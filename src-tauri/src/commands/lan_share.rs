use super::{BackendError, BackendResult};
use crate::lan_share::{LanHttpServer, LanShareService};
use mdns_sd::{ServiceDaemon, ServiceInfo};
use serde::{Deserialize, Serialize};
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard};
use std::time::Duration;

const SERVICE_TYPE: &str = "_notespace._tcp.local.";
const SERVICE_NAME: &str = "NoteSpace Desktop";
const API_PROTOCOL_VERSION: &str = "1";
const DEFAULT_LAN_SHARE_PORT: u16 = 49_920;
const MIN_LAN_SHARE_PORT: u16 = 1_024;
static NEXT_INSTANCE: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LanShareWorkspaceSelection {
    pub path: String,
    pub name: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LanShareRuntimeStatus {
    Stopped,
    Running,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LanShareDiscoveryStatus {
    Active,
    Unavailable,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanShareStatus {
    pub status: LanShareRuntimeStatus,
    pub service_name: Option<String>,
    pub addresses: Vec<String>,
    pub port: Option<u16>,
    pub discovery_status: LanShareDiscoveryStatus,
    pub active_request_count: usize,
    pub shared_workspace_paths: Vec<String>,
}

impl LanShareStatus {
    fn stopped() -> Self {
        Self {
            status: LanShareRuntimeStatus::Stopped,
            service_name: None,
            addresses: Vec::new(),
            port: None,
            discovery_status: LanShareDiscoveryStatus::Unavailable,
            active_request_count: 0,
            shared_workspace_paths: Vec::new(),
        }
    }
}

#[derive(Default)]
pub struct LanShareState {
    running: Mutex<Option<RunningLanShare>>,
}

struct RunningLanShare {
    server: LanHttpServer,
    publisher: Option<MdnsPublisher>,
    service_name: String,
    addresses: Vec<String>,
    shared_workspace_paths: Vec<String>,
}

impl RunningLanShare {
    fn status(&self) -> LanShareStatus {
        LanShareStatus {
            status: LanShareRuntimeStatus::Running,
            service_name: Some(self.service_name.clone()),
            addresses: self.addresses.clone(),
            port: Some(self.server.local_addr().port()),
            discovery_status: if self.publisher.is_some() {
                LanShareDiscoveryStatus::Active
            } else {
                LanShareDiscoveryStatus::Unavailable
            },
            active_request_count: self.server.active_request_count(),
            shared_workspace_paths: self.shared_workspace_paths.clone(),
        }
    }
}

impl Drop for RunningLanShare {
    fn drop(&mut self) {
        // Revoke the HTTP service and close active sockets before waiting for
        // best-effort mDNS withdrawal, so stop cannot keep serving during the
        // publisher's bounded unregister/shutdown waits.
        let _ = self.server.stop();
        self.publisher.take();
    }
}

struct MdnsPublisher {
    daemon: ServiceDaemon,
    fullname: String,
}

impl MdnsPublisher {
    fn start(port: u16, service_name: &str) -> Result<Self, String> {
        let sequence = NEXT_INSTANCE.fetch_add(1, Ordering::Relaxed);
        let instance_id = format!("notespace-{}-{port}-{sequence}", std::process::id());
        let instance_name = format!("NoteSpace-{}-{port}-{sequence}", std::process::id());
        let hostname = format!("notespace-{}.local.", std::process::id());
        let properties = [
            ("protocolVersion", API_PROTOCOL_VERSION),
            ("instanceId", instance_id.as_str()),
            ("serviceName", service_name),
        ];
        let info = ServiceInfo::new(
            SERVICE_TYPE,
            &instance_name,
            &hostname,
            (),
            port,
            &properties[..],
        )
        .map_err(|error| format!("could not describe mDNS service: {error}"))?
        .enable_addr_auto();
        let fullname = info.get_fullname().to_owned();
        let daemon = ServiceDaemon::new()
            .map_err(|error| format!("could not start mDNS service: {error}"))?;
        daemon
            .register(info)
            .map_err(|error| format!("could not publish mDNS service: {error}"))?;
        Ok(Self { daemon, fullname })
    }
}

impl Drop for MdnsPublisher {
    fn drop(&mut self) {
        if let Ok(receiver) = self.daemon.unregister(&self.fullname) {
            let _ = receiver.recv_timeout(Duration::from_millis(400));
        }
        if let Ok(receiver) = self.daemon.shutdown() {
            let _ = receiver.recv_timeout(Duration::from_millis(400));
        }
    }
}

impl LanShareState {
    fn lock(&self) -> BackendResult<MutexGuard<'_, Option<RunningLanShare>>> {
        self.running.lock().map_err(|_| {
            BackendError::new(
                "lanShareUnavailable",
                "the local sharing service is unavailable",
            )
        })
    }

    fn status(&self) -> BackendResult<LanShareStatus> {
        let running = self.lock()?;
        Ok(running
            .as_ref()
            .map(RunningLanShare::status)
            .unwrap_or_else(LanShareStatus::stopped))
    }

    fn start(
        &self,
        workspaces: Vec<LanShareWorkspaceSelection>,
        port: u16,
    ) -> BackendResult<LanShareStatus> {
        if workspaces.is_empty() {
            return Err(BackendError::new(
                "workspaceRequired",
                "select at least one open workspace to share",
            ));
        }
        if port < MIN_LAN_SHARE_PORT {
            return Err(BackendError::new(
                "invalidLanSharePort",
                format!("port must be between {MIN_LAN_SHARE_PORT} and {}", u16::MAX),
            ));
        }

        let mut running = self.lock()?;
        if running.is_some() {
            return Err(BackendError::new(
                "lanShareAlreadyRunning",
                "stop the current sharing service before starting another one",
            ));
        }

        let service = LanShareService::default();
        for workspace in &workspaces {
            service
                .share_workspace(Path::new(&workspace.path), Some(&workspace.name))
                .map_err(share_error)?;
        }
        let server = LanHttpServer::start(
            SocketAddr::from((Ipv4Addr::UNSPECIFIED, port)),
            service,
            SERVICE_NAME,
        )
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::AddrInUse {
                BackendError::new(
                    "lanSharePortInUse",
                    format!("port {port} is already in use; choose a different port"),
                )
            } else {
                BackendError::new(
                    "lanShareStartFailed",
                    format!("could not start the local sharing service on port {port}: {error}"),
                )
            }
        })?;
        let port = server.local_addr().port();
        let addresses = local_http_addresses(port);
        let publisher = MdnsPublisher::start(port, SERVICE_NAME).ok();
        *running = Some(RunningLanShare {
            server,
            publisher,
            service_name: SERVICE_NAME.to_owned(),
            addresses,
            shared_workspace_paths: workspaces
                .into_iter()
                .map(|workspace| workspace.path)
                .collect(),
        });
        Ok(running
            .as_ref()
            .expect("running state was inserted above")
            .status())
    }

    fn stop(&self) -> BackendResult<LanShareStatus> {
        let previous = self.lock()?.take();
        drop(previous);
        Ok(LanShareStatus::stopped())
    }
}

fn share_error(error: crate::lan_share::ShareError) -> BackendError {
    BackendError::new(error.code, error.message)
}

fn local_http_addresses(port: u16) -> Vec<String> {
    let mut addresses = if_addrs::get_if_addrs()
        .unwrap_or_default()
        .into_iter()
        .filter(|interface| !interface.is_loopback())
        .filter_map(|interface| match interface.ip() {
            IpAddr::V4(address) if !address.is_unspecified() => {
                Some(format!("http://{address}:{port}"))
            }
            _ => None,
        })
        .collect::<Vec<_>>();
    addresses.sort();
    addresses.dedup();
    addresses
}

#[tauri::command]
pub fn lan_share_status(state: tauri::State<'_, LanShareState>) -> BackendResult<LanShareStatus> {
    state.status()
}

#[tauri::command]
pub fn start_lan_share(
    workspaces: Vec<LanShareWorkspaceSelection>,
    port: Option<u16>,
    state: tauri::State<'_, LanShareState>,
) -> BackendResult<LanShareStatus> {
    state.start(workspaces, port.unwrap_or(DEFAULT_LAN_SHARE_PORT))
}

#[tauri::command]
pub fn stop_lan_share(state: tauri::State<'_, LanShareState>) -> BackendResult<LanShareStatus> {
    state.stop()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::net::TcpListener;
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT_FIXTURE: AtomicU64 = AtomicU64::new(1);

    struct Fixture(std::path::PathBuf);

    impl Fixture {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "notespace-lan-command-test-{}-{}",
                std::process::id(),
                NEXT_FIXTURE.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir(&path).unwrap();
            fs::write(path.join("readme.md"), "# Shared\n").unwrap();
            Self(path.canonicalize().unwrap())
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.0).unwrap();
        }
    }

    fn unused_port() -> u16 {
        let listener = TcpListener::bind((Ipv4Addr::UNSPECIFIED, 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);
        port
    }

    #[test]
    fn lifecycle_is_ephemeral_and_keeps_the_selected_paths_only_in_desktop_state() {
        let fixture = Fixture::new();
        let state = LanShareState::default();
        assert_eq!(state.status().unwrap(), LanShareStatus::stopped());

        let started = state
            .start(
                vec![LanShareWorkspaceSelection {
                    path: fixture.0.to_string_lossy().into_owned(),
                    name: "Fixture".to_owned(),
                }],
                unused_port(),
            )
            .unwrap();
        assert_eq!(started.status, LanShareRuntimeStatus::Running);
        assert!(started.port.is_some_and(|port| port >= MIN_LAN_SHARE_PORT));
        assert_eq!(started.shared_workspace_paths.len(), 1);
        assert_eq!(state.stop().unwrap(), LanShareStatus::stopped());
    }

    #[test]
    fn an_empty_selection_never_starts_a_listener() {
        let state = LanShareState::default();
        let error = state.start(Vec::new(), DEFAULT_LAN_SHARE_PORT).unwrap_err();
        assert_eq!(error.code, "workspaceRequired");
        assert_eq!(state.status().unwrap(), LanShareStatus::stopped());
    }

    #[test]
    fn ports_below_the_user_range_are_rejected_before_binding() {
        let fixture = Fixture::new();
        let state = LanShareState::default();
        let error = state
            .start(
                vec![LanShareWorkspaceSelection {
                    path: fixture.0.to_string_lossy().into_owned(),
                    name: "Fixture".to_owned(),
                }],
                MIN_LAN_SHARE_PORT - 1,
            )
            .unwrap_err();
        assert_eq!(error.code, "invalidLanSharePort");
        assert_eq!(state.status().unwrap(), LanShareStatus::stopped());
    }

    #[test]
    fn an_occupied_requested_port_returns_a_specific_actionable_error() {
        let fixture = Fixture::new();
        let reservation = TcpListener::bind((Ipv4Addr::UNSPECIFIED, 0)).unwrap();
        let port = reservation.local_addr().unwrap().port();
        let state = LanShareState::default();
        let error = state
            .start(
                vec![LanShareWorkspaceSelection {
                    path: fixture.0.to_string_lossy().into_owned(),
                    name: "Fixture".to_owned(),
                }],
                port,
            )
            .unwrap_err();
        assert_eq!(error.code, "lanSharePortInUse");
        assert!(error.message.contains(&port.to_string()));
        assert_eq!(state.status().unwrap(), LanShareStatus::stopped());
    }

    #[test]
    fn the_implicit_connection_port_remains_stable() {
        assert_eq!(DEFAULT_LAN_SHARE_PORT, 49_920);
    }
}
