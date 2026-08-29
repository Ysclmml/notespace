use std::{
    env, fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, AtomicUsize, Ordering},
};

use tauri::{webview::PageLoadEvent, AppHandle, Builder, Manager, Wry};

const ENABLE_ENV: &str = "MARKDOWN_WORKSPACE_CONTRACT_024_SPIKE";
const RESULT_PATH_ENV: &str = "MARKDOWN_WORKSPACE_CONTRACT_024_RESULT";
const SCENARIO_ENV: &str = "MARKDOWN_WORKSPACE_CONTRACT_024_SCENARIO";
const RESULT_FILE_NAME: &str = "contract-024-result.json";
const RAW_LIMIT_BYTES: usize = 32 * 1024 * 1024;
const WIRE_LIMIT_BYTES: usize = 193 * 1024 * 1024;
const HARNESS_SCRIPT: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../tests/contract/ipc/contract-024-document-content-budget/harness.js"
));

static INJECTED: AtomicBool = AtomicBool::new(false);
static ROUND_TRIPS: AtomicUsize = AtomicUsize::new(0);

pub(crate) fn configure(builder: Builder<Wry>) -> Builder<Wry> {
    builder
        .invoke_handler(tauri::generate_handler![
            contract_024_scenario,
            contract_024_roundtrip,
            contract_024_report,
            contract_024_fail
        ])
        .on_page_load(|webview, payload| {
            if !spike_enabled()
                || payload.event() != PageLoadEvent::Finished
                || INJECTED.swap(true, Ordering::SeqCst)
            {
                return;
            }

            if webview.eval(HARNESS_SCRIPT).is_err() {
                let _ = finish_failure(webview.app_handle(), "harnessEvaluationFailed", 70);
            }
        })
        .on_web_content_process_terminate(|webview| {
            if spike_enabled() {
                let _ = finish_failure(webview.app_handle(), "webContentProcessTerminated", 71);
            }
        })
}

fn spike_enabled() -> bool {
    env::var(ENABLE_ENV).as_deref() == Ok("1")
}

fn scenario() -> Result<String, String> {
    if !spike_enabled() {
        return Err("transport spike is not enabled".to_owned());
    }

    match env::var(SCENARIO_ENV).as_deref() {
        Ok("ordinary") => Ok("ordinary".to_owned()),
        Ok("worstEscaping") => Ok("worstEscaping".to_owned()),
        _ => Err("transport spike scenario is invalid".to_owned()),
    }
}

#[tauri::command]
fn contract_024_scenario() -> Result<String, String> {
    scenario()
}

#[tauri::command]
fn contract_024_roundtrip(payload: String) -> Result<String, String> {
    let scenario = scenario()?;
    if ROUND_TRIPS.fetch_add(1, Ordering::SeqCst) != 0 {
        return Err("transport spike accepts exactly one round-trip per process".to_owned());
    }
    if payload.len() != RAW_LIMIT_BYTES {
        return Err("transport spike received the wrong raw byte length".to_owned());
    }

    let expected_byte = if scenario == "ordinary" { b'x' } else { 0 };
    if !payload.as_bytes().iter().all(|byte| *byte == expected_byte) {
        return Err("transport spike received different content".to_owned());
    }

    Ok(payload)
}

#[tauri::command]
fn contract_024_report(app: AppHandle<Wry>, result: String) -> Result<(), String> {
    let fields: Vec<&str> = result.split('|').collect();
    if fields.len() != 9 {
        return finish_failure(&app, "invalidResultShape", 72);
    }

    let scenario = fields[0];
    let raw_bytes = parse_usize(fields[1], "raw bytes")?;
    let request_wire_bytes = parse_usize(fields[2], "request wire bytes")?;
    let response_wire_bytes = parse_usize(fields[3], "response wire bytes")?;
    let elapsed_micros = parse_u64(fields[4], "elapsed micros")?;
    let equal = parse_bool(fields[5], "equal")?;
    let transport_observation_installed = parse_bool(fields[6], "transport observation installed")?;
    let fallback_used = parse_bool(fields[7], "fallback used")?;
    let boundaries_passed = parse_bool(fields[8], "boundaries passed")?;

    let escape_factor = match scenario {
        "ordinary" => 1,
        "worstEscaping" => 6,
        _ => return finish_failure(&app, "invalidScenarioReport", 72),
    };
    let expected_request_wire_bytes = 14 + RAW_LIMIT_BYTES * escape_factor;
    let expected_response_wire_bytes = 2 + RAW_LIMIT_BYTES * escape_factor;
    let valid = raw_bytes == RAW_LIMIT_BYTES
        && request_wire_bytes == expected_request_wire_bytes
        && response_wire_bytes == expected_response_wire_bytes
        && request_wire_bytes <= WIRE_LIMIT_BYTES
        && response_wire_bytes <= WIRE_LIMIT_BYTES
        && elapsed_micros > 0
        && equal
        && transport_observation_installed
        && !fallback_used
        && boundaries_passed
        && ROUND_TRIPS.load(Ordering::SeqCst) == 1;

    if !valid {
        return finish_failure(&app, "resultInvariantFailed", 72);
    }

    let json = format!(
        concat!(
            "{{\n",
            "  \"status\": \"PASS\",\n",
            "  \"scenario\": \"{}\",\n",
            "  \"rawBytes\": {},\n",
            "  \"requestWireBytes\": {},\n",
            "  \"responseWireBytes\": {},\n",
            "  \"elapsedMicros\": {},\n",
            "  \"roundTrips\": 1,\n",
            "  \"transport\": \"wkwebviewCustomProtocol\"\n",
            "}}\n"
        ),
        scenario, raw_bytes, request_wire_bytes, response_wire_bytes, elapsed_micros
    );
    finish(&app, &json, 0)
}

#[tauri::command]
fn contract_024_fail(app: AppHandle<Wry>, code: String) -> Result<(), String> {
    const ALLOWED_CODES: &[&str] = &[
        "boundaryInvariantFailed",
        "transportObservationUnavailable",
        "customProtocolNotObserved",
        "invokeRejected",
        "responseMismatch",
        "unexpectedHarnessFailure",
    ];
    let safe_code = if ALLOWED_CODES.contains(&code.as_str()) {
        code.as_str()
    } else {
        "unknownHarnessFailure"
    };
    finish_failure(&app, safe_code, 73)
}

fn parse_usize(value: &str, label: &str) -> Result<usize, String> {
    value
        .parse::<usize>()
        .map_err(|_| format!("invalid {label}"))
}

fn parse_u64(value: &str, label: &str) -> Result<u64, String> {
    value.parse::<u64>().map_err(|_| format!("invalid {label}"))
}

fn parse_bool(value: &str, label: &str) -> Result<bool, String> {
    match value {
        "true" => Ok(true),
        "false" => Ok(false),
        _ => Err(format!("invalid {label}")),
    }
}

fn finish_failure(app: &AppHandle<Wry>, code: &str, exit_code: i32) -> Result<(), String> {
    let json = format!("{{\n  \"status\": \"FAIL\",\n  \"code\": \"{code}\"\n}}\n");
    finish(app, &json, exit_code)
}

fn finish(app: &AppHandle<Wry>, json: &str, exit_code: i32) -> Result<(), String> {
    let write_result = result_path().and_then(|path| {
        fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(path)
            .and_then(|mut file| {
                use std::io::Write;
                file.write_all(json.as_bytes())?;
                file.sync_all()
            })
            .map_err(|_| "cannot persist transport spike result".to_owned())
    });
    app.exit(if write_result.is_ok() { exit_code } else { 74 });
    write_result
}

fn result_path() -> Result<PathBuf, String> {
    let requested = env::var_os(RESULT_PATH_ENV)
        .map(PathBuf::from)
        .ok_or_else(|| "transport spike result path is missing".to_owned())?;
    if requested.file_name().and_then(|name| name.to_str()) != Some(RESULT_FILE_NAME) {
        return Err("transport spike result filename is invalid".to_owned());
    }
    let parent = requested
        .parent()
        .ok_or_else(|| "transport spike result parent is missing".to_owned())?;
    let canonical_parent = fs::canonicalize(parent)
        .map_err(|_| "transport spike result parent is unavailable".to_owned())?;
    let canonical_temp = canonical_temp_root()?;
    if !canonical_parent.starts_with(&canonical_temp) {
        return Err(
            "transport spike result must stay in the system temporary directory".to_owned(),
        );
    }
    Ok(canonical_parent.join(RESULT_FILE_NAME))
}

fn canonical_temp_root() -> Result<PathBuf, String> {
    canonicalize_existing_ancestor(&env::temp_dir())
        .ok_or_else(|| "system temporary directory is unavailable".to_owned())
}

fn canonicalize_existing_ancestor(path: &Path) -> Option<PathBuf> {
    let mut candidate = path;
    loop {
        if let Ok(canonical) = fs::canonicalize(candidate) {
            return Some(canonical);
        }
        candidate = candidate.parent()?;
    }
}

#[cfg(test)]
mod tests {
    use super::{parse_bool, RAW_LIMIT_BYTES, WIRE_LIMIT_BYTES};

    const DEFAULT_LIMIT_BYTES: usize = 1024 * 1024;

    fn document_allowed(raw_bytes: usize, wire_bytes: usize) -> bool {
        raw_bytes <= RAW_LIMIT_BYTES && wire_bytes <= WIRE_LIMIT_BYTES
    }

    fn default_allowed(wire_bytes: usize) -> bool {
        wire_bytes <= DEFAULT_LIMIT_BYTES
    }

    #[test]
    fn contract_024_raw_and_wire_boundaries_are_distinct_from_default_budget() {
        assert!(document_allowed(RAW_LIMIT_BYTES - 1, WIRE_LIMIT_BYTES - 1));
        assert!(document_allowed(RAW_LIMIT_BYTES, WIRE_LIMIT_BYTES));
        assert!(!document_allowed(RAW_LIMIT_BYTES + 1, WIRE_LIMIT_BYTES));
        assert!(!document_allowed(RAW_LIMIT_BYTES, WIRE_LIMIT_BYTES + 1));
        assert!(default_allowed(DEFAULT_LIMIT_BYTES));
        assert!(!default_allowed(DEFAULT_LIMIT_BYTES + 1));
        assert!(document_allowed(
            DEFAULT_LIMIT_BYTES + 1,
            DEFAULT_LIMIT_BYTES + 1
        ));
    }

    #[test]
    fn report_boolean_parser_is_fail_closed() {
        assert!(parse_bool("true", "test").unwrap());
        assert!(!parse_bool("false", "test").unwrap());
        assert!(parse_bool("1", "test").is_err());
    }
}
