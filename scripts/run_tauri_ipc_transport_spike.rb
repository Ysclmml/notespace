#!/usr/bin/env ruby
# frozen_string_literal: true

require "json"
require "open3"
require "rbconfig"
require "tmpdir"

ROOT = File.expand_path("..", __dir__)
TAURI_DIR = File.join(ROOT, "src-tauri")
CARGO_MANIFEST = File.join(TAURI_DIR, "Cargo.toml")
APP_BINARY_NAME = "markdown-workspace"
RESULT_FILE_NAME = "contract-024-result.json"
ENABLE_ENV = "MARKDOWN_WORKSPACE_CONTRACT_024_SPIKE"
SCENARIO_ENV = "MARKDOWN_WORKSPACE_CONTRACT_024_SCENARIO"
RESULT_ENV = "MARKDOWN_WORKSPACE_CONTRACT_024_RESULT"
RAW_BYTES = 32 * 1024 * 1024
WIRE_LIMIT_BYTES = 193 * 1024 * 1024
RUNS_PER_SCENARIO = 3
PROCESS_TIMEOUT_SECONDS = 180
SPIKE_MARKERS = [
  "MARKDOWN_WORKSPACE_CONTRACT_024_SPIKE",
  "contract_024_roundtrip",
  "wkwebviewCustomProtocol"
].freeze
SCENARIOS = {
  "ordinary" => {
    "requestWireBytes" => 14 + RAW_BYTES,
    "responseWireBytes" => 2 + RAW_BYTES
  },
  "worstEscaping" => {
    "requestWireBytes" => 14 + (RAW_BYTES * 6),
    "responseWireBytes" => 2 + (RAW_BYTES * 6)
  }
}.freeze

class SpikeFailure < StandardError; end

def resolve_executable(name, fallback = nil)
  configured = ENV[name.upcase]
  return configured if configured && File.file?(configured) && File.executable?(configured)

  ENV.fetch("PATH", "").split(File::PATH_SEPARATOR).each do |directory|
    candidate = File.join(directory, name)
    return candidate if File.file?(candidate) && File.executable?(candidate)
  end
  return fallback if fallback && File.file?(fallback) && File.executable?(fallback)

  raise SpikeFailure, "required executable is unavailable: #{name}"
end

def run_command!(*command, chdir: ROOT)
  stdout, stderr, status = Open3.capture3(*command, chdir: chdir)
  return if status.success?

  combined = [stdout, stderr].join("\n")
  diagnostic = combined.bytesize > 8_192 ? combined.byteslice(-8_192, 8_192) : combined
  raise SpikeFailure, "command failed (#{command.first}):\n#{diagnostic}"
end

def binary_path(profile)
  File.join(TAURI_DIR, "target", profile, APP_BINARY_NAME)
end

def assert_default_binary_isolated!(profile)
  path = binary_path(profile)
  raise SpikeFailure, "missing #{profile} application binary" unless File.file?(path)

  bytes = File.binread(path)
  leaked = SPIKE_MARKERS.select { |marker| bytes.include?(marker) }
  return if leaked.empty?

  raise SpikeFailure, "#{profile} default build contains spike markers: #{leaked.join(", ")}"
end

def terminate_process_group(pid)
  begin
    Process.kill("TERM", -pid)
  rescue Errno::ESRCH
    return
  end

  deadline = Process.clock_gettime(Process::CLOCK_MONOTONIC) + 2
  while Process.clock_gettime(Process::CLOCK_MONOTONIC) < deadline
    begin
      Process.kill(0, pid)
      sleep 0.05
    rescue Errno::ESRCH
      return
    end
  end
  begin
    Process.kill("KILL", -pid)
  rescue Errno::ESRCH
    nil
  end
end

def wait_with_timeout(wait_thread, timeout_seconds)
  deadline = Process.clock_gettime(Process::CLOCK_MONOTONIC) + timeout_seconds
  while wait_thread.alive? && Process.clock_gettime(Process::CLOCK_MONOTONIC) < deadline
    sleep 0.05
  end
  return wait_thread.value unless wait_thread.alive?

  terminate_process_group(wait_thread.pid)
  wait_thread.value
  raise SpikeFailure, "transport process exceeded #{timeout_seconds}s timeout"
end

def validate_result!(result, scenario)
  expected = SCENARIOS.fetch(scenario)
  required = %w[
    status scenario rawBytes requestWireBytes responseWireBytes elapsedMicros roundTrips transport
  ]
  unless result.keys.sort == required.sort
    raise SpikeFailure, "#{scenario} returned an unexpected result shape"
  end

  invariants = {
    "status" => result["status"] == "PASS",
    "scenario" => result["scenario"] == scenario,
    "rawBytes" => result["rawBytes"] == RAW_BYTES,
    "requestWireBytes" => result["requestWireBytes"] == expected.fetch("requestWireBytes"),
    "responseWireBytes" => result["responseWireBytes"] == expected.fetch("responseWireBytes"),
    "requestBudget" => result["requestWireBytes"].is_a?(Integer) &&
      result["requestWireBytes"] <= WIRE_LIMIT_BYTES,
    "responseBudget" => result["responseWireBytes"].is_a?(Integer) &&
      result["responseWireBytes"] <= WIRE_LIMIT_BYTES,
    "elapsedMicros" => result["elapsedMicros"].is_a?(Integer) && result["elapsedMicros"].positive?,
    "roundTrips" => result["roundTrips"] == 1,
    "transport" => result["transport"] == "wkwebviewCustomProtocol"
  }
  failed = invariants.each_with_object([]) do |(name, passed), failures|
    failures << name unless passed
  end
  return if failed.empty?

  raise SpikeFailure, "#{scenario} failed result invariants: #{failed.join(", ")}"
end

def run_scenario!(binary, scenario)
  Dir.mktmpdir("markdown-workspace-contract-024-") do |directory|
    result_path = File.join(directory, RESULT_FILE_NAME)
    environment = {
      ENABLE_ENV => "1",
      SCENARIO_ENV => scenario,
      RESULT_ENV => result_path
    }
    captured_output = +""

    Open3.popen2e(environment, binary, chdir: TAURI_DIR, pgroup: true) do |stdin, output, wait_thread|
      stdin.close
      output_thread = Thread.new { captured_output << output.read }
      status = wait_with_timeout(wait_thread, PROCESS_TIMEOUT_SECONDS)
      output_thread.join
      unless status.success?
        diagnostic = if captured_output.bytesize > 2_048
                       captured_output.byteslice(-2_048, 2_048)
                     else
                       captured_output
                     end
        raise SpikeFailure, "#{scenario} process exited #{status.exitstatus}: #{diagnostic}"
      end
    end

    raise SpikeFailure, "#{scenario} did not create a structured result" unless File.file?(result_path)

    result = JSON.parse(File.binread(result_path))
    if result["status"] == "FAIL"
      raise SpikeFailure, "#{scenario} harness failed: #{result.fetch("code", "unknownFailure")}"
    end
    validate_result!(result, scenario)
    result
  rescue JSON::ParserError => error
    raise SpikeFailure, "#{scenario} returned invalid JSON: #{error.message}"
  end
end

def percentile(values, fraction)
  ordered = values.sort
  ordered[((ordered.length - 1) * fraction).ceil]
end

def build_summary(results)
  scenarios = results.transform_values do |runs|
    elapsed = runs.map { |run| run.fetch("elapsedMicros") }
    first = runs.first
    {
      "runs" => runs.length,
      "rawBytes" => first.fetch("rawBytes"),
      "requestWireBytes" => first.fetch("requestWireBytes"),
      "responseWireBytes" => first.fetch("responseWireBytes"),
      "elapsedMicros" => elapsed,
      "medianElapsedMicros" => percentile(elapsed, 0.5),
      "maxElapsedMicros" => elapsed.max,
      "transport" => first.fetch("transport")
    }
  end

  {
    "schemaVersion" => "contract-024-spike-v1",
    "status" => "PASS",
    "platform" => RbConfig::CONFIG.fetch("host_os"),
    "architecture" => RbConfig::CONFIG.fetch("host_cpu"),
    "runsPerScenario" => RUNS_PER_SCENARIO,
    "rawLimitBytes" => RAW_BYTES,
    "wireLimitBytes" => WIRE_LIMIT_BYTES,
    "defaultBuildIsolation" => {
      "debug" => "PASS",
      "release" => "PASS"
    },
    "scenarios" => scenarios
  }
end

def main
  unless RbConfig::CONFIG.fetch("host_os").include?("darwin")
    raise SpikeFailure, "CONTRACT-024 transport spike requires macOS/WKWebView"
  end

  pnpm = resolve_executable("pnpm")
  cargo = resolve_executable("cargo", File.join(Dir.home, ".cargo", "bin", "cargo"))

  run_command!(pnpm, "build")
  run_command!(cargo, "build", "--manifest-path", CARGO_MANIFEST)
  assert_default_binary_isolated!("debug")
  run_command!(cargo, "build", "--manifest-path", CARGO_MANIFEST, "--release",
               "--features", "tauri/custom-protocol")
  assert_default_binary_isolated!("release")
  run_command!(cargo, "build", "--manifest-path", CARGO_MANIFEST, "--release",
               "--features", "tauri/custom-protocol,ipc-transport-spike")

  binary = binary_path("release")
  results = SCENARIOS.to_h do |scenario, _expected|
    [scenario, Array.new(RUNS_PER_SCENARIO) { run_scenario!(binary, scenario) }]
  end
  puts JSON.pretty_generate(build_summary(results))
end

begin
  main
rescue SpikeFailure => error
  warn JSON.generate({ "schemaVersion" => "contract-024-spike-v1", "status" => "FAIL", "error" => error.message })
  exit 1
rescue StandardError => error
  warn JSON.generate({
                       "schemaVersion" => "contract-024-spike-v1",
                       "status" => "FAIL",
                       "error" => "#{error.class}: #{error.message}"
                     })
  exit 1
end
