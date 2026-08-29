#!/usr/bin/env ruby
# frozen_string_literal: true

require "digest"
require "fileutils"
require "find"
require "json"
require "pathname"
require "yaml"
require "zlib"

module FixtureGenerator
  REPOSITORY_ROOT = File.realpath(File.expand_path("..", __dir__))
  PLAN_FIELDS = %w[fixtureVersion generatedBy sensitive artifacts].freeze
  ARTIFACT_FIELDS = %w[
    id
    kind
    path
    encoding
    newline
    expectedMode
    ownerIntent
    parameters
    expectedSha256
    expectedBytes
    expectedFiles
  ].freeze
  OWNER_INTENT_FIELDS = %w[owner evidenceIds consumerTasks].freeze
  EXPECTED_MODES = %w[editable/normal editable/largeText safetyBlocked unsupported workspace asset recovery].freeze
  ENCODINGS = %w[utf-8 binary mixed].freeze
  NEWLINES = %w[lf crlf mixed none].freeze
  RESERVED_OUTPUT_PATHS = ["generation-manifest.json"].freeze
  MAX_GENERATED_BYTES = 32 * 1024 * 1024
  MAX_LINE_BYTES = 2 * 1024 * 1024

  KIND_SPECIFICATIONS = {
    "empty_file" => { parameters: {}, encoding: "utf-8", newline: "none" },
    "normal_multiline" => {
      parameters: { "bytes" => (1..MAX_GENERATED_BYTES) },
      encoding: "utf-8",
      newline: "lf"
    },
    "data_image_single_line" => {
      parameters: { "payloadBytes" => (1..MAX_GENERATED_BYTES) },
      encoding: "utf-8",
      newline: "lf"
    },
    "single_line" => {
      parameters: { "lineBytes" => (1..MAX_LINE_BYTES) },
      encoding: "utf-8",
      newline: "lf"
    },
    "invalid_utf8" => { parameters: {}, encoding: "binary", newline: "none" },
    "bom_crlf" => { parameters: {}, encoding: "utf-8", newline: "crlf" },
    "mixed_newlines" => { parameters: {}, encoding: "utf-8", newline: "mixed" },
    "dense_tables" => {
      parameters: { "tableCount" => (1..10_000) },
      encoding: "utf-8",
      newline: "lf"
    },
    "broken_link" => { parameters: {}, encoding: "utf-8", newline: "lf" },
    "malicious_source" => { parameters: {}, encoding: "utf-8", newline: "lf" },
    "synthetic_workspace" => {
      parameters: {
        "markdownFiles" => (1..1_000),
        "linksPerFile" => (0..1_000),
        "mermaidFiles" => (0..1_000),
        "imageReferences" => (0..1_000)
      },
      encoding: "utf-8",
      newline: "lf"
    },
    "nested_markers" => {
      parameters: { "depth" => (1_000..10_000) },
      encoding: "utf-8",
      newline: "lf"
    },
    "mermaid_nodes" => {
      parameters: { "nodeCount" => (1..100_000) },
      encoding: "utf-8",
      newline: "lf"
    },
    "image_matrix" => {
      parameters: {
        "oversizedWidth" => (1..1_000_000),
        "oversizedHeight" => (1..1_000_000)
      },
      encoding: "binary",
      newline: "none"
    },
    "symlink_workspace" => { parameters: {}, encoding: "utf-8", newline: "lf" },
    "recovery_bundle" => { parameters: {}, encoding: "mixed", newline: "mixed" }
  }.freeze

  JPEG_ONE_PIXEL_HEX = (
    "ffd8ffe000104a46494600010100000100010000ffdb004300100b0c0e0c0a100e0d0e1211101318281a181616183123251d283a333d3c3933383740485c4e404457453738506d51575f626768673e4d71797064785c656763" \
    "ffc0000b080001000101011100ffc4001f0000010501010101010100000000000000000102030405060708090a0bffc400b5100002010303020403050504040000017d01020300041105122131410613516107227114328191a1082342b1c11552d1f02433627282090a161718191a25262728292a3435363738393a434445464748494a535455565758595a636465666768696a737475767778797a838485868788898a92939495969798999aa2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae1e2e3e4e5e6e7e8e9eaf1f2f3f4f5f6f7f8f9fa" \
    "ffda0008010100003f002bffd9"
  ).freeze

  module_function

  def exact_keys!(value, expected, label)
    raise ArgumentError, "#{label} must be a mapping" unless value.is_a?(Hash)

    actual = value.keys
    missing = expected - actual
    extra = actual - expected
    raise ArgumentError, "#{label} missing fields: #{missing.join(", ")}" unless missing.empty?
    raise ArgumentError, "#{label} has unknown fields: #{extra.join(", ")}" unless extra.empty?
  end

  def validate_owner_intent!(owner_intent, label)
    exact_keys!(owner_intent, OWNER_INTENT_FIELDS, "#{label}.ownerIntent")
    raise ArgumentError, "#{label}.ownerIntent.owner must be QA" unless owner_intent["owner"] == "QA"

    evidence_ids = owner_intent["evidenceIds"]
    unless evidence_ids.is_a?(Array) && !evidence_ids.empty? && evidence_ids.all? { |id| id.is_a?(String) }
      raise ArgumentError, "#{label}.ownerIntent.evidenceIds must be a non-empty string array"
    end
    unless evidence_ids.uniq.length == evidence_ids.length && evidence_ids.all? { |id| id.match?(/\A[A-Z]+(?:-[A-Z]+)*-[0-9]{3}\z/) }
      raise ArgumentError, "#{label}.ownerIntent.evidenceIds must contain unique stable test IDs"
    end

    consumer_tasks = owner_intent["consumerTasks"]
    unless consumer_tasks.is_a?(Array) && !consumer_tasks.empty? && consumer_tasks.all? { |id| id.is_a?(String) }
      raise ArgumentError, "#{label}.ownerIntent.consumerTasks must be a non-empty string array"
    end
    unless consumer_tasks.uniq.length == consumer_tasks.length && consumer_tasks.all? { |id| id.match?(/\AP[0-9]+-[A-Z0-9]+(?:-[A-Z0-9]+)*\z/) }
      raise ArgumentError, "#{label}.ownerIntent.consumerTasks must contain unique stable task IDs"
    end
  end

  def validate_relative_path!(path, label)
    raise ArgumentError, "#{label} must be a non-empty string" unless path.is_a?(String) && !path.empty?
    raise ArgumentError, "#{label} contains a NUL byte" if path.include?("\0")

    pathname = Pathname.new(path)
    clean = pathname.cleanpath.to_s
    if pathname.absolute? || clean != path || clean == "." || path.split("/").include?("..")
      raise ArgumentError, "#{label} must be a normalized relative path"
    end
  end

  def validate_plan!(plan)
    exact_keys!(plan, PLAN_FIELDS, "generated plan")
    raise ArgumentError, "generated plan fixtureVersion must be 1" unless plan["fixtureVersion"] == 1
    unless plan["generatedBy"] == "tools/generate_fixtures.rb"
      raise ArgumentError, "generated plan generatedBy must name tools/generate_fixtures.rb"
    end
    raise ArgumentError, "generated plan sensitive must be false" unless plan["sensitive"] == false

    artifacts = plan["artifacts"]
    raise ArgumentError, "generated plan artifacts must be a non-empty array" unless artifacts.is_a?(Array) && !artifacts.empty?

    ids = {}
    paths = []
    artifacts.each_with_index do |artifact, index|
      label = "generated plan artifact[#{index}]"
      exact_keys!(artifact, ARTIFACT_FIELDS, label)

      id = artifact["id"]
      unless id.is_a?(String) && id.match?(/\A(?:markdown|workspace|asset|recovery)\.[a-z0-9.-]+\z/)
        raise ArgumentError, "#{label}.id is invalid"
      end
      raise ArgumentError, "generated plan duplicate id #{id}" if ids.key?(id)
      ids[id] = true

      kind = artifact["kind"]
      specification = KIND_SPECIFICATIONS[kind]
      raise ArgumentError, "#{label}.kind is unsupported" unless specification

      path = artifact["path"]
      validate_relative_path!(path, "#{label}.path")
      raise ArgumentError, "#{label}.path is reserved" if RESERVED_OUTPUT_PATHS.include?(path)
      paths.each do |other|
        if path == other || path.start_with?("#{other}/") || other.start_with?("#{path}/")
          raise ArgumentError, "generated plan artifact paths overlap: #{other} and #{path}"
        end
      end
      paths << path

      encoding = artifact["encoding"]
      newline = artifact["newline"]
      expected_mode = artifact["expectedMode"]
      raise ArgumentError, "#{label}.encoding is unsupported" unless ENCODINGS.include?(encoding)
      raise ArgumentError, "#{label}.newline is unsupported" unless NEWLINES.include?(newline)
      raise ArgumentError, "#{label}.expectedMode is unsupported" unless EXPECTED_MODES.include?(expected_mode)
      unless encoding == specification.fetch(:encoding) && newline == specification.fetch(:newline)
        raise ArgumentError, "#{label} encoding/newline do not match kind #{kind}"
      end

      validate_owner_intent!(artifact["ownerIntent"], label)

      parameters = artifact["parameters"]
      exact_keys!(parameters, specification.fetch(:parameters).keys, "#{label}.parameters")
      specification.fetch(:parameters).each do |name, range|
        value = parameters[name]
        unless value.is_a?(Integer) && range.cover?(value)
          raise ArgumentError, "#{label}.parameters.#{name} must be an integer in #{range}"
        end
      end
      if kind == "normal_multiline" && (parameters.fetch("bytes") % 128) != 0
        raise ArgumentError, "#{label}.parameters.bytes must be divisible by 128"
      end
      if kind == "synthetic_workspace"
        markdown_files = parameters.fetch("markdownFiles")
        if parameters.fetch("mermaidFiles") > markdown_files || parameters.fetch("imageReferences") > markdown_files
          raise ArgumentError, "#{label} Mermaid/image counts cannot exceed Markdown file count"
        end
      end

      sha256 = artifact["expectedSha256"]
      unless sha256.is_a?(String) && sha256.match?(/\A[0-9a-f]{64}\z/)
        raise ArgumentError, "#{label}.expectedSha256 must be a lowercase SHA-256"
      end
      unless artifact["expectedBytes"].is_a?(Integer) && artifact["expectedBytes"] >= 0
        raise ArgumentError, "#{label}.expectedBytes must be a non-negative integer"
      end
      unless artifact["expectedFiles"].is_a?(Integer) && artifact["expectedFiles"] >= 1
        raise ArgumentError, "#{label}.expectedFiles must be a positive integer"
      end
    end

    plan
  end

  def load_plan(plan_path)
    bytes = File.binread(plan_path)
    plan = YAML.safe_load(
      bytes,
      permitted_classes: [],
      permitted_symbols: [],
      aliases: false,
      filename: plan_path
    )
    validate_plan!(plan)
  rescue Psych::Exception => error
    raise ArgumentError, "generated plan YAML is invalid: #{error.message.lines.first.strip}"
  end

  def path_within?(candidate, root)
    candidate == root || candidate.start_with?("#{root}#{File::SEPARATOR}")
  end

  def canonicalize_from_nearest_existing(path)
    cursor = File.expand_path(path)
    suffix = []
    until File.exist?(cursor) || File.symlink?(cursor)
      parent = File.dirname(cursor)
      raise ArgumentError, "cannot resolve output path" if parent == cursor

      suffix.unshift(File.basename(cursor))
      cursor = parent
    end

    File.expand_path(File.join(File.realpath(cursor), *suffix))
  rescue SystemCallError => error
    raise ArgumentError, "cannot resolve output path: #{error.class}"
  end

  def canonicalize_output_root!(output_root, repository_root: REPOSITORY_ROOT)
    requested = File.expand_path(String(output_root))
    repository_lexical = File.expand_path(String(repository_root))
    repository_canonical = File.realpath(repository_lexical)
    if path_within?(requested, repository_lexical)
      raise ArgumentError, "generated fixtures must stay outside the repository"
    end

    canonical = canonicalize_from_nearest_existing(requested)
    if path_within?(canonical, repository_canonical)
      raise ArgumentError, "generated fixtures must stay outside the repository after symlink resolution"
    end

    canonical
  rescue SystemCallError => error
    raise ArgumentError, "cannot resolve repository boundary: #{error.class}"
  end

  def ensure_empty_output!(output_root)
    if File.exist?(output_root)
      raise ArgumentError, "output path must be a directory" unless File.directory?(output_root)
      raise ArgumentError, "output directory must be absent or empty: #{output_root}" unless Dir.empty?(output_root)
    elsif File.symlink?(output_root)
      raise ArgumentError, "output directory is a dangling symlink"
    end

    FileUtils.mkdir_p(output_root)
    File.realpath(output_root)
  rescue SystemCallError => error
    raise ArgumentError, "cannot prepare output directory: #{error.class}"
  end

  def binary_write(path, bytes)
    FileUtils.mkdir_p(File.dirname(path))
    File.open(path, "wb") { |file| file.write(bytes.b) }
  end

  def write_repeated(path, bytes, line)
    raise ArgumentError, "line must divide requested bytes" unless (bytes % line.bytesize).zero?

    FileUtils.mkdir_p(File.dirname(path))
    File.open(path, "wb") do |file|
      (bytes / line.bytesize).times { file.write(line) }
    end
  end

  def write_empty_file(path, _parameters)
    binary_write(path, "".b)
  end

  def write_normal_multiline(path, parameters)
    line = "ordinary markdown text " + ("x" * 104) + "\n"
    raise "normal line generator invariant changed" unless line.bytesize == 128

    write_repeated(path, Integer(parameters.fetch("bytes")), line)
  end

  def write_data_image_single_line(path, parameters)
    FileUtils.mkdir_p(File.dirname(path))
    File.open(path, "wb") do |file|
      file.write("![oversized](data:image/png;base64,")
      remaining = Integer(parameters.fetch("payloadBytes"))
      chunk = "A" * (64 * 1024)
      while remaining.positive?
        count = [remaining, chunk.bytesize].min
        file.write(chunk.byteslice(0, count))
        remaining -= count
      end
      file.write(")\n")
    end
  end

  def write_single_line(path, parameters)
    FileUtils.mkdir_p(File.dirname(path))
    File.open(path, "wb") do |file|
      remaining = Integer(parameters.fetch("lineBytes"))
      chunk = "x" * (64 * 1024)
      while remaining.positive?
        count = [remaining, chunk.bytesize].min
        file.write(chunk.byteslice(0, count))
        remaining -= count
      end
      file.write("\n")
    end
  end

  def write_invalid_utf8(path, _parameters)
    binary_write(path, "# invalid utf-8\nvalid prefix\n".b + [0xF0, 0x28, 0x8C, 0x28, 0xFF].pack("C*"))
  end

  def write_bom_crlf(path, _parameters)
    binary_write(path, [0xEF, 0xBB, 0xBF].pack("C*") + "# BOM\r\n\r\nCRLF body\r\n".b)
  end

  def write_mixed_newlines(path, _parameters)
    binary_write(path, "# LF\nCRLF body\r\nlegacy CR\rfinal LF\n".b)
  end

  def write_dense_tables(path, parameters)
    FileUtils.mkdir_p(File.dirname(path))
    File.open(path, "wb") do |file|
      Integer(parameters.fetch("tableCount")).times do |index|
        file.write("## Table %03d\n\n" % (index + 1))
        file.write("| key | 中文 value | escaped |\n")
        file.write("| --- | :----------: | ------: |\n")
        file.write("| row-%03d | 值 %03d | a \\| b |\n\n" % [index + 1, index + 1])
      end
    end
  end

  def write_broken_link(path, _parameters)
    binary_write(path, "# Broken link\n\n[Intentional missing target](./missing.md)\n")
  end

  def write_malicious_source(path, _parameters)
    binary_write(
      path,
      <<~MARKDOWN
        # Untrusted source vectors

        [Path traversal](../../../../outside.md)

        [Dangerous scheme](javascript:alert%28%27blocked%27%29)

        <a href="javascript:alert('blocked')">unsafe HTML link</a>

        <img src="missing.png" onerror="alert('blocked')">

        <svg xmlns="http://www.w3.org/2000/svg" onload="alert('blocked')">
          <a href="javascript:alert('blocked')"><text>unsafe SVG link</text></a>
        </svg>
      MARKDOWN
    )
  end

  def write_synthetic_workspace(path, parameters)
    file_count = Integer(parameters.fetch("markdownFiles"))
    links_per_file = Integer(parameters.fetch("linksPerFile"))
    mermaid_file_count = Integer(parameters.fetch("mermaidFiles"))
    image_reference_count = Integer(parameters.fetch("imageReferences"))
    FileUtils.mkdir_p(File.join(path, "docs"))
    FileUtils.mkdir_p(File.join(path, "assets"))
    binary_write(
      File.join(path, "assets", "diagram.svg"),
      "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"8\" height=\"8\"><path d=\"M0 0h8v8H0z\"/></svg>\n"
    )

    mermaid_indexes = (0...mermaid_file_count).map { |index| (index * file_count) / mermaid_file_count }

    file_count.times do |index|
      number = index + 1
      content = +"# 合成文档 %03d\n\n" % number
      content << "| key | value |\n| --- | --- |\n| doc | %03d |\n\n" % number
      links_per_file.times do |offset|
        target = ((index + offset + 1) % file_count) + 1
        content << "- [文档 %03d](./doc-%03d.md#合成文档-%03d)\n" % [target, target, target]
      end
      content << "\n"
      content << "![synthetic](../assets/diagram.svg)\n\n" if index < image_reference_count
      if mermaid_indexes.include?(index)
        content << "```mermaid\nflowchart LR\n  A#{number} --> B#{number}\n```\n"
      end
      binary_write(File.join(path, "docs", "doc-%03d.md" % number), content)
    end
  end

  def write_nested_markers(path, parameters)
    depth = Integer(parameters.fetch("depth"))
    binary_write(path, ("*" * depth) + "深度标记" + ("*" * depth) + "\n")
  end

  def write_mermaid_nodes(path, parameters)
    node_count = Integer(parameters.fetch("nodeCount"))
    FileUtils.mkdir_p(File.dirname(path))
    File.open(path, "wb") do |file|
      file.write("# Mermaid node limit\n\n```mermaid\nflowchart LR\n")
      node_count.times { |index| file.write("  N#{index}[node #{index}]\n") }
      file.write("```\n")
    end
  end

  def png_chunk(type, data)
    [data.bytesize].pack("N") + type + data + [Zlib.crc32(type + data)].pack("N")
  end

  def png_bytes(width, height, rgba)
    signature = "\x89PNG\r\n\x1A\n".b
    ihdr = [width, height, 8, 6, 0, 0, 0].pack("NNC5")
    scanline = "\x00".b + rgba.pack("C4")
    signature + png_chunk("IHDR".b, ihdr) + png_chunk("IDAT".b, Zlib::Deflate.deflate(scanline)) + png_chunk("IEND".b, "".b)
  end

  def write_image_matrix(path, parameters)
    FileUtils.mkdir_p(path)
    opaque_png = png_bytes(1, 1, [0x22, 0x66, 0xAA, 0xFF])
    transparent_png = png_bytes(1, 1, [0x00, 0x00, 0x00, 0x00])
    oversized_png = png_bytes(
      Integer(parameters.fetch("oversizedWidth")),
      Integer(parameters.fetch("oversizedHeight")),
      [0x00, 0x00, 0x00, 0x00]
    )
    binary_write(File.join(path, "valid.png"), opaque_png)
    binary_write(File.join(path, "transparent.png"), transparent_png)
    binary_write(File.join(path, "valid.jpg"), [JPEG_ONE_PIXEL_HEX].pack("H*"))
    binary_write(File.join(path, "wrong-mime.jpg"), opaque_png)
    binary_write(File.join(path, "oversized-dimensions.png"), oversized_png)
  end

  def write_symlink_workspace(path, _parameters)
    binary_write(File.join(path, "outside.md"), "# Outside granted workspace\n")
    binary_write(File.join(path, "workspace", "inside.md"), "# Inside granted workspace\n")
    File.symlink("../outside.md", File.join(path, "workspace", "escape.md"))
  end

  def write_recovery_bundle(path, _parameters)
    binary_write(File.join(path, "dirty", "disk.md"), "# Disk baseline\n")
    binary_write(File.join(path, "dirty", "checkpoint.md"), "# Unsaved checkpoint\n\nlocal edit\n")
    binary_write(File.join(path, "corrupt", "checkpoint.bin"), [0x00, 0xFF, 0x13, 0x37].pack("C*"))
    binary_write(File.join(path, "revision", "disk-v1.md"), "# Revision one\n")
    binary_write(File.join(path, "revision", "disk-v2.md"), "# Revision two\n")
    binary_write(File.join(path, "staging", "draft.md"), "# Draft with staged asset\n\n![staged](./assets/paste.png)\n")
    binary_write(File.join(path, "staging", "assets", "paste.png"), png_bytes(1, 1, [0x44, 0x88, 0xCC, 0xFF]))
    binary_write(File.join(path, "startup-loop", "poison.md"), "# Poison candidate\n\n" + ("*" * 4_096) + "\n")
    index = {
      "fixtureVersion" => 1,
      "scenarios" => %w[dirty corrupt revision-change staging startup-loop]
    }
    binary_write(File.join(path, "scenario-index.json"), JSON.pretty_generate(index) + "\n")
  end

  WRITERS = {
    "empty_file" => :write_empty_file,
    "normal_multiline" => :write_normal_multiline,
    "data_image_single_line" => :write_data_image_single_line,
    "single_line" => :write_single_line,
    "invalid_utf8" => :write_invalid_utf8,
    "bom_crlf" => :write_bom_crlf,
    "mixed_newlines" => :write_mixed_newlines,
    "dense_tables" => :write_dense_tables,
    "broken_link" => :write_broken_link,
    "malicious_source" => :write_malicious_source,
    "synthetic_workspace" => :write_synthetic_workspace,
    "nested_markers" => :write_nested_markers,
    "mermaid_nodes" => :write_mermaid_nodes,
    "image_matrix" => :write_image_matrix,
    "symlink_workspace" => :write_symlink_workspace,
    "recovery_bundle" => :write_recovery_bundle
  }.freeze

  def tree_digest(path)
    entries = []
    Find.find(path) do |entry|
      next if entry == path

      relative = entry.delete_prefix("#{path}/")
      stat = File.lstat(entry)
      if stat.symlink?
        entries << [relative, "symlink", File.readlink(entry).b]
      elsif stat.file?
        entries << [relative, "file", File.binread(entry)]
      elsif !stat.directory?
        raise ArgumentError, "generated artifact contains an unsupported filesystem entry: #{relative}"
      end
    end

    digest = Digest::SHA256.new
    total_bytes = 0
    entries.sort_by(&:first).each do |relative, type, bytes|
      digest.update(relative)
      digest.update("\0")
      digest.update(type)
      digest.update("\0")
      digest.update(bytes)
      total_bytes += bytes.bytesize
    end
    [digest.hexdigest, total_bytes, entries.length]
  end

  def artifact_digest(path)
    return tree_digest(path) if File.directory?(path)

    [Digest::SHA256.file(path).hexdigest, File.size(path), 1]
  end

  def generate(plan_path, output_root, repository_root: REPOSITORY_ROOT)
    canonical_root = canonicalize_output_root!(output_root, repository_root: repository_root)
    plan = load_plan(plan_path)
    canonical_root = ensure_empty_output!(canonical_root)
    results = plan.fetch("artifacts").map do |artifact|
      writer = WRITERS.fetch(artifact.fetch("kind"))
      output_path = File.expand_path(artifact.fetch("path"), canonical_root)
      unless path_within?(output_path, canonical_root) && output_path != canonical_root
        raise ArgumentError, "generated artifact escapes output directory: #{artifact.fetch("path")}"
      end
      public_send(writer, output_path, artifact.fetch("parameters"))
      resolved_artifact = File.realpath(output_path)
      unless path_within?(resolved_artifact, canonical_root)
        raise ArgumentError, "generated artifact resolves outside output directory: #{artifact.fetch("path")}"
      end
      sha256, bytes, files = artifact_digest(output_path)
      {
        "id" => artifact.fetch("id"),
        "path" => artifact.fetch("path"),
        "encoding" => artifact.fetch("encoding"),
        "newline" => artifact.fetch("newline"),
        "expectedMode" => artifact.fetch("expectedMode"),
        "ownerIntent" => artifact.fetch("ownerIntent"),
        "sha256" => sha256,
        "bytes" => bytes,
        "files" => files
      }
    end

    manifest = {
      "fixtureVersion" => plan.fetch("fixtureVersion"),
      "generatedBy" => plan.fetch("generatedBy"),
      "sensitive" => false,
      "artifacts" => results
    }
    binary_write(File.join(canonical_root, "generation-manifest.json"), JSON.pretty_generate(manifest) + "\n")
    manifest
  end
end

if $PROGRAM_NAME == __FILE__
  unless ARGV.length.between?(1, 2)
    warn "usage: ruby tools/generate_fixtures.rb OUTPUT_DIR [PLAN_PATH]"
    exit 2
  end

  output_root = ARGV.fetch(0)
  plan_path = File.expand_path(ARGV.fetch(1, File.join(__dir__, "..", "tests", "fixtures", "generated-plan.yml")))
  manifest = FixtureGenerator.generate(plan_path, output_root)
  puts "generated_fixtures=PASS artifacts=#{manifest.fetch("artifacts").length}"
end
