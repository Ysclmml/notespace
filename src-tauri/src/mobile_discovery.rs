use mdns_sd::{ServiceDaemon, ServiceEvent};
use serde::Serialize;
use std::collections::BTreeMap;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const NOTE_SPACE_SERVICE_TYPE: &str = "_notespace._tcp.local.";
const PROTOCOL_VERSION: &str = "1";
const MIN_DISCOVERY_MS: u64 = 250;
const MAX_DISCOVERY_MS: u64 = 5_000;

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredLanService {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub base_url: String,
    pub candidate_base_urls: Vec<String>,
    pub last_seen_at: u64,
}

fn now_epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

fn discover_blocking(timeout_ms: u64) -> Result<Vec<DiscoveredLanService>, String> {
    let timeout = Duration::from_millis(timeout_ms.clamp(MIN_DISCOVERY_MS, MAX_DISCOVERY_MS));
    let daemon = ServiceDaemon::new().map_err(|error| format!("mDNS unavailable: {error}"))?;
    let receiver = daemon
        .browse(NOTE_SPACE_SERVICE_TYPE)
        .map_err(|error| format!("mDNS browse failed: {error}"))?;
    let deadline = Instant::now() + timeout;
    let mut services = BTreeMap::new();

    loop {
        let now = Instant::now();
        if now >= deadline {
            break;
        }
        match receiver.recv_timeout(deadline.saturating_duration_since(now)) {
            Ok(ServiceEvent::ServiceResolved(service)) => {
                if service.get_property_val_str("protocolVersion") != Some(PROTOCOL_VERSION) {
                    continue;
                }
                let mut hosts = service
                    .get_addresses_v4()
                    .into_iter()
                    .filter(|address| !address.is_loopback() && !address.is_unspecified())
                    .map(|address| address.to_string())
                    .collect::<Vec<_>>();
                hosts.sort();
                hosts.dedup();
                let Some(host) = hosts.first().cloned() else {
                    continue;
                };
                let port = service.get_port();
                if port == 0 {
                    continue;
                }
                let id = service
                    .get_property_val_str("instanceId")
                    .filter(|value| !value.is_empty())
                    .unwrap_or_else(|| service.get_fullname())
                    .to_owned();
                let name = service
                    .get_property_val_str("serviceName")
                    .filter(|value| !value.is_empty())
                    .unwrap_or("NoteSpace")
                    .to_owned();
                let candidate_base_urls = hosts
                    .into_iter()
                    .map(|candidate| format!("http://{candidate}:{port}/api/v1"))
                    .collect();
                services.insert(
                    id.clone(),
                    DiscoveredLanService {
                        id,
                        name,
                        host: host.clone(),
                        port,
                        base_url: format!("http://{host}:{port}/api/v1"),
                        candidate_base_urls,
                        last_seen_at: now_epoch_ms(),
                    },
                );
            }
            Ok(_) => {}
            Err(mdns_sd::RecvTimeoutError::Timeout) => break,
            Err(mdns_sd::RecvTimeoutError::Disconnected) => break,
        }
    }

    let _ = daemon.stop_browse(NOTE_SPACE_SERVICE_TYPE);
    let _ = daemon.shutdown();
    Ok(services.into_values().collect())
}

#[tauri::command]
pub async fn discover_lan_services(
    timeout_ms: Option<u64>,
) -> Result<Vec<DiscoveredLanService>, String> {
    tauri::async_runtime::spawn_blocking(move || discover_blocking(timeout_ms.unwrap_or(1_500)))
        .await
        .map_err(|error| format!("LAN discovery task failed: {error}"))?
}
