#!/usr/bin/env ruby
# frozen_string_literal: true

# P0-HOST-SMOKE-01: build-isolated macOS release host evidence runner.

require "digest"
require "fileutils"
require "json"
require "open3"
require "rbconfig"
require "tmpdir"

ROOT = File.realpath(File.join(__dir__, "..", ".."))
ROOT_PREFIX = "markdown-workspace-host-smoke."
RESULT_FILE = "host-smoke-result.json"
BINARY = File.join(ROOT, "src-tauri", "target", "release", "markdown-workspace")
HOST_APP = File.join(
  ROOT, "src-tauri", "target", "release", "bundle", "macos", "Markdown Workspace.app"
)
HOST_APP_BINARY = File.join(HOST_APP, "Contents", "MacOS", "markdown-workspace")
FRONTEND_SENTINELS = [
  "P0-HOST-SMOKE-01",
  "host_release_smoke_frontend_ready",
  "WKWebView 主机验证"
].freeze
NATIVE_SENTINELS = [
  "MARKDOWN_WORKSPACE_HOST_RELEASE_SMOKE_ROOT",
  "__MARKDOWN_WORKSPACE_HOST_RELEASE_SMOKE__",
  "host_release_smoke_trusted_ime_finish",
  "host_release_smoke_trusted_chooser_finish",
  "host_release_smoke_frontend_ready",
  "host-smoke-menu-ping"
].freeze
LEGACY_TRUST_BYPASS_SENTINELS = [
  "host_release_smoke_record_ime",
  "host_release_smoke_record_chooser"
].freeze
PINNED_PNPM = [
  "volta", "run", "--node", "24.14.0", "--pnpm", "10.32.1", "pnpm"
].freeze

def assert!(condition, message)
  raise message unless condition
end

def run_command!(environment, *command)
  success = system(environment, *command, chdir: ROOT)
  raise "command failed: #{command.first}" unless success
end

def tree_contains_any?(directory, needles)
  Dir.glob(File.join(directory, "**", "*"), File::FNM_DOTMATCH).any? do |path|
    next false unless File.file?(path)

    bytes = File.binread(path)
    needles.any? { |needle| bytes.include?(needle.b) }
  end
end

def file_contains_all?(path, needles)
  bytes = File.binread(path)
  needles.all? { |needle| bytes.include?(needle.b) }
end

def file_contains_any?(path, needles)
  bytes = File.binread(path)
  needles.any? { |needle| bytes.include?(needle.b) }
end

def private_root
  root = Dir.mktmpdir(ROOT_PREFIX)
  File.chmod(0o700, root)
  File.realpath(root)
end

def safe_cleanup(root)
  return unless root && File.exist?(root)

  canonical_temp = File.realpath(Dir.tmpdir)
  canonical_root = File.realpath(root)
  assert!(File.dirname(canonical_root) == canonical_temp, "cleanup root escaped system temp")
  assert!(File.basename(canonical_root).start_with?(ROOT_PREFIX), "cleanup root has wrong name")
  FileUtils.remove_entry_secure(canonical_root)
end

def wait_for_process(pid, timeout_seconds)
  deadline = Process.clock_gettime(Process::CLOCK_MONOTONIC) + timeout_seconds
  loop do
    completed = Process.waitpid(pid, Process::WNOHANG)
    return $? if completed

    if Process.clock_gettime(Process::CLOCK_MONOTONIC) >= deadline
      terminate_exact_process(pid)
      raise "release host timed out"
    end
    sleep 0.1
  end
end

def terminate_exact_process(pid)
  Process.kill("TERM", pid)
  deadline = Process.clock_gettime(Process::CLOCK_MONOTONIC) + 2
  loop do
    completed = Process.waitpid(pid, Process::WNOHANG)
    return if completed
    break if Process.clock_gettime(Process::CLOCK_MONOTONIC) >= deadline

    sleep 0.05
  end
  Process.kill("KILL", pid)
  Process.waitpid(pid)
rescue Errno::ESRCH, Errno::ECHILD
  nil
end

def launch_host!(mode:, timeout_seconds:, binary: BINARY)
  root = nil
  root = private_root
  log_path = File.join(root, "process.log")
  environment = {
    "MARKDOWN_WORKSPACE_HOST_RELEASE_SMOKE" => "1",
    "MARKDOWN_WORKSPACE_HOST_RELEASE_SMOKE_MODE" => mode,
    "MARKDOWN_WORKSPACE_HOST_RELEASE_SMOKE_ROOT" => root
  }
  pid = Process.spawn(environment, [binary, binary], chdir: ROOT, out: log_path, err: [:child, :out])
  status = wait_for_process(pid, timeout_seconds)
  unless status.success?
    digest = File.exist?(log_path) ? Digest::SHA256.file(log_path).hexdigest : "none"
    raise "release host exited nonzero; redacted_log_sha256=#{digest}"
  end

  result_path = File.join(root, RESULT_FILE)
  assert!(File.file?(result_path), "release host did not produce its fixed result file")
  [root, JSON.parse(File.read(result_path, encoding: "UTF-8"))]
rescue StandardError
  safe_cleanup(root)
  raise
end

def assert_privacy!(report)
  json = JSON.generate(report)
  assert!(!json.include?("/Users/"), "report contains a personal path")
  assert!(!json.include?("old-host-smoke"), "report contains atomic fixture content")
  assert!(!json.include?("new-host-smoke"), "report contains atomic fixture content")
  privacy = report.fetch("privacy")
  assert!(privacy.values.all? { |value| value == false }, "privacy declaration failed")
end

def assert_automated_report!(report)
  assert!(report.fetch("schemaVersion") == 2, "wrong report schema")
  assert!(report.fetch("taskId") == "P0-HOST-SMOKE-01", "wrong task id")
  assert!(report.fetch("resultState") == "automatedReady", "automated host not ready")
  build = report.fetch("build")
  assert!(build.fetch("profile") == "release", "host was not a release build")
  assert!(build.fetch("targetOs") == "macos", "host was not macOS")
  assert!(build.fetch("webview") == "WKWebView", "host did not report WKWebView")
  assert!(build.fetch("mode") == "automated", "wrong automated mode")
  atomic = report.fetch("atomicReplace")
  assert!(atomic.fetch("status") == "passed", "atomic replace self-test failed")
  assert!(atomic.fetch("originalWasIntactBeforeReplace"), "original integrity was not proven")
  assert!(atomic.fetch("finalIsCompleteNewVersion"), "final integrity was not proven")
  assert!(atomic.fetch("tempCleaned"), "atomic temporary file was not cleaned")
  assert!(report.dig("menu", "status") == "ready", "system menu was not built")
  assert!(report.dig("frontend", "status") == "ready", "frontend was not ready")
  assert!(report.dig("frontend", "editorMounted"), "CodeMirror was not mounted")
  assert!(report.dig("frontend", "contentEditable"), "CodeMirror was not contenteditable")
  assert!(report.dig("frontend", "nativeFileInputPresent"), "native file input was absent")
  assert!(report.dig("frontend", "captureBoundary") == "nativeInitializationScript", "wrong capture boundary")
  assert!(report.dig("frontend", "captureBoundaryReady"), "private capture boundary was not ready")
  assert!(report.dig("imeConfirm", "status") == "pending", "automated run fabricated IME evidence")
  assert!(report.dig("imeCancel", "status") == "pending", "automated run fabricated IME evidence")
  assert!(report.dig("chooserCancel", "status") == "pending", "automated run fabricated chooser evidence")
  assert!(report.dig("chooserNoReadAudit", "status") == "passed", "compiled no-read audit failed")
  assert!(report.dig("chooserNoReadAudit", "auditKind") == "compiledSourceTokenDenylist", "wrong no-read audit kind")
  assert!(report.dig("chooserNoReadAudit", "forbiddenApiMatchCount") == 0, "forbidden chooser API found")
  assert_privacy!(report)
end

def assert_manual_report!(report)
  assert!(report.fetch("resultState") == "manualPass", "manual evidence is incomplete")
  assert!(report.dig("build", "mode") == "manual", "wrong manual mode")
  assert!(report.dig("menu", "activationCount").to_i >= 1, "menu activation was not recorded")
  assert!(report.dig("imeConfirm", "status") == "passed", "IME confirm did not pass")
  assert!(report.dig("imeCancel", "status") == "passed", "IME cancel did not pass")
  assert!(report.dig("chooserCancel", "status") == "passed", "chooser cancel did not pass")
  %w[imeConfirm imeCancel].each do |section|
    assert!(report.dig(section, "captureSource") == "nativeInitializationScript", "#{section} was frontend-authored")
    assert!(report.dig(section, "compositionStartCount") == 1, "#{section} did not have exactly one start")
    assert!(report.dig(section, "compositionEndCount") == 1, "#{section} did not have exactly one end")
    assert!(report.dig(section, "compositionUpdateCount").to_i >= 1, "#{section} had no update")
    assert!(report.dig(section, "beforeInputCount") == report.dig(section, "inputCount"), "#{section} input pair mismatch")
    assert!(report.dig(section, "rejectedUntrustedEventCount") == 0, "#{section} included an untrusted event")
    %w[strictSequenceValid compositionDataValid inputFieldsValid singleTargetValid finalStateMatches rejectedEventSetEmpty privateMacValid nativeNonceFlowConsumed].each do |field|
      assert!(report.dig(section, field), "#{section}.#{field} was false")
    end
  end
  chooser = report.fetch("chooserCancel")
  assert!(chooser.fetch("captureSource") == "nativeInitializationScript", "chooser evidence was frontend-authored")
  assert!(chooser.fetch("eventKind") == "cancel", "chooser did not emit cancel")
  assert!(chooser.fetch("eventWasTrusted"), "chooser cancel was synthetic")
  assert!(chooser.fetch("nativeDialogInteractionObserved"), "native chooser interaction was not observed")
  assert!(chooser.fetch("privateMacValid"), "chooser evidence MAC was invalid")
  assert!(chooser.fetch("nativeNonceFlowConsumed"), "chooser nonce flow was not consumed")
  assert!(chooser.fetch("selectionDataInspected") == false, "chooser inspected selection data")
  assert!(report.dig("chooserNoReadAudit", "status") == "passed", "compiled no-read audit failed")
  assert!(report.dig("chooserNoReadAudit", "forbiddenApiMatchCount") == 0, "forbidden chooser API found")
  assert_privacy!(report)
end

def assert_chooser_source_is_read_free!
  sources = [
    File.join(ROOT, "src", "features", "editor", "host-smoke", "HostReleaseSmoke.tsx"),
    File.join(ROOT, "src-tauri", "src", "host_release_smoke_init.js")
  ].map { |path| File.read(path, encoding: "UTF-8") }
  forbidden = [
    "FileReader", ".files", ".value", ".arrayBuffer(", ".text(", ".stream(", ".name", ".path",
    "webkitRelativePath", "createObjectURL", "getAsFile"
  ]
  hits = forbidden.select { |token| sources.any? { |source| source.include?(token) } }
  assert!(hits.empty?, "chooser source reads file/path data: #{hits.join(",")}")
end

def assert_frontend_runtime_gate_source!
  source = File.read(File.join(ROOT, "src", "app", "bootstrap", "AppBootstrap.tsx"), encoding: "UTF-8")
  expected = "window.__MARKDOWN_WORKSPACE_HOST_RELEASE_SMOKE__ === true"
  assert!(source.include?(expected), "host frontend does not require the native runtime latch")
end

def assert_runtime_gate!
  root = private_root
  log_path = File.join(root, "runtime-gate.log")
  environment = {
    "MARKDOWN_WORKSPACE_HOST_RELEASE_SMOKE" => nil,
    "MARKDOWN_WORKSPACE_HOST_RELEASE_SMOKE_MODE" => "automated",
    "MARKDOWN_WORKSPACE_HOST_RELEASE_SMOKE_ROOT" => root
  }
  pid = Process.spawn(environment, BINARY, chdir: ROOT, out: log_path, err: [:child, :out])
  sleep 0.75
  assert!(Process.waitpid(pid, Process::WNOHANG).nil?, "host started the harness without its runtime enable latch")
  assert!(!File.exist?(File.join(root, RESULT_FILE)), "host wrote a report without its runtime enable latch")
ensure
  terminate_exact_process(pid) if pid
  safe_cleanup(root)
end

def build_and_verify_isolation!
  clean_environment = {
    "VITE_HOST_RELEASE_SMOKE" => nil,
    "MARKDOWN_WORKSPACE_HOST_RELEASE_SMOKE" => nil,
    "MARKDOWN_WORKSPACE_HOST_RELEASE_SMOKE_MODE" => nil,
    "MARKDOWN_WORKSPACE_HOST_RELEASE_SMOKE_ROOT" => nil
  }
  run_command!(clean_environment, *PINNED_PNPM, "tauri", "build", "--no-bundle")
  assert!(File.executable?(BINARY), "default release binary missing")
  assert!(!tree_contains_any?(File.join(ROOT, "dist"), FRONTEND_SENTINELS), "default frontend contains host smoke surface")
  assert!(!file_contains_any?(BINARY, NATIVE_SENTINELS), "default native binary contains host smoke surface")

  host_environment = clean_environment.merge("VITE_HOST_RELEASE_SMOKE" => "1")
  run_command!(
    host_environment,
    *PINNED_PNPM,
    "tauri",
    "build",
    "--bundles",
    "app",
    "--features",
    "host-release-smoke"
  )
  assert!(tree_contains_any?(File.join(ROOT, "dist"), FRONTEND_SENTINELS), "host frontend surface missing")
  assert!(file_contains_all?(BINARY, NATIVE_SENTINELS), "host native surface missing")
  assert!(File.executable?(HOST_APP_BINARY), "host release app binary missing")
  assert!(file_contains_all?(HOST_APP_BINARY, NATIVE_SENTINELS), "host release app surface missing")
  assert!(!file_contains_any?(BINARY, LEGACY_TRUST_BYPASS_SENTINELS), "legacy frontend-authored evidence command remains")
  assert!(
    !file_contains_any?(HOST_APP_BINARY, LEGACY_TRUST_BYPASS_SENTINELS),
    "legacy app evidence command remains"
  )
  assert!(!tree_contains_any?(File.join(ROOT, "dist"), LEGACY_TRUST_BYPASS_SENTINELS), "legacy evidence command remains in frontend")
  assert_chooser_source_is_read_free!
  assert_frontend_runtime_gate_source!
  assert_runtime_gate!
end

abort("P0-HOST-SMOKE-01 requires macOS") unless RbConfig::CONFIG.fetch("host_os").include?("darwin")

manual = ARGV.delete("--manual")
abort("usage: run_host_release_smoke.rb [--manual]") unless ARGV.empty?

build_and_verify_isolation!
automated_root = nil
manual_root = nil
begin
  automated_root, automated_report = launch_host!(mode: "automated", timeout_seconds: 45)
  assert_automated_report!(automated_report)
  puts "P0-HOST-SMOKE-01 automated release host: PASS"

  if manual
    puts <<~STEPS
      Manual steps:
      1. In Host Smoke, choose Record Menu Activation from the macOS menu bar.
      2. Run candidate confirm: type zhongwen with system Pinyin, choose “中文”, then record.
      3. Run candidate cancel: begin Pinyin after “取消：”, press Escape, then record.
      4. Open the native chooser, cancel it, refresh evidence, then choose Complete and Exit.
    STEPS
    manual_root, manual_report = launch_host!(
      mode: "manual", timeout_seconds: 600, binary: HOST_APP_BINARY
    )
    assert_manual_report!(manual_report)
    puts "P0-HOST-SMOKE-01 manual release host: PASS"
  end
ensure
  safe_cleanup(automated_root)
  safe_cleanup(manual_root)
end
