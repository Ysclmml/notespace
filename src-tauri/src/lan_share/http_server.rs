use super::model::{
    AssetId, DirectoryId, DocumentId, EntropyError, EntropySource, SearchRequest, ShareError,
    ShareLimits, ShareResult, SharedWorkspace, WorkspaceId,
};
use super::protocol::{
    ApiFailure, ApiSuccess, AssetResolution, MobileDocument, ServiceStatus, LAN_API_PREFIX,
};
use super::LanShareRegistry;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fmt::Write as _;
use std::io::{self, Read, Write};
use std::net::{Shutdown, SocketAddr, TcpListener, TcpStream};
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread::{self, JoinHandle};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const MAX_HEADER_BYTES: usize = 16 * 1024;
const MAX_BODY_BYTES: usize = 64 * 1024;
const IO_TIMEOUT: Duration = Duration::from_secs(3);
const ACCEPT_POLL_INTERVAL: Duration = Duration::from_millis(20);
const MAX_SERVICE_NAME_CHARS: usize = 120;
static NEXT_ENTROPY_SEED: AtomicU64 = AtomicU64::new(1);

#[cfg(test)]
type SearchScanHook = Arc<dyn Fn() + Send + Sync>;

#[derive(Clone)]
pub struct LanShareService {
    state: Arc<Mutex<ServiceState>>,
    available: Arc<AtomicBool>,
    #[cfg(test)]
    search_scan_hook: Arc<Mutex<Option<SearchScanHook>>>,
}

struct ServiceState {
    registry: LanShareRegistry,
    entropy: SessionEntropy,
}

/// Lightweight runtime entropy for opaque routing identifiers. These IDs are
/// not authentication credentials and the current LAN protocol is explicitly
/// unauthenticated.
struct SessionEntropy {
    state: u64,
}

impl SessionEntropy {
    fn new() -> Self {
        let epoch = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos() as u64)
            .unwrap_or(0);
        let sequence = NEXT_ENTROPY_SEED.fetch_add(1, Ordering::Relaxed);
        Self {
            state: epoch ^ (u64::from(std::process::id()) << 32) ^ sequence.rotate_left(17),
        }
    }

    #[cfg(test)]
    fn seeded(seed: u64) -> Self {
        Self { state: seed }
    }

    fn next_u64(&mut self) -> u64 {
        // SplitMix64 is sufficient for collision-resistant session routing IDs;
        // it is not represented as cryptographic entropy.
        self.state = self.state.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut value = self.state;
        value = (value ^ (value >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        value = (value ^ (value >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        value ^ (value >> 31)
    }
}

impl EntropySource for SessionEntropy {
    fn fill_bytes(&mut self, output: &mut [u8]) -> Result<(), EntropyError> {
        for chunk in output.chunks_mut(8) {
            let bytes = self.next_u64().to_le_bytes();
            chunk.copy_from_slice(&bytes[..chunk.len()]);
        }
        Ok(())
    }
}

impl LanShareService {
    pub fn new(limits: ShareLimits) -> Self {
        Self::from_parts(LanShareRegistry::new(limits), SessionEntropy::new())
    }

    pub fn share_workspace(
        &self,
        path: &Path,
        label: Option<&str>,
    ) -> ShareResult<SharedWorkspace> {
        let mut state = self.lock_state()?;
        let ServiceState { registry, entropy } = &mut *state;
        registry.share_workspace(path, label, entropy)
    }

    pub fn unshare_workspace(&self, id: &WorkspaceId) -> ShareResult<bool> {
        Ok(self.lock_state()?.registry.unshare_workspace(id))
    }

    pub fn clear(&self) -> ShareResult<()> {
        self.lock_state()?.registry.clear();
        Ok(())
    }

    pub fn workspaces(&self) -> ShareResult<Vec<SharedWorkspace>> {
        Ok(self.lock_state()?.registry.workspaces())
    }

    fn from_parts(registry: LanShareRegistry, entropy: SessionEntropy) -> Self {
        Self {
            state: Arc::new(Mutex::new(ServiceState { registry, entropy })),
            available: Arc::new(AtomicBool::new(true)),
            #[cfg(test)]
            search_scan_hook: Arc::new(Mutex::new(None)),
        }
    }

    fn lock_state(&self) -> ShareResult<MutexGuard<'_, ServiceState>> {
        if !self.is_available() {
            return Err(service_unavailable());
        }
        let state = self.state.lock().map_err(|_| {
            ShareError::new(
                "serviceUnavailable",
                "the local sharing service is unavailable",
            )
        })?;
        if !self.is_available() {
            return Err(service_unavailable());
        }
        Ok(state)
    }

    fn is_available(&self) -> bool {
        self.available.load(Ordering::Acquire)
    }

    fn mark_unavailable(&self) {
        self.available.store(false, Ordering::Release);
    }

    fn clear_revoked_registry(&self) {
        if let Ok(mut state) = self.state.lock() {
            state.registry.clear();
        }
    }

    #[cfg(test)]
    fn set_search_scan_hook(&self, hook: SearchScanHook) {
        *self.search_scan_hook.lock().unwrap() = Some(hook);
    }

    #[cfg(test)]
    fn run_search_scan_hook(&self) {
        let hook = self.search_scan_hook.lock().unwrap().clone();
        if let Some(hook) = hook {
            hook();
        }
    }

    fn route(
        &self,
        request: HttpRequest,
        service_name: &str,
        active_request_count: usize,
        cancelled: &dyn Fn() -> bool,
    ) -> HttpResponse {
        if cancelled() || !self.is_available() {
            return share_error_response(request_cancelled());
        }
        if request.method == "OPTIONS" {
            return HttpResponse::empty(204);
        }
        if !request.path.starts_with(LAN_API_PREFIX) {
            return json_error(
                404,
                ShareError::new("notFound", "the requested API route does not exist"),
            );
        }
        let segments = request
            .path
            .trim_start_matches('/')
            .split('/')
            .collect::<Vec<_>>();
        match (request.method.as_str(), segments.as_slice()) {
            ("GET", ["api", "v1", "status"]) => json_success(ServiceStatus::new(
                service_name.to_owned(),
                active_request_count,
            )),
            ("GET", ["api", "v1", "workspaces"]) => self
                .lock_state()
                .map(|state| state.registry.workspaces())
                .map(json_success)
                .unwrap_or_else(share_error_response),
            ("GET", ["api", "v1", "workspaces", workspace_id, "directories"]) => {
                // Compatibility with the first local prototype. Protocol v1
                // clients should use the explicit `/directories/root` route.
                self.directory_response(workspace_id, None, cancelled)
            }
            ("GET", ["api", "v1", "workspaces", workspace_id, "directories", "root"]) => {
                self.directory_response(workspace_id, None, cancelled)
            }
            ("GET", ["api", "v1", "workspaces", workspace_id, "directories", directory_id]) => {
                self.directory_response(workspace_id, Some(directory_id), cancelled)
            }
            ("GET", ["api", "v1", "documents", document_id]) => {
                self.document_response(document_id, cancelled)
            }
            ("POST", ["api", "v1", "search"]) => self.search_response(&request.body, cancelled),
            ("GET", ["api", "v1", "favorites"]) => json_success(Vec::<serde_json::Value>::new()),
            ("POST", ["api", "v1", "assets", "resolve"]) => {
                self.resolve_asset_response(&request.body, cancelled)
            }
            ("GET", ["api", "v1", "assets", asset_id]) => self.asset_response(asset_id, cancelled),
            (_, ["api", "v1", "status"])
            | (_, ["api", "v1", "workspaces"])
            | (_, ["api", "v1", "search"])
            | (_, ["api", "v1", "favorites"])
            | (_, ["api", "v1", "documents", _])
            | (_, ["api", "v1", "assets", _])
            | (_, ["api", "v1", "workspaces", _, "directories"])
            | (_, ["api", "v1", "workspaces", _, "directories", _]) => json_error(
                405,
                ShareError::new(
                    "methodNotAllowed",
                    "the API route does not allow this method",
                ),
            ),
            _ => json_error(
                404,
                ShareError::new("notFound", "the requested API route does not exist"),
            ),
        }
    }

    fn directory_response(
        &self,
        workspace_id: &str,
        directory_id: Option<&str>,
        cancelled: &dyn Fn() -> bool,
    ) -> HttpResponse {
        let workspace_id = WorkspaceId::from_generated(workspace_id.to_owned());
        let directory_id = directory_id.map(|value| DirectoryId::from_generated(value.to_owned()));
        let result = self
            .lock_state()
            .and_then(|state| {
                state
                    .registry
                    .prepare_directory_read(&workspace_id, directory_id.as_ref())
            })
            .and_then(|prepared| prepared.scan(cancelled))
            .and_then(|scanned| {
                if cancelled() {
                    return Err(request_cancelled());
                }
                let mut state = self.lock_state()?;
                let ServiceState { registry, entropy } = &mut *state;
                registry.materialize_directory_read(scanned, entropy)
            });
        result
            .map(json_success)
            .unwrap_or_else(share_error_response)
    }

    fn document_response(&self, document_id: &str, cancelled: &dyn Fn() -> bool) -> HttpResponse {
        let document_id = DocumentId::from_generated(document_id.to_owned());
        let result = self
            .lock_state()
            .and_then(|state| state.registry.prepare_markdown_read(&document_id))
            .and_then(|prepared| {
                let document = prepared.read(cancelled)?;
                if cancelled() {
                    return Err(request_cancelled());
                }
                let state = self.lock_state()?;
                let workspace = state.registry.validate_markdown_read(&prepared)?;
                Ok(MobileDocument::from_document(document, workspace.name))
            });
        result
            .map(json_success)
            .unwrap_or_else(share_error_response)
    }

    fn search_response(&self, body: &[u8], cancelled: &dyn Fn() -> bool) -> HttpResponse {
        let request = match parse_json::<SearchRequest>(body) {
            Ok(request) => request,
            Err(response) => return response,
        };
        let result = self
            .lock_state()
            .and_then(|state| state.registry.prepare_search(request))
            .and_then(|prepared| {
                #[cfg(test)]
                self.run_search_scan_hook();
                prepared.scan(cancelled)
            })
            .and_then(|scanned| {
                if cancelled() {
                    return Err(request_cancelled());
                }
                let mut state = self.lock_state()?;
                let ServiceState { registry, entropy } = &mut *state;
                registry.materialize_search(scanned, entropy)
            });
        result
            .map(json_success)
            .unwrap_or_else(share_error_response)
    }

    fn resolve_asset_response(&self, body: &[u8], cancelled: &dyn Fn() -> bool) -> HttpResponse {
        let request = match parse_json::<ResolveAssetRequest>(body) {
            Ok(request) => request,
            Err(response) => return response,
        };
        let result = self
            .lock_state()
            .and_then(|state| {
                state
                    .registry
                    .prepare_asset_resolution(&request.document_id, &request.reference)
            })
            .and_then(|prepared| prepared.scan(cancelled))
            .and_then(|scanned| {
                if cancelled() {
                    return Err(request_cancelled());
                }
                let mut state = self.lock_state()?;
                let ServiceState { registry, entropy } = &mut *state;
                registry
                    .materialize_asset_resolution(scanned, entropy)
                    .map(|asset_id| AssetResolution { asset_id })
            });
        result
            .map(json_success)
            .unwrap_or_else(share_error_response)
    }

    fn asset_response(&self, asset_id: &str, cancelled: &dyn Fn() -> bool) -> HttpResponse {
        let asset_id = AssetId::from_generated(asset_id.to_owned());
        let result = self
            .lock_state()
            .and_then(|state| state.registry.prepare_asset_read(&asset_id))
            .and_then(|prepared| {
                let asset = prepared.read(cancelled)?;
                if cancelled() {
                    return Err(request_cancelled());
                }
                self.lock_state()?.registry.validate_asset_read(&prepared)?;
                Ok(asset)
            });
        match result {
            Ok(asset) => HttpResponse::bytes(200, asset.media_type, asset.bytes),
            Err(error) => share_error_response(error),
        }
    }
}

impl Default for LanShareService {
    fn default() -> Self {
        Self::new(ShareLimits::default())
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResolveAssetRequest {
    document_id: DocumentId,
    reference: String,
}

pub struct LanHttpServer {
    local_addr: SocketAddr,
    service: LanShareService,
    shutdown: Arc<AtomicBool>,
    active_requests: Arc<ActiveRequests>,
    listener_thread: Option<JoinHandle<()>>,
}

#[derive(Default)]
struct ActiveRequestState {
    stopping: bool,
    next_id: u64,
    sockets: HashMap<u64, TcpStream>,
}

#[derive(Default)]
struct ActiveRequests {
    state: Mutex<ActiveRequestState>,
    count: AtomicUsize,
}

impl ActiveRequests {
    fn register(self: &Arc<Self>, stream: &TcpStream) -> io::Result<ActiveRequestGuard> {
        let tracked_stream = stream.try_clone()?;
        let mut state = self
            .state
            .lock()
            .map_err(|_| io::Error::other("the active request registry is unavailable"))?;
        if state.stopping {
            return Err(io::Error::new(
                io::ErrorKind::ConnectionAborted,
                "the local sharing server is stopping",
            ));
        }
        let id = state.next_id;
        state.next_id = state.next_id.wrapping_add(1);
        state.sockets.insert(id, tracked_stream);
        self.count.fetch_add(1, Ordering::AcqRel);
        Ok(ActiveRequestGuard {
            id,
            active_requests: Arc::clone(self),
        })
    }

    fn stop(&self) {
        let sockets = match self.state.lock() {
            Ok(mut state) => {
                state.stopping = true;
                state.sockets.drain().map(|(_, stream)| stream).collect()
            }
            Err(_) => Vec::new(),
        };
        for stream in sockets {
            let _ = stream.shutdown(Shutdown::Both);
        }
    }

    fn count(&self) -> usize {
        self.count.load(Ordering::Acquire)
    }

    fn finish(&self, id: u64) {
        if let Ok(mut state) = self.state.lock() {
            state.sockets.remove(&id);
        }
        self.count.fetch_sub(1, Ordering::AcqRel);
    }
}

struct ActiveRequestGuard {
    id: u64,
    active_requests: Arc<ActiveRequests>,
}

impl Drop for ActiveRequestGuard {
    fn drop(&mut self) {
        self.active_requests.finish(self.id);
    }
}

impl LanHttpServer {
    /// Start the explicitly enabled, read-only LAN listener.
    pub fn start(
        bind_addr: SocketAddr,
        service: LanShareService,
        service_name: impl Into<String>,
    ) -> io::Result<Self> {
        let listener = TcpListener::bind(bind_addr)?;
        listener.set_nonblocking(true)?;
        let local_addr = listener.local_addr()?;
        let shutdown = Arc::new(AtomicBool::new(false));
        let active_requests = Arc::new(ActiveRequests::default());
        let thread_shutdown = Arc::clone(&shutdown);
        let thread_active_requests = Arc::clone(&active_requests);
        let thread_service = service.clone();
        let service_name = normalize_service_name(service_name.into());
        let listener_thread = thread::Builder::new()
            .name("notespace-lan-http".to_owned())
            .spawn(move || {
                run_listener(
                    listener,
                    thread_service,
                    service_name,
                    thread_shutdown,
                    thread_active_requests,
                );
            })?;
        Ok(Self {
            local_addr,
            service,
            shutdown,
            active_requests,
            listener_thread: Some(listener_thread),
        })
    }

    pub fn local_addr(&self) -> SocketAddr {
        self.local_addr
    }

    pub fn service(&self) -> LanShareService {
        self.service.clone()
    }

    /// Number of HTTP requests currently being served. This is deliberately
    /// not a device/client count because the protocol has no sessions.
    pub fn active_request_count(&self) -> usize {
        self.active_requests.count()
    }

    pub fn is_running(&self) -> bool {
        self.listener_thread.is_some() && !self.shutdown.load(Ordering::Acquire)
    }

    pub fn stop(&mut self) -> io::Result<()> {
        self.shutdown.store(true, Ordering::Release);
        self.service.mark_unavailable();
        self.active_requests.stop();
        // All filesystem I/O happens outside this lock. Waiting here only lets
        // a bounded ID commit finish, then destroys every old opaque ID before
        // stop returns.
        self.service.clear_revoked_registry();
        let Some(listener_thread) = self.listener_thread.take() else {
            return Ok(());
        };
        listener_thread
            .join()
            .map_err(|_| io::Error::other("the local sharing listener stopped unexpectedly"))
    }
}

impl Drop for LanHttpServer {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}

fn run_listener(
    listener: TcpListener,
    service: LanShareService,
    service_name: String,
    shutdown: Arc<AtomicBool>,
    active_requests: Arc<ActiveRequests>,
) {
    let mut workers = Vec::new();
    while !shutdown.load(Ordering::Acquire) {
        match listener.accept() {
            Ok((stream, _)) => {
                if shutdown.load(Ordering::Acquire) {
                    let _ = stream.shutdown(Shutdown::Both);
                    break;
                }
                let service = service.clone();
                let service_name = service_name.clone();
                let worker_shutdown = Arc::clone(&shutdown);
                let request_guard = match active_requests.register(&stream) {
                    Ok(guard) => guard,
                    Err(_) => {
                        let _ = stream.shutdown(Shutdown::Both);
                        continue;
                    }
                };
                if let Ok(worker) = thread::Builder::new()
                    .name("notespace-lan-client".to_owned())
                    .spawn(move || {
                        let active_requests = Arc::clone(&request_guard.active_requests);
                        let _request_guard = request_guard;
                        let _ = handle_connection(
                            stream,
                            &service,
                            &service_name,
                            &active_requests,
                            &worker_shutdown,
                        );
                    })
                {
                    workers.push(worker);
                }
            }
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                thread::sleep(ACCEPT_POLL_INTERVAL);
            }
            Err(error)
                if matches!(
                    error.kind(),
                    io::ErrorKind::Interrupted | io::ErrorKind::ConnectionAborted
                ) => {}
            Err(_) => break,
        }
        reap_finished_workers(&mut workers);
    }
    // Dropping a JoinHandle detaches the worker. stop() has already revoked the
    // service and shut every tracked socket. Repeating that transition here
    // also handles an unexpected listener failure, so status cannot remain
    // "running" while no listener exists and detached workers cannot serve.
    shutdown.store(true, Ordering::Release);
    service.mark_unavailable();
    active_requests.stop();
    service.clear_revoked_registry();
    drop(workers);
}

fn reap_finished_workers(workers: &mut Vec<JoinHandle<()>>) {
    let mut index = 0;
    while index < workers.len() {
        if workers[index].is_finished() {
            let worker = workers.swap_remove(index);
            let _ = worker.join();
        } else {
            index += 1;
        }
    }
}

fn handle_connection(
    mut stream: TcpStream,
    service: &LanShareService,
    service_name: &str,
    active_requests: &ActiveRequests,
    shutdown: &AtomicBool,
) -> io::Result<()> {
    // Accepted sockets inherit O_NONBLOCK from the listener on macOS/BSD.
    // Restore blocking I/O so fragmented headers and bodies wait for the
    // bounded timeout instead of being rejected on the first WouldBlock.
    stream.set_nonblocking(false)?;
    stream.set_read_timeout(Some(IO_TIMEOUT))?;
    stream.set_write_timeout(Some(IO_TIMEOUT))?;
    let cancelled = || shutdown.load(Ordering::Acquire) || !service.is_available();
    let response = match read_request(&mut stream) {
        Ok(request) => service.route(request, service_name, active_requests.count(), &cancelled),
        Err(error) => json_error(error.status, ShareError::new(error.code, error.message)),
    };
    if cancelled() {
        return Ok(());
    }
    response.write_to(&mut stream)
}

fn read_request(stream: &mut TcpStream) -> Result<HttpRequest, RequestError> {
    let mut bytes = Vec::new();
    let header_end = loop {
        if let Some(index) = find_header_end(&bytes) {
            break index;
        }
        if bytes.len() >= MAX_HEADER_BYTES {
            return Err(RequestError::new(
                431,
                "headersTooLarge",
                "request headers exceed their limit",
            ));
        }
        let mut buffer = [0_u8; 4096];
        let read = stream
            .read(&mut buffer)
            .map_err(|_| RequestError::new(400, "invalidRequest", "request could not be read"))?;
        if read == 0 {
            return Err(RequestError::new(
                400,
                "invalidRequest",
                "request headers are incomplete",
            ));
        }
        bytes.extend_from_slice(&buffer[..read]);
    };
    if header_end > MAX_HEADER_BYTES {
        return Err(RequestError::new(
            431,
            "headersTooLarge",
            "request headers exceed their limit",
        ));
    }
    let header = std::str::from_utf8(&bytes[..header_end]).map_err(|_| {
        RequestError::new(400, "invalidRequest", "request headers are not valid UTF-8")
    })?;
    let mut lines = header.split("\r\n");
    let request_line = lines.next().unwrap_or_default();
    let mut request_parts = request_line.split_whitespace();
    let method = request_parts.next().unwrap_or_default();
    let path = request_parts.next().unwrap_or_default();
    let version = request_parts.next().unwrap_or_default();
    if request_parts.next().is_some()
        || !matches!(method, "GET" | "POST" | "OPTIONS")
        || !matches!(version, "HTTP/1.0" | "HTTP/1.1")
        || !path.starts_with('/')
        || path.contains(['?', '#'])
    {
        return Err(RequestError::new(
            400,
            "invalidRequest",
            "request line is invalid",
        ));
    }

    let mut content_length = None;
    for line in lines {
        if line.is_empty() {
            continue;
        }
        let Some((name, value)) = line.split_once(':') else {
            return Err(RequestError::new(
                400,
                "invalidRequest",
                "request header is invalid",
            ));
        };
        if name.eq_ignore_ascii_case("transfer-encoding") {
            return Err(RequestError::new(
                400,
                "unsupportedTransferEncoding",
                "chunked request bodies are not supported",
            ));
        }
        if name.eq_ignore_ascii_case("content-length") {
            if content_length.is_some() {
                return Err(RequestError::new(
                    400,
                    "invalidRequest",
                    "content length is repeated",
                ));
            }
            content_length = Some(value.trim().parse::<usize>().map_err(|_| {
                RequestError::new(400, "invalidRequest", "content length is invalid")
            })?);
        }
    }
    let content_length = content_length.unwrap_or(0);
    if content_length > MAX_BODY_BYTES {
        return Err(RequestError::new(
            413,
            "bodyTooLarge",
            "request body exceeds its limit",
        ));
    }
    let method = method.to_owned();
    let path = path.to_owned();
    let body_start = header_end + 4;
    while bytes.len().saturating_sub(body_start) < content_length {
        let remaining = content_length - bytes.len().saturating_sub(body_start);
        let mut buffer = [0_u8; 4096];
        let read_limit = remaining.min(buffer.len());
        let read = stream.read(&mut buffer[..read_limit]).map_err(|_| {
            RequestError::new(400, "invalidRequest", "request body could not be read")
        })?;
        if read == 0 {
            return Err(RequestError::new(
                400,
                "invalidRequest",
                "request body is incomplete",
            ));
        }
        bytes.extend_from_slice(&buffer[..read]);
    }
    Ok(HttpRequest {
        method,
        path,
        body: bytes[body_start..body_start + content_length].to_vec(),
    })
}

fn find_header_end(bytes: &[u8]) -> Option<usize> {
    bytes.windows(4).position(|window| window == b"\r\n\r\n")
}

struct HttpRequest {
    method: String,
    path: String,
    body: Vec<u8>,
}

struct RequestError {
    status: u16,
    code: &'static str,
    message: &'static str,
}

impl RequestError {
    fn new(status: u16, code: &'static str, message: &'static str) -> Self {
        Self {
            status,
            code,
            message,
        }
    }
}

struct HttpResponse {
    status: u16,
    content_type: &'static str,
    body: Vec<u8>,
}

impl HttpResponse {
    fn empty(status: u16) -> Self {
        Self {
            status,
            content_type: "text/plain; charset=utf-8",
            body: Vec::new(),
        }
    }

    fn bytes(status: u16, content_type: &'static str, body: Vec<u8>) -> Self {
        Self {
            status,
            content_type,
            body,
        }
    }

    fn write_to(self, stream: &mut TcpStream) -> io::Result<()> {
        let mut header = String::new();
        write!(
            &mut header,
            "HTTP/1.1 {}\r\nContent-Type: {}\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type\r\nAccess-Control-Allow-Private-Network: true\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
            status_line(self.status),
            self.content_type,
            self.body.len()
        )
        .expect("writing HTTP headers to a String cannot fail");
        stream.write_all(header.as_bytes())?;
        stream.write_all(&self.body)?;
        stream.flush()
    }
}

fn status_line(status: u16) -> &'static str {
    match status {
        200 => "200 OK",
        204 => "204 No Content",
        400 => "400 Bad Request",
        404 => "404 Not Found",
        405 => "405 Method Not Allowed",
        413 => "413 Content Too Large",
        431 => "431 Request Header Fields Too Large",
        500 => "500 Internal Server Error",
        503 => "503 Service Unavailable",
        _ => "500 Internal Server Error",
    }
}

fn json_success<T: Serialize>(data: T) -> HttpResponse {
    serialize_json(200, &ApiSuccess::new(data))
}

fn json_error(status: u16, error: ShareError) -> HttpResponse {
    serialize_json(status, &ApiFailure::new(error))
}

fn serialize_json(status: u16, value: &impl Serialize) -> HttpResponse {
    match serde_json::to_vec(value) {
        Ok(body) => HttpResponse::bytes(status, "application/json; charset=utf-8", body),
        Err(_) => HttpResponse::bytes(
            500,
            "application/json; charset=utf-8",
            br#"{"protocolVersion":1,"error":{"code":"serializationFailed","message":"response could not be serialized"}}"#.to_vec(),
        ),
    }
}

fn parse_json<T: DeserializeOwned>(body: &[u8]) -> Result<T, HttpResponse> {
    serde_json::from_slice(body).map_err(|_| {
        json_error(
            400,
            ShareError::new("invalidJson", "request body is not valid JSON"),
        )
    })
}

fn share_error_response(error: ShareError) -> HttpResponse {
    let status = match error.code {
        "unknownWorkspace" | "unknownDirectory" | "unknownDocument" | "unknownAsset" => 404,
        "workspaceUnavailable"
        | "directoryUnavailable"
        | "resourceUnavailable"
        | "requestCancelled" => 503,
        "documentTooLarge" | "assetTooLarge" => 413,
        "serviceUnavailable" => 500,
        _ => 400,
    };
    json_error(status, error)
}

fn service_unavailable() -> ShareError {
    ShareError::new(
        "serviceUnavailable",
        "the local sharing service is unavailable",
    )
}

fn request_cancelled() -> ShareError {
    ShareError::new("requestCancelled", "the sharing request was cancelled")
}

fn normalize_service_name(value: String) -> String {
    let value = value.trim();
    if value.is_empty() {
        return "NoteSpace".to_owned();
    }
    value.chars().take(MAX_SERVICE_NAME_CHARS).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;
    use std::fs;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::mpsc;
    use std::time::Instant;

    static NEXT_FIXTURE: AtomicU64 = AtomicU64::new(1);

    struct Fixture(std::path::PathBuf);

    impl Fixture {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "notespace-lan-http-test-{}-{}",
                std::process::id(),
                NEXT_FIXTURE.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir(&path).unwrap();
            Self(path.canonicalize().unwrap())
        }

        fn write(&self, relative: &str, contents: impl AsRef<[u8]>) {
            let path = self.0.join(relative);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, contents).unwrap();
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.0).unwrap();
        }
    }

    fn request(addr: SocketAddr, method: &str, path: &str, body: &[u8]) -> Vec<u8> {
        let mut stream = TcpStream::connect(addr).unwrap();
        write!(
            stream,
            "{method} {path} HTTP/1.1\r\nHost: localhost\r\nContent-Length: {}\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n",
            body.len()
        )
        .unwrap();
        stream.write_all(body).unwrap();
        let mut response = Vec::new();
        let mut chunk = [0_u8; 4096];
        loop {
            match stream.read(&mut chunk) {
                Ok(0) => break,
                Ok(read) => response.extend_from_slice(&chunk[..read]),
                Err(error)
                    if matches!(
                        error.kind(),
                        io::ErrorKind::ConnectionReset
                            | io::ErrorKind::ConnectionAborted
                            | io::ErrorKind::UnexpectedEof
                            | io::ErrorKind::NotConnected
                    ) =>
                {
                    break;
                }
                Err(error) => panic!("response read failed: {error}"),
            }
        }
        response
    }

    fn wait_until(timeout: Duration, predicate: impl Fn() -> bool) -> bool {
        let deadline = Instant::now() + timeout;
        while Instant::now() < deadline {
            if predicate() {
                return true;
            }
            thread::sleep(Duration::from_millis(5));
        }
        predicate()
    }

    fn response_json(response: &[u8]) -> Value {
        let body = response
            .windows(4)
            .position(|window| window == b"\r\n\r\n")
            .map(|index| &response[index + 4..])
            .unwrap();
        serde_json::from_slice(body).unwrap()
    }

    fn request_with_declared_length(addr: SocketAddr, content_length: usize) -> Vec<u8> {
        let mut stream = TcpStream::connect(addr).unwrap();
        write!(
            stream,
            "POST /api/v1/search HTTP/1.1\r\nHost: localhost\r\nContent-Length: {content_length}\r\nConnection: close\r\n\r\n"
        )
        .unwrap();
        let mut response = Vec::new();
        stream.read_to_end(&mut response).unwrap();
        response
    }

    #[test]
    fn server_exposes_the_read_only_versioned_vertical_slice() {
        let fixture = Fixture::new();
        fixture.write(
            "docs/guide.md",
            "# Guide\n\nneedle\n\n![pixel](../images/pixel.png)",
        );
        fixture.write("images/pixel.png", [137, 80, 78, 71]);
        fixture.write("private.txt", "not shared");
        let service =
            LanShareService::from_parts(LanShareRegistry::default(), SessionEntropy::seeded(7));
        let workspace = service
            .share_workspace(&fixture.0, Some("Phone notes"))
            .unwrap();
        let mut server =
            LanHttpServer::start("127.0.0.1:0".parse().unwrap(), service, " Test computer ")
                .unwrap();
        let addr = server.local_addr();

        let status = request(addr, "GET", "/api/v1/status", b"");
        assert!(status.starts_with(b"HTTP/1.1 200 OK"));
        assert!(String::from_utf8_lossy(&status).contains("Access-Control-Allow-Origin: *"));
        let status = response_json(&status);
        assert_eq!(status["protocolVersion"], 1);
        assert_eq!(status["data"]["protocolVersion"], 1);
        assert_eq!(status["data"]["serviceName"], "Test computer");
        assert_eq!(status["data"]["activeRequestCount"], 1);

        let workspaces = response_json(&request(addr, "GET", "/api/v1/workspaces", b""));
        assert_eq!(workspaces["data"][0]["id"], workspace.id.as_str());
        assert_eq!(
            workspaces["data"][0]["syncKey"],
            workspace.sync_key.as_str()
        );
        assert_eq!(workspaces["data"][0]["name"], "Phone notes");
        let root_path = format!(
            "/api/v1/workspaces/{}/directories/root",
            workspace.id.as_str()
        );
        let root = response_json(&request(addr, "GET", &root_path, b""));
        assert_eq!(root["data"]["directoryId"], Value::Null);
        assert_eq!(root["data"]["entries"][0]["kind"], "directory");
        let directory_id = root["data"]["entries"][0]["id"].as_str().unwrap();
        let child_path = format!(
            "/api/v1/workspaces/{}/directories/{directory_id}",
            workspace.id.as_str()
        );
        let child = response_json(&request(addr, "GET", &child_path, b""));
        assert_eq!(child["data"]["entries"][0]["kind"], "document");
        let document_id = child["data"]["entries"][0]["id"].as_str().unwrap();

        let document_path = format!("/api/v1/documents/{document_id}");
        let document = response_json(&request(addr, "GET", &document_path, b""));
        assert_eq!(document["data"]["workspaceName"], "Phone notes");
        assert_eq!(document["data"]["title"], "guide");
        assert!(document["data"]["markdown"]
            .as_str()
            .unwrap()
            .contains("needle"));
        assert!(!document
            .to_string()
            .contains(&fixture.0.to_string_lossy().to_string()));

        let search = response_json(&request(
            addr,
            "POST",
            "/api/v1/search",
            format!(
                "{{\"workspaceIds\":[\"{}\"],\"query\":\"needle\"}}",
                workspace.id.as_str()
            )
            .as_bytes(),
        ));
        assert_eq!(search["data"]["matches"].as_array().unwrap().len(), 1);
        assert_eq!(search["data"]["matches"][0]["documentId"], document_id);

        let resolved = response_json(&request(
            addr,
            "POST",
            "/api/v1/assets/resolve",
            format!("{{\"documentId\":\"{document_id}\",\"reference\":\"../images/pixel.png\"}}")
                .as_bytes(),
        ));
        let asset_id = resolved["data"]["assetId"].as_str().unwrap();
        let asset = request(addr, "GET", &format!("/api/v1/assets/{asset_id}"), b"");
        assert!(asset.starts_with(b"HTTP/1.1 200 OK"));
        assert!(String::from_utf8_lossy(&asset).contains("Content-Type: image/png"));
        assert!(asset.ends_with(&[137, 80, 78, 71]));

        let favorites = response_json(&request(addr, "GET", "/api/v1/favorites", b""));
        assert_eq!(favorites["data"], serde_json::json!([]));
        let options = request(addr, "OPTIONS", "/api/v1/search", b"");
        assert!(options.starts_with(b"HTTP/1.1 204 No Content"));

        server.stop().unwrap();
        assert!(!server.is_running());
        assert!(TcpStream::connect(addr).is_err());
    }

    #[test]
    fn fragmented_http_headers_wait_for_the_bounded_read_timeout() {
        let service = LanShareService::default();
        let mut server = LanHttpServer::start(
            "127.0.0.1:0".parse().unwrap(),
            service,
            "Fragmented request",
        )
        .unwrap();
        let mut stream = TcpStream::connect(server.local_addr()).unwrap();
        stream.write_all(b"GET /api/v1/sta").unwrap();
        assert!(wait_until(Duration::from_secs(1), || {
            server.active_request_count() == 1
        }));
        thread::sleep(Duration::from_millis(50));
        stream
            .write_all(b"tus HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
            .unwrap();
        let mut response = Vec::new();
        stream.read_to_end(&mut response).unwrap();
        assert!(response.starts_with(b"HTTP/1.1 200 OK"));
        server.stop().unwrap();
    }

    #[test]
    fn a_scanning_search_does_not_serialize_document_requests() {
        let fixture = Fixture::new();
        fixture.write("guide.md", "# Guide\n\nneedle");
        let service =
            LanShareService::from_parts(LanShareRegistry::default(), SessionEntropy::seeded(19));
        let workspace = service
            .share_workspace(&fixture.0, Some("Concurrent notes"))
            .unwrap();
        let mut server = LanHttpServer::start(
            "127.0.0.1:0".parse().unwrap(),
            service.clone(),
            "Concurrent I/O",
        )
        .unwrap();
        let addr = server.local_addr();
        let root_path = format!(
            "/api/v1/workspaces/{}/directories/root",
            workspace.id.as_str()
        );
        let root = response_json(&request(addr, "GET", &root_path, b""));
        let document_id = root["data"]["entries"][0]["id"]
            .as_str()
            .unwrap()
            .to_owned();

        let (search_started_tx, search_started_rx) = mpsc::channel();
        let (release_search_tx, release_search_rx) = mpsc::channel();
        let release_search_rx = Arc::new(Mutex::new(release_search_rx));
        service.set_search_scan_hook(Arc::new(move || {
            let _ = search_started_tx.send(());
            let _ = release_search_rx.lock().unwrap().recv();
        }));

        let search_body = format!(
            "{{\"workspaceIds\":[\"{}\"],\"query\":\"needle\"}}",
            workspace.id.as_str()
        );
        let search_client =
            thread::spawn(move || request(addr, "POST", "/api/v1/search", search_body.as_bytes()));
        search_started_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("search did not reach its lock-free scan phase");

        let document_path = format!("/api/v1/documents/{document_id}");
        let (document_tx, document_rx) = mpsc::channel();
        let document_client = thread::spawn(move || {
            let _ = document_tx.send(request(addr, "GET", &document_path, b""));
        });
        let document = document_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("document request was serialized behind the search scan");
        assert!(document.starts_with(b"HTTP/1.1 200 OK"));
        document_client.join().unwrap();

        release_search_tx.send(()).unwrap();
        assert!(search_client
            .join()
            .unwrap()
            .starts_with(b"HTTP/1.1 200 OK"));
        server.stop().unwrap();
    }

    #[test]
    fn stop_is_bounded_revokes_inflight_search_and_new_servers_reject_old_ids() {
        let fixture = Fixture::new();
        fixture.write("guide.md", "# Guide\n\nneedle");
        let service =
            LanShareService::from_parts(LanShareRegistry::default(), SessionEntropy::seeded(23));
        let workspace = service
            .share_workspace(&fixture.0, Some("Stopped notes"))
            .unwrap();
        let mut server =
            LanHttpServer::start("127.0.0.1:0".parse().unwrap(), service.clone(), "Stop test")
                .unwrap();
        let addr = server.local_addr();
        let root_path = format!(
            "/api/v1/workspaces/{}/directories/root",
            workspace.id.as_str()
        );
        let root = response_json(&request(addr, "GET", &root_path, b""));
        let old_document_id = root["data"]["entries"][0]["id"]
            .as_str()
            .unwrap()
            .to_owned();
        let entropy_before_stop = service.state.lock().unwrap().entropy.state;

        let (search_started_tx, search_started_rx) = mpsc::channel();
        let (release_search_tx, release_search_rx) = mpsc::channel();
        let release_search_rx = Arc::new(Mutex::new(release_search_rx));
        service.set_search_scan_hook(Arc::new(move || {
            let _ = search_started_tx.send(());
            let _ = release_search_rx.lock().unwrap().recv();
        }));
        let search_body = format!(
            "{{\"workspaceIds\":[\"{}\"],\"query\":\"needle\"}}",
            workspace.id.as_str()
        );
        let (response_tx, response_rx) = mpsc::channel();
        let search_client = thread::spawn(move || {
            let _ = response_tx.send(request(
                addr,
                "POST",
                "/api/v1/search",
                search_body.as_bytes(),
            ));
        });
        search_started_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("search did not reach its lock-free scan phase");

        let stop_started = Instant::now();
        server.stop().unwrap();
        assert!(
            stop_started.elapsed() < Duration::from_secs(1),
            "stop waited for an in-flight worker"
        );
        let stopped_response = response_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("stop did not close the active request socket");
        assert!(stopped_response.is_empty());
        assert!(TcpStream::connect(addr).is_err());
        assert_eq!(service.workspaces().unwrap_err().code, "serviceUnavailable");

        release_search_tx.send(()).unwrap();
        search_client.join().unwrap();
        assert!(wait_until(Duration::from_secs(1), || {
            server.active_request_count() == 0
        }));
        assert_eq!(
            service.state.lock().unwrap().entropy.state,
            entropy_before_stop,
            "the cancelled search must not materialize document IDs"
        );

        let replacement_service =
            LanShareService::from_parts(LanShareRegistry::default(), SessionEntropy::seeded(29));
        replacement_service
            .share_workspace(&fixture.0, Some("Replacement notes"))
            .unwrap();
        let mut replacement = LanHttpServer::start(
            "127.0.0.1:0".parse().unwrap(),
            replacement_service,
            "Replacement",
        )
        .unwrap();
        let old_document = request(
            replacement.local_addr(),
            "GET",
            &format!("/api/v1/documents/{old_document_id}"),
            b"",
        );
        assert!(old_document.starts_with(b"HTTP/1.1 404 Not Found"));
        assert_eq!(
            response_json(&old_document)["error"]["code"],
            "unknownDocument"
        );
        replacement.stop().unwrap();
    }

    #[test]
    fn active_request_count_tracks_parallel_requests_and_returns_to_zero() {
        let fixture = Fixture::new();
        fixture.write("guide.md", "# Guide\n\nneedle");
        let service = LanShareService::default();
        let workspace = service
            .share_workspace(&fixture.0, Some("Request count"))
            .unwrap();
        let entered = Arc::new(std::sync::Barrier::new(3));
        let release = Arc::new(std::sync::Barrier::new(3));
        let hook_entered = Arc::clone(&entered);
        let hook_release = Arc::clone(&release);
        service.set_search_scan_hook(Arc::new(move || {
            hook_entered.wait();
            hook_release.wait();
        }));
        let mut server =
            LanHttpServer::start("127.0.0.1:0".parse().unwrap(), service, "Request count").unwrap();
        let addr = server.local_addr();
        let body = format!(
            "{{\"workspaceIds\":[\"{}\"],\"query\":\"needle\"}}",
            workspace.id.as_str()
        );
        let first_body = body.clone();
        let first =
            thread::spawn(move || request(addr, "POST", "/api/v1/search", first_body.as_bytes()));
        let second =
            thread::spawn(move || request(addr, "POST", "/api/v1/search", body.as_bytes()));

        entered.wait();
        let parallel_count = server.active_request_count();
        release.wait();
        assert!(first.join().unwrap().starts_with(b"HTTP/1.1 200 OK"));
        assert!(second.join().unwrap().starts_with(b"HTTP/1.1 200 OK"));
        assert_eq!(parallel_count, 2);
        server.stop().unwrap();
        assert!(wait_until(Duration::from_secs(1), || {
            server.active_request_count() == 0
        }));
    }

    #[test]
    fn multiple_requests_can_be_served_without_pairing_or_shared_mutation() {
        let service = LanShareService::default();
        let mut server =
            LanHttpServer::start("127.0.0.1:0".parse().unwrap(), service, "Concurrent test")
                .unwrap();
        let addr = server.local_addr();
        let clients = (0..12)
            .map(|_| thread::spawn(move || request(addr, "GET", "/api/v1/status", b"")))
            .collect::<Vec<_>>();
        for client in clients {
            let response = client.join().unwrap();
            assert!(
                response.starts_with(b"HTTP/1.1 200 OK"),
                "unexpected concurrent response: {}",
                String::from_utf8_lossy(&response)
            );
        }
        server.stop().unwrap();
        assert_eq!(server.active_request_count(), 0);
    }

    #[test]
    fn malformed_oversized_and_unknown_requests_fail_with_json_and_cors() {
        let service = LanShareService::default();
        let mut server =
            LanHttpServer::start("127.0.0.1:0".parse().unwrap(), service, "Errors").unwrap();
        let addr = server.local_addr();

        let unknown = request(addr, "GET", "/api/v1/missing", b"");
        assert!(unknown.starts_with(b"HTTP/1.1 404 Not Found"));
        assert_eq!(response_json(&unknown)["error"]["code"], "notFound");
        assert!(String::from_utf8_lossy(&unknown).contains("Access-Control-Allow-Origin: *"));

        let invalid_json = request(addr, "POST", "/api/v1/search", b"not json");
        assert!(invalid_json.starts_with(b"HTTP/1.1 400 Bad Request"));
        assert_eq!(response_json(&invalid_json)["error"]["code"], "invalidJson");

        let oversized = request_with_declared_length(addr, MAX_BODY_BYTES + 1);
        assert!(oversized.starts_with(b"HTTP/1.1 413 Content Too Large"));
        assert_eq!(response_json(&oversized)["error"]["code"], "bodyTooLarge");
        server.stop().unwrap();
    }

    #[test]
    fn service_name_is_bounded_and_empty_names_fall_back() {
        assert_eq!(normalize_service_name("   ".to_owned()), "NoteSpace");
        assert_eq!(
            normalize_service_name("x".repeat(MAX_SERVICE_NAME_CHARS + 10))
                .chars()
                .count(),
            MAX_SERVICE_NAME_CHARS
        );
    }
}
