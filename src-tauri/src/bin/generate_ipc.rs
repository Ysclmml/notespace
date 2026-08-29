use std::{
    env, fs,
    io::Write,
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

use markdown_workspace_lib::ipc_schema::{
    render_contract_manifest, render_event_payload_schemas, render_typescript,
    render_union_fixtures, render_union_schemas, validate_catalog,
};

struct Artifact {
    path: PathBuf,
    contents: String,
}

fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    validate_catalog()?;
    let check = match env::args().nth(1).as_deref() {
        Some("--check") => true,
        Some("--write") | None => false,
        Some(argument) => return Err(format!("unknown argument: {argument}")),
    };

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let repository_root = manifest_dir
        .parent()
        .ok_or_else(|| "Cargo manifest has no repository parent".to_owned())?;
    let formatted_typescript = format_typescript(repository_root, &render_typescript())?;
    let artifacts = [
        Artifact {
            path: repository_root.join("src/generated/ipc.ts"),
            contents: formatted_typescript,
        },
        Artifact {
            path: repository_root.join("contracts/ipc-v1.manifest.json"),
            contents: render_contract_manifest(),
        },
        Artifact {
            path: repository_root.join("contracts/generated/ipc-v1-union-fixtures.json"),
            contents: render_union_fixtures(),
        },
        Artifact {
            path: repository_root.join("contracts/generated/ipc-v1-union-schemas.json"),
            contents: render_union_schemas(),
        },
        Artifact {
            path: repository_root.join("contracts/generated/ipc-v1-event-schemas.json"),
            contents: render_event_payload_schemas(),
        },
    ];

    if check {
        let mut drift = Vec::new();
        for artifact in &artifacts {
            match fs::read_to_string(&artifact.path) {
                Ok(existing) if existing == artifact.contents => {}
                Ok(_) => drift.push(format!(
                    "changed: {}",
                    display_path(repository_root, &artifact.path)
                )),
                Err(error) => drift.push(format!(
                    "missing/unreadable: {} ({error})",
                    display_path(repository_root, &artifact.path)
                )),
            }
        }
        if drift.is_empty() {
            println!("CONTRACT-001 PASS: generated IPC artifacts have no drift");
            return Ok(());
        }
        return Err(format!(
            "CONTRACT-001 FAIL: regenerate with `cargo run --manifest-path src-tauri/Cargo.toml --bin generate_ipc -- --write`\n{}",
            drift.join("\n")
        ));
    }

    for artifact in &artifacts {
        if let Some(parent) = artifact.path.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                format!(
                    "cannot create {}: {error}",
                    display_path(repository_root, parent)
                )
            })?;
        }
        fs::write(&artifact.path, &artifact.contents).map_err(|error| {
            format!(
                "cannot write {}: {error}",
                display_path(repository_root, &artifact.path)
            )
        })?;
        println!(
            "generated {}",
            display_path(repository_root, &artifact.path)
        );
    }
    Ok(())
}

fn format_typescript(repository_root: &Path, source: &str) -> Result<String, String> {
    let mut child = Command::new("pnpm")
        .args([
            "exec",
            "prettier",
            "--stdin-filepath",
            "src/generated/ipc.ts",
        ])
        .current_dir(repository_root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("cannot start pinned Prettier through pnpm: {error}"))?;
    child
        .stdin
        .take()
        .ok_or_else(|| "Prettier stdin was not captured".to_owned())?
        .write_all(source.as_bytes())
        .map_err(|error| format!("cannot send generated TypeScript to Prettier: {error}"))?;
    let output = child
        .wait_with_output()
        .map_err(|error| format!("cannot wait for Prettier: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "pinned Prettier rejected generated TypeScript:\n{}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    String::from_utf8(output.stdout)
        .map_err(|error| format!("Prettier returned non-UTF-8 output: {error}"))
}

fn display_path(repository_root: &Path, path: &Path) -> String {
    path.strip_prefix(repository_root)
        .unwrap_or(path)
        .display()
        .to_string()
}
