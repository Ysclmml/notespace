#!/usr/bin/env ruby
# frozen_string_literal: true

require "open3"

MAX_TRACKED_FILE_BYTES = 5 * 1024 * 1024
MAX_TRACKED_LINE_BYTES = 1024 * 1024
BASE64_PAYLOAD_BYTES = 1024

SCANNER_ALLOWLIST = [
  "scripts/check_repository_hygiene.rb",
  "scripts/validate_design_docs.rb"
].freeze

FORBIDDEN_BASENAMES = [
  ".DS_Store",
  ".env",
  "id_rsa",
  "id_ed25519"
].freeze

def text_violations(path, bytes)
  return [] if SCANNER_ALLOWLIST.include?(path)

  text = bytes.dup.force_encoding(Encoding::UTF_8)
  return [] unless text.valid_encoding?

  violations = []
  violations << "personal macOS path" if text.match?(%r{/Users/[^/\s]+/|/var/folders/[^\s]+})
  violations << "personal Linux path" if text.match?(%r{/home/[^/\s]+/})
  violations << "personal Windows path" if text.match?(%r{[A-Za-z]:\\Users\\[^\\\s]+\\})
  violations << "private key material" if text.match?(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/)

  data_uri = /data:image\/[a-z0-9.+-]+;base64,([a-z0-9+\/=\r\n]{#{BASE64_PAYLOAD_BYTES},})/i
  violations << "embedded image Base64 payload" if text.match?(data_uri)
  violations
end

def repository_violations(paths)
  violations = []

  paths.each do |path|
    basename = File.basename(path)
    violations << "#{path}: forbidden tracked filename" if FORBIDDEN_BASENAMES.include?(basename)

    size = File.size(path)
    if size > MAX_TRACKED_FILE_BYTES
      violations << "#{path}: tracked file is #{size} bytes (limit #{MAX_TRACKED_FILE_BYTES})"
      next
    end

    bytes = File.binread(path)
    longest_line = bytes.each_line.map(&:bytesize).max || 0
    if longest_line > MAX_TRACKED_LINE_BYTES
      violations << "#{path}: line is #{longest_line} bytes (limit #{MAX_TRACKED_LINE_BYTES})"
    end

    text_violations(path, bytes).each { |message| violations << "#{path}: #{message}" }
  end

  violations
end

def workflow_violations(paths)
  paths.filter { |path| path.match?(%r{\A\.github/workflows/.+\.ya?ml\z}) }.flat_map do |path|
    text = File.read(path, encoding: Encoding::UTF_8)
    messages = []
    messages << "#{path}: pull_request_target is forbidden" if text.match?(/^\s*pull_request_target:/)
    messages << "#{path}: workflow must declare contents: read" unless text.match?(/^\s+contents:\s+read\s*$/)

    text.each_line.with_index(1) do |line, line_number|
      next unless (match = line.match(/^\s*uses:\s*([^\s#]+)(?:\s+#.*)?$/))
      next if match[1].match?(/@[0-9a-f]{40}\z/)

      messages << "#{path}:#{line_number}: action is not pinned to a full commit SHA"
    end
    messages
  end
end

def run_self_test
  cases = {
    "normal" => ["src/example.ts", "const value = 'safe';\n", []],
    "mac path" => ["notes.md", "/Users/example/private/file.md\n", ["personal macOS path"]],
    "private key" => ["secret.txt", "-----BEGIN PRIVATE KEY-----\n", ["private key material"]],
    "large data uri" => [
      "fixture.md",
      "data:image/png;base64,#{"A" * BASE64_PAYLOAD_BYTES}",
      ["embedded image Base64 payload"]
    ]
  }

  failures = []
  cases.each do |name, (path, value, expected)|
    actual = text_violations(path, value.b)
    failures << "#{name}: expected #{expected.inspect}, got #{actual.inspect}" unless actual == expected
  end

  abort("repository_hygiene_self_test=FAIL\n#{failures.join("\n")}") unless failures.empty?
  puts "repository_hygiene_self_test=PASS cases=#{cases.length}"
end

if ARGV == ["--self-test"]
  run_self_test
  exit
end

tracked, status = Open3.capture2("git", "ls-files", "-z")
abort("repository_hygiene=FAIL unable to list tracked files") unless status.success?

paths = tracked.split("\0").reject(&:empty?)
violations = repository_violations(paths) + workflow_violations(paths)

if violations.empty?
  puts "repository_hygiene=PASS tracked_files=#{paths.length}"
else
  warn "repository_hygiene=FAIL count=#{violations.length}"
  violations.each { |violation| warn "ERROR #{violation}" }
  exit 1
end
