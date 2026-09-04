use super::model::{AssetId, MarkdownDocument, ShareError};
use serde::Serialize;
use std::path::Path;

pub const LAN_API_PROTOCOL_VERSION: u16 = 1;
pub const LAN_API_PREFIX: &str = "/api/v1";

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiSuccess<T> {
    pub protocol_version: u16,
    pub data: T,
}

impl<T> ApiSuccess<T> {
    pub fn new(data: T) -> Self {
        Self {
            protocol_version: LAN_API_PROTOCOL_VERSION,
            data,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiFailure {
    pub protocol_version: u16,
    pub error: ShareError,
}

impl ApiFailure {
    pub fn new(error: ShareError) -> Self {
        Self {
            protocol_version: LAN_API_PROTOCOL_VERSION,
            error,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceStatus {
    pub protocol_version: u16,
    pub service_name: String,
    pub active_request_count: usize,
}

impl ServiceStatus {
    pub(crate) fn new(service_name: String, active_request_count: usize) -> Self {
        Self {
            protocol_version: LAN_API_PROTOCOL_VERSION,
            service_name,
            active_request_count,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileDocument {
    pub id: super::model::DocumentId,
    pub workspace_id: super::model::WorkspaceId,
    pub workspace_name: String,
    pub title: String,
    pub relative_path: String,
    pub markdown: String,
    pub size_bytes: u64,
}

impl MobileDocument {
    pub(crate) fn from_document(document: MarkdownDocument, workspace_name: String) -> Self {
        let title = Path::new(&document.name)
            .file_stem()
            .and_then(|value| value.to_str())
            .filter(|value| !value.is_empty())
            .unwrap_or(&document.name)
            .to_owned();
        Self {
            id: document.id,
            workspace_id: document.workspace_id,
            workspace_name,
            title,
            relative_path: document.relative_path,
            markdown: document.content,
            size_bytes: document.size_bytes,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetResolution {
    pub asset_id: AssetId,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn envelopes_use_the_versioned_camel_case_contract() {
        let serialized = serde_json::to_value(ApiSuccess::new(ServiceStatus::new(
            "NoteSpace".to_owned(),
            2,
        )))
        .unwrap();
        assert_eq!(serialized["protocolVersion"], 1);
        assert_eq!(serialized["data"]["protocolVersion"], 1);
        assert_eq!(serialized["data"]["serviceName"], "NoteSpace");
        assert_eq!(serialized["data"]["activeRequestCount"], 2);

        let failure =
            serde_json::to_value(ApiFailure::new(ShareError::new("notFound", "not found")))
                .unwrap();
        assert_eq!(failure["protocolVersion"], 1);
        assert_eq!(failure["error"]["code"], "notFound");
    }

    #[test]
    fn mobile_document_uses_the_filename_stem_as_its_title() {
        let document = MarkdownDocument {
            id: super::super::model::DocumentId::from_generated("doc_test".to_owned()),
            workspace_id: super::super::model::WorkspaceId::from_generated("ws_test".to_owned()),
            name: "README.MD".to_owned(),
            relative_path: "docs/README.MD".to_owned(),
            content: "# Read me".to_owned(),
            size_bytes: 9,
        };
        let mobile = MobileDocument::from_document(document, "Notes".to_owned());
        assert_eq!(mobile.title, "README");
        assert_eq!(mobile.workspace_name, "Notes");
    }
}
