#!/usr/bin/env ruby
# frozen_string_literal: true

require "fileutils"
require "find"
require "json"
require "open3"
require "pathname"
require "tmpdir"
require "yaml"
require_relative "../tools/generate_fixtures"

REPO_ROOT = Pathname.new(File.realpath(File.expand_path("..", __dir__)))
FIXTURE_ROOT = REPO_ROOT.join("tests", "fixtures")
FIXTURE_ROOT_REAL = File.realpath(FIXTURE_ROOT.to_s)
MANIFEST_FIELDS = %w[
  fixtureVersion
  id
  purpose
  encoding
  newline
  expectedMode
  sensitive
  generatedBy
  ownerIntent
  files
].freeze
EXPECTED_MODES = FixtureGenerator::EXPECTED_MODES.freeze
ENCODINGS = FixtureGenerator::ENCODINGS.freeze
NEWLINES = FixtureGenerator::NEWLINES.freeze
MIB = 1024 * 1024

REQUIRED_COMMITTED_IDS = %w[
  asset.images.corrupt-png-001
  asset.images.transparent-svg-001
  markdown.canonical.source-basics-001
  markdown.canonical.unknown-syntax-001
  markdown.cjk.composition-001
  markdown.images.relative-001
  markdown.links.duplicates-relative-001
  markdown.math.source-only-001
  markdown.mermaid.valid-invalid-malicious-001
  markdown.tables.gfm-edge-001
  markdown.tables.wide-24-columns-001
  workspace.conflicts.external-change-001
  workspace.navigation.directory-links-001
  workspace.paths.unicode-space-001
].freeze

REQUIRED_GENERATED_IDS = %w[
  asset.images.validation-matrix-001
  markdown.canonical.empty-001
  markdown.encodings.bom-crlf-001
  markdown.encodings.invalid-utf8-001
  markdown.encodings.mixed-newlines-001
  markdown.links.broken-relative-001
  markdown.malicious.source-vectors-001
  markdown.mermaid.node-limit-5001-001
  markdown.pathological.data-image-single-line-10mib-001
  markdown.pathological.line-boundary-exact-001
  markdown.pathological.line-boundary-over-001
  markdown.pathological.line-boundary-under-001
  markdown.pathological.nested-markers-4096-001
  markdown.pathological.normal-multiline-10mib-001
  markdown.tables.dense-300-001
  recovery.scenarios.core-001
  workspace.malicious.symlink-escape-001
  workspace.synthetic.shape-79-001
].freeze

def fail_with(errors)
  warn "fixture_validation=FAIL count=#{errors.length}"
  errors.each { |error| warn "ERROR #{error}" }
  exit 1
end

def safe_yaml(path)
  YAML.safe_load(
    File.binread(path),
    permitted_classes: [],
    permitted_symbols: [],
    aliases: false,
    filename: path
  )
end

def relative_to_repo(path)
  Pathname.new(path).relative_path_from(REPO_ROOT).to_s
end

def relative_to_fixture(path)
  Pathname.new(path).relative_path_from(FIXTURE_ROOT).to_s
end

def validate_regular_file(path, root, label)
  stat = File.lstat(path)
  return "#{label}: symlinks are forbidden" if stat.symlink?
  return "#{label}: must be a regular file" unless stat.file?

  canonical = File.realpath(path)
  root_canonical = File.realpath(root)
  return "#{label}: resolves outside fixture root" unless FixtureGenerator.path_within?(canonical, root_canonical)

  nil
rescue SystemCallError => error
  "#{label}: cannot lstat/realpath (#{error.class})"
end

def scan_fixture_tree
  errors = []
  regular_files = []
  root_stat = File.lstat(FIXTURE_ROOT.to_s)
  errors << "tests/fixtures: fixture root must not be a symlink" if root_stat.symlink?
  errors << "tests/fixtures: fixture root must be a directory" unless root_stat.directory?

  Find.find(FIXTURE_ROOT.to_s) do |entry|
    next if entry == FIXTURE_ROOT.to_s

    relative = relative_to_fixture(entry)
    stat = File.lstat(entry)
    if stat.symlink?
      errors << "tests/fixtures/#{relative}: committed fixture symlinks are forbidden"
      Find.prune
    elsif stat.file?
      canonical = File.realpath(entry)
      unless FixtureGenerator.path_within?(canonical, FIXTURE_ROOT_REAL)
        errors << "tests/fixtures/#{relative}: committed fixture resolves outside fixture root"
      end
      regular_files << entry
    elsif !stat.directory?
      errors << "tests/fixtures/#{relative}: unsupported filesystem entry #{stat.ftype}"
    end
  rescue SystemCallError => error
    errors << "tests/fixtures/#{relative}: cannot inspect entry (#{error.class})"
    Find.prune
  end

  [errors, regular_files.sort]
rescue SystemCallError => error
  [["tests/fixtures: cannot inspect fixture root (#{error.class})"], []]
end

def validate_exact_fields(value, expected, label, errors)
  unless value.is_a?(Hash)
    errors << "#{label}: must be a mapping"
    return false
  end

  missing = expected - value.keys
  extra = value.keys - expected
  errors << "#{label}: missing fields #{missing.join(", ")}" unless missing.empty?
  errors << "#{label}: unknown fields #{extra.join(", ")}" unless extra.empty?
  missing.empty? && extra.empty?
end

def validate_newlines(bytes, encoding, newline, label, errors)
  if encoding == "binary"
    errors << "#{label}: binary fixtures must declare newline none" unless newline == "none"
    return
  end
  return if encoding == "mixed"

  case newline
  when "lf"
    errors << "#{label}: LF fixture contains CR bytes" if bytes.include?("\r")
  when "crlf"
    reduced = bytes.gsub("\r\n", "")
    unless bytes.include?("\r\n") && !reduced.include?("\r") && !reduced.include?("\n")
      errors << "#{label}: CRLF fixture contains a bare CR/LF or no CRLF"
    end
  when "mixed"
    without_crlf = bytes.gsub("\r\n", "")
    unless bytes.include?("\r\n") && without_crlf.include?("\n") && without_crlf.include?("\r")
      errors << "#{label}: mixed fixture must contain CRLF, bare LF, and bare CR"
    end
  when "none"
    errors << "#{label}: newline none fixture contains CR/LF" if bytes.include?("\r") || bytes.include?("\n")
  end
end

def validate_committed_manifests(regular_files)
  errors = []
  ids = {}
  covered = {}
  manifests = regular_files.select { |path| path.end_with?(".fixture.yml") }

  manifests.each do |manifest_path|
    relative_manifest = relative_to_repo(manifest_path)
    file_error = validate_regular_file(manifest_path, FIXTURE_ROOT.to_s, relative_manifest)
    if file_error
      errors << file_error
      next
    end

    manifest = safe_yaml(manifest_path)
    next unless validate_exact_fields(manifest, MANIFEST_FIELDS, relative_manifest, errors)

    errors << "#{relative_manifest}: fixtureVersion must be integer 1" unless manifest["fixtureVersion"] == 1

    id = manifest["id"]
    unless id.is_a?(String) && id.match?(/\A(?:markdown|workspace|asset|recovery)\.[a-z0-9.-]+\z/)
      errors << "#{relative_manifest}: invalid id"
    end
    errors << "#{relative_manifest}: duplicate id #{id}" if ids.key?(id)
    ids[id] = relative_manifest if id.is_a?(String)

    purpose = manifest["purpose"]
    unless purpose.is_a?(String) && !purpose.strip.empty? && purpose.bytesize <= 300
      errors << "#{relative_manifest}: purpose must be a non-empty string no longer than 300 bytes"
    end

    encoding = manifest["encoding"]
    newline = manifest["newline"]
    expected_mode = manifest["expectedMode"]
    errors << "#{relative_manifest}: unsupported encoding #{encoding.inspect}" unless ENCODINGS.include?(encoding)
    errors << "#{relative_manifest}: unsupported newline #{newline.inspect}" unless NEWLINES.include?(newline)
    errors << "#{relative_manifest}: unsupported expectedMode #{expected_mode.inspect}" unless EXPECTED_MODES.include?(expected_mode)
    errors << "#{relative_manifest}: sensitive must be false" unless manifest["sensitive"] == false
    unless manifest["generatedBy"] == "committed-synthetic"
      errors << "#{relative_manifest}: generatedBy must be committed-synthetic"
    end

    begin
      FixtureGenerator.validate_owner_intent!(manifest["ownerIntent"], relative_manifest)
    rescue ArgumentError => error
      errors << error.message
    end

    files = manifest["files"]
    unless files.is_a?(Array) && !files.empty? && files.all? { |entry| entry.is_a?(String) }
      errors << "#{relative_manifest}: files must be a non-empty string array"
      next
    end
    errors << "#{relative_manifest}: files must be unique" unless files.uniq.length == files.length

    files.each do |entry|
      begin
        FixtureGenerator.validate_relative_path!(entry, "#{relative_manifest}.files")
      rescue ArgumentError => error
        errors << error.message
        next
      end

      resolved = File.expand_path(entry, File.dirname(manifest_path))
      file_error = validate_regular_file(resolved, FIXTURE_ROOT.to_s, "#{relative_manifest}: #{entry}")
      if file_error
        errors << file_error
        next
      end

      relative_file = relative_to_fixture(resolved)
      errors << "#{relative_manifest}: file covered twice: #{relative_file}" if covered.key?(relative_file)
      covered[relative_file] = relative_manifest

      bytes = File.binread(resolved)
      if encoding == "utf-8"
        text = bytes.dup.force_encoding(Encoding::UTF_8)
        errors << "#{relative_manifest}: #{entry} is not valid UTF-8" unless text.valid_encoding?
      end
      validate_newlines(bytes, encoding, newline, "#{relative_manifest}: #{entry}", errors)
    end
  rescue Psych::Exception => error
    errors << "#{relative_manifest}: invalid YAML: #{error.message.lines.first.strip}"
  rescue SystemCallError => error
    errors << "#{relative_manifest}: cannot inspect manifest (#{error.class})"
  end

  committed_files = regular_files
    .map { |path| relative_to_fixture(path) }
    .reject { |path| path.end_with?(".fixture.yml") || path == "generated-plan.yml" }
  committed_files.reject { |path| covered.key?(path) }.each do |path|
    errors << "uncovered committed fixture file: #{path}"
  end

  missing_ids = REQUIRED_COMMITTED_IDS - ids.keys
  extra_ids = ids.keys - REQUIRED_COMMITTED_IDS
  errors << "committed fixture IDs missing: #{missing_ids.join(", ")}" unless missing_ids.empty?
  errors << "unexpected committed fixture IDs: #{extra_ids.join(", ")}" unless extra_ids.empty?

  [errors, manifests.length, committed_files.length, ids]
end

def validate_git_attributes(regular_files)
  errors = []
  fixture_paths = regular_files.map { |path| relative_to_repo(path) }
  return [["git attribute validation found no fixture paths"], 0] if fixture_paths.empty?

  stdout, stderr, status = Open3.capture3(
    "git",
    "check-attr",
    "-z",
    "text",
    "--",
    *fixture_paths,
    chdir: REPO_ROOT.to_s
  )
  unless status.success?
    errors << "git check-attr text failed: #{stderr.lines.first.to_s.strip}"
    return [errors, 0]
  end

  fields = stdout.split("\0")
  fields.pop while fields.last == ""
  if (fields.length % 3) != 0
    errors << "git check-attr returned a malformed NUL-delimited response"
    return [errors, 0]
  end

  checked = 0
  fields.each_slice(3) do |path, attribute, value|
    checked += 1
    errors << "#{path}: expected text attribute name" unless attribute == "text"
    errors << "#{path}: fixture bytes are not pinned with -text (actual=#{value})" unless value == "unset"
  end
  errors << "git check-attr did not report every fixture file" unless checked == fixture_paths.length
  [errors, checked]
end

def plan_artifact(plan, id)
  plan.fetch("artifacts").find { |artifact| artifact.fetch("id") == id }
end

def artifact_output_path(output_root, plan, id)
  artifact = plan_artifact(plan, id)
  raise "missing generated artifact #{id}" unless artifact

  File.join(output_root, artifact.fetch("path"))
end

def assert_bytes(condition, message, errors)
  errors << message unless condition
end

def validate_png(path, expected_width, expected_height, label, errors, complete_pixels: true)
  bytes = File.binread(path)
  signature = "\x89PNG\r\n\x1A\n".b
  assert_bytes(bytes.start_with?(signature), "#{label}: missing PNG signature", errors)
  assert_bytes(bytes.bytesize >= 33, "#{label}: PNG is too short", errors)
  return if bytes.bytesize < 33

  chunks = []
  offset = signature.bytesize
  while offset + 12 <= bytes.bytesize
    length = bytes.byteslice(offset, 4).unpack1("N")
    type = bytes.byteslice(offset + 4, 4)
    data = bytes.byteslice(offset + 8, length)
    crc_bytes = bytes.byteslice(offset + 8 + length, 4)
    if data.nil? || crc_bytes.nil?
      errors << "#{label}: truncated PNG chunk"
      break
    end
    expected_crc = crc_bytes.unpack1("N")
    actual_crc = Zlib.crc32(type + data)
    errors << "#{label}: invalid #{type.inspect} CRC" unless actual_crc == expected_crc
    chunks << [type, data]
    offset += 12 + length
    break if type == "IEND"
  end

  ihdr = chunks.first
  assert_bytes(ihdr && ihdr[0] == "IHDR" && ihdr[1].bytesize == 13, "#{label}: first PNG chunk is not IHDR", errors)
  return unless ihdr && ihdr[1].bytesize == 13

  width, height = ihdr[1].byteslice(0, 8).unpack("NN")
  assert_bytes(width == expected_width && height == expected_height, "#{label}: PNG dimensions drift", errors)
  assert_bytes(chunks.last && chunks.last[0] == "IEND", "#{label}: PNG is missing IEND", errors)
  return unless complete_pixels

  compressed = chunks.select { |type, _data| type == "IDAT" }.map(&:last).join
  begin
    pixels = Zlib::Inflate.inflate(compressed)
    assert_bytes(pixels.bytesize == 1 + (width * 4 * height), "#{label}: decompressed RGBA byte count drift", errors)
  rescue Zlib::Error => error
    errors << "#{label}: IDAT cannot be decompressed (#{error.class})"
  end
end

def validate_jpeg(path, label, errors)
  bytes = File.binread(path)
  assert_bytes(bytes.start_with?("\xFF\xD8".b), "#{label}: missing JPEG SOI", errors)
  assert_bytes(bytes.end_with?("\xFF\xD9".b), "#{label}: missing JPEG EOI", errors)
  assert_bytes(bytes.include?("JFIF".b), "#{label}: missing JFIF marker", errors)
  sof = bytes.index("\xFF\xC0".b)
  sos = bytes.index("\xFF\xDA".b)
  assert_bytes(!sof.nil? && !sos.nil? && sof < sos, "#{label}: missing ordered SOF0/SOS markers", errors)
  return unless sof && bytes.bytesize >= sof + 9

  height, width = bytes.byteslice(sof + 5, 4).unpack("nn")
  assert_bytes(width == 1 && height == 1, "#{label}: JPEG dimensions drift", errors)
end

def validate_generated_semantics(plan, output_root)
  errors = []

  expected_modes = {
    "markdown.canonical.empty-001" => "editable/normal",
    "markdown.pathological.normal-multiline-10mib-001" => "editable/largeText",
    "markdown.pathological.data-image-single-line-10mib-001" => "safetyBlocked",
    "markdown.pathological.line-boundary-under-001" => "editable/largeText",
    "markdown.pathological.line-boundary-exact-001" => "editable/largeText",
    "markdown.pathological.line-boundary-over-001" => "safetyBlocked",
    "markdown.encodings.invalid-utf8-001" => "unsupported",
    "markdown.encodings.bom-crlf-001" => "editable/normal",
    "markdown.encodings.mixed-newlines-001" => "editable/normal",
    "markdown.tables.dense-300-001" => "editable/normal",
    "markdown.links.broken-relative-001" => "editable/normal",
    "markdown.malicious.source-vectors-001" => "editable/normal",
    "workspace.synthetic.shape-79-001" => "workspace",
    "markdown.pathological.nested-markers-4096-001" => "editable/normal",
    "markdown.mermaid.node-limit-5001-001" => "editable/normal",
    "asset.images.validation-matrix-001" => "asset",
    "workspace.malicious.symlink-escape-001" => "workspace",
    "recovery.scenarios.core-001" => "recovery"
  }
  expected_modes.each do |id, expected_mode|
    actual_mode = plan_artifact(plan, id).fetch("expectedMode")
    assert_bytes(actual_mode == expected_mode, "#{id}: semantic expectedMode drift", errors)
  end

  empty = artifact_output_path(output_root, plan, "markdown.canonical.empty-001")
  assert_bytes(File.size(empty).zero?, "canonical empty fixture is not zero bytes", errors)

  normal = artifact_output_path(output_root, plan, "markdown.pathological.normal-multiline-10mib-001")
  normal_plan = plan_artifact(plan, "markdown.pathological.normal-multiline-10mib-001")
  assert_bytes(normal_plan.fetch("parameters").fetch("bytes") == 10 * MIB, "normal multiline parameter is not exactly 10 MiB", errors)
  normal_lines = 0
  normal_max_line = 0
  File.open(normal, "rb") do |file|
    file.each_line do |line|
      normal_lines += 1
      normal_max_line = [normal_max_line, line.bytesize].max
      errors << "normal multiline line shape drift" unless line.bytesize == 128 && line.end_with?("\n")
      break unless errors.empty?
    end
  end
  assert_bytes(normal_lines == 81_920, "normal multiline line count drift", errors)
  assert_bytes(normal_max_line == 128, "normal multiline maximum line drift", errors)

  data_uri = artifact_output_path(output_root, plan, "markdown.pathological.data-image-single-line-10mib-001")
  data_plan = plan_artifact(plan, "markdown.pathological.data-image-single-line-10mib-001")
  data_prefix = "![oversized](data:image/png;base64,".b
  data_suffix = ")\n".b
  payload_bytes = data_plan.fetch("parameters").fetch("payloadBytes")
  assert_bytes(payload_bytes == 10 * MIB, "data URI payload parameter is not exactly 10 MiB", errors)
  File.open(data_uri, "rb") do |file|
    assert_bytes(file.read(data_prefix.bytesize) == data_prefix, "data URI header drift", errors)
    remaining = payload_bytes
    while remaining.positive?
      chunk = file.read([remaining, 64 * 1024].min)
      if chunk.nil? || chunk.empty? || chunk.bytes.any? { |byte| byte != 0x41 }
        errors << "data URI payload is not the declared run of Base64 A bytes"
        break
      end
      remaining -= chunk.bytesize
    end
    assert_bytes(remaining.zero?, "data URI payload length drift", errors)
    assert_bytes(file.read == data_suffix, "data URI suffix drift", errors)
  end
  decoded_estimate = (payload_bytes / 4) * 3
  assert_bytes(decoded_estimate > 512 * 1024, "data URI decoded estimate no longer exceeds safety threshold", errors)

  {
    "markdown.pathological.line-boundary-under-001" => MIB - 1,
    "markdown.pathological.line-boundary-exact-001" => MIB,
    "markdown.pathological.line-boundary-over-001" => MIB + 1
  }.each do |id, expected_line_bytes|
    artifact = plan_artifact(plan, id)
    path = artifact_output_path(output_root, plan, id)
    assert_bytes(artifact.fetch("parameters").fetch("lineBytes") == expected_line_bytes, "#{id}: threshold parameter drift", errors)
    bytes = File.binread(path)
    assert_bytes(bytes.bytesize == expected_line_bytes + 1, "#{id}: file byte size drift", errors)
    assert_bytes(bytes.end_with?("\n") && bytes.byteslice(0, expected_line_bytes) == ("x" * expected_line_bytes), "#{id}: physical line content drift", errors)
  end

  invalid = File.binread(artifact_output_path(output_root, plan, "markdown.encodings.invalid-utf8-001"))
  invalid_text = invalid.dup.force_encoding(Encoding::UTF_8)
  assert_bytes(!invalid_text.valid_encoding?, "invalid UTF-8 fixture became valid UTF-8", errors)
  assert_bytes(invalid.end_with?([0xF0, 0x28, 0x8C, 0x28, 0xFF].pack("C*")), "invalid UTF-8 sentinel bytes drift", errors)

  bom_crlf = File.binread(artifact_output_path(output_root, plan, "markdown.encodings.bom-crlf-001"))
  assert_bytes(bom_crlf.start_with?([0xEF, 0xBB, 0xBF].pack("C*")), "BOM/CRLF fixture lost UTF-8 BOM", errors)
  reduced_crlf = bom_crlf.byteslice(3..-1).gsub("\r\n", "")
  assert_bytes(bom_crlf.scan("\r\n").length == 3 && !reduced_crlf.include?("\r") && !reduced_crlf.include?("\n"), "BOM/CRLF fixture newline semantics drift", errors)

  mixed = File.binread(artifact_output_path(output_root, plan, "markdown.encodings.mixed-newlines-001"))
  without_pairs = mixed.gsub("\r\n", "")
  assert_bytes(mixed.include?("\r\n") && without_pairs.include?("\r") && without_pairs.include?("\n"), "mixed-newline fixture lost one newline family", errors)

  dense = File.binread(artifact_output_path(output_root, plan, "markdown.tables.dense-300-001"))
  assert_bytes(dense.scan(/^## Table /).length == 300, "dense table fixture is not exactly 300 tables", errors)

  broken = File.binread(artifact_output_path(output_root, plan, "markdown.links.broken-relative-001"))
  assert_bytes(broken.include?("](./missing.md)"), "broken relative link fixture no longer contains its missing target", errors)

  malicious = File.binread(artifact_output_path(output_root, plan, "markdown.malicious.source-vectors-001"))
  %w[../../../../outside.md javascript: onerror= onload=].each do |marker|
    assert_bytes(malicious.include?(marker), "malicious source fixture lost #{marker.inspect}", errors)
  end

  workspace_plan = plan_artifact(plan, "workspace.synthetic.shape-79-001")
  workspace = artifact_output_path(output_root, plan, "workspace.synthetic.shape-79-001")
  markdown_files = Dir.glob(File.join(workspace, "docs", "*.md")).sort
  links = markdown_files.inject(0) { |count, file| count + File.binread(file).scan(/\]\(\.\/doc-[0-9]{3}\.md#/).length }
  mermaid_blocks = markdown_files.inject(0) { |count, file| count + File.binread(file).scan(/^```mermaid$/).length }
  image_references = markdown_files.inject(0) { |count, file| count + File.binread(file).scan(/!\[synthetic\]/).length }
  assert_bytes(workspace_plan.fetch("parameters") == { "markdownFiles" => 79, "linksPerFile" => 14, "mermaidFiles" => 4, "imageReferences" => 2 }, "synthetic workspace parameters drift from the 79-file shape", errors)
  assert_bytes(markdown_files.length == 79, "synthetic workspace Markdown file count drift", errors)
  assert_bytes(links == 1_106, "synthetic workspace link count drift", errors)
  assert_bytes(mermaid_blocks == 4, "synthetic workspace Mermaid count drift", errors)
  assert_bytes(image_references == 2, "synthetic workspace image count drift", errors)

  nested_plan = plan_artifact(plan, "markdown.pathological.nested-markers-4096-001")
  nested = File.binread(artifact_output_path(output_root, plan, "markdown.pathological.nested-markers-4096-001"))
  depth = nested_plan.fetch("parameters").fetch("depth")
  assert_bytes(depth == 4_096 && nested.start_with?("*" * depth) && nested.end_with?(("*" * depth) + "\n"), "nested marker depth/content drift", errors)

  mermaid_plan = plan_artifact(plan, "markdown.mermaid.node-limit-5001-001")
  mermaid = File.binread(artifact_output_path(output_root, plan, "markdown.mermaid.node-limit-5001-001"))
  assert_bytes(mermaid_plan.fetch("parameters").fetch("nodeCount") == 5_001, "Mermaid node-limit parameter drift", errors)
  assert_bytes(mermaid.scan(/^  N[0-9]+\[node [0-9]+\]$/).length == 5_001, "Mermaid node-limit fixture count drift", errors)

  images = artifact_output_path(output_root, plan, "asset.images.validation-matrix-001")
  validate_png(File.join(images, "valid.png"), 1, 1, "valid PNG", errors)
  validate_png(File.join(images, "transparent.png"), 1, 1, "transparent PNG", errors)
  validate_png(File.join(images, "oversized-dimensions.png"), 100_000, 100_000, "oversized PNG", errors, complete_pixels: false)
  validate_jpeg(File.join(images, "valid.jpg"), "valid JPEG", errors)
  wrong_mime = File.join(images, "wrong-mime.jpg")
  assert_bytes(File.binread(wrong_mime).start_with?("\x89PNG".b), "wrong-MIME JPEG extension no longer contains PNG bytes", errors)
  validate_png(wrong_mime, 1, 1, "wrong-MIME PNG bytes", errors)

  symlink_root = artifact_output_path(output_root, plan, "workspace.malicious.symlink-escape-001")
  symlink_path = File.join(symlink_root, "workspace", "escape.md")
  assert_bytes(File.lstat(symlink_path).symlink?, "malicious workspace fixture lost its symlink", errors)
  assert_bytes(File.readlink(symlink_path) == "../outside.md", "malicious workspace symlink target drift", errors)
  workspace_scope = File.realpath(File.join(symlink_root, "workspace"))
  target = File.realpath(symlink_path)
  assert_bytes(!FixtureGenerator.path_within?(target, workspace_scope) && FixtureGenerator.path_within?(target, File.realpath(symlink_root)), "malicious workspace symlink no longer escapes only the nested grant", errors)

  recovery = artifact_output_path(output_root, plan, "recovery.scenarios.core-001")
  expected_recovery_files = %w[
    corrupt/checkpoint.bin
    dirty/checkpoint.md
    dirty/disk.md
    revision/disk-v1.md
    revision/disk-v2.md
    scenario-index.json
    staging/assets/paste.png
    staging/draft.md
    startup-loop/poison.md
  ]
  actual_recovery_files = Dir.glob(File.join(recovery, "**", "*"), File::FNM_DOTMATCH)
    .select { |path| File.file?(path) }
    .map { |path| path.delete_prefix("#{recovery}/") }
    .sort
  assert_bytes(actual_recovery_files == expected_recovery_files.sort, "recovery scenario file set drift", errors)
  assert_bytes(File.binread(File.join(recovery, "dirty", "checkpoint.md")) != File.binread(File.join(recovery, "dirty", "disk.md")), "dirty recovery pair became identical", errors)
  assert_bytes(File.binread(File.join(recovery, "revision", "disk-v1.md")) != File.binread(File.join(recovery, "revision", "disk-v2.md")), "revision recovery pair became identical", errors)
  assert_bytes(File.binread(File.join(recovery, "corrupt", "checkpoint.bin")).include?("\xFF".b), "corrupt checkpoint sentinel drift", errors)
  validate_png(File.join(recovery, "staging", "assets", "paste.png"), 1, 1, "staging PNG", errors)
  scenario_index = JSON.parse(File.binread(File.join(recovery, "scenario-index.json")))
  assert_bytes(scenario_index.fetch("scenarios") == %w[dirty corrupt revision-change staging startup-loop], "recovery scenario index drift", errors)
  assert_bytes(File.size(File.join(recovery, "startup-loop", "poison.md")) > 4_096, "startup-loop poison fixture lost its pathological marker run", errors)

  errors
rescue JSON::ParserError, KeyError, SystemCallError => error
  errors << "generated semantic validation raised #{error.class}: #{error.message}"
  errors
end

def validate_committed_semantics
  errors = []
  assertions = {
    "markdown/canonical/source-basics.md" => ["```ts", "<sample-element", "> A quoted line", "1. ordered item"],
    "markdown/canonical/unknown-syntax.md" => [":::future-panel", "keep **every** byte"],
    "markdown/cjk/composition.md" => ["[中文链接文本]", "| 表格单元格 |", "```text", "𠮷野家", "👩‍💻"],
    "markdown/images/relative-images.md" => ["https://example.invalid/image.png", "../../assets/transparent.svg", "../../assets/corrupt.png"],
    "markdown/mermaid/blocks.md" => ["javascript:alert", "<img src=x onerror=", "<svg onload="],
    "workspaces/navigation-basic/index.md" => ["](./guide/)", "](./guide/index.md#guide-index)"],
    "workspaces/navigation-basic/guide/index.md" => ["](../)"]
  }
  assertions.each do |relative, needles|
    bytes = File.binread(FIXTURE_ROOT.join(relative))
    needles.each { |needle| errors << "#{relative}: missing semantic marker #{needle.inspect}" unless bytes.include?(needle.b) }
  end

  wide = File.binread(FIXTURE_ROOT.join("markdown/tables/wide-table.md"))
  header = wide.lines.find { |line| line.start_with?("| C01") }
  errors << "wide table fixture is not exactly 24 columns" unless header && header.scan("|").length == 25

  errors
rescue SystemCallError => error
  errors << "committed semantic validation raised #{error.class}: #{error.message}"
  errors
end

def validate_plan_schema_self_tests(plan)
  errors = []
  cases = []

  wrong_version = Marshal.load(Marshal.dump(plan))
  wrong_version["fixtureVersion"] = "1"
  cases << ["wrong-version-type", wrong_version]

  unknown_field = Marshal.load(Marshal.dump(plan))
  unknown_field["unexpected"] = true
  cases << ["unknown-top-level-field", unknown_field]

  wrong_parameter = Marshal.load(Marshal.dump(plan))
  wrong_parameter.fetch("artifacts").find { |artifact| artifact.fetch("kind") == "single_line" }.fetch("parameters")["lineBytes"] = "1048576"
  cases << ["wrong-parameter-type", wrong_parameter]

  overlapping_path = Marshal.load(Marshal.dump(plan))
  overlapping_path.fetch("artifacts")[1]["path"] = overlapping_path.fetch("artifacts")[0].fetch("path") + "/child"
  cases << ["overlapping-artifact-path", overlapping_path]

  cases.each do |name, invalid_plan|
    begin
      FixtureGenerator.validate_plan!(invalid_plan)
      errors << "strict generated-plan schema self-test accepted #{name}"
    rescue ArgumentError
      # Expected fail-closed result.
    end
  end
  [errors, cases.length]
end

def validate_symlink_self_tests(plan_path)
  errors = []
  count = 0

  Dir.mktmpdir("fixture-output-root-symlink-") do |directory|
    fake_repo = File.join(directory, "fake-repository")
    inside_target = File.join(fake_repo, "generated")
    output_link = File.join(directory, "output-link")
    FileUtils.mkdir_p(inside_target)
    File.symlink(inside_target, output_link)
    count += 1
    begin
      FixtureGenerator.generate(plan_path, output_link, repository_root: fake_repo)
      errors << "generator accepted an output-root symlink into the repository"
    rescue ArgumentError => error
      unless error.message.include?("outside the repository after symlink resolution")
        errors << "output-root symlink self-test returned the wrong error"
      end
    end
    errors << "output-root symlink self-test wrote into fake repository" unless Dir.empty?(inside_target)
  end

  Dir.mktmpdir("fixture-output-parent-symlink-") do |directory|
    fake_repo = File.join(directory, "fake-repository")
    parent_link = File.join(directory, "linked-parent")
    FileUtils.mkdir_p(fake_repo)
    File.symlink(fake_repo, parent_link)
    requested_output = File.join(parent_link, "nested", "generated")
    count += 1
    begin
      FixtureGenerator.generate(plan_path, requested_output, repository_root: fake_repo)
      errors << "generator accepted an intermediate-parent symlink into the repository"
    rescue ArgumentError => error
      unless error.message.include?("outside the repository after symlink resolution")
        errors << "intermediate-parent symlink self-test returned the wrong error"
      end
    end
    errors << "intermediate-parent symlink self-test created a repository directory" if File.exist?(File.join(fake_repo, "nested"))
  end

  Dir.mktmpdir("fixture-validator-symlink-") do |directory|
    root = File.join(directory, "fixtures")
    outside = File.join(directory, "outside.yml")
    link = File.join(root, "manifest.fixture.yml")
    FileUtils.mkdir_p(root)
    File.open(outside, "wb") { |file| file.write("fixtureVersion: 1\n") }
    File.symlink(outside, link)
    count += 1
    result = validate_regular_file(link, root, "validator symlink self-test")
    errors << "validator regular-file guard accepted a symlink" unless result&.include?("symlinks are forbidden")
  end

  [errors, count]
end

def validate_generated_plan(committed_ids)
  errors = []
  plan_path = FIXTURE_ROOT.join("generated-plan.yml").to_s
  file_error = validate_regular_file(plan_path, FIXTURE_ROOT.to_s, "tests/fixtures/generated-plan.yml")
  return [[file_error], 0, 0, 0] if file_error

  plan = FixtureGenerator.load_plan(plan_path)
  generated_ids = plan.fetch("artifacts").map { |artifact| artifact.fetch("id") }
  missing_ids = REQUIRED_GENERATED_IDS - generated_ids
  extra_ids = generated_ids - REQUIRED_GENERATED_IDS
  errors << "generated fixture IDs missing: #{missing_ids.join(", ")}" unless missing_ids.empty?
  errors << "unexpected generated fixture IDs: #{extra_ids.join(", ")}" unless extra_ids.empty?
  duplicate_cross_scope = generated_ids & committed_ids.keys
  errors << "fixture IDs overlap committed/generated scopes: #{duplicate_cross_scope.join(", ")}" unless duplicate_cross_scope.empty?

  schema_errors, schema_self_tests = validate_plan_schema_self_tests(plan)
  errors.concat(schema_errors)
  symlink_errors, symlink_self_tests = validate_symlink_self_tests(plan_path)
  errors.concat(symlink_errors)

  Dir.mktmpdir("markdown-workspace-fixtures-") do |directory|
    output_root = File.join(directory, "generated")
    manifest = FixtureGenerator.generate(plan_path, output_root)
    actual_by_id = manifest.fetch("artifacts").to_h { |artifact| [artifact.fetch("id"), artifact] }
    plan.fetch("artifacts").each do |expected|
      id = expected.fetch("id")
      actual = actual_by_id[id]
      if actual.nil?
        errors << "#{id}: generator omitted artifact"
        next
      end
      %w[path encoding newline expectedMode ownerIntent].each do |field|
        errors << "#{id}: #{field} drift" unless actual.fetch(field) == expected.fetch(field)
      end
      errors << "#{id}: sha256 drift expected=#{expected.fetch("expectedSha256")} actual=#{actual.fetch("sha256")}" unless actual.fetch("sha256") == expected.fetch("expectedSha256")
      errors << "#{id}: byte count drift expected=#{expected.fetch("expectedBytes")} actual=#{actual.fetch("bytes")}" unless actual.fetch("bytes") == expected.fetch("expectedBytes")
      errors << "#{id}: file count drift expected=#{expected.fetch("expectedFiles")} actual=#{actual.fetch("files")}" unless actual.fetch("files") == expected.fetch("expectedFiles")
    end

    manifest_path = File.join(output_root, "generation-manifest.json")
    errors << "generator did not write generation-manifest.json" unless File.file?(manifest_path)
    parsed_manifest = JSON.parse(File.binread(manifest_path)) if File.file?(manifest_path)
    errors << "generation-manifest.json content drift" if parsed_manifest && parsed_manifest != manifest

    errors.concat(validate_generated_semantics(plan, output_root))

    begin
      FixtureGenerator.generate(plan_path, output_root)
      errors << "generator accepted a non-empty output directory"
    rescue ArgumentError => error
      errors << "generator returned the wrong non-empty error" unless error.message.include?("absent or empty")
    end
  end

  begin
    FixtureGenerator.generate(plan_path, FIXTURE_ROOT.join("generated-output-must-not-exist").to_s)
    errors << "generator accepted an output directory inside the repository"
  rescue ArgumentError => error
    errors << "generator returned the wrong repository-boundary error" unless error.message.include?("outside the repository")
  end

  Dir.mktmpdir("markdown-workspace-fixture-escape-") do |directory|
    escape_plan_path = File.join(directory, "escape-plan.yml")
    escaped_file = File.join(directory, "escaped.md")
    escape_plan = Marshal.load(Marshal.dump(plan))
    escape_plan.fetch("artifacts").first["path"] = "../escaped.md"
    File.open(escape_plan_path, "wb") { |file| file.write(YAML.dump(escape_plan)) }
    begin
      FixtureGenerator.generate(escape_plan_path, File.join(directory, "output"))
      errors << "generator accepted an artifact path outside the output directory"
    rescue ArgumentError => error
      errors << "generator returned the wrong artifact-boundary error" unless error.message.include?("normalized relative path")
    end
    errors << "generator wrote an escaped artifact before rejecting it" if File.exist?(escaped_file)
  end

  [errors, plan.fetch("artifacts").length, schema_self_tests, symlink_self_tests]
rescue ArgumentError, Psych::Exception, JSON::ParserError, SystemCallError => error
  [["generated-plan.yml validation raised #{error.class}: #{error.message}"], 0, 0, 0]
end

tree_errors, regular_files = scan_fixture_tree
committed_errors, manifest_count, committed_file_count, committed_ids = validate_committed_manifests(regular_files)
attribute_errors, attributed_files = validate_git_attributes(regular_files)
generated_errors, generated_count, schema_self_tests, symlink_self_tests = validate_generated_plan(committed_ids)
semantic_errors = validate_committed_semantics
errors = tree_errors + committed_errors + attribute_errors + generated_errors + semantic_errors
fail_with(errors) unless errors.empty?

puts "fixture_validation=PASS manifests=#{manifest_count} committed_files=#{committed_file_count} generated_artifacts=#{generated_count} attributed_files=#{attributed_files} schema_self_tests=#{schema_self_tests} symlink_self_tests=#{symlink_self_tests}"
