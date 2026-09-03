use super::{BackendError, BackendResult};
use serde::{Deserialize, Serialize};
use std::time::Duration;

const LATEST_RELEASE_URL: &str = "https://api.github.com/repos/Ysclmml/notespace/releases/latest";
const RELEASE_PATH_PREFIX: &str = "/ysclmml/notespace/releases/";
const MAX_RESPONSE_BYTES: u64 = 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckResult {
    current_version: String,
    latest_version: Option<String>,
    release_url: Option<String>,
    published_at: Option<String>,
    status: UpdateStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
enum UpdateStatus {
    Available,
    UpToDate,
    NoPublishedRelease,
}

#[derive(Debug, Deserialize)]
struct GitHubRelease {
    tag_name: String,
    html_url: String,
    published_at: Option<String>,
    draft: bool,
    prerelease: bool,
}

#[tauri::command]
pub async fn check_for_update() -> BackendResult<UpdateCheckResult> {
    tauri::async_runtime::spawn_blocking(check_latest_release)
        .await
        .map_err(|error| BackendError::new("updateCheckFailed", error.to_string()))?
}

fn check_latest_release() -> BackendResult<UpdateCheckResult> {
    let current_version = env!("CARGO_PKG_VERSION");
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(10)))
        .max_redirects(0)
        .build()
        .into();
    let mut response = match agent
        .get(LATEST_RELEASE_URL)
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .header(
            "User-Agent",
            concat!("NoteSpace/", env!("CARGO_PKG_VERSION")),
        )
        .call()
    {
        Ok(response) => response,
        Err(ureq::Error::StatusCode(404)) => return Ok(no_release(current_version)),
        Err(error) => {
            return Err(BackendError::new(
                "updateCheckFailed",
                format!("GitHub release check failed: {error}"),
            ))
        }
    };
    let body = response
        .body_mut()
        .with_config()
        .limit(MAX_RESPONSE_BYTES)
        .read_to_string()
        .map_err(|error| {
            BackendError::new(
                "updateCheckFailed",
                format!("GitHub release response could not be read: {error}"),
            )
        })?;
    parse_release_response(current_version, &body)
}

fn no_release(current_version: &str) -> UpdateCheckResult {
    UpdateCheckResult {
        current_version: current_version.to_owned(),
        latest_version: None,
        release_url: None,
        published_at: None,
        status: UpdateStatus::NoPublishedRelease,
    }
}

fn parse_release_response(current_version: &str, body: &str) -> BackendResult<UpdateCheckResult> {
    let release: GitHubRelease = serde_json::from_str(body).map_err(|error| {
        BackendError::new(
            "updateInvalidResponse",
            format!("GitHub returned an invalid release response: {error}"),
        )
    })?;
    if release.draft || release.prerelease {
        return Err(BackendError::new(
            "updateInvalidResponse",
            "GitHub returned a draft or prerelease from the stable release endpoint.",
        ));
    }
    let current = parse_stable_version(current_version).ok_or_else(|| {
        BackendError::new(
            "updateInvalidResponse",
            "The current app version is invalid.",
        )
    })?;
    let latest = parse_stable_version(&release.tag_name).ok_or_else(|| {
        BackendError::new(
            "updateInvalidResponse",
            "The latest GitHub release tag is not a stable semantic version.",
        )
    })?;
    validate_release_url(&release.html_url)?;

    Ok(UpdateCheckResult {
        current_version: current_version.to_owned(),
        latest_version: Some(format_version(latest)),
        release_url: Some(release.html_url),
        published_at: release.published_at,
        status: if latest > current {
            UpdateStatus::Available
        } else {
            UpdateStatus::UpToDate
        },
    })
}

fn parse_stable_version(value: &str) -> Option<(u64, u64, u64)> {
    let value = value
        .trim()
        .strip_prefix(['v', 'V'])
        .unwrap_or(value.trim());
    let (core, build) = value
        .split_once('+')
        .map_or((value, None), |(core, build)| (core, Some(build)));
    if build.is_some_and(|metadata| {
        metadata.is_empty()
            || metadata.split('.').any(|identifier| {
                identifier.is_empty()
                    || !identifier
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
            })
    }) {
        return None;
    }
    let mut parts = core.split('.');
    let major = parse_numeric_identifier(parts.next()?)?;
    let minor = parse_numeric_identifier(parts.next()?)?;
    let patch = parse_numeric_identifier(parts.next()?)?;
    if parts.next().is_some() {
        return None;
    }
    Some((major, minor, patch))
}

fn parse_numeric_identifier(value: &str) -> Option<u64> {
    if value.is_empty()
        || !value.bytes().all(|byte| byte.is_ascii_digit())
        || (value.len() > 1 && value.starts_with('0'))
    {
        return None;
    }
    value.parse().ok()
}

fn format_version((major, minor, patch): (u64, u64, u64)) -> String {
    format!("{major}.{minor}.{patch}")
}

fn validate_release_url(value: &str) -> BackendResult<()> {
    let url = tauri::Url::parse(value).map_err(|_| {
        BackendError::new(
            "updateInvalidResponse",
            "The GitHub release link is invalid.",
        )
    })?;
    if url.scheme() != "https"
        || url.host_str() != Some("github.com")
        || !url
            .path()
            .to_ascii_lowercase()
            .starts_with(RELEASE_PATH_PREFIX)
    {
        return Err(BackendError::new(
            "updateInvalidResponse",
            "The release link does not belong to the NoteSpace GitHub repository.",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn release(tag: &str, url: &str) -> String {
        serde_json::json!({
            "tag_name": tag,
            "html_url": url,
            "published_at": "2026-09-04T09:00:00Z",
            "draft": false,
            "prerelease": false
        })
        .to_string()
    }

    #[test]
    fn reports_a_newer_stable_release() {
        let result = parse_release_response(
            "0.1.1",
            &release(
                "v0.2.0",
                "https://github.com/Ysclmml/notespace/releases/tag/v0.2.0",
            ),
        )
        .unwrap();
        assert_eq!(result.status, UpdateStatus::Available);
        assert_eq!(result.current_version, "0.1.1");
        assert_eq!(result.latest_version.as_deref(), Some("0.2.0"));
    }

    #[test]
    fn equal_or_older_release_is_up_to_date() {
        for tag in ["0.1.1", "v0.1.0"] {
            let result = parse_release_response(
                "0.1.1",
                &release(
                    tag,
                    &format!("https://github.com/Ysclmml/notespace/releases/tag/{tag}"),
                ),
            )
            .unwrap();
            assert_eq!(result.status, UpdateStatus::UpToDate);
        }
    }

    #[test]
    fn rejects_prerelease_tags_and_untrusted_links() {
        let prerelease = parse_release_response(
            "0.1.1",
            &release(
                "v0.2.0-beta.1",
                "https://github.com/Ysclmml/notespace/releases/tag/v0.2.0-beta.1",
            ),
        )
        .unwrap_err();
        assert_eq!(prerelease.code, "updateInvalidResponse");

        let untrusted = parse_release_response(
            "0.1.1",
            &release("v0.2.0", "https://example.com/releases/tag/v0.2.0"),
        )
        .unwrap_err();
        assert_eq!(untrusted.code, "updateInvalidResponse");
    }

    #[test]
    fn validates_versions_without_ignoring_extra_components() {
        assert_eq!(parse_stable_version("v1.2.3"), Some((1, 2, 3)));
        assert_eq!(parse_stable_version(" V1.2.3 "), Some((1, 2, 3)));
        assert_eq!(parse_stable_version("1.2.3+macos.arm64"), Some((1, 2, 3)));
        assert_eq!(parse_stable_version("1.2"), None);
        assert_eq!(parse_stable_version("1.2.3.4"), None);
        assert_eq!(parse_stable_version("1.2.3-beta"), None);
        assert_eq!(parse_stable_version("01.2.3"), None);
        assert_eq!(parse_stable_version("1.2.3+"), None);
    }

    #[test]
    fn represents_an_absent_published_release_without_a_link() {
        let result = no_release("0.1.1");
        assert_eq!(result.status, UpdateStatus::NoPublishedRelease);
        assert_eq!(result.latest_version, None);
        assert_eq!(result.release_url, None);
    }
}
