#!/usr/bin/env ruby
# frozen_string_literal: true

# Static integrity checks for the design-only repository. This script reads only
# repository Markdown; it never reads user document corpora or writes files.

require "uri"
require "digest"

ROOT = File.expand_path("..", __dir__)
Dir.chdir(ROOT)

files = Dir.glob("**/*.md").sort
errors = []
link_count = 0
fence_pairs = 0

def duplicates(values)
  counts = Hash.new(0)
  values.each { |value| counts[value] += 1 }
  counts.select { |_value, count| count > 1 }.keys.sort
end

files.each do |file|
  fence = nil

  File.readlines(file, chomp: true).each_with_index do |line, index|
    if (match = line.match(/^\s*(`{3,}|~{3,})/))
      mark = match[1]
      if fence.nil?
        fence = [mark[0], mark.length, index + 1]
      elsif mark[0] == fence[0] && mark.length >= fence[1]
        fence = nil
        fence_pairs += 1
      end
      next
    end

    next if fence

    # Markdown-looking examples inside inline code are not links.
    visible = line.gsub(/(`+).*?\1/, "")
    visible.scan(/!?\[[^\]]*\]\(([^)]+)\)/) do |capture|
      raw = capture[0].strip
      target = if raw.start_with?("<") && raw.include?(">")
                 raw[1...raw.index(">")]
               else
                 raw.split(/\s+/, 2).first
               end

      next if target.nil? || target.empty? || target.start_with?("#")
      next if target.match?(/\A[a-z][a-z0-9+.-]*:/i)

      link_count += 1
      if target.start_with?("/")
        errors << "absolute local Markdown link #{file}:#{index + 1}: #{target}"
        next
      end

      path_part = target.split("#", 2).first.split("?", 2).first
      begin
        path_part = URI::DEFAULT_PARSER.unescape(path_part)
      rescue ArgumentError
        errors << "bad URL escaping #{file}:#{index + 1}: #{target}"
        next
      end

      resolved = File.expand_path(path_part, File.dirname(File.join(ROOT, file)))
      errors << "missing link #{file}:#{index + 1}: #{target}" unless File.exist?(resolved)
    end
  end

  errors << "unclosed fence #{file}:#{fence[2]}" if fence
end

requirement_definitions = []
requirement_acceptance = {}
File.readlines("docs/REQUIREMENTS.md", chomp: true).each do |line|
  match = line.match(/^\|\s*([A-Z][A-Z0-9-]*-\d{3})\s*\|\s*(P[012])\s*\|.*\|\s*([A-Z][A-Z0-9-]*-\d{3})\s*\|\s*$/)
  next unless match

  requirement_definitions << match[1]
  requirement_acceptance[match[1]] = match[3]
end

ux_definitions = File.readlines("docs/design/01-product-ux.md", chomp: true).map do |line|
  match = line.match(/^\|\s*`(UX-[A-Z0-9-]+-\d{3})`\s*\|\s*P[012]\s*\|/)
  match && match[1]
end.compact

ux_crosswalk = File.readlines("docs/REQUIREMENTS.md", chomp: true).map do |line|
  match = line.match(/^\|\s*(UX-[A-Z0-9-]+-\d{3})\s*\|/)
  match && match[1]
end.compact

test_definitions = File.readlines("docs/design/09-testing-observability.md", chomp: true).map do |line|
  match = line.match(/^\|\s*([A-Z][A-Z0-9-]*-\d{3})\s*\|/)
  match && match[1]
end.compact

acceptance_definitions = File.read("docs/design/01-product-ux.md")
                             .scan(/\*\*(AC-[A-Z0-9-]+-\d{3})(?:（P1）)?\*\*/)
                             .flatten

{
  "requirement" => requirement_definitions,
  "UX" => ux_definitions,
  "test" => test_definitions,
  "acceptance" => acceptance_definitions
}.each do |label, definitions|
  repeated = duplicates(definitions)
  errors << "duplicate #{label} definitions: #{repeated.join(', ')}" unless repeated.empty?
end

defined_evidence = (test_definitions + acceptance_definitions).uniq
missing_acceptance = requirement_acceptance.values.uniq - defined_evidence
unless missing_acceptance.empty?
  errors << "undefined acceptance IDs: #{missing_acceptance.sort.join(', ')}"
end

missing_crosswalk = ux_definitions.uniq - ux_crosswalk.uniq
extra_crosswalk = ux_crosswalk.uniq - ux_definitions.uniq
errors << "UX missing crosswalk: #{missing_crosswalk.sort.join(', ')}" unless missing_crosswalk.empty?
errors << "crosswalk undefined UX: #{extra_crosswalk.sort.join(', ')}" unless extra_crosswalk.empty?

test_requirement_references = File.readlines("docs/design/09-testing-observability.md", chomp: true).flat_map do |line|
  match = line.match(/^\|\s*[A-Z][A-Z0-9-]*-\d{3}\s*\|\s*([^|]+)\|/)
  next [] unless match

  match[1].scan(/(?:DATA|EDIT|NAV|FILE|ASSET|RECOVERY|PERF|SAFE|EXT|OPS)-[A-Z0-9-]+-\d{3}/)
end.uniq
undefined_test_requirements = test_requirement_references - requirement_definitions.uniq
unless undefined_test_requirements.empty?
  errors << "tests reference undefined requirements: #{undefined_test_requirements.sort.join(', ')}"
end

acceptance_ux_references = File.readlines("docs/design/01-product-ux.md", chomp: true).flat_map do |line|
  line.include?("**AC-") ? line.scan(/UX-[A-Z0-9-]+-\d{3}/) : []
end.uniq
undefined_acceptance_ux = acceptance_ux_references - ux_definitions.uniq
unless undefined_acceptance_ux.empty?
  errors << "acceptance scenarios reference undefined UX IDs: #{undefined_acceptance_ux.sort.join(', ')}"
end

plan_text = File.read("docs/IMPLEMENTATION_PLAN.md")
task_definitions = File.readlines("docs/IMPLEMENTATION_PLAN.md", chomp: true).map do |line|
  match = line.match(/^\|\s*`(P\d-[A-Z0-9-]+-\d{2})`\s*\|\s*[^|]+\|\s*[^|]+\|\s*[^|]+\|\s*$/)
  match && match[1]
end.compact
repeated_tasks = duplicates(task_definitions)
errors << "duplicate task definitions: #{repeated_tasks.join(', ')}" unless repeated_tasks.empty?
undefined_task_references = plan_text.scan(/P\d-[A-Z0-9-]+-\d{2}/).uniq - task_definitions.uniq
unless undefined_task_references.empty?
  errors << "implementation plan references undefined tasks: #{undefined_task_references.sort.join(', ')}"
end

planned_requirement_references = plan_text.scan(
  /(?:DATA|EDIT|NAV|FILE|ASSET|RECOVERY|PERF|SAFE|EXT|OPS)-[A-Z0-9-]+-\d{3}/
).uniq
unplanned_requirements = requirement_definitions.uniq - planned_requirement_references
unless unplanned_requirements.empty?
  errors << "requirements without an implementation-plan trace: #{unplanned_requirements.sort.join(', ')}"
end

planned_acceptance_references = plan_text.scan(/AC-[A-Z0-9-]+-\d{3}/).uniq
unplanned_acceptance = acceptance_definitions.uniq - planned_acceptance_references
unless unplanned_acceptance.empty?
  errors << "acceptance IDs without an implementation-plan trace: #{unplanned_acceptance.sort.join(', ')}"
end

planned_evidence_references = plan_text.scan(/[A-Z][A-Z0-9-]*-\d{3}/).uniq
unplanned_test_evidence = test_definitions.reject { |id| id.start_with?("QA-INV-") }.uniq - planned_evidence_references
unless unplanned_test_evidence.empty?
  errors << "test IDs without an implementation-plan trace: #{unplanned_test_evidence.sort.join(', ')}"
end

# Protect cross-phase ownership that a global "ID appears somewhere" check cannot
# prove. These pairs are release handoffs: the shipped implementation task must
# cite the evidence even when an earlier fixture/spike also mentions it.
required_task_trace_pairs = [
  ["P0-FLAG-01", "UX-EXT-001"],
  ["P1-FILE-01", "AC-EDIT-001"],
  ["P1-EDITOR-01", "AC-EDIT-003"],
  ["P3-PASTE-01", "AC-EDIT-003"],
  ["P4-TABLE-01", "AC-EDIT-003"],
  ["P4-TABLE-01", "AC-TABLE-002"],
  ["P4-MERMAID-01", "EXT-BLOCK-001"],
  ["P6-PACKAGE-01", "OPS-RELEASE-001"],
  ["P6-PACKAGE-01", "RELEASE-001"]
]

required_task_trace_pairs.each do |task_id, trace_id|
  next if plan_text.lines.any? { |line| line.include?("`#{task_id}`") && line.include?("`#{trace_id}`") }

  errors << "missing task-level trace pair: #{task_id} -> #{trace_id}"
end

ipc_rows = File.readlines("docs/design/03-domain-model-and-contracts.md", chomp: true).map do |line|
  match = line.match(/^\|\s*`(IPC-CMD-\d{3})`\s*\|\s*`([a-z0-9_]+_v\d+)`\s*\|/)
  match && [match[1], match[2]]
end.compact

domain_contract_text = File.read("docs/design/03-domain-model-and-contracts.md")
known_error_block = domain_contract_text[/const KNOWN_APP_ERROR_CODES = \[(.*?)\] as const/m, 1]
if known_error_block.nil?
  errors << "missing KNOWN_APP_ERROR_CODES source"
else
  known_error_codes = known_error_block.scan(/"(ERR_[A-Z0-9_]+)"/).flatten
  error_table_codes = domain_contract_text.scan(/^\| `ERR-\d{3} \/ (ERR_[A-Z0-9_]+)` \|/).flatten
  duplicate_known_codes = duplicates(known_error_codes)
  errors << "duplicate known AppError codes: #{duplicate_known_codes.join(', ')}" unless duplicate_known_codes.empty?
  unless known_error_codes.sort == error_table_codes.sort
    errors << "KNOWN_APP_ERROR_CODES/table mismatch: source=#{known_error_codes.sort.join(',')} table=#{error_table_codes.sort.join(',')}"
  end
end

repeated_ipc_ids = duplicates(ipc_rows.map(&:first))
repeated_ipc_names = duplicates(ipc_rows.map(&:last))
errors << "duplicate IPC IDs: #{repeated_ipc_ids.join(', ')}" unless repeated_ipc_ids.empty?
errors << "duplicate IPC names: #{repeated_ipc_names.join(', ')}" unless repeated_ipc_names.empty?

versioned_command_references = files.flat_map do |file|
  # Scan prose and code, not only backticked tokens. Shorthand such as
  # "foo_save/load_v1" must fail instead of silently inventing `load_v1`.
  File.read(file).scan(/\b([a-z][a-z0-9_]+_v\d+)\b/).flatten
end.uniq
undefined_commands = versioned_command_references - ipc_rows.map(&:last)
unless undefined_commands.empty?
  errors << "undefined versioned command refs: #{undefined_commands.sort.join(', ')}"
end

forbidden_patterns = {
  "personal macOS path" => %r{/Users/|/var/folders/},
  "personal Windows path" => /[A-Za-z]:\\Users\\/,
  "embedded Base64 payload" => /base64,[A-Za-z0-9+\/=]{128}/,
  "unfinished document status" => /(?:状态[:：].*Draft|Status: planning baseline|编写中|待编写|已完成初稿|待全局校验|待契约对齐)/,
  "retired contract term" => /table\.hybridEditing|SafeBlocked|openReadOnly|asset_commit|conflictToken|preflightToken|resumeState|ViewResumeState|currentIndex|navigationId|operationId\/newDiskRevision|Exclude<OpenMode,\s*"readOnly">|三态分类|-- close --> Closed|保留恢复稿\/不保存|workspace\/document capability|CONTRACT-001\s*[–-]\s*CONTRACT-023/
}

files.each do |file|
  File.readlines(file, chomp: true).each_with_index do |line, index|
    forbidden_patterns.each do |label, pattern|
      errors << "#{label} #{file}:#{index + 1}" if line.match?(pattern)
    end
  end
end

puts "markdown_files=#{files.length}"
puts "relative_links_checked=#{link_count}"
puts "fence_pairs=#{fence_pairs}"
puts "requirements=#{requirement_definitions.length}"
puts "ux_requirements=#{ux_definitions.length}"
puts "ux_crosswalk=#{ux_crosswalk.uniq.length}"
puts "test_ids=#{test_definitions.length}"
puts "acceptance_ids=#{acceptance_definitions.length}"
puts "ipc_commands=#{ipc_rows.length}"
puts "implementation_tasks=#{task_definitions.length}"

# PROJECT_STATE records this digest, so exclude it to avoid a self-referential
# hash. Include every other Markdown source and this validator itself, with
# paths and NUL separators for an unambiguous deterministic snapshot.
snapshot_files = (files + ["scripts/validate_design_docs.rb"])
                 .reject { |file| file == "docs/PROJECT_STATE.md" }
                 .sort
snapshot_digest = Digest::SHA256.new
snapshot_files.each do |file|
  snapshot_digest << file << "\0" << File.binread(file) << "\0"
end
puts "design_snapshot_sha256=#{snapshot_digest.hexdigest}"

if errors.empty?
  puts "RESULT=PASS"
else
  puts "RESULT=FAIL count=#{errors.length}"
  errors.each { |error| puts "ERROR #{error}" }
  exit 1
end
