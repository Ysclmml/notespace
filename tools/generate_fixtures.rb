#!/usr/bin/env ruby
# frozen_string_literal: true

require "digest"
require "fileutils"
require "json"
require "yaml"

module FixtureGenerator
  REPOSITORY_ROOT = File.expand_path("..", __dir__)

  module_function

  def ensure_empty_output!(output_root)
    if File.exist?(output_root) && !Dir.empty?(output_root)
      raise ArgumentError, "output directory must be absent or empty: #{output_root}"
    end

    FileUtils.mkdir_p(output_root)
  end

  def ensure_outside_repository!(output_root)
    expanded_output = File.expand_path(output_root)
    return unless expanded_output == REPOSITORY_ROOT || expanded_output.start_with?("#{REPOSITORY_ROOT}/")

    raise ArgumentError, "generated fixtures must stay outside the repository"
  end

  def write_repeated(path, bytes, line)
    raise ArgumentError, "line must divide requested bytes" unless (bytes % line.bytesize).zero?

    FileUtils.mkdir_p(File.dirname(path))
    File.open(path, "wb") do |file|
      (bytes / line.bytesize).times { file.write(line) }
    end
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
    FileUtils.mkdir_p(File.dirname(path))
    File.binwrite(path, "# invalid utf-8\nvalid prefix\n".b + [0xF0, 0x28, 0x8C, 0x28, 0xFF].pack("C*"))
  end

  def write_bom_crlf(path, _parameters)
    FileUtils.mkdir_p(File.dirname(path))
    File.binwrite(path, [0xEF, 0xBB, 0xBF].pack("C*") + "# BOM\r\n\r\nCRLF body\r\n".b)
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
    FileUtils.mkdir_p(File.dirname(path))
    File.write(path, "# Broken link\n\n[Intentional missing target](./missing.md)\n", mode: "wb")
  end

  def write_synthetic_workspace(path, parameters)
    file_count = Integer(parameters.fetch("markdownFiles"))
    links_per_file = Integer(parameters.fetch("linksPerFile"))
    mermaid_file_count = Integer(parameters.fetch("mermaidFiles"))
    image_reference_count = Integer(parameters.fetch("imageReferences"))
    FileUtils.mkdir_p(File.join(path, "docs"))
    FileUtils.mkdir_p(File.join(path, "assets"))
    File.write(
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
      if index < image_reference_count
        content << "![synthetic](../assets/diagram.svg)\n\n"
      end
      if mermaid_indexes.include?(index)
        content << "```mermaid\nflowchart LR\n  A#{number} --> B#{number}\n```\n"
      end
      File.write(File.join(path, "docs", "doc-%03d.md" % number), content, mode: "wb")
    end
  end

  WRITERS = {
    "normal_multiline" => :write_normal_multiline,
    "data_image_single_line" => :write_data_image_single_line,
    "single_line" => :write_single_line,
    "invalid_utf8" => :write_invalid_utf8,
    "bom_crlf" => :write_bom_crlf,
    "dense_tables" => :write_dense_tables,
    "broken_link" => :write_broken_link,
    "synthetic_workspace" => :write_synthetic_workspace
  }.freeze

  def tree_digest(path)
    digest = Digest::SHA256.new
    files = Dir.glob(File.join(path, "**", "*"), File::FNM_DOTMATCH).select { |entry| File.file?(entry) }.sort
    files.each do |file|
      relative = file.delete_prefix("#{path}/")
      digest.update(relative)
      digest.update("\0")
      digest.update(File.binread(file))
    end
    [digest.hexdigest, files.map { |file| File.size(file) }.inject(0, :+), files.length]
  end

  def artifact_digest(path)
    return tree_digest(path) if File.directory?(path)

    [Digest::SHA256.file(path).hexdigest, File.size(path), 1]
  end

  def generate(plan_path, output_root)
    ensure_outside_repository!(output_root)
    ensure_empty_output!(output_root)
    plan = YAML.load_file(plan_path)
    results = plan.fetch("artifacts").map do |artifact|
      writer = WRITERS.fetch(artifact.fetch("kind"))
      output_path = File.expand_path(artifact.fetch("path"), output_root)
      unless output_path.start_with?("#{File.expand_path(output_root)}/")
        raise ArgumentError, "generated artifact escapes output directory: #{artifact.fetch("path")}"
      end
      public_send(writer, output_path, artifact.fetch("parameters"))
      sha256, bytes, files = artifact_digest(output_path)
      {
        "id" => artifact.fetch("id"),
        "path" => artifact.fetch("path"),
        "expectedMode" => artifact.fetch("expectedMode"),
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
    File.write(File.join(output_root, "generation-manifest.json"), JSON.pretty_generate(manifest) + "\n")
    manifest
  end
end

if $PROGRAM_NAME == __FILE__
  unless ARGV.length.between?(1, 2)
    warn "usage: ruby tools/generate_fixtures.rb OUTPUT_DIR [PLAN_PATH]"
    exit 2
  end

  output_root = File.expand_path(ARGV.fetch(0))
  plan_path = File.expand_path(ARGV.fetch(1, File.join(__dir__, "..", "tests", "fixtures", "generated-plan.yml")))
  manifest = FixtureGenerator.generate(plan_path, output_root)
  puts "generated_fixtures=PASS artifacts=#{manifest.fetch("artifacts").length} output=#{output_root}"
end
