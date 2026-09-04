//! Read-only filesystem and pairing primitives for NoteSpace LAN sharing.
//!
//! The plaintext HTTP adapter in this module is compiled for desktop and is
//! available only after the user explicitly starts read-only sharing for
//! selected roots. It currently has no pairing or transport security.

mod catalog;
mod http_server;
mod model;
mod pairing;
mod protocol;

pub use catalog::LanShareRegistry;
pub use http_server::{LanHttpServer, LanShareService};
pub use model::{
    AssetId, AssetResource, DeviceCredential, DeviceId, DeviceToken, DirectoryBreadcrumb,
    DirectoryEntry, DirectoryEntryKind, DirectoryId, DirectoryListing, DocumentId, EntropyError,
    EntropySource, MarkdownDocument, PairedDevice, PairingChallenge, PairingClaimSecret,
    PairingNonce, PairingRequestId, PairingRequestReceipt, PairingVerificationCode,
    PendingPairingRequest, SearchMatch, SearchRequest, SearchResponse, ShareError, ShareLimits,
    ShareResult, SharedWorkspace, TreeNode, TreeNodeKind, WorkspaceId, WorkspaceTree,
};
pub use pairing::PairingState;
pub use protocol::{
    ApiFailure, ApiSuccess, AssetResolution, MobileDocument, ServiceStatus, LAN_API_PREFIX,
    LAN_API_PROTOCOL_VERSION,
};
