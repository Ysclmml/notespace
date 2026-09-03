use super::{BackendError, BackendResult};
use std::process::{Command, Stdio};

#[derive(Clone, Copy)]
enum BrowserPlatform {
    MacOs,
    Windows,
    Linux,
}

#[derive(Debug, PartialEq)]
enum BrowserLaunch {
    Command {
        program: &'static str,
        args: [String; 1],
    },
    Windows {
        url: String,
    },
}

fn browser_launch(url: &str, platform: BrowserPlatform) -> BackendResult<BrowserLaunch> {
    let invalid_url = || {
        BackendError::new(
            "invalidExternalUrl",
            "only HTTP and HTTPS browser links with a valid host are supported",
        )
    };
    // URL parsers discard some controls; reject them before creating an OS argument.
    if url.chars().any(char::is_control) {
        return Err(invalid_url());
    }
    let parsed = tauri::Url::parse(url).map_err(|_| invalid_url())?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
        return Err(invalid_url());
    }
    let url = parsed.to_string();
    Ok(match platform {
        BrowserPlatform::MacOs => BrowserLaunch::Command {
            program: "open",
            args: [url],
        },
        BrowserPlatform::Linux => BrowserLaunch::Command {
            program: "xdg-open",
            args: [url],
        },
        BrowserPlatform::Windows => BrowserLaunch::Windows { url },
    })
}

pub(super) fn open_in_browser(url: &str) -> BackendResult<()> {
    let platform = if cfg!(target_os = "macos") {
        BrowserPlatform::MacOs
    } else if cfg!(target_os = "windows") {
        BrowserPlatform::Windows
    } else if cfg!(target_os = "linux") {
        BrowserPlatform::Linux
    } else {
        return Err(BackendError::new(
            "externalOpenFailed",
            "opening a system browser is not supported on this platform",
        ));
    };

    match browser_launch(url, platform)? {
        BrowserLaunch::Command { program, args } => {
            let status = Command::new(program)
                .args(args)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .map_err(|error| BackendError::new("externalOpenFailed", error.to_string()))?;
            if status.success() {
                Ok(())
            } else {
                Err(BackendError::new(
                    "externalOpenFailed",
                    format!("system browser launcher exited with status {status}"),
                ))
            }
        }
        BrowserLaunch::Windows { url } => open_windows_browser(&url),
    }
}

#[cfg(target_os = "windows")]
fn open_windows_browser(url: &str) -> BackendResult<()> {
    use std::ffi::c_void;
    use std::ptr;

    #[link(name = "shell32")]
    extern "system" {
        fn ShellExecuteW(
            window: *mut c_void,
            operation: *const u16,
            file: *const u16,
            parameters: *const u16,
            directory: *const u16,
            show_command: i32,
        ) -> *mut c_void;
    }

    let operation: Vec<u16> = "open".encode_utf16().chain(Some(0)).collect();
    let target: Vec<u16> = url.encode_utf16().chain(Some(0)).collect();
    // SAFETY: both buffers are live, NUL-terminated UTF-16 strings. The validated
    // URL is passed as the file target, never as shell code or command parameters.
    let result = unsafe {
        ShellExecuteW(
            ptr::null_mut(),
            operation.as_ptr(),
            target.as_ptr(),
            ptr::null(),
            ptr::null(),
            1,
        )
    } as isize;
    if result > 32 {
        Ok(())
    } else {
        Err(BackendError::new(
            "externalOpenFailed",
            format!("system browser launcher failed with code {result}"),
        ))
    }
}

#[cfg(not(target_os = "windows"))]
fn open_windows_browser(_url: &str) -> BackendResult<()> {
    Err(BackendError::new(
        "externalOpenFailed",
        "the Windows browser launcher is unavailable on this platform",
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_http_https_local_hosts_and_encoded_paths_without_requests() {
        for url in [
            "https://example.test/guide?q=hello#section",
            "http://localhost:8080/docs",
            "http://127.0.0.1:3000/",
            "https://[::1]:8443/",
            "https://example.test/%E7%AC%94%E8%AE%B0?q=a%20b",
        ] {
            assert!(browser_launch(url, BrowserPlatform::MacOs).is_ok());
        }
        assert_eq!(
            browser_launch("HTTPS://EXAMPLE.TEST", BrowserPlatform::MacOs).unwrap(),
            BrowserLaunch::Command {
                program: "open",
                args: ["https://example.test/".into()],
            }
        );
    }

    #[test]
    fn rejects_non_web_schemes_missing_hosts_and_control_characters() {
        for url in [
            "",
            "relative.md",
            "//example.test/path",
            "https://",
            "https://?query",
            "https://exa mple.test/",
            "javascript:alert(1)",
            "file:///tmp/notes.md",
            "data:text/html,hello",
            "mailto:reader@example.test",
            "ftp://example.test/file",
            "https://example.test/\0test",
            "https://example.test/\npath",
            "https://example.test/\tpath",
        ] {
            let error = browser_launch(url, BrowserPlatform::MacOs).unwrap_err();
            assert_eq!(error.code, "invalidExternalUrl", "URL: {url:?}");
        }
    }

    #[test]
    fn dispatches_literal_url_to_each_platform_without_shell_interpolation() {
        let url = "https://example.test/path?one=a&two=$(echo-test);three=%22quoted%22#end";
        for (platform, program) in [
            (BrowserPlatform::MacOs, "open"),
            (BrowserPlatform::Linux, "xdg-open"),
        ] {
            assert_eq!(
                browser_launch(url, platform).unwrap(),
                BrowserLaunch::Command {
                    program,
                    args: [url.into()],
                }
            );
        }
        assert_eq!(
            browser_launch(url, BrowserPlatform::Windows).unwrap(),
            BrowserLaunch::Windows { url: url.into() }
        );
    }
}
