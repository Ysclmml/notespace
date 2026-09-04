use super::model::{
    encode_opaque, AssetId, AssetResource, DirectoryBreadcrumb, DirectoryEntry, DirectoryEntryKind,
    DirectoryId, DirectoryListing, DocumentId, EntropySource, MarkdownDocument, SearchMatch,
    SearchRequest, SearchResponse, ShareError, ShareLimits, ShareResult, SharedWorkspace, TreeNode,
    TreeNodeKind, WorkspaceId, WorkspaceTree,
};
use cap_fs_ext::{DirExt, FollowSymlinks, OpenOptionsFollowExt, OpenOptionsSyncExt};
use cap_std::fs::{Dir, File as CapFile, OpenOptions};
use regex::{Regex, RegexBuilder};
use std::collections::{HashMap, HashSet};
use std::ffi::OsStr;
use std::fs;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;

const ID_BYTES: usize = 16;
const MAX_GENERATION_ATTEMPTS: usize = 16;
const READ_BUFFER_BYTES: usize = 64 * 1024;
const MAX_LABEL_CHARS: usize = 120;
const MAX_REFERENCE_CHARS: usize = 4_096;
const MAX_LINE_BYTES: usize = 1024 * 1024;
const MAX_DATA_IMAGE_LINE_BYTES: usize = 512 * 1024;
const SNIPPET_CHARS: usize = 240;

#[derive(Clone)]
struct SharedRoot {
    public: SharedWorkspace,
    canonical_path: PathBuf,
    directory: Arc<Dir>,
}

#[derive(Clone, Eq, Hash, PartialEq)]
struct ScopedPath {
    workspace_id: WorkspaceId,
    relative_path: PathBuf,
}

#[derive(Clone)]
pub(crate) struct PreparedDirectoryRead {
    workspace_id: WorkspaceId,
    directory_id: Option<DirectoryId>,
    root: SharedRoot,
    relative_path: PathBuf,
    limits: ShareLimits,
}

pub(crate) struct ScannedDirectoryRead {
    prepared: PreparedDirectoryRead,
    entries: Vec<ScannedDirectoryEntry>,
    scanned_entries: usize,
    truncated: bool,
}

struct ScannedDirectoryEntry {
    name: String,
    scoped: ScopedPath,
    kind: DirectoryEntryKind,
}

#[derive(Clone)]
pub(crate) struct PreparedMarkdownRead {
    id: DocumentId,
    scoped: ScopedPath,
    root: SharedRoot,
    max_bytes: usize,
}

pub(crate) struct PreparedAssetResolution {
    document_id: DocumentId,
    document: ScopedPath,
    root: SharedRoot,
    reference: String,
}

pub(crate) struct ScannedAssetResolution {
    prepared: PreparedAssetResolution,
    asset: ScopedPath,
}

#[derive(Clone)]
pub(crate) struct PreparedAssetRead {
    id: AssetId,
    scoped: ScopedPath,
    root: SharedRoot,
    media_type: &'static str,
    max_bytes: usize,
}

pub(crate) struct PreparedSearch {
    limits: ShareLimits,
    request: SearchRequest,
    roots: Vec<(WorkspaceId, SharedRoot)>,
}

pub(crate) struct ScannedSearch {
    roots: Vec<(WorkspaceId, SharedRoot)>,
    response: SearchResponse,
    matches: Vec<RawSearchMatch>,
}

/// An in-memory, read-only registry of the workspace roots explicitly selected
/// by the desktop user. Public responses carry only opaque IDs and relative
/// paths; canonical host paths remain private to this type.
pub struct LanShareRegistry {
    limits: ShareLimits,
    roots: HashMap<WorkspaceId, SharedRoot>,
    root_ids: HashMap<PathBuf, WorkspaceId>,
    directories: HashMap<DirectoryId, ScopedPath>,
    directory_ids: HashMap<ScopedPath, DirectoryId>,
    documents: HashMap<DocumentId, ScopedPath>,
    document_ids: HashMap<ScopedPath, DocumentId>,
    assets: HashMap<AssetId, ScopedPath>,
    asset_ids: HashMap<ScopedPath, AssetId>,
}

impl LanShareRegistry {
    pub fn new(limits: ShareLimits) -> Self {
        Self {
            limits,
            roots: HashMap::new(),
            root_ids: HashMap::new(),
            directories: HashMap::new(),
            directory_ids: HashMap::new(),
            documents: HashMap::new(),
            document_ids: HashMap::new(),
            assets: HashMap::new(),
            asset_ids: HashMap::new(),
        }
    }

    /// Add one explicitly selected directory. Selecting the same canonical root
    /// again returns its existing opaque identity.
    pub fn share_workspace(
        &mut self,
        path: &Path,
        label: Option<&str>,
        entropy: &mut impl EntropySource,
    ) -> ShareResult<SharedWorkspace> {
        if !path.is_absolute() {
            return Err(ShareError::new(
                "invalidWorkspace",
                "selected workspace path must be absolute",
            ));
        }
        let metadata = fs::symlink_metadata(path).map_err(|_| {
            ShareError::new(
                "workspaceUnavailable",
                "selected workspace is not available",
            )
        })?;
        if metadata.file_type().is_symlink() || path_contains_symlink(path) {
            return Err(ShareError::new(
                "symbolicLink",
                "symbolic links cannot be shared",
            ));
        }
        if !metadata.is_dir() {
            return Err(ShareError::new(
                "invalidWorkspace",
                "selected workspace must be a directory",
            ));
        }
        if is_hidden_name(path.file_name()) {
            return Err(ShareError::new(
                "hiddenPath",
                "hidden workspaces cannot be shared",
            ));
        }
        let canonical_path = path.canonicalize().map_err(|_| {
            ShareError::new(
                "workspaceUnavailable",
                "selected workspace is not available",
            )
        })?;
        let directory = open_absolute_directory_nofollow(path)?;
        if !directory
            .dir_metadata()
            .is_ok_and(|metadata| metadata.is_dir())
        {
            return Err(ShareError::new(
                "workspaceUnavailable",
                "selected workspace is not available",
            ));
        }
        if path.canonicalize().ok().as_ref() != Some(&canonical_path) {
            return Err(ShareError::new(
                "workspaceUnavailable",
                "selected workspace changed while it was being shared",
            ));
        }
        if let Some(id) = self.root_ids.get(&canonical_path) {
            return Ok(self.roots[id].public.clone());
        }
        if self.roots.len() >= self.limits.max_workspaces {
            return Err(ShareError::new(
                "workspaceLimit",
                "too many workspaces are selected for sharing",
            ));
        }
        let name = workspace_label(path, label)?;
        let id = self.unique_workspace_id(entropy)?;
        let public = SharedWorkspace {
            id: id.clone(),
            sync_key: workspace_sync_key(&canonical_path),
            name,
        };
        self.root_ids.insert(canonical_path.clone(), id.clone());
        self.roots.insert(
            id,
            SharedRoot {
                public: public.clone(),
                canonical_path,
                directory: Arc::new(directory),
            },
        );
        Ok(public)
    }

    pub fn unshare_workspace(&mut self, id: &WorkspaceId) -> bool {
        let Some(root) = self.roots.remove(id) else {
            return false;
        };
        self.root_ids.remove(&root.canonical_path);
        self.directories
            .retain(|_, scoped| &scoped.workspace_id != id);
        self.directory_ids
            .retain(|scoped, _| &scoped.workspace_id != id);
        self.documents
            .retain(|_, scoped| &scoped.workspace_id != id);
        self.document_ids
            .retain(|scoped, _| &scoped.workspace_id != id);
        self.assets.retain(|_, scoped| &scoped.workspace_id != id);
        self.asset_ids
            .retain(|scoped, _| &scoped.workspace_id != id);
        true
    }

    pub fn clear(&mut self) {
        self.roots.clear();
        self.root_ids.clear();
        self.directories.clear();
        self.directory_ids.clear();
        self.documents.clear();
        self.document_ids.clear();
        self.assets.clear();
        self.asset_ids.clear();
    }

    pub fn workspaces(&self) -> Vec<SharedWorkspace> {
        let mut workspaces: Vec<_> = self
            .roots
            .values()
            .map(|root| root.public.clone())
            .collect();
        workspaces.sort_by(|left, right| {
            left.name
                .to_lowercase()
                .cmp(&right.name.to_lowercase())
                .then_with(|| left.name.cmp(&right.name))
                .then_with(|| left.id.cmp(&right.id))
        });
        workspaces
    }

    pub fn workspace(&self, id: &WorkspaceId) -> ShareResult<SharedWorkspace> {
        self.root(id).map(|root| root.public.clone())
    }

    /// Enumerate exactly one directory page for the mobile reader. The root is
    /// represented by `None`; every returned child directory receives a stable
    /// opaque ID scoped to this in-memory sharing session.
    pub fn list_directory(
        &mut self,
        workspace_id: &WorkspaceId,
        directory_id: Option<&DirectoryId>,
        entropy: &mut impl EntropySource,
    ) -> ShareResult<DirectoryListing> {
        let prepared = self.prepare_directory_read(workspace_id, directory_id)?;
        let scanned = prepared.scan(&|| false)?;
        self.materialize_directory_read(scanned, entropy)
    }

    pub(crate) fn prepare_directory_read(
        &self,
        workspace_id: &WorkspaceId,
        directory_id: Option<&DirectoryId>,
    ) -> ShareResult<PreparedDirectoryRead> {
        let relative_path = match directory_id {
            None => PathBuf::new(),
            Some(directory_id) => {
                let scoped = self.directories.get(directory_id).ok_or_else(|| {
                    ShareError::new("unknownDirectory", "shared directory does not exist")
                })?;
                if &scoped.workspace_id != workspace_id {
                    return Err(ShareError::new(
                        "unknownDirectory",
                        "shared directory does not exist",
                    ));
                }
                scoped.relative_path.clone()
            }
        };
        let root = self.root(workspace_id)?.clone();
        Ok(PreparedDirectoryRead {
            workspace_id: workspace_id.clone(),
            directory_id: directory_id.cloned(),
            root,
            relative_path,
            limits: self.limits,
        })
    }

    pub(crate) fn materialize_directory_read(
        &mut self,
        scanned: ScannedDirectoryRead,
        entropy: &mut impl EntropySource,
    ) -> ShareResult<DirectoryListing> {
        let PreparedDirectoryRead {
            workspace_id,
            directory_id,
            root,
            relative_path,
            ..
        } = scanned.prepared;
        self.ensure_root_snapshot_current(&workspace_id, &root)?;
        let mut entries = Vec::new();
        for entry in scanned.entries {
            let id = match entry.kind {
                DirectoryEntryKind::Directory => self
                    .directory_id_for(entry.scoped, entropy)?
                    .as_str()
                    .to_owned(),
                DirectoryEntryKind::Document => self
                    .document_id_for(entry.scoped, entropy)?
                    .as_str()
                    .to_owned(),
            };
            entries.push(DirectoryEntry {
                id,
                name: entry.name,
                kind: entry.kind,
                detail: None,
            });
        }
        entries.sort_by(|left, right| {
            let left_rank = left.kind != DirectoryEntryKind::Directory;
            let right_rank = right.kind != DirectoryEntryKind::Directory;
            left_rank
                .cmp(&right_rank)
                .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
                .then_with(|| left.name.cmp(&right.name))
        });

        let breadcrumbs =
            self.directory_breadcrumbs(&root, &workspace_id, &relative_path, entropy)?;
        let name = relative_path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| root.public.name.clone());
        Ok(DirectoryListing {
            workspace_id,
            directory_id,
            name,
            breadcrumbs,
            entries,
            scanned_entries: scanned.scanned_entries,
            truncated: scanned.truncated,
        })
    }

    pub fn workspace_tree(
        &mut self,
        id: &WorkspaceId,
        entropy: &mut impl EntropySource,
    ) -> ShareResult<WorkspaceTree> {
        let root = self.root(id)?.clone();
        ensure_root_available(&root)?;
        let mut scan = TreeScan::new(self.limits);
        let raw_nodes = scan.directory(root.directory.as_ref(), Path::new(""), 0);
        let nodes = self.materialize_nodes(id, raw_nodes, entropy)?;
        Ok(WorkspaceTree {
            workspace: root.public,
            nodes,
            scanned_entries: scan.entries,
            truncated: scan.truncated,
        })
    }

    pub fn read_markdown(&self, id: &DocumentId) -> ShareResult<MarkdownDocument> {
        self.prepare_markdown_read(id)?.read(&|| false)
    }

    pub(crate) fn prepare_markdown_read(
        &self,
        id: &DocumentId,
    ) -> ShareResult<PreparedMarkdownRead> {
        let scoped = self
            .documents
            .get(id)
            .ok_or_else(|| ShareError::new("unknownDocument", "shared document does not exist"))?;
        Ok(PreparedMarkdownRead {
            id: id.clone(),
            scoped: scoped.clone(),
            root: self.root(&scoped.workspace_id)?.clone(),
            max_bytes: self.limits.max_document_bytes,
        })
    }

    pub(crate) fn validate_markdown_read(
        &self,
        prepared: &PreparedMarkdownRead,
    ) -> ShareResult<SharedWorkspace> {
        if self.documents.get(&prepared.id) != Some(&prepared.scoped) {
            return Err(ShareError::new(
                "unknownDocument",
                "shared document does not exist",
            ));
        }
        self.ensure_root_snapshot_current(&prepared.scoped.workspace_id, &prepared.root)?;
        Ok(prepared.root.public.clone())
    }

    /// Resolve one local image reference relative to a previously enumerated
    /// Markdown document. Remote/data/file URLs and root escapes are rejected.
    pub fn resolve_asset(
        &mut self,
        document_id: &DocumentId,
        reference: &str,
        entropy: &mut impl EntropySource,
    ) -> ShareResult<AssetId> {
        let prepared = self.prepare_asset_resolution(document_id, reference)?;
        let scanned = prepared.scan(&|| false)?;
        self.materialize_asset_resolution(scanned, entropy)
    }

    pub(crate) fn prepare_asset_resolution(
        &self,
        document_id: &DocumentId,
        reference: &str,
    ) -> ShareResult<PreparedAssetResolution> {
        let document =
            self.documents.get(document_id).cloned().ok_or_else(|| {
                ShareError::new("unknownDocument", "shared document does not exist")
            })?;
        Ok(PreparedAssetResolution {
            document_id: document_id.clone(),
            root: self.root(&document.workspace_id)?.clone(),
            document,
            reference: reference.to_owned(),
        })
    }

    pub(crate) fn materialize_asset_resolution(
        &mut self,
        scanned: ScannedAssetResolution,
        entropy: &mut impl EntropySource,
    ) -> ShareResult<AssetId> {
        if self.documents.get(&scanned.prepared.document_id) != Some(&scanned.prepared.document) {
            return Err(ShareError::new(
                "unknownDocument",
                "shared document does not exist",
            ));
        }
        self.ensure_root_snapshot_current(
            &scanned.prepared.document.workspace_id,
            &scanned.prepared.root,
        )?;
        self.asset_id_for(scanned.asset, entropy)
    }

    pub fn read_asset(&self, id: &AssetId) -> ShareResult<AssetResource> {
        self.prepare_asset_read(id)?.read(&|| false)
    }

    pub(crate) fn prepare_asset_read(&self, id: &AssetId) -> ShareResult<PreparedAssetRead> {
        let scoped = self
            .assets
            .get(id)
            .ok_or_else(|| ShareError::new("unknownAsset", "shared asset does not exist"))?;
        let media_type = asset_media_type(&scoped.relative_path)
            .ok_or_else(|| ShareError::new("unsupportedAsset", "asset type is not supported"))?;
        Ok(PreparedAssetRead {
            id: id.clone(),
            scoped: scoped.clone(),
            root: self.root(&scoped.workspace_id)?.clone(),
            media_type,
            max_bytes: self.limits.max_asset_bytes,
        })
    }

    pub(crate) fn validate_asset_read(&self, prepared: &PreparedAssetRead) -> ShareResult<()> {
        if self.assets.get(&prepared.id) != Some(&prepared.scoped) {
            return Err(ShareError::new(
                "unknownAsset",
                "shared asset does not exist",
            ));
        }
        self.ensure_root_snapshot_current(&prepared.scoped.workspace_id, &prepared.root)
    }

    pub fn search(
        &mut self,
        request: SearchRequest,
        entropy: &mut impl EntropySource,
    ) -> ShareResult<SearchResponse> {
        let prepared = self.prepare_search(request)?;
        let scanned = prepared.scan(&|| false)?;
        self.materialize_search(scanned, entropy)
    }

    pub(crate) fn prepare_search(&self, request: SearchRequest) -> ShareResult<PreparedSearch> {
        validate_search_request(&request, self.limits)?;
        // Keep pattern validation synchronous with request preparation while the
        // actual filesystem walk remains outside the registry lock.
        ContentMatcher::compile(&request.query, request.case_sensitive, request.use_regex)?;
        compile_file_filter(request.file_filter.as_deref(), self.limits)?;
        if request.query.trim().is_empty() {
            return Ok(PreparedSearch {
                limits: self.limits,
                request,
                roots: Vec::new(),
            });
        }

        let selected_ids = self.selected_workspace_ids(&request.workspace_ids)?;
        let roots = selected_ids
            .into_iter()
            .map(|id| self.root(&id).cloned().map(|root| (id, root)))
            .collect::<ShareResult<Vec<_>>>()?;
        Ok(PreparedSearch {
            limits: self.limits,
            request,
            roots,
        })
    }

    pub(crate) fn materialize_search(
        &mut self,
        mut scanned: ScannedSearch,
        entropy: &mut impl EntropySource,
    ) -> ShareResult<SearchResponse> {
        for (workspace_id, root) in &scanned.roots {
            self.ensure_root_snapshot_current(workspace_id, root)?;
        }
        scanned.matches.sort_by(|left, right| {
            left.workspace_id
                .cmp(&right.workspace_id)
                .then_with(|| left.relative_path.cmp(&right.relative_path))
                .then_with(|| left.line.cmp(&right.line))
        });
        for found in scanned.matches {
            let scoped = ScopedPath {
                workspace_id: found.workspace_id.clone(),
                relative_path: found.relative_path.clone(),
            };
            let document_id = self.document_id_for(scoped, entropy)?;
            scanned.response.matches.push(SearchMatch {
                workspace_id: found.workspace_id,
                document_id,
                relative_path: relative_display_path(&found.relative_path),
                line: found.line,
                column: found.column,
                match_length: found.match_length,
                snippet: found.snippet,
            });
        }
        Ok(scanned.response)
    }

    fn root(&self, id: &WorkspaceId) -> ShareResult<&SharedRoot> {
        self.roots
            .get(id)
            .ok_or_else(|| ShareError::new("unknownWorkspace", "shared workspace does not exist"))
    }

    fn ensure_root_snapshot_current(
        &self,
        id: &WorkspaceId,
        snapshot: &SharedRoot,
    ) -> ShareResult<()> {
        let current = self.root(id)?;
        if current.canonical_path != snapshot.canonical_path
            || !Arc::ptr_eq(&current.directory, &snapshot.directory)
        {
            return Err(ShareError::new(
                "workspaceUnavailable",
                "shared workspace changed during the request",
            ));
        }
        Ok(())
    }

    fn selected_workspace_ids(&self, requested: &[WorkspaceId]) -> ShareResult<Vec<WorkspaceId>> {
        if requested.len() > self.limits.max_workspaces {
            return Err(ShareError::new(
                "invalidSearchScope",
                "search workspace scope exceeds its limit",
            ));
        }
        let mut ids = if requested.is_empty() {
            self.roots.keys().cloned().collect::<Vec<_>>()
        } else {
            let mut seen = HashSet::new();
            requested
                .iter()
                .filter(|id| seen.insert((*id).clone()))
                .cloned()
                .collect::<Vec<_>>()
        };
        if ids.iter().any(|id| !self.roots.contains_key(id)) {
            return Err(ShareError::new(
                "unknownWorkspace",
                "search contains a workspace that is not shared",
            ));
        }
        ids.sort();
        Ok(ids)
    }

    fn materialize_nodes(
        &mut self,
        workspace_id: &WorkspaceId,
        nodes: Vec<RawTreeNode>,
        entropy: &mut impl EntropySource,
    ) -> ShareResult<Vec<TreeNode>> {
        nodes
            .into_iter()
            .map(|node| {
                let document_id = if node.kind == TreeNodeKind::Markdown {
                    Some(self.document_id_for(
                        ScopedPath {
                            workspace_id: workspace_id.clone(),
                            relative_path: node.relative_path.clone(),
                        },
                        entropy,
                    )?)
                } else {
                    None
                };
                let children = self.materialize_nodes(workspace_id, node.children, entropy)?;
                Ok(TreeNode {
                    name: node.name,
                    relative_path: relative_display_path(&node.relative_path),
                    kind: node.kind,
                    document_id,
                    children,
                })
            })
            .collect()
    }

    fn directory_breadcrumbs(
        &mut self,
        root: &SharedRoot,
        workspace_id: &WorkspaceId,
        relative_path: &Path,
        entropy: &mut impl EntropySource,
    ) -> ShareResult<Vec<DirectoryBreadcrumb>> {
        let mut breadcrumbs = vec![DirectoryBreadcrumb {
            id: None,
            name: root.public.name.clone(),
        }];
        let mut current = PathBuf::new();
        for component in relative_path.components() {
            let Component::Normal(name) = component else {
                return Err(ShareError::new(
                    "pathOutsideWorkspace",
                    "requested path is outside the shared workspace",
                ));
            };
            current.push(name);
            let id = self.directory_id_for(
                ScopedPath {
                    workspace_id: workspace_id.clone(),
                    relative_path: current.clone(),
                },
                entropy,
            )?;
            breadcrumbs.push(DirectoryBreadcrumb {
                id: Some(id),
                name: name.to_string_lossy().into_owned(),
            });
        }
        Ok(breadcrumbs)
    }

    fn directory_id_for(
        &mut self,
        scoped: ScopedPath,
        entropy: &mut impl EntropySource,
    ) -> ShareResult<DirectoryId> {
        if let Some(id) = self.directory_ids.get(&scoped) {
            return Ok(id.clone());
        }
        let id = self.unique_directory_id(entropy)?;
        self.directories.insert(id.clone(), scoped.clone());
        self.directory_ids.insert(scoped, id.clone());
        Ok(id)
    }

    fn document_id_for(
        &mut self,
        scoped: ScopedPath,
        entropy: &mut impl EntropySource,
    ) -> ShareResult<DocumentId> {
        if let Some(id) = self.document_ids.get(&scoped) {
            return Ok(id.clone());
        }
        let id = self.unique_document_id(entropy)?;
        self.documents.insert(id.clone(), scoped.clone());
        self.document_ids.insert(scoped, id.clone());
        Ok(id)
    }

    fn asset_id_for(
        &mut self,
        scoped: ScopedPath,
        entropy: &mut impl EntropySource,
    ) -> ShareResult<AssetId> {
        if let Some(id) = self.asset_ids.get(&scoped) {
            return Ok(id.clone());
        }
        let id = self.unique_asset_id(entropy)?;
        self.assets.insert(id.clone(), scoped.clone());
        self.asset_ids.insert(scoped, id.clone());
        Ok(id)
    }

    fn unique_workspace_id(&self, entropy: &mut impl EntropySource) -> ShareResult<WorkspaceId> {
        generate_id("ws_", entropy, |candidate| {
            self.roots
                .contains_key(&WorkspaceId::from_generated(candidate.to_owned()))
        })
        .map(WorkspaceId::from_generated)
    }

    fn unique_directory_id(&self, entropy: &mut impl EntropySource) -> ShareResult<DirectoryId> {
        generate_id("dir_", entropy, |candidate| {
            self.directories
                .contains_key(&DirectoryId::from_generated(candidate.to_owned()))
        })
        .map(DirectoryId::from_generated)
    }

    fn unique_document_id(&self, entropy: &mut impl EntropySource) -> ShareResult<DocumentId> {
        generate_id("doc_", entropy, |candidate| {
            self.documents
                .contains_key(&DocumentId::from_generated(candidate.to_owned()))
        })
        .map(DocumentId::from_generated)
    }

    fn unique_asset_id(&self, entropy: &mut impl EntropySource) -> ShareResult<AssetId> {
        generate_id("asset_", entropy, |candidate| {
            self.assets
                .contains_key(&AssetId::from_generated(candidate.to_owned()))
        })
        .map(AssetId::from_generated)
    }
}

impl Default for LanShareRegistry {
    fn default() -> Self {
        Self::new(ShareLimits::default())
    }
}

impl PreparedDirectoryRead {
    pub(crate) fn scan(self, cancelled: &dyn Fn() -> bool) -> ShareResult<ScannedDirectoryRead> {
        ensure_not_cancelled(cancelled)?;
        ensure_root_available(&self.root)?;
        let directory = open_scoped_directory(&self.root, &self.relative_path)?;
        let raw_entries = directory.entries().map_err(|_| {
            ShareError::new("directoryUnavailable", "shared directory is not available")
        })?;
        let mut sortable_entries = Vec::new();
        let mut truncated = false;
        for entry in raw_entries {
            ensure_not_cancelled(cancelled)?;
            match entry {
                Ok(entry) => sortable_entries.push(entry),
                Err(_) => truncated = true,
            }
        }
        sortable_entries.sort_by_key(|entry| entry.file_name());

        let mut scanned_entries = 0;
        let mut entries = Vec::new();
        for entry in sortable_entries {
            ensure_not_cancelled(cancelled)?;
            if scanned_entries >= self.limits.max_tree_entries {
                truncated = true;
                break;
            }
            scanned_entries += 1;
            let name_os = entry.file_name();
            if is_hidden_name(Some(&name_os)) {
                continue;
            }
            let Ok(file_type) = entry.file_type() else {
                truncated = true;
                continue;
            };
            if file_type.is_symlink() {
                continue;
            }
            let scoped = ScopedPath {
                workspace_id: self.workspace_id.clone(),
                relative_path: self.relative_path.join(&name_os),
            };
            if file_type.is_dir() {
                let name = name_os.to_string_lossy().into_owned();
                if is_ignored_workspace_directory(&name) {
                    continue;
                }
                match open_directory_nofollow(&directory, &name_os) {
                    Ok(child) => drop(child),
                    Err(_) => {
                        truncated = true;
                        continue;
                    }
                }
                entries.push(ScannedDirectoryEntry {
                    name,
                    scoped,
                    kind: DirectoryEntryKind::Directory,
                });
            } else if file_type.is_file() && is_markdown_path(&scoped.relative_path) {
                match open_regular_child(&directory, &name_os) {
                    Ok(file) => drop(file),
                    Err(_) => {
                        truncated = true;
                        continue;
                    }
                }
                entries.push(ScannedDirectoryEntry {
                    name: name_os.to_string_lossy().into_owned(),
                    scoped,
                    kind: DirectoryEntryKind::Document,
                });
            }
        }
        ensure_not_cancelled(cancelled)?;
        Ok(ScannedDirectoryRead {
            prepared: self,
            entries,
            scanned_entries,
            truncated,
        })
    }
}

impl PreparedMarkdownRead {
    pub(crate) fn read(&self, cancelled: &dyn Fn() -> bool) -> ShareResult<MarkdownDocument> {
        ensure_not_cancelled(cancelled)?;
        let file = open_regular_file(
            &self.root,
            &self.scoped.relative_path,
            ExpectedFile::Markdown,
        )?;
        let bytes = read_bounded_cancellable(file, self.max_bytes, "documentTooLarge", cancelled)?;
        let content = validate_markdown_bytes(bytes)?;
        ensure_not_cancelled(cancelled)?;
        Ok(MarkdownDocument {
            id: self.id.clone(),
            workspace_id: self.scoped.workspace_id.clone(),
            name: self
                .scoped
                .relative_path
                .file_name()
                .unwrap_or_else(|| OsStr::new("Document"))
                .to_string_lossy()
                .into_owned(),
            relative_path: relative_display_path(&self.scoped.relative_path),
            size_bytes: content.len() as u64,
            content,
        })
    }
}

impl PreparedAssetResolution {
    pub(crate) fn scan(self, cancelled: &dyn Fn() -> bool) -> ShareResult<ScannedAssetResolution> {
        ensure_not_cancelled(cancelled)?;
        // A stale ID cannot be used as an anchor after the source document has
        // disappeared or has been replaced by a link.
        open_regular_file(
            &self.root,
            &self.document.relative_path,
            ExpectedFile::Markdown,
        )?;
        let relative_path = resolve_local_reference(&self.document.relative_path, &self.reference)?;
        open_regular_file(&self.root, &relative_path, ExpectedFile::Asset)?;
        ensure_not_cancelled(cancelled)?;
        let workspace_id = self.document.workspace_id.clone();
        Ok(ScannedAssetResolution {
            prepared: self,
            asset: ScopedPath {
                workspace_id,
                relative_path,
            },
        })
    }
}

impl PreparedAssetRead {
    pub(crate) fn read(&self, cancelled: &dyn Fn() -> bool) -> ShareResult<AssetResource> {
        ensure_not_cancelled(cancelled)?;
        let file = open_regular_file(&self.root, &self.scoped.relative_path, ExpectedFile::Asset)?;
        let bytes = read_bounded_cancellable(file, self.max_bytes, "assetTooLarge", cancelled)?;
        ensure_not_cancelled(cancelled)?;
        Ok(AssetResource {
            id: self.id.clone(),
            workspace_id: self.scoped.workspace_id.clone(),
            media_type: self.media_type,
            bytes,
        })
    }
}

impl PreparedSearch {
    pub(crate) fn scan(self, cancelled: &dyn Fn() -> bool) -> ShareResult<ScannedSearch> {
        ensure_not_cancelled(cancelled)?;
        let matcher = ContentMatcher::compile(
            &self.request.query,
            self.request.case_sensitive,
            self.request.use_regex,
        )?;
        let file_filter = compile_file_filter(self.request.file_filter.as_deref(), self.limits)?;
        if self.request.query.trim().is_empty() {
            return Ok(ScannedSearch {
                roots: Vec::new(),
                response: SearchResponse::default(),
                matches: Vec::new(),
            });
        }

        let selected_root_paths = self
            .roots
            .iter()
            .map(|(_, root)| root.canonical_path.clone())
            .collect();
        let mut scan = SearchScan::new(
            self.limits,
            &matcher,
            file_filter.as_ref(),
            selected_root_paths,
            cancelled,
        );
        for (id, root) in &self.roots {
            if scan.exhausted() {
                scan.response.truncated = true;
                break;
            }
            if ensure_root_available(root).is_err() {
                scan.response.unavailable_workspaces.push(id.clone());
                continue;
            }
            scan.directory(
                id,
                &root.canonical_path,
                root.directory.as_ref(),
                Path::new(""),
                0,
            );
        }
        ensure_not_cancelled(cancelled)?;
        scan.response.scanned_entries = scan.entries;
        Ok(ScannedSearch {
            roots: self.roots,
            response: scan.response,
            matches: scan.matches,
        })
    }
}

fn generate_id(
    prefix: &str,
    entropy: &mut impl EntropySource,
    collision: impl Fn(&str) -> bool,
) -> ShareResult<String> {
    for _ in 0..MAX_GENERATION_ATTEMPTS {
        let mut bytes = [0_u8; ID_BYTES];
        entropy.fill_bytes(&mut bytes).map_err(|_| {
            ShareError::new("entropyUnavailable", "secure randomness is unavailable")
        })?;
        let candidate = encode_opaque(prefix, &bytes);
        if !collision(&candidate) {
            return Ok(candidate);
        }
    }
    Err(ShareError::new(
        "identifierCollision",
        "could not allocate a unique opaque identifier",
    ))
}

fn workspace_label(path: &Path, requested: Option<&str>) -> ShareResult<String> {
    let fallback = path
        .file_name()
        .filter(|name| !name.is_empty())
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "Workspace".to_owned());
    let label = requested.unwrap_or(&fallback).trim();
    if label.is_empty()
        || label.chars().count() > MAX_LABEL_CHARS
        || label.chars().any(char::is_control)
    {
        return Err(ShareError::new(
            "invalidWorkspaceLabel",
            "workspace name must contain 1 to 120 printable characters",
        ));
    }
    Ok(label.to_owned())
}

/// Produce a deterministic, path-redacted key for reconnecting an offline
/// mobile snapshot to the same workspace. This is deliberately not presented
/// as a security primitive: LAN sharing is currently unauthenticated and the
/// key is scoped by the mobile client's computer record.
fn workspace_sync_key(path: &Path) -> String {
    const FNV_PRIME: u64 = 0x0000_0100_0000_01b3;
    const FORWARD_BASIS: u64 = 0xcbf2_9ce4_8422_2325;
    const REVERSE_BASIS: u64 = 0x8422_2325_cbf2_9ce4;

    let display = path.to_string_lossy();
    let bytes = display.as_bytes();
    let forward = bytes.iter().fold(FORWARD_BASIS, |hash, byte| {
        (hash ^ u64::from(*byte)).wrapping_mul(FNV_PRIME)
    });
    let reverse = bytes.iter().rev().fold(REVERSE_BASIS, |hash, byte| {
        (hash ^ u64::from(*byte)).wrapping_mul(FNV_PRIME)
    });
    format!("workspace_{forward:016x}{reverse:016x}")
}

fn ensure_root_available(root: &SharedRoot) -> ShareResult<()> {
    let metadata = root.directory.dir_metadata().map_err(|_| {
        ShareError::new("workspaceUnavailable", "shared workspace is not available")
    })?;
    if !metadata.is_dir() {
        return Err(ShareError::new(
            "workspaceUnavailable",
            "shared workspace is not available",
        ));
    }
    Ok(())
}

fn path_contains_symlink(path: &Path) -> bool {
    let mut ancestors: Vec<_> = path.ancestors().collect();
    ancestors.reverse();
    ancestors.into_iter().any(|ancestor| {
        fs::symlink_metadata(ancestor)
            .map(|metadata| metadata.file_type().is_symlink())
            .unwrap_or(false)
    })
}

/// Open an absolute directory from its filesystem anchor, refusing symlinks at
/// every named component. The only ambient open is `/` on Unix or the volume /
/// UNC root on Windows; every user-controlled component is resolved relative
/// to an already-open directory handle.
fn open_absolute_directory_nofollow(path: &Path) -> ShareResult<Dir> {
    let anchor = path.ancestors().last().ok_or_else(|| {
        ShareError::new(
            "workspaceUnavailable",
            "selected workspace is not available",
        )
    })?;
    let mut directory =
        Dir::open_ambient_dir(anchor, cap_std::ambient_authority()).map_err(|_| {
            ShareError::new(
                "workspaceUnavailable",
                "selected workspace is not available",
            )
        })?;
    let relative = path.strip_prefix(anchor).map_err(|_| {
        ShareError::new(
            "invalidWorkspace",
            "selected workspace path must be absolute",
        )
    })?;
    for component in relative.components() {
        let Component::Normal(name) = component else {
            return Err(ShareError::new(
                "invalidWorkspace",
                "selected workspace path is not normalized",
            ));
        };
        directory = directory.open_dir_nofollow(name).map_err(|_| {
            if directory
                .symlink_metadata(name)
                .is_ok_and(|metadata| metadata.file_type().is_symlink())
            {
                ShareError::new("symbolicLink", "symbolic links cannot be shared")
            } else {
                ShareError::new(
                    "workspaceUnavailable",
                    "selected workspace is not available",
                )
            }
        })?;
    }
    Ok(directory)
}

#[derive(Clone, Copy)]
enum ExpectedFile {
    Markdown,
    Asset,
}

fn open_regular_file(
    root: &SharedRoot,
    relative_path: &Path,
    expected: ExpectedFile,
) -> ShareResult<CapFile> {
    ensure_root_available(root)?;
    validate_scoped_relative_path(relative_path)?;
    let supported = match expected {
        ExpectedFile::Markdown => is_markdown_path(relative_path),
        ExpectedFile::Asset => asset_media_type(relative_path).is_some(),
    };
    if !supported {
        return Err(ShareError::new(
            "unsupportedType",
            "shared resource type is not supported",
        ));
    }

    let components = relative_path.components().collect::<Vec<_>>();
    let mut directory = root.directory.try_clone().map_err(|_| {
        ShareError::new("workspaceUnavailable", "shared workspace is not available")
    })?;
    for component in &components[..components.len() - 1] {
        let Component::Normal(name) = component else {
            return Err(ShareError::new(
                "pathOutsideWorkspace",
                "requested path is outside the shared workspace",
            ));
        };
        directory = open_directory_nofollow(&directory, name)?;
    }
    let Component::Normal(file_name) = components[components.len() - 1] else {
        return Err(ShareError::new(
            "pathOutsideWorkspace",
            "requested path is outside the shared workspace",
        ));
    };
    open_regular_child(&directory, file_name)
}

fn open_scoped_directory(root: &SharedRoot, relative_path: &Path) -> ShareResult<Dir> {
    ensure_root_available(root)?;
    let mut directory = root.directory.try_clone().map_err(|_| {
        ShareError::new("workspaceUnavailable", "shared workspace is not available")
    })?;
    if relative_path.as_os_str().is_empty() {
        return Ok(directory);
    }
    validate_scoped_relative_path(relative_path)?;
    for component in relative_path.components() {
        let Component::Normal(name) = component else {
            return Err(ShareError::new(
                "pathOutsideWorkspace",
                "requested path is outside the shared workspace",
            ));
        };
        directory = open_directory_nofollow(&directory, name)?;
    }
    Ok(directory)
}

fn open_directory_nofollow(parent: &Dir, name: &OsStr) -> ShareResult<Dir> {
    parent
        .open_dir_nofollow(name)
        .map_err(|_| classify_open_error(parent, name))
}

fn open_regular_child(parent: &Dir, name: &OsStr) -> ShareResult<CapFile> {
    let mut options = OpenOptions::new();
    options.read(true);
    options.follow(FollowSymlinks::No);
    // On Unix this prevents a raced-in FIFO from blocking the serving thread
    // before its type can be checked. It is harmless for regular files and is
    // implemented portably by cap-fs-ext.
    options.nonblock(true);
    let file = parent
        .open_with(name, &options)
        .map_err(|_| classify_open_error(parent, name))?;
    let metadata = file
        .metadata()
        .map_err(|_| ShareError::new("resourceUnavailable", "shared resource is not available"))?;
    if !metadata.is_file() {
        return Err(ShareError::new(
            "resourceUnavailable",
            "shared resource is not a regular file",
        ));
    }
    Ok(file)
}

fn classify_open_error(parent: &Dir, name: &OsStr) -> ShareError {
    if parent
        .symlink_metadata(name)
        .is_ok_and(|metadata| metadata.file_type().is_symlink())
    {
        ShareError::new("symbolicLink", "symbolic links cannot be shared")
    } else {
        ShareError::new("resourceUnavailable", "shared resource is not available")
    }
}

fn validate_scoped_relative_path(path: &Path) -> ShareResult<()> {
    let mut saw_component = false;
    for component in path.components() {
        let Component::Normal(name) = component else {
            return Err(ShareError::new(
                "pathOutsideWorkspace",
                "requested path is outside the shared workspace",
            ));
        };
        saw_component = true;
        if is_hidden_name(Some(name)) || is_ignored_workspace_directory(&name.to_string_lossy()) {
            return Err(ShareError::new(
                "hiddenPath",
                "hidden and ignored paths cannot be shared",
            ));
        }
    }
    if !saw_component {
        return Err(ShareError::new(
            "invalidPath",
            "shared resource path is empty",
        ));
    }
    Ok(())
}

fn ensure_not_cancelled(cancelled: &dyn Fn() -> bool) -> ShareResult<()> {
    if cancelled() {
        return Err(ShareError::new(
            "requestCancelled",
            "the sharing request was cancelled",
        ));
    }
    Ok(())
}

fn read_bounded_cancellable(
    mut file: CapFile,
    limit: usize,
    limit_code: &'static str,
    cancelled: &dyn Fn() -> bool,
) -> ShareResult<Vec<u8>> {
    ensure_not_cancelled(cancelled)?;
    let metadata = file
        .metadata()
        .map_err(|_| ShareError::new("resourceUnavailable", "shared resource is not available"))?;
    if metadata.len() > limit as u64 {
        return Err(ShareError::new(
            limit_code,
            "shared resource exceeds its read limit",
        ));
    }
    let mut bytes = Vec::with_capacity((metadata.len() as usize).min(limit));
    let mut buffer = [0_u8; READ_BUFFER_BYTES];
    loop {
        ensure_not_cancelled(cancelled)?;
        let allowed = (limit + 1).saturating_sub(bytes.len()).min(buffer.len());
        if allowed == 0 {
            return Err(ShareError::new(
                limit_code,
                "shared resource exceeds its read limit",
            ));
        }
        let read = file.read(&mut buffer[..allowed]).map_err(|_| {
            ShareError::new("resourceUnavailable", "shared resource could not be read")
        })?;
        if read == 0 {
            break;
        }
        bytes.extend_from_slice(&buffer[..read]);
        if bytes.len() > limit {
            return Err(ShareError::new(
                limit_code,
                "shared resource exceeds its read limit",
            ));
        }
    }
    ensure_not_cancelled(cancelled)?;
    Ok(bytes)
}

fn validate_markdown_bytes(bytes: Vec<u8>) -> ShareResult<String> {
    let content = String::from_utf8(bytes)
        .map_err(|_| ShareError::new("invalidUtf8", "shared document is not valid UTF-8"))?;
    for line in content.split('\n') {
        let line_bytes = line.len();
        if line_bytes > MAX_DATA_IMAGE_LINE_BYTES {
            let lowercase = line.to_ascii_lowercase();
            if lowercase.contains("data:image/") && lowercase.contains(";base64,") {
                return Err(ShareError::new(
                    "largeDataUri",
                    "shared document contains an oversized inline image",
                ));
            }
        }
        if line_bytes > MAX_LINE_BYTES {
            return Err(ShareError::new(
                "lineTooLong",
                "shared document contains a line that is too long",
            ));
        }
    }
    Ok(content)
}

fn resolve_local_reference(document: &Path, reference: &str) -> ShareResult<PathBuf> {
    if reference.chars().count() > MAX_REFERENCE_CHARS || reference.contains(['\0', '\n', '\r']) {
        return Err(ShareError::new(
            "invalidAssetReference",
            "asset reference is invalid or exceeds its limit",
        ));
    }
    let path_part = reference.split(['#', '?']).next().unwrap_or(reference);
    let decoded = percent_decode(path_part)?;
    let normalized_separators = decoded.replace('\\', "/");
    if normalized_separators.is_empty()
        || normalized_separators.starts_with('/')
        || normalized_separators.starts_with('~')
        || normalized_separators.contains(':')
    {
        return Err(ShareError::new(
            "invalidAssetReference",
            "asset reference must be a relative local path",
        ));
    }

    let mut components: Vec<_> = document
        .parent()
        .into_iter()
        .flat_map(Path::components)
        .filter_map(|component| match component {
            Component::Normal(name) => Some(name.to_os_string()),
            _ => None,
        })
        .collect();
    for component in normalized_separators.split('/') {
        match component {
            "" | "." => {}
            ".." => {
                if components.pop().is_none() {
                    return Err(ShareError::new(
                        "pathOutsideWorkspace",
                        "asset reference escapes the shared workspace",
                    ));
                }
            }
            name => components.push(name.into()),
        }
    }
    if components.is_empty() {
        return Err(ShareError::new(
            "invalidAssetReference",
            "asset reference does not identify a file",
        ));
    }
    let mut resolved = PathBuf::new();
    for component in components {
        resolved.push(component);
    }
    validate_scoped_relative_path(&resolved)?;
    Ok(resolved)
}

fn percent_decode(value: &str) -> ShareResult<String> {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] != b'%' {
            decoded.push(bytes[index]);
            index += 1;
            continue;
        }
        if index + 2 >= bytes.len() {
            return Err(ShareError::new(
                "invalidAssetReference",
                "asset reference contains invalid percent encoding",
            ));
        }
        let high = hex_value(bytes[index + 1]);
        let low = hex_value(bytes[index + 2]);
        let (Some(high), Some(low)) = (high, low) else {
            return Err(ShareError::new(
                "invalidAssetReference",
                "asset reference contains invalid percent encoding",
            ));
        };
        decoded.push((high << 4) | low);
        index += 3;
    }
    String::from_utf8(decoded).map_err(|_| {
        ShareError::new(
            "invalidAssetReference",
            "asset reference is not valid UTF-8",
        )
    })
}

fn hex_value(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
}

struct TreeScan {
    limits: ShareLimits,
    entries: usize,
    truncated: bool,
}

impl TreeScan {
    fn new(limits: ShareLimits) -> Self {
        Self {
            limits,
            entries: 0,
            truncated: false,
        }
    }

    fn directory(
        &mut self,
        directory: &Dir,
        relative_directory: &Path,
        depth: usize,
    ) -> Vec<RawTreeNode> {
        if depth > self.limits.max_tree_depth {
            self.truncated = true;
            return Vec::new();
        }
        let Ok(raw_entries) = directory.entries() else {
            self.truncated = true;
            return Vec::new();
        };
        let mut entries = Vec::new();
        for entry in raw_entries {
            match entry {
                Ok(entry) => entries.push(entry),
                Err(_) => self.truncated = true,
            }
        }
        entries.sort_by_key(|entry| entry.file_name());
        let mut nodes = Vec::new();
        for entry in entries {
            if self.entries >= self.limits.max_tree_entries {
                self.truncated = true;
                break;
            }
            self.entries += 1;
            let name_os = entry.file_name();
            if is_hidden_name(Some(&name_os)) {
                continue;
            }
            let Ok(file_type) = entry.file_type() else {
                self.truncated = true;
                continue;
            };
            if file_type.is_symlink() {
                continue;
            }
            let relative_path = relative_directory.join(&name_os);
            if file_type.is_dir() {
                let name = name_os.to_string_lossy().into_owned();
                if is_ignored_workspace_directory(&name) {
                    continue;
                }
                let Ok(child) = open_directory_nofollow(directory, &name_os) else {
                    self.truncated = true;
                    continue;
                };
                nodes.push(RawTreeNode {
                    name,
                    relative_path: relative_path.clone(),
                    kind: TreeNodeKind::Directory,
                    children: self.directory(&child, &relative_path, depth + 1),
                });
            } else if file_type.is_file() && is_markdown_path(&relative_path) {
                match open_regular_child(directory, &name_os) {
                    Ok(file) => {
                        drop(file);
                        nodes.push(RawTreeNode {
                            name: name_os.to_string_lossy().into_owned(),
                            relative_path,
                            kind: TreeNodeKind::Markdown,
                            children: Vec::new(),
                        });
                    }
                    Err(_) => self.truncated = true,
                }
            }
        }
        nodes.sort_by(|left, right| {
            let left_rank = left.kind != TreeNodeKind::Directory;
            let right_rank = right.kind != TreeNodeKind::Directory;
            left_rank
                .cmp(&right_rank)
                .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
                .then_with(|| left.name.cmp(&right.name))
        });
        nodes
    }
}

struct RawTreeNode {
    name: String,
    relative_path: PathBuf,
    kind: TreeNodeKind,
    children: Vec<RawTreeNode>,
}

struct RawSearchMatch {
    workspace_id: WorkspaceId,
    relative_path: PathBuf,
    line: usize,
    column: usize,
    match_length: usize,
    snippet: String,
}

struct SearchScan<'a> {
    limits: ShareLimits,
    matcher: &'a ContentMatcher,
    file_filter: Option<&'a Regex>,
    selected_roots: HashSet<PathBuf>,
    cancelled: &'a dyn Fn() -> bool,
    response: SearchResponse,
    matches: Vec<RawSearchMatch>,
    entries: usize,
    files: usize,
    bytes: usize,
    result_limit_reached: bool,
}

impl<'a> SearchScan<'a> {
    fn new(
        limits: ShareLimits,
        matcher: &'a ContentMatcher,
        file_filter: Option<&'a Regex>,
        selected_roots: HashSet<PathBuf>,
        cancelled: &'a dyn Fn() -> bool,
    ) -> Self {
        Self {
            limits,
            matcher,
            file_filter,
            selected_roots,
            cancelled,
            response: SearchResponse::default(),
            matches: Vec::new(),
            entries: 0,
            files: 0,
            bytes: 0,
            result_limit_reached: false,
        }
    }

    fn exhausted(&self) -> bool {
        (self.cancelled)()
            || self.entries >= self.limits.max_tree_entries
            || self.files >= self.limits.max_search_files
            || self.bytes >= self.limits.max_search_total_bytes
            || self.result_limit_reached
    }

    fn directory(
        &mut self,
        workspace_id: &WorkspaceId,
        root_path: &Path,
        directory: &Dir,
        relative_directory: &Path,
        depth: usize,
    ) {
        if (self.cancelled)() {
            return;
        }
        if depth > self.limits.max_tree_depth {
            self.response.truncated = true;
            return;
        }
        let Ok(raw_entries) = directory.entries() else {
            self.response.truncated = true;
            return;
        };
        let mut entries = Vec::new();
        for entry in raw_entries {
            if (self.cancelled)() {
                return;
            }
            match entry {
                Ok(entry) => entries.push(entry),
                Err(_) => self.response.truncated = true,
            }
        }
        entries.sort_by_key(|entry| entry.file_name());
        for entry in entries {
            if (self.cancelled)() {
                return;
            }
            if self.exhausted() {
                self.response.truncated = true;
                break;
            }
            self.entries += 1;
            let name = entry.file_name();
            if is_hidden_name(Some(&name)) {
                continue;
            }
            let Ok(file_type) = entry.file_type() else {
                self.response.truncated = true;
                continue;
            };
            if file_type.is_symlink() {
                continue;
            }
            let relative_path = relative_directory.join(&name);
            if file_type.is_dir() {
                let display_name = name.to_string_lossy();
                let logical_path = root_path.join(&relative_path);
                if !is_ignored_workspace_directory(&display_name)
                    && !self.selected_roots.contains(&logical_path)
                {
                    match open_directory_nofollow(directory, &name) {
                        Ok(child) => self.directory(
                            workspace_id,
                            root_path,
                            &child,
                            &relative_path,
                            depth + 1,
                        ),
                        Err(_) => self.response.truncated = true,
                    }
                }
            } else if file_type.is_file() && is_markdown_path(&relative_path) {
                let display = relative_display_path(&relative_path);
                if self
                    .file_filter
                    .is_none_or(|filter| filter.is_match(&display))
                {
                    self.file(workspace_id, directory, &name, relative_path);
                }
            }
        }
    }

    fn file(
        &mut self,
        workspace_id: &WorkspaceId,
        directory: &Dir,
        file_name: &OsStr,
        relative_path: PathBuf,
    ) {
        if (self.cancelled)() {
            return;
        }
        self.files += 1;
        if validate_scoped_relative_path(&relative_path).is_err()
            || !is_markdown_path(&relative_path)
        {
            self.response.skipped_files += 1;
            return;
        }
        let remaining = self
            .limits
            .max_search_total_bytes
            .saturating_sub(self.bytes);
        if remaining == 0 {
            self.response.truncated = true;
            return;
        }
        let file_limit = self.limits.max_document_bytes.min(remaining);
        let file = match open_regular_child(directory, file_name) {
            Ok(file) => file,
            Err(_) => {
                self.response.skipped_files += 1;
                return;
            }
        };
        let bytes =
            match read_bounded_cancellable(file, file_limit, "documentTooLarge", self.cancelled) {
                Ok(bytes) => bytes,
                Err(error) => {
                    if error.code == "requestCancelled" {
                        return;
                    }
                    self.response.skipped_files += 1;
                    if error.code == "documentTooLarge"
                        && remaining < self.limits.max_document_bytes
                    {
                        self.response.truncated = true;
                    }
                    return;
                }
            };
        self.bytes += bytes.len();
        let Ok(content) = validate_markdown_bytes(bytes) else {
            self.response.skipped_files += 1;
            return;
        };
        self.response.searched_files += 1;
        for (line_index, line) in content.lines().enumerate() {
            if (self.cancelled)() {
                return;
            }
            let Some(span) = self.matcher.first_non_empty(line) else {
                continue;
            };
            if self.matches.len() >= self.limits.max_search_matches {
                self.response.truncated = true;
                self.result_limit_reached = true;
                return;
            }
            self.matches.push(RawSearchMatch {
                workspace_id: workspace_id.clone(),
                relative_path: relative_path.clone(),
                line: line_index + 1,
                column: line[..span.start].encode_utf16().count() + 1,
                match_length: line[span.start..span.end].encode_utf16().count(),
                snippet: make_snippet(line, span.start),
            });
        }
    }
}

#[derive(Clone, Copy)]
struct MatchSpan {
    start: usize,
    end: usize,
}

enum ContentMatcher {
    Literal {
        needle: String,
        case_sensitive: bool,
    },
    Regex(Regex),
}

impl ContentMatcher {
    fn compile(query: &str, case_sensitive: bool, use_regex: bool) -> ShareResult<Self> {
        if !use_regex {
            return Ok(Self::Literal {
                needle: if case_sensitive {
                    query.to_owned()
                } else {
                    lowercase_literal(query)
                },
                case_sensitive,
            });
        }
        RegexBuilder::new(query)
            .case_insensitive(!case_sensitive)
            .build()
            .map(Self::Regex)
            .map_err(|error| ShareError::new("invalidSearchPattern", error.to_string()))
    }

    fn first_non_empty(&self, line: &str) -> Option<MatchSpan> {
        match self {
            Self::Literal {
                needle,
                case_sensitive,
            } => literal_match_span(line, needle, *case_sensitive),
            Self::Regex(regex) => regex.find_iter(line).find_map(|found| {
                (!found.is_empty()).then_some(MatchSpan {
                    start: found.start(),
                    end: found.end(),
                })
            }),
        }
    }
}

fn validate_search_request(request: &SearchRequest, limits: ShareLimits) -> ShareResult<()> {
    if request.query.chars().count() > limits.max_search_query_chars
        || request.query.contains(['\0', '\n', '\r'])
    {
        return Err(ShareError::new(
            "invalidSearchQuery",
            "search query is invalid or exceeds its limit",
        ));
    }
    Ok(())
}

fn compile_file_filter(value: Option<&str>, limits: ShareLimits) -> ShareResult<Option<Regex>> {
    let Some(pattern) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    if pattern.chars().count() > limits.max_file_filter_chars {
        return Err(ShareError::new(
            "invalidFileFilter",
            "file filter exceeds its limit",
        ));
    }
    RegexBuilder::new(pattern)
        .case_insensitive(true)
        .build()
        .map(Some)
        .map_err(|error| ShareError::new("invalidFileFilter", error.to_string()))
}

fn lowercase_literal(value: &str) -> String {
    value.chars().flat_map(char::to_lowercase).collect()
}

fn literal_match_span(line: &str, needle: &str, case_sensitive: bool) -> Option<MatchSpan> {
    if case_sensitive {
        let start = line.find(needle)?;
        return Some(MatchSpan {
            start,
            end: start + needle.len(),
        });
    }
    let folded = lowercase_literal(line);
    let folded_start = folded.find(needle)?;
    let folded_end = folded_start + needle.len();
    let mut folded_cursor = 0;
    let mut original_start = None;
    for (offset, character) in line.char_indices() {
        let next = folded_cursor + character.to_lowercase().map(char::len_utf8).sum::<usize>();
        if original_start.is_none() && next > folded_start {
            original_start = Some(offset);
        }
        if next >= folded_end {
            return Some(MatchSpan {
                start: original_start?,
                end: offset + character.len_utf8(),
            });
        }
        folded_cursor = next;
    }
    None
}

fn make_snippet(line: &str, offset: usize) -> String {
    let chars_before_match = line[..offset].chars().count();
    let start = chars_before_match.saturating_sub(60);
    let mut chars = line.chars().skip(start);
    let text: String = chars.by_ref().take(SNIPPET_CHARS).collect();
    format!(
        "{}{}{}",
        if start > 0 { "…" } else { "" },
        text,
        if chars.next().is_some() { "…" } else { "" }
    )
}

fn is_hidden_name(name: Option<&OsStr>) -> bool {
    name.is_some_and(|name| name.to_string_lossy().starts_with('.'))
}

fn is_ignored_workspace_directory(name: &str) -> bool {
    matches!(
        name,
        ".git"
            | ".hg"
            | ".svn"
            | "node_modules"
            | ".venv"
            | "venv"
            | "target"
            | "dist"
            | "build"
            | "__pycache__"
    )
}

fn is_markdown_path(path: &Path) -> bool {
    path.extension()
        .and_then(OsStr::to_str)
        .is_some_and(|extension| {
            extension.eq_ignore_ascii_case("md") || extension.eq_ignore_ascii_case("markdown")
        })
}

fn asset_media_type(path: &Path) -> Option<&'static str> {
    Some(
        match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
            "png" => "image/png",
            "jpg" | "jpeg" => "image/jpeg",
            "gif" => "image/gif",
            "webp" => "image/webp",
            "bmp" => "image/bmp",
            "ico" => "image/x-icon",
            // SVG is intentionally excluded because an image document can contain
            // active content when embedded with an unsafe browser policy.
            _ => return None,
        },
    )
}

fn relative_display_path(path: &Path) -> String {
    path.components()
        .map(|component| component.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lan_share::model::EntropyError;
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT_FIXTURE: AtomicU64 = AtomicU64::new(1);

    struct CounterEntropy(u8);

    impl EntropySource for CounterEntropy {
        fn fill_bytes(&mut self, output: &mut [u8]) -> Result<(), EntropyError> {
            for byte in output {
                *byte = self.0;
                self.0 = self.0.wrapping_add(1);
            }
            Ok(())
        }
    }

    struct Fixture(PathBuf);

    impl Fixture {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "notespace-lan-share-test-{}-{}",
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

        fn registry(&self) -> (LanShareRegistry, SharedWorkspace, CounterEntropy) {
            let mut registry = LanShareRegistry::default();
            let mut entropy = CounterEntropy(1);
            let workspace = registry
                .share_workspace(&self.0, Some("Test workspace"), &mut entropy)
                .unwrap();
            (registry, workspace, entropy)
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.0).unwrap();
        }
    }

    fn maybe_find_document(nodes: &[TreeNode], name: &str) -> Option<DocumentId> {
        for node in nodes {
            if node.name == name {
                return node.document_id.clone();
            }
            if let Some(found) = maybe_find_document(&node.children, name) {
                return Some(found);
            }
        }
        None
    }

    fn find_document(nodes: &[TreeNode], name: &str) -> DocumentId {
        maybe_find_document(nodes, name).unwrap_or_else(|| panic!("document not found: {name}"))
    }

    #[test]
    fn only_explicit_roots_are_visible_and_ids_do_not_leak_paths() {
        let fixture = Fixture::new();
        fixture.write("guide.md", "# Guide");
        let (mut registry, workspace, mut entropy) = fixture.registry();
        let tree = registry
            .workspace_tree(&workspace.id, &mut entropy)
            .unwrap();
        let document = registry
            .read_markdown(&tree.nodes[0].document_id.clone().unwrap())
            .unwrap();
        let serialized = serde_json::to_string(&(tree, document)).unwrap();
        assert!(!serialized.contains(&fixture.0.to_string_lossy().to_string()));
        assert!(serialized.contains("guide.md"));

        let unknown = WorkspaceId::from_generated("ws_unknown".to_owned());
        assert_eq!(
            registry
                .workspace_tree(&unknown, &mut entropy)
                .unwrap_err()
                .code,
            "unknownWorkspace"
        );
    }

    #[test]
    fn workspace_sync_key_is_stable_without_exposing_the_root_path() {
        let fixture = Fixture::new();
        let mut first_registry = LanShareRegistry::default();
        let mut first_entropy = CounterEntropy(1);
        let first = first_registry
            .share_workspace(&fixture.0, Some("First label"), &mut first_entropy)
            .unwrap();
        let mut second_registry = LanShareRegistry::default();
        let mut second_entropy = CounterEntropy(99);
        let second = second_registry
            .share_workspace(&fixture.0, Some("Second label"), &mut second_entropy)
            .unwrap();

        assert_ne!(first.id, second.id);
        assert_eq!(first.sync_key, second.sync_key);
        assert!(first.sync_key.starts_with("workspace_"));
        assert_eq!(first.sync_key.len(), "workspace_".len() + 32);
        let serialized = serde_json::to_string(&first).unwrap();
        assert!(!serialized.contains(&fixture.0.to_string_lossy().to_string()));
    }

    #[test]
    fn layered_directory_pages_use_stable_opaque_ids() {
        let fixture = Fixture::new();
        fixture.write("guide.md", "# Guide");
        fixture.write("docs/inside.markdown", "# Inside");
        fixture.write("docs/ignore.txt", "not shared");
        fixture.write(".hidden/secret.md", "secret");
        let (mut registry, workspace, mut entropy) = fixture.registry();

        let root = registry
            .list_directory(&workspace.id, None, &mut entropy)
            .unwrap();
        assert_eq!(root.directory_id, None);
        assert_eq!(root.name, "Test workspace");
        assert_eq!(root.breadcrumbs.len(), 1);
        assert_eq!(root.entries.len(), 2);
        assert_eq!(root.entries[0].kind, DirectoryEntryKind::Directory);
        assert_eq!(root.entries[0].name, "docs");
        assert!(root.entries[0].id.starts_with("dir_"));
        assert_eq!(root.entries[1].kind, DirectoryEntryKind::Document);
        assert_eq!(root.entries[1].name, "guide.md");
        assert!(root.entries[1].id.starts_with("doc_"));

        let directory_id = DirectoryId::from_generated(root.entries[0].id.clone());
        let child = registry
            .list_directory(&workspace.id, Some(&directory_id), &mut entropy)
            .unwrap();
        assert_eq!(child.directory_id, Some(directory_id.clone()));
        assert_eq!(child.breadcrumbs.len(), 2);
        assert_eq!(child.breadcrumbs[1].id, Some(directory_id.clone()));
        assert_eq!(child.entries.len(), 1);
        assert_eq!(child.entries[0].name, "inside.markdown");
        assert_eq!(
            registry
                .list_directory(&workspace.id, None, &mut entropy)
                .unwrap()
                .entries[0]
                .id,
            directory_id.as_str()
        );

        let other_workspace = WorkspaceId::from_generated("ws_other".to_owned());
        assert_eq!(
            registry
                .list_directory(&other_workspace, Some(&directory_id), &mut entropy)
                .unwrap_err()
                .code,
            "unknownDirectory"
        );
        assert!(registry.unshare_workspace(&workspace.id));
        assert_eq!(
            registry
                .list_directory(&workspace.id, Some(&directory_id), &mut entropy)
                .unwrap_err()
                .code,
            "unknownDirectory"
        );
    }

    #[test]
    fn tree_is_sorted_bounded_and_excludes_hidden_heavy_and_non_markdown_files() {
        let fixture = Fixture::new();
        fixture.write("z.md", "z");
        fixture.write("A.markdown", "a");
        fixture.write("note.txt", "not mobile content");
        fixture.write(".hidden.md", "hidden");
        fixture.write(".drafts/note.md", "hidden");
        fixture.write("node_modules/package.md", "heavy");
        fixture.write("docs/inside.md", "inside");
        let (mut registry, workspace, mut entropy) = fixture.registry();
        let tree = registry
            .workspace_tree(&workspace.id, &mut entropy)
            .unwrap();
        assert_eq!(tree.nodes.len(), 3);
        assert_eq!(tree.nodes[0].name, "docs");
        assert_eq!(tree.nodes[1].name, "A.markdown");
        assert_eq!(tree.nodes[2].name, "z.md");
        assert_eq!(tree.nodes[0].children[0].relative_path, "docs/inside.md");
        assert!(tree.nodes.iter().all(|node| node.name != "note.txt"));

        let mut limited = LanShareRegistry::new(ShareLimits {
            max_tree_entries: 1,
            ..ShareLimits::default()
        });
        let root = limited
            .share_workspace(&fixture.0, None, &mut entropy)
            .unwrap();
        let limited_tree = limited.workspace_tree(&root.id, &mut entropy).unwrap();
        assert!(limited_tree.truncated);
        assert_eq!(limited_tree.scanned_entries, 1);
    }

    #[test]
    fn document_ids_are_stable_and_unsharing_invalidates_them() {
        let fixture = Fixture::new();
        fixture.write("guide.md", "# 中文\n");
        let (mut registry, workspace, mut entropy) = fixture.registry();
        let first = registry
            .workspace_tree(&workspace.id, &mut entropy)
            .unwrap();
        let second = registry
            .workspace_tree(&workspace.id, &mut entropy)
            .unwrap();
        let first_id = first.nodes[0].document_id.clone().unwrap();
        assert_eq!(first_id, second.nodes[0].document_id.clone().unwrap());
        let document = registry.read_markdown(&first_id).unwrap();
        assert_eq!(document.content, "# 中文\n");
        assert_eq!(document.relative_path, "guide.md");
        assert!(registry.unshare_workspace(&workspace.id));
        assert_eq!(
            registry.read_markdown(&first_id).unwrap_err().code,
            "unknownDocument"
        );
    }

    #[test]
    fn document_reads_reject_invalid_utf8_and_size_limits() {
        let fixture = Fixture::new();
        fixture.write("invalid.md", [0xff, 0xfe]);
        fixture.write("large.md", b"12345");
        let mut registry = LanShareRegistry::new(ShareLimits {
            max_document_bytes: 4,
            ..ShareLimits::default()
        });
        let mut entropy = CounterEntropy(1);
        let workspace = registry
            .share_workspace(&fixture.0, None, &mut entropy)
            .unwrap();
        let tree = registry
            .workspace_tree(&workspace.id, &mut entropy)
            .unwrap();
        assert_eq!(
            registry
                .read_markdown(&find_document(&tree.nodes, "invalid.md"))
                .unwrap_err()
                .code,
            "invalidUtf8"
        );
        assert_eq!(
            registry
                .read_markdown(&find_document(&tree.nodes, "large.md"))
                .unwrap_err()
                .code,
            "documentTooLarge"
        );
    }

    #[test]
    fn asset_resolution_allows_parent_paths_inside_root_but_rejects_unsafe_targets() {
        let fixture = Fixture::new();
        fixture.write("docs/guide.md", "![image](../images/pic%20one.png)");
        fixture.write("images/pic one.png", b"png bytes");
        fixture.write("images/vector.svg", b"<svg/>");
        fixture.write(".private/secret.png", b"secret");
        let (mut registry, workspace, mut entropy) = fixture.registry();
        let tree = registry
            .workspace_tree(&workspace.id, &mut entropy)
            .unwrap();
        let document_id = find_document(&tree.nodes, "guide.md");
        let asset_id = registry
            .resolve_asset(&document_id, "../images/pic%20one.png", &mut entropy)
            .unwrap();
        let asset = registry.read_asset(&asset_id).unwrap();
        assert_eq!(asset.media_type, "image/png");
        assert_eq!(asset.bytes, b"png bytes");
        assert_eq!(
            registry
                .resolve_asset(&document_id, "../../outside.png", &mut entropy)
                .unwrap_err()
                .code,
            "pathOutsideWorkspace"
        );
        for reference in [
            "https://example.test/image.png",
            "file:///tmp/image.png",
            "../.private/secret.png",
            "../images/vector.svg",
        ] {
            assert!(registry
                .resolve_asset(&document_id, reference, &mut entropy)
                .is_err());
        }
    }

    #[test]
    fn search_returns_opaque_document_ids_and_utf16_positions() {
        let fixture = Fixture::new();
        fixture.write("docs/a.md", "nothing\n😀 仓库 Alpha42\n");
        fixture.write("docs/b.markdown", "alpha-7\n");
        fixture.write("docs/not.txt", "Alpha99\n");
        fixture.write(".hidden.md", "Alpha00\n");
        let (mut registry, workspace, mut entropy) = fixture.registry();
        let result = registry
            .search(
                SearchRequest {
                    workspace_ids: vec![workspace.id.clone()],
                    query: r"alpha(?:\d+|-\d+)".to_owned(),
                    case_sensitive: false,
                    use_regex: true,
                    file_filter: Some(r"^docs/.*\.(md|markdown)$".to_owned()),
                },
                &mut entropy,
            )
            .unwrap();
        assert_eq!(result.matches.len(), 2);
        assert_eq!(result.matches[0].column, 7);
        assert_eq!(result.matches[0].match_length, 7);
        assert_eq!(result.searched_files, 2);
        let opened = registry
            .read_markdown(&result.matches[0].document_id)
            .unwrap();
        assert_eq!(opened.relative_path, "docs/a.md");
        let serialized = serde_json::to_string(&result).unwrap();
        assert!(!serialized.contains(&fixture.0.to_string_lossy().to_string()));
    }

    #[test]
    fn search_honors_result_and_byte_budgets_and_validates_patterns() {
        let fixture = Fixture::new();
        fixture.write("a.md", "match\nmatch\nmatch\n");
        fixture.write("b.md", "match\n");
        let mut registry = LanShareRegistry::new(ShareLimits {
            max_search_matches: 1,
            max_search_total_bytes: 32,
            ..ShareLimits::default()
        });
        let mut entropy = CounterEntropy(1);
        registry
            .share_workspace(&fixture.0, None, &mut entropy)
            .unwrap();
        let result = registry
            .search(
                SearchRequest {
                    workspace_ids: Vec::new(),
                    query: "match".to_owned(),
                    case_sensitive: false,
                    use_regex: false,
                    file_filter: None,
                },
                &mut entropy,
            )
            .unwrap();
        assert_eq!(result.matches.len(), 1);
        assert!(result.truncated);

        let invalid = registry
            .search(
                SearchRequest {
                    workspace_ids: Vec::new(),
                    query: "[".to_owned(),
                    case_sensitive: false,
                    use_regex: true,
                    file_filter: None,
                },
                &mut entropy,
            )
            .unwrap_err();
        assert_eq!(invalid.code, "invalidSearchPattern");
    }

    #[cfg(unix)]
    #[test]
    fn symlink_roots_entries_and_replacements_are_rejected() {
        use std::os::unix::fs::symlink;

        let fixture = Fixture::new();
        fixture.write("real.md", "real");
        let linked_root = fixture.0.parent().unwrap().join(format!(
            "notespace-lan-share-link-{}-{}",
            std::process::id(),
            NEXT_FIXTURE.fetch_add(1, Ordering::Relaxed)
        ));
        symlink(&fixture.0, &linked_root).unwrap();
        let mut entropy = CounterEntropy(1);
        let mut registry = LanShareRegistry::default();
        assert_eq!(
            registry
                .share_workspace(&linked_root, None, &mut entropy)
                .unwrap_err()
                .code,
            "symbolicLink"
        );
        fs::remove_file(&linked_root).unwrap();

        let workspace = registry
            .share_workspace(&fixture.0, None, &mut entropy)
            .unwrap();
        symlink(fixture.0.join("real.md"), fixture.0.join("linked.md")).unwrap();
        let tree = registry
            .workspace_tree(&workspace.id, &mut entropy)
            .unwrap();
        assert!(tree.nodes.iter().all(|node| node.name != "linked.md"));
        let id = find_document(&tree.nodes, "real.md");
        fs::remove_file(fixture.0.join("real.md")).unwrap();
        fixture.write("target.md", "target");
        symlink(fixture.0.join("target.md"), fixture.0.join("real.md")).unwrap();
        assert_eq!(
            registry.read_markdown(&id).unwrap_err().code,
            "symbolicLink"
        );
    }

    #[cfg(unix)]
    #[test]
    fn opened_root_handle_does_not_follow_a_replaced_workspace_path() {
        use std::os::unix::fs::symlink;

        let fixture = Fixture::new();
        let replacement = Fixture::new();
        fixture.write("original.md", "original");
        replacement.write("outside.md", "outside");
        let (mut registry, workspace, mut entropy) = fixture.registry();
        let moved_root = fixture.0.with_file_name(format!(
            "notespace-lan-share-moved-{}-{}",
            std::process::id(),
            NEXT_FIXTURE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::rename(&fixture.0, &moved_root).unwrap();
        symlink(&replacement.0, &fixture.0).unwrap();

        let tree = registry
            .workspace_tree(&workspace.id, &mut entropy)
            .unwrap();
        assert!(maybe_find_document(&tree.nodes, "original.md").is_some());
        assert!(maybe_find_document(&tree.nodes, "outside.md").is_none());

        fs::remove_file(&fixture.0).unwrap();
        fs::rename(moved_root, &fixture.0).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn raced_symlink_replacements_never_read_outside_the_open_root() {
        use std::os::unix::fs::symlink;
        use std::thread;

        let fixture = Fixture::new();
        let outside = Fixture::new();
        fixture.write("race.md", "safe");
        outside.write("secret.md", "outside-secret");
        let (mut registry, workspace, mut entropy) = fixture.registry();
        let tree = registry
            .workspace_tree(&workspace.id, &mut entropy)
            .unwrap();
        let document_id = find_document(&tree.nodes, "race.md");
        let root = fixture.0.clone();
        let outside_secret = outside.0.join("secret.md");
        let attacker = thread::spawn(move || {
            let published = root.join("race.md");
            for index in 0..2_000 {
                let candidate = root.join(format!(".candidate-{index}"));
                if index % 2 == 0 {
                    symlink(&outside_secret, &candidate).unwrap();
                } else {
                    fs::write(&candidate, "safe").unwrap();
                }
                fs::rename(candidate, &published).unwrap();
            }
        });

        for _ in 0..2_000 {
            if let Ok(document) = registry.read_markdown(&document_id) {
                assert_eq!(document.content, "safe");
            }
        }
        attacker.join().unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn raced_in_fifo_is_rejected_without_becoming_a_read_source() {
        use std::process::Command;

        let fixture = Fixture::new();
        fixture.write("pipe.md", "initial");
        let (mut registry, workspace, mut entropy) = fixture.registry();
        let tree = registry
            .workspace_tree(&workspace.id, &mut entropy)
            .unwrap();
        let document_id = find_document(&tree.nodes, "pipe.md");
        let path = fixture.0.join("pipe.md");
        fs::remove_file(&path).unwrap();
        assert!(Command::new("mkfifo")
            .arg(&path)
            .status()
            .unwrap()
            .success());

        assert_eq!(
            registry.read_markdown(&document_id).unwrap_err().code,
            "resourceUnavailable"
        );
    }
}
