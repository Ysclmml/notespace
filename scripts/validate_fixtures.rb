#!/usr/bin/env ruby
# frozen_string_literal: true

require "json"
require "pathname"
require "tmpdir"
require "yaml"
require_relative "../tools/generate_fixtures"

REPO_ROOT = Pathname.new(File.expand_path("..", __dir__))
FIXTURE_ROOT = REPO_ROOT.join("tests", "fixtures")
REQUIRED_MANIFEST_FIELDS = %w[
  fixtureVersion
  id
  purpose
  encoding
  newline
  expectedMode
  sensitive
  generatedBy
  files
].freeze
EXPECTED_MODES = %w[editable/normal editable/largeText safetyBlocked unsupported workspace].freeze

def fail_with(errors)
  warn "fixture_validation=FAIL count=#{errors.length}"
  errors.each { |error| warn "ERROR #{error}" }
  exit 1
end

def validate_committed_manifests
  errors = []
  ids = {}
  covered = {}
  manifests = Dir.glob(FIXTURE_ROOT.join("**", "*.fixture.yml")).sort

  manifests.each do |manifest_path|
    manifest = YAML.load_file(manifest_path)
    relative_manifest = Pathname.new(manifest_path).relative_path_from(REPO_ROOT).to_s
    missing = REQUIRED_MANIFEST_FIELDS.reject { |field| manifest.key?(field) }
    errors << "#{relative_manifest}: missing fields #{missing.join(", ")}" unless missing.empty?
    next unless missing.empty?

    id = manifest.fetch("id")
    errors << "#{relative_manifest}: fixtureVersion must be 1" unless manifest.fetch("fixtureVersion") == 1
    errors << "#{relative_manifest}: sensitive must be false" unless manifest.fetch("sensitive") == false
    errors << "#{relative_manifest}: duplicate id #{id}" if ids.key?(id)
    ids[id] = relative_manifest
    unless id.match?(/\A(?:markdown|workspace)\.[a-z0-9.-]+\z/)
      errors << "#{relative_manifest}: invalid id #{id}"
    end
    unless EXPECTED_MODES.include?(manifest.fetch("expectedMode"))
      errors << "#{relative_manifest}: unsupported expectedMode #{manifest.fetch("expectedMode")}"
    end

    files = manifest.fetch("files")
    errors << "#{relative_manifest}: files must be a non-empty array" unless files.is_a?(Array) && !files.empty?
    next unless files.is_a?(Array)

    files.each do |entry|
      resolved = Pathname.new(File.expand_path(entry, File.dirname(manifest_path)))
      unless resolved.to_s.start_with?("#{FIXTURE_ROOT}/")
        errors << "#{relative_manifest}: file escapes fixture root: #{entry}"
        next
      end
      unless resolved.file?
        errors << "#{relative_manifest}: missing file #{entry}"
        next
      end

      relative_file = resolved.relative_path_from(FIXTURE_ROOT).to_s
      errors << "#{relative_manifest}: file covered twice: #{relative_file}" if covered.key?(relative_file)
      covered[relative_file] = relative_manifest

      bytes = resolved.binread
      if manifest.fetch("encoding") == "utf-8"
        text = bytes.dup.force_encoding(Encoding::UTF_8)
        errors << "#{relative_manifest}: #{entry} is not valid UTF-8" unless text.valid_encoding?
      end
      errors << "#{relative_manifest}: #{entry} contains CRLF" if manifest.fetch("newline") == "lf" && bytes.include?("\r\n")
    end
  rescue Psych::SyntaxError => error
    errors << "#{relative_manifest}: invalid YAML: #{error.message.lines.first.strip}"
  end

  committed_files = Dir.glob(FIXTURE_ROOT.join("**", "*"), File::FNM_DOTMATCH)
    .select { |path| File.file?(path) }
    .map { |path| Pathname.new(path).relative_path_from(FIXTURE_ROOT).to_s }
    .reject { |path| path.end_with?(".fixture.yml") || path == "generated-plan.yml" }
  uncovered = committed_files.reject { |path| covered.key?(path) }
  uncovered.each { |path| errors << "uncovered committed fixture file: #{path}" }

  [errors, manifests.length, committed_files.length]
end

def validate_generated_plan
  errors = []
  plan_path = FIXTURE_ROOT.join("generated-plan.yml")
  plan = YAML.load_file(plan_path)
  ids = {}
  plan.fetch("artifacts").each do |artifact|
    id = artifact.fetch("id")
    errors << "generated plan duplicate id #{id}" if ids.key?(id)
    ids[id] = true
    sha = artifact.fetch("expectedSha256")
    errors << "#{id}: expectedSha256 is not frozen" unless sha.match?(/\A[0-9a-f]{64}\z/)
  end

  Dir.mktmpdir("markdown-workspace-fixtures-") do |directory|
    manifest = FixtureGenerator.generate(plan_path.to_s, directory)
    actual_by_id = manifest.fetch("artifacts").to_h { |artifact| [artifact.fetch("id"), artifact] }
    plan.fetch("artifacts").each do |expected|
      actual = actual_by_id[expected.fetch("id")]
      if actual.nil?
        errors << "#{expected.fetch("id")}: generator omitted artifact"
        next
      end
      errors << "#{expected.fetch("id")}: path drift" unless actual.fetch("path") == expected.fetch("path")
      errors << "#{expected.fetch("id")}: expectedMode drift" unless actual.fetch("expectedMode") == expected.fetch("expectedMode")
      unless actual.fetch("sha256") == expected.fetch("expectedSha256")
        errors << "#{expected.fetch("id")}: sha256 drift expected=#{expected.fetch("expectedSha256")} actual=#{actual.fetch("sha256")}"
      end
    end

    manifest_path = File.join(directory, "generation-manifest.json")
    errors << "generator did not write generation-manifest.json" unless File.file?(manifest_path)
    JSON.parse(File.read(manifest_path)) if File.file?(manifest_path)

    begin
      FixtureGenerator.generate(plan_path.to_s, directory)
      errors << "generator accepted a non-empty output directory"
    rescue ArgumentError => error
      errors << "generator returned the wrong non-empty error" unless error.message.include?("absent or empty")
    end

    workspace_plan = plan.fetch("artifacts").find { |artifact| artifact.fetch("kind") == "synthetic_workspace" }
    workspace = File.join(directory, workspace_plan.fetch("path"))
    markdown_files = Dir.glob(File.join(workspace, "docs", "*.md")).sort
    links = markdown_files.inject(0) { |count, file| count + File.read(file).scan(/\]\(\.\/doc-[0-9]{3}\.md#/).length }
    mermaid_blocks = markdown_files.inject(0) { |count, file| count + File.read(file).scan(/^```mermaid$/).length }
    image_references = markdown_files.inject(0) { |count, file| count + File.read(file).scan(/!\[synthetic\]/).length }
    workspace_parameters = workspace_plan.fetch("parameters")
    errors << "synthetic workspace Markdown file count drift" unless markdown_files.length == workspace_parameters.fetch("markdownFiles")
    expected_links = workspace_parameters.fetch("markdownFiles") * workspace_parameters.fetch("linksPerFile")
    errors << "synthetic workspace link count drift" unless links == expected_links
    errors << "synthetic workspace Mermaid count drift" unless mermaid_blocks == workspace_parameters.fetch("mermaidFiles")
    errors << "synthetic workspace image count drift" unless image_references == workspace_parameters.fetch("imageReferences")

    dense_plan = plan.fetch("artifacts").find { |artifact| artifact.fetch("kind") == "dense_tables" }
    dense_file = File.join(directory, dense_plan.fetch("path"))
    dense_count = File.read(dense_file).scan(/^## Table /).length
    errors << "dense table count drift" unless dense_count == dense_plan.fetch("parameters").fetch("tableCount")
  end

  begin
    FixtureGenerator.generate(plan_path.to_s, FIXTURE_ROOT.join("generated-output-must-not-exist").to_s)
    errors << "generator accepted an output directory inside the repository"
  rescue ArgumentError => error
    errors << "generator returned the wrong repository-boundary error" unless error.message.include?("outside the repository")
  end

  Dir.mktmpdir("markdown-workspace-fixture-escape-") do |directory|
    escape_plan_path = File.join(directory, "escape-plan.yml")
    escape_output = File.join(directory, "output")
    escaped_file = File.join(directory, "escaped.md")
    escape_plan = {
      "fixtureVersion" => 1,
      "generatedBy" => "validator-self-test",
      "artifacts" => [
        {
          "id" => "markdown.pathological.escape-self-test",
          "kind" => "broken_link",
          "path" => "../escaped.md",
          "expectedMode" => "editable/normal",
          "parameters" => {}
        }
      ]
    }
    File.write(escape_plan_path, YAML.dump(escape_plan))
    begin
      FixtureGenerator.generate(escape_plan_path, escape_output)
      errors << "generator accepted an artifact path outside the output directory"
    rescue ArgumentError => error
      errors << "generator returned the wrong artifact-boundary error" unless error.message.include?("escapes output directory")
    end
    errors << "generator wrote an escaped artifact before rejecting it" if File.exist?(escaped_file)
  end

  [errors, plan.fetch("artifacts").length]
rescue Psych::SyntaxError => error
  [["generated-plan.yml: invalid YAML: #{error.message.lines.first.strip}"], 0]
end

committed_errors, manifest_count, committed_file_count = validate_committed_manifests
generated_errors, generated_count = validate_generated_plan
errors = committed_errors + generated_errors
fail_with(errors) unless errors.empty?

puts "fixture_validation=PASS manifests=#{manifest_count} committed_files=#{committed_file_count} generated_artifacts=#{generated_count}"
