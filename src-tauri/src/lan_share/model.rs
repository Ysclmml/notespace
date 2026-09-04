use serde::{Deserialize, Serialize};
use std::fmt;

/// The platform integration supplies cryptographically secure bytes. Keeping
/// entropy injection at this boundary makes the filesystem and pairing core
/// deterministic in tests without choosing a platform RNG here.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct EntropyError;

impl fmt::Display for EntropyError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("secure randomness is unavailable")
    }
}

impl std::error::Error for EntropyError {}

pub trait EntropySource {
    fn fill_bytes(&mut self, output: &mut [u8]) -> Result<(), EntropyError>;
}

impl<F> EntropySource for F
where
    F: FnMut(&mut [u8]) -> Result<(), EntropyError>,
{
    fn fill_bytes(&mut self, output: &mut [u8]) -> Result<(), EntropyError> {
        self(output)
    }
}

macro_rules! opaque_id {
    ($name:ident) => {
        #[derive(Clone, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
        #[serde(transparent)]
        pub struct $name(String);

        impl $name {
            pub fn as_str(&self) -> &str {
                &self.0
            }

            pub(crate) fn from_generated(value: String) -> Self {
                Self(value)
            }
        }

        impl fmt::Debug for $name {
            fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter
                    .debug_tuple(stringify!($name))
                    .field(&self.0)
                    .finish()
            }
        }
    };
}

opaque_id!(WorkspaceId);
opaque_id!(DirectoryId);
opaque_id!(DocumentId);
opaque_id!(AssetId);
opaque_id!(DeviceId);
opaque_id!(PairingRequestId);

/// A one-time pairing secret. Its `Debug` representation is intentionally redacted.
#[derive(Clone, Eq, Hash, PartialEq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct PairingNonce(String);

impl PairingNonce {
    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub(crate) fn from_generated(value: String) -> Self {
        Self(value)
    }
}

impl fmt::Debug for PairingNonce {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("PairingNonce([redacted])")
    }
}

/// A one-time bearer secret held by the phone while the desktop user reviews
/// its pairing request. Its `Debug` representation is intentionally redacted.
#[derive(Clone, Eq, PartialEq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct PairingClaimSecret(String);

impl PairingClaimSecret {
    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub(crate) fn from_generated(value: String) -> Self {
        Self(value)
    }
}

impl fmt::Debug for PairingClaimSecret {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("PairingClaimSecret([redacted])")
    }
}

/// The short code shown independently on the phone and desktop so the desktop
/// user can confirm the request they are approving.
#[derive(Clone, Eq, PartialEq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct PairingVerificationCode(String);

impl PairingVerificationCode {
    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub(crate) fn from_generated(value: String) -> Self {
        Self(value)
    }
}

impl fmt::Debug for PairingVerificationCode {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("PairingVerificationCode([redacted])")
    }
}

/// A persistent bearer credential for one paired device. Its `Debug`
/// representation is intentionally redacted.
#[derive(Clone, Eq, PartialEq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct DeviceToken(String);

impl DeviceToken {
    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub(crate) fn from_generated(value: String) -> Self {
        Self(value)
    }
}

impl fmt::Debug for DeviceToken {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("DeviceToken([redacted])")
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedWorkspace {
    pub id: WorkspaceId,
    /// Stable, path-redacted identity used by mobile offline snapshots. This is
    /// an identity hint, not an authentication secret.
    pub sync_key: String,
    pub name: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TreeNodeKind {
    Directory,
    Markdown,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeNode {
    pub name: String,
    pub relative_path: String,
    pub kind: TreeNodeKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub document_id: Option<DocumentId>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub children: Vec<TreeNode>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceTree {
    pub workspace: SharedWorkspace,
    pub nodes: Vec<TreeNode>,
    pub scanned_entries: usize,
    pub truncated: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryBreadcrumb {
    pub id: Option<DirectoryId>,
    pub name: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DirectoryEntryKind {
    Directory,
    Document,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryEntry {
    /// Opaque directory or document identifier, depending on `kind`.
    pub id: String,
    pub name: String,
    pub kind: DirectoryEntryKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

/// One bounded directory page used by the mobile reader. Unlike
/// `WorkspaceTree`, this response never recursively enumerates descendants.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryListing {
    pub workspace_id: WorkspaceId,
    pub directory_id: Option<DirectoryId>,
    pub name: String,
    pub breadcrumbs: Vec<DirectoryBreadcrumb>,
    pub entries: Vec<DirectoryEntry>,
    pub scanned_entries: usize,
    pub truncated: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkdownDocument {
    pub id: DocumentId,
    pub workspace_id: WorkspaceId,
    pub name: String,
    pub relative_path: String,
    pub content: String,
    pub size_bytes: u64,
}

/// Raw asset bytes are intentionally not serialized to JSON. An HTTP adapter
/// should stream `bytes` as the supplied media type instead of constructing a
/// large JSON integer array.
#[derive(Clone, Eq, PartialEq)]
pub struct AssetResource {
    pub id: AssetId,
    pub workspace_id: WorkspaceId,
    pub media_type: &'static str,
    pub bytes: Vec<u8>,
}

impl fmt::Debug for AssetResource {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("AssetResource")
            .field("id", &self.id)
            .field("workspace_id", &self.workspace_id)
            .field("media_type", &self.media_type)
            .field("byte_count", &self.bytes.len())
            .finish()
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchRequest {
    #[serde(default)]
    pub workspace_ids: Vec<WorkspaceId>,
    pub query: String,
    #[serde(default)]
    pub case_sensitive: bool,
    #[serde(default)]
    pub use_regex: bool,
    #[serde(default)]
    pub file_filter: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchMatch {
    pub workspace_id: WorkspaceId,
    pub document_id: DocumentId,
    pub relative_path: String,
    pub line: usize,
    pub column: usize,
    pub match_length: usize,
    pub snippet: String,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResponse {
    pub matches: Vec<SearchMatch>,
    pub searched_files: usize,
    pub skipped_files: usize,
    pub scanned_entries: usize,
    pub unavailable_workspaces: Vec<WorkspaceId>,
    pub truncated: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PairingChallenge {
    pub nonce: PairingNonce,
    pub expires_at_epoch_ms: u64,
}

/// Phone-only receipt returned after applying to pair. The claim secret must
/// never be included in the desktop's pending-request list.
#[derive(Clone, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PairingRequestReceipt {
    pub request_id: PairingRequestId,
    pub claim_secret: PairingClaimSecret,
    pub verification_code: PairingVerificationCode,
    pub expires_at_epoch_ms: u64,
}

impl fmt::Debug for PairingRequestReceipt {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("PairingRequestReceipt")
            .field("request_id", &self.request_id)
            .field("claim_secret", &"[redacted]")
            .field("verification_code", &"[redacted]")
            .field("expires_at_epoch_ms", &self.expires_at_epoch_ms)
            .finish()
    }
}

/// Desktop-visible request awaiting explicit confirmation. It intentionally
/// carries no claim secret and no device credential.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingPairingRequest {
    pub request_id: PairingRequestId,
    pub device_name: String,
    pub verification_code: PairingVerificationCode,
    pub requested_at_epoch_ms: u64,
    pub expires_at_epoch_ms: u64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PairedDevice {
    pub id: DeviceId,
    pub name: String,
    pub paired_at_epoch_ms: u64,
    pub last_seen_at_epoch_ms: u64,
}

#[derive(Clone, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceCredential {
    pub device: PairedDevice,
    pub token: DeviceToken,
}

impl fmt::Debug for DeviceCredential {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("DeviceCredential")
            .field("device", &self.device)
            .field("token", &"[redacted]")
            .finish()
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ShareLimits {
    pub max_workspaces: usize,
    pub max_tree_entries: usize,
    pub max_tree_depth: usize,
    pub max_document_bytes: usize,
    pub max_asset_bytes: usize,
    pub max_search_query_chars: usize,
    pub max_file_filter_chars: usize,
    pub max_search_files: usize,
    pub max_search_total_bytes: usize,
    pub max_search_matches: usize,
    pub max_pending_pairings: usize,
    pub max_paired_devices: usize,
}

impl Default for ShareLimits {
    fn default() -> Self {
        Self {
            max_workspaces: 16,
            max_tree_entries: 20_000,
            max_tree_depth: 64,
            max_document_bytes: 2 * 1024 * 1024,
            max_asset_bytes: 16 * 1024 * 1024,
            max_search_query_chars: 512,
            max_file_filter_chars: 256,
            max_search_files: 5_000,
            max_search_total_bytes: 64 * 1024 * 1024,
            max_search_matches: 200,
            max_pending_pairings: 4,
            max_paired_devices: 16,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareError {
    pub code: &'static str,
    pub message: String,
}

impl ShareError {
    pub(crate) fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

impl fmt::Display for ShareError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for ShareError {}

pub type ShareResult<T> = Result<T, ShareError>;

pub(crate) fn encode_opaque(prefix: &str, bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut encoded = String::with_capacity(prefix.len() + bytes.len() * 2);
    encoded.push_str(prefix);
    for byte in bytes {
        encoded.push(HEX[(byte >> 4) as usize] as char);
        encoded.push(HEX[(byte & 0x0f) as usize] as char);
    }
    encoded
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn secret_debug_output_is_redacted() {
        let nonce = PairingNonce::from_generated("pair_secret".to_owned());
        let claim = PairingClaimSecret::from_generated("claim_secret".to_owned());
        let code = PairingVerificationCode::from_generated("123456".to_owned());
        let token = DeviceToken::from_generated("device_secret".to_owned());
        assert!(!format!("{nonce:?}").contains("pair_secret"));
        assert!(!format!("{claim:?}").contains("claim_secret"));
        assert!(!format!("{code:?}").contains("123456"));
        assert!(!format!("{token:?}").contains("device_secret"));
    }

    #[test]
    fn opaque_encoding_has_a_fixed_lowercase_shape() {
        assert_eq!(encode_opaque("doc_", &[0, 15, 16, 255]), "doc_000f10ff");
    }
}
