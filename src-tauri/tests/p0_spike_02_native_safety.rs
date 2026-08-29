//! P0-SPIKE-02 disposable Native/Safety feasibility harness.
//!
//! This deliberately lives in the integration-test tree. It validates the
//! accepted policy without exposing a product command or freezing a Phase 1
//! implementation prematurely.

use std::env;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{self, Command};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const KIB: u64 = 1024;
const MIB: u64 = 1024 * KIB;
const SCAN_BUFFER_BYTES: usize = 64 * 1024;
const JSON_ESCAPE_BUFFER_BYTES: usize = SCAN_BUFFER_BYTES * 6;
const SCRATCH_PREFIX: &str = "markdown-workspace-p0-spike-02-";
const CRASH_EXIT_CODE: i32 = 86;

static SCRATCH_SEQUENCE: AtomicU64 = AtomicU64::new(0);
static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Copy, Debug)]
struct SpikePolicy {
    normal_file_bytes: u64,
    max_editable_file_bytes: u64,
    max_normal_line_bytes: u64,
    safety_block_line_bytes: u64,
    safety_block_data_image_decoded_bytes: u64,
    read_buffer_bytes: usize,
}

impl Default for SpikePolicy {
    fn default() -> Self {
        Self {
            normal_file_bytes: 8 * MIB,
            max_editable_file_bytes: 32 * MIB,
            max_normal_line_bytes: 256 * KIB,
            safety_block_line_bytes: MIB,
            safety_block_data_image_decoded_bytes: 512 * KIB,
            read_buffer_bytes: SCAN_BUFFER_BYTES,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum EditableMode {
    Normal,
    LargeText,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum SafetyReason {
    LineTooLong,
    LargeDataImage,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum UnsupportedReason {
    Binary,
    FileTooLarge,
    InvalidUtf8,
}

#[derive(Debug, PartialEq, Eq)]
enum SpikeOutcome {
    Editable(EditableMode),
    SafetyBlocked(Vec<SafetyReason>),
    Unsupported(Vec<UnsupportedReason>),
}

#[derive(Debug)]
struct SpikePreflightReport {
    size_bytes: u64,
    max_line_bytes: u64,
    line_count_estimate: u64,
    has_utf8_bom: bool,
    detected_data_image_count: u64,
    largest_data_image_estimate_bytes: Option<u64>,
    retained_bytes_upper_bound: usize,
}

#[derive(Debug)]
struct SpikeScanResult {
    report: SpikePreflightReport,
    outcome: SpikeOutcome,
}

#[derive(Debug)]
enum SpikeScanError {
    Cancelled { bytes_read: u64 },
    Io(io::ErrorKind),
}

impl From<io::Error> for SpikeScanError {
    fn from(error: io::Error) -> Self {
        Self::Io(error.kind())
    }
}

#[derive(Clone, Copy, Debug)]
enum DataImageStage {
    Seeking(usize),
    Header {
        suffix_matched: usize,
        header_bytes: usize,
    },
    Payload {
        encoded_chars: u64,
        padding_chars: u8,
    },
}

#[derive(Debug)]
struct DataImageDetector {
    stage: DataImageStage,
    detected_count: u64,
    largest_decoded_estimate: Option<u64>,
}

impl DataImageDetector {
    const PREFIX: &'static [u8] = b"data:image/";
    const BASE64_SUFFIX: &'static [u8] = b";base64,";
    const MAX_HEADER_BYTES: usize = 128;

    fn new() -> Self {
        Self {
            stage: DataImageStage::Seeking(0),
            detected_count: 0,
            largest_decoded_estimate: None,
        }
    }

    fn feed(&mut self, byte: u8) {
        self.stage = match self.stage {
            DataImageStage::Seeking(matched) => {
                let next = advance_ascii_case_insensitive(Self::PREFIX, matched, byte);
                if next == Self::PREFIX.len() {
                    DataImageStage::Header {
                        suffix_matched: 0,
                        header_bytes: 0,
                    }
                } else {
                    DataImageStage::Seeking(next)
                }
            }
            DataImageStage::Header {
                suffix_matched,
                header_bytes,
            } => {
                if matches!(byte, b'\n' | b'\r' | b')' | b'>' | b'\'' | b'"')
                    || header_bytes >= Self::MAX_HEADER_BYTES
                {
                    seeking_stage_for(byte)
                } else {
                    let next =
                        advance_ascii_case_insensitive(Self::BASE64_SUFFIX, suffix_matched, byte);
                    if next == Self::BASE64_SUFFIX.len() {
                        DataImageStage::Payload {
                            encoded_chars: 0,
                            padding_chars: 0,
                        }
                    } else {
                        DataImageStage::Header {
                            suffix_matched: next,
                            header_bytes: header_bytes + 1,
                        }
                    }
                }
            }
            DataImageStage::Payload {
                encoded_chars,
                padding_chars,
            } => {
                if is_base64_alphabet(byte) {
                    DataImageStage::Payload {
                        encoded_chars: encoded_chars + 1,
                        padding_chars,
                    }
                } else if byte == b'=' && padding_chars < 2 {
                    DataImageStage::Payload {
                        encoded_chars: encoded_chars + 1,
                        padding_chars: padding_chars + 1,
                    }
                } else {
                    self.record_payload(encoded_chars, padding_chars);
                    seeking_stage_for(byte)
                }
            }
        };
    }

    fn finish(&mut self) {
        if let DataImageStage::Payload {
            encoded_chars,
            padding_chars,
        } = self.stage
        {
            self.record_payload(encoded_chars, padding_chars);
            self.stage = DataImageStage::Seeking(0);
        }
    }

    fn record_payload(&mut self, encoded_chars: u64, padding_chars: u8) {
        self.detected_count += 1;
        let complete_quads = encoded_chars / 4;
        let remainder = encoded_chars % 4;
        let mut decoded = complete_quads.saturating_mul(3);
        decoded = decoded.saturating_sub(u64::from(padding_chars.min(2)));
        decoded = decoded.saturating_add(match remainder {
            2 => 1,
            3 => 2,
            _ => 0,
        });
        self.largest_decoded_estimate = Some(
            self.largest_decoded_estimate
                .map_or(decoded, |current| current.max(decoded)),
        );
    }
}

fn advance_ascii_case_insensitive(pattern: &[u8], matched: usize, byte: u8) -> usize {
    if pattern
        .get(matched)
        .is_some_and(|expected| expected.eq_ignore_ascii_case(&byte))
    {
        matched + 1
    } else if pattern[0].eq_ignore_ascii_case(&byte) {
        1
    } else {
        0
    }
}

fn seeking_stage_for(byte: u8) -> DataImageStage {
    DataImageStage::Seeking(
        if DataImageDetector::PREFIX[0].eq_ignore_ascii_case(&byte) {
            1
        } else {
            0
        },
    )
}

fn is_base64_alphabet(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'/')
}

#[derive(Debug)]
struct StreamingUtf8Validator {
    continuation_bytes_remaining: u8,
    next_byte_min: u8,
    next_byte_max: u8,
    valid: bool,
}

impl StreamingUtf8Validator {
    fn new() -> Self {
        Self {
            continuation_bytes_remaining: 0,
            next_byte_min: 0x80,
            next_byte_max: 0xbf,
            valid: true,
        }
    }

    fn feed(&mut self, byte: u8) {
        if !self.valid {
            return;
        }

        if self.continuation_bytes_remaining > 0 {
            if !(self.next_byte_min..=self.next_byte_max).contains(&byte) {
                self.valid = false;
                return;
            }
            self.continuation_bytes_remaining -= 1;
            self.next_byte_min = 0x80;
            self.next_byte_max = 0xbf;
            return;
        }

        match byte {
            0x00..=0x7f => {}
            0xc2..=0xdf => self.expect_continuations(1, 0x80, 0xbf),
            0xe0 => self.expect_continuations(2, 0xa0, 0xbf),
            0xe1..=0xec | 0xee..=0xef => self.expect_continuations(2, 0x80, 0xbf),
            0xed => self.expect_continuations(2, 0x80, 0x9f),
            0xf0 => self.expect_continuations(3, 0x90, 0xbf),
            0xf1..=0xf3 => self.expect_continuations(3, 0x80, 0xbf),
            0xf4 => self.expect_continuations(3, 0x80, 0x8f),
            _ => self.valid = false,
        }
    }

    fn expect_continuations(&mut self, count: u8, first_min: u8, first_max: u8) {
        self.continuation_bytes_remaining = count;
        self.next_byte_min = first_min;
        self.next_byte_max = first_max;
    }

    fn is_complete_and_valid(&self) -> bool {
        self.valid && self.continuation_bytes_remaining == 0
    }
}

fn scan_reader<R: Read>(
    mut reader: R,
    policy: SpikePolicy,
    cancelled: &AtomicBool,
) -> Result<SpikeScanResult, SpikeScanError> {
    assert!(policy.read_buffer_bytes > 0);

    let mut read_buffer = vec![0_u8; policy.read_buffer_bytes];
    let mut total_bytes = 0_u64;
    let mut current_line_bytes = 0_u64;
    let mut max_line_bytes = 0_u64;
    let mut newline_count = 0_u64;
    let mut last_byte_was_newline = false;
    let mut utf8 = StreamingUtf8Validator::new();
    let mut data_images = DataImageDetector::new();
    let mut first_bytes = [0_u8; 3];
    let mut first_bytes_len = 0_usize;
    let mut saw_nul = false;
    let mut binary_sampled = 0_u64;
    let mut binary_controls = 0_u64;
    let mut exceeded_file_limit = false;

    loop {
        if cancelled.load(Ordering::Relaxed) {
            return Err(SpikeScanError::Cancelled {
                bytes_read: total_bytes,
            });
        }

        let read = reader.read(&mut read_buffer)?;
        if read == 0 {
            break;
        }

        let observed_after_read = total_bytes + read as u64;
        if cancelled.load(Ordering::Relaxed) {
            return Err(SpikeScanError::Cancelled {
                bytes_read: observed_after_read,
            });
        }

        for (index, &byte) in read_buffer[..read].iter().enumerate() {
            if index % 4096 == 0 && cancelled.load(Ordering::Relaxed) {
                return Err(SpikeScanError::Cancelled {
                    bytes_read: total_bytes + index as u64,
                });
            }

            if first_bytes_len < first_bytes.len() {
                first_bytes[first_bytes_len] = byte;
                first_bytes_len += 1;
            }

            if binary_sampled < 8 * KIB {
                binary_sampled += 1;
                if matches!(byte, 0x01..=0x08 | 0x0b | 0x0c | 0x0e..=0x1f | 0x7f) {
                    binary_controls += 1;
                }
            }
            saw_nul |= byte == 0;
            utf8.feed(byte);
            data_images.feed(byte);

            if byte == b'\n' {
                max_line_bytes = max_line_bytes.max(current_line_bytes);
                current_line_bytes = 0;
                newline_count += 1;
                last_byte_was_newline = true;
            } else {
                current_line_bytes += 1;
                max_line_bytes = max_line_bytes.max(current_line_bytes);
                last_byte_was_newline = false;
            }
        }

        total_bytes = observed_after_read;
        if total_bytes > policy.max_editable_file_bytes {
            exceeded_file_limit = true;
            break;
        }
    }

    data_images.finish();
    let line_count_estimate = if total_bytes == 0 {
        0
    } else if last_byte_was_newline {
        newline_count
    } else {
        newline_count + 1
    };
    let has_utf8_bom = first_bytes_len >= 3 && first_bytes == [0xef, 0xbb, 0xbf];
    let looks_binary = saw_nul
        || (binary_sampled >= 64 && binary_controls.saturating_mul(100) >= binary_sampled * 30);

    let mut unsupported_reasons = Vec::new();
    if looks_binary {
        unsupported_reasons.push(UnsupportedReason::Binary);
    }
    if exceeded_file_limit || total_bytes > policy.max_editable_file_bytes {
        unsupported_reasons.push(UnsupportedReason::FileTooLarge);
    }
    if !utf8.is_complete_and_valid() {
        unsupported_reasons.push(UnsupportedReason::InvalidUtf8);
    }

    let outcome = if !unsupported_reasons.is_empty() {
        SpikeOutcome::Unsupported(unsupported_reasons)
    } else {
        let mut safety_reasons = Vec::new();
        if max_line_bytes > policy.safety_block_line_bytes {
            safety_reasons.push(SafetyReason::LineTooLong);
        }
        if data_images
            .largest_decoded_estimate
            .is_some_and(|bytes| bytes > policy.safety_block_data_image_decoded_bytes)
        {
            safety_reasons.push(SafetyReason::LargeDataImage);
        }

        if !safety_reasons.is_empty() {
            SpikeOutcome::SafetyBlocked(safety_reasons)
        } else if total_bytes <= policy.normal_file_bytes
            && max_line_bytes <= policy.max_normal_line_bytes
        {
            SpikeOutcome::Editable(EditableMode::Normal)
        } else {
            SpikeOutcome::Editable(EditableMode::LargeText)
        }
    };

    Ok(SpikeScanResult {
        report: SpikePreflightReport {
            size_bytes: total_bytes,
            max_line_bytes,
            line_count_estimate,
            has_utf8_bom,
            detected_data_image_count: data_images.detected_count,
            largest_data_image_estimate_bytes: data_images.largest_decoded_estimate,
            retained_bytes_upper_bound: policy.read_buffer_bytes
                + std::mem::size_of::<DataImageDetector>()
                + std::mem::size_of::<StreamingUtf8Validator>()
                + first_bytes.len(),
        },
        outcome,
    })
}

#[derive(Debug)]
struct ScratchDirectory {
    path: PathBuf,
}

impl ScratchDirectory {
    fn create() -> io::Result<Self> {
        let sequence = SCRATCH_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let leaf = format!("{SCRATCH_PREFIX}{}-{sequence}", process::id());
        let path = env::temp_dir().join(leaf);
        fs::create_dir(&path)?;
        Ok(Self { path })
    }

    fn join(&self, name: &str) -> PathBuf {
        self.path.join(name)
    }
}

impl Drop for ScratchDirectory {
    fn drop(&mut self) {
        let is_scoped = self.path.parent() == Some(env::temp_dir().as_path())
            && self
                .path
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with(SCRATCH_PREFIX));
        if is_scoped {
            let _ = fs::remove_dir_all(&self.path);
        }
    }
}

fn write_repeated(mut writer: impl Write, byte: u8, bytes: u64) -> io::Result<()> {
    io::copy(&mut io::repeat(byte).take(bytes), &mut writer)?;
    Ok(())
}

fn write_multiline_fixture(path: &Path, total_bytes: u64, line_bytes: usize) -> io::Result<()> {
    assert!(line_bytes > 0);
    let mut file = File::create(path)?;
    let line = vec![b'm'; line_bytes];
    let mut remaining = total_bytes;
    while remaining > 0 {
        let payload = remaining.min(line_bytes as u64) as usize;
        file.write_all(&line[..payload])?;
        remaining -= payload as u64;
        if remaining > 0 {
            file.write_all(b"\n")?;
            remaining -= 1;
        }
    }
    file.sync_all()
}

fn write_data_image_for_decoded_size(path: &Path, decoded_bytes: u64) -> io::Result<()> {
    let mut file = File::create(path)?;
    file.write_all(b"![synthetic](data:image/png;base64,")?;
    let complete_groups = decoded_bytes / 3;
    write_repeated(&mut file, b'A', complete_groups * 4)?;
    match decoded_bytes % 3 {
        1 => file.write_all(b"AA==")?,
        2 => file.write_all(b"AAA=")?,
        _ => {}
    }
    file.write_all(b")")?;
    file.sync_all()
}

fn write_sized_data_image(path: &Path, total_bytes: u64) -> io::Result<()> {
    const PREFIX: &[u8] = b"![synthetic](data:image/png;base64,";
    const SUFFIX: &[u8] = b")";
    assert!(total_bytes > (PREFIX.len() + SUFFIX.len()) as u64);
    let mut file = File::create(path)?;
    file.write_all(PREFIX)?;
    write_repeated(
        &mut file,
        b'A',
        total_bytes - PREFIX.len() as u64 - SUFFIX.len() as u64,
    )?;
    file.write_all(SUFFIX)?;
    file.sync_all()
}

fn scan_file(path: &Path, policy: SpikePolicy) -> Result<SpikeScanResult, SpikeScanError> {
    let file = File::open(path)?;
    scan_reader(file, policy, &AtomicBool::new(false))
}

#[derive(Debug)]
struct CancellingReader<R> {
    inner: R,
    cancel_after_bytes: u64,
    bytes_returned: Arc<AtomicU64>,
    cancelled: Arc<AtomicBool>,
}

impl<R: Read> Read for CancellingReader<R> {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        let read = self.inner.read(buffer)?;
        let total = self
            .bytes_returned
            .fetch_add(read as u64, Ordering::Relaxed)
            + read as u64;
        if total >= self.cancel_after_bytes {
            self.cancelled.store(true, Ordering::Relaxed);
        }
        Ok(read)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ReplaceFault {
    None,
    AfterTempCreate,
    AfterPartialWrite,
    AfterTempSync,
    AfterRename,
}

fn temporary_path_for(target: &Path, timestamp: u64) -> io::Result<PathBuf> {
    let parent = target
        .parent()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "target has no parent"))?;
    let file_name = target
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "target has no file name"))?;
    let sequence = TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    Ok(parent.join(format!(
        ".{file_name}.mdapp-spike-{timestamp}-{sequence}.tmp"
    )))
}

fn injected_failure(stage: &'static str) -> io::Error {
    io::Error::other(format!("P0-SPIKE-02 injected failure at {stage}"))
}

fn same_directory_atomic_replace(
    target: &Path,
    new_bytes: &[u8],
    fault: ReplaceFault,
) -> io::Result<()> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let temporary = temporary_path_for(target, now)?;
    debug_assert_eq!(temporary.parent(), target.parent());
    let mut committed = false;

    let result = (|| {
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)?;
        if fault == ReplaceFault::AfterTempCreate {
            return Err(injected_failure("temp-create"));
        }

        let split = new_bytes.len() / 2;
        file.write_all(&new_bytes[..split])?;
        if fault == ReplaceFault::AfterPartialWrite {
            return Err(injected_failure("partial-write"));
        }
        file.write_all(&new_bytes[split..])?;
        file.flush()?;
        file.sync_all()?;
        if fault == ReplaceFault::AfterTempSync {
            return Err(injected_failure("temp-sync"));
        }
        drop(file);

        fs::rename(&temporary, target)?;
        committed = true;
        if fault == ReplaceFault::AfterRename {
            return Err(injected_failure("rename-commit"));
        }

        sync_parent_directory(target)?;
        Ok(())
    })();

    if !committed {
        match fs::remove_file(&temporary) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) if result.is_ok() => return Err(error),
            Err(_) => {}
        }
    }

    result
}

#[cfg(unix)]
fn sync_parent_directory(target: &Path) -> io::Result<()> {
    File::open(
        target
            .parent()
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "target has no parent"))?,
    )?
    .sync_all()
}

#[cfg(not(unix))]
fn sync_parent_directory(_target: &Path) -> io::Result<()> {
    Ok(())
}

fn cleanup_stale_temporaries(target: &Path, older_than_epoch_seconds: u64) -> io::Result<usize> {
    let parent = target
        .parent()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "target has no parent"))?;
    let file_name = target
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "target has no file name"))?;
    let prefix = format!(".{file_name}.mdapp-spike-");
    let mut removed = 0;

    for entry in fs::read_dir(parent)? {
        let entry = entry?;
        if !entry.file_type()?.is_file() {
            continue;
        }
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            continue;
        };
        let Some(remainder) = name
            .strip_prefix(&prefix)
            .and_then(|name| name.strip_suffix(".tmp"))
        else {
            continue;
        };
        let Some(timestamp) = remainder
            .split('-')
            .next()
            .and_then(|value| value.parse::<u64>().ok())
        else {
            continue;
        };
        if timestamp < older_than_epoch_seconds {
            fs::remove_file(entry.path())?;
            removed += 1;
        }
    }

    Ok(removed)
}

fn count_task_temporaries(target: &Path) -> io::Result<usize> {
    let parent = target
        .parent()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "target has no parent"))?;
    let file_name = target
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "target has no file name"))?;
    let prefix = format!(".{file_name}.mdapp-spike-");
    let mut count = 0;
    for entry in fs::read_dir(parent)? {
        let entry = entry?;
        if entry.file_type()?.is_file()
            && entry
                .file_name()
                .to_str()
                .is_some_and(|name| name.starts_with(&prefix) && name.ends_with(".tmp"))
        {
            count += 1;
        }
    }
    Ok(count)
}

#[derive(Default)]
struct CountingWriter {
    bytes_written: u64,
}

impl Write for CountingWriter {
    fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
        self.bytes_written += buffer.len() as u64;
        Ok(buffer.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

#[derive(Debug)]
struct JsonWireMeasurement {
    raw_bytes: u64,
    wire_bytes: u64,
    retained_bytes_upper_bound: usize,
}

fn stream_json_escape_measurement<R: Read>(
    mut reader: R,
    envelope_bytes: u64,
) -> io::Result<JsonWireMeasurement> {
    let mut input = vec![0_u8; SCAN_BUFFER_BYTES];
    let mut escaped = Vec::with_capacity(JSON_ESCAPE_BUFFER_BYTES);
    let mut sink = CountingWriter::default();
    let mut raw_bytes = 0_u64;

    loop {
        let read = reader.read(&mut input)?;
        if read == 0 {
            break;
        }
        raw_bytes += read as u64;
        escaped.clear();
        for byte in &input[..read] {
            match byte {
                b'"' => escaped.extend_from_slice(br#"\""#),
                b'\\' => escaped.extend_from_slice(br#"\\"#),
                b'\n' => escaped.extend_from_slice(br"\n"),
                b'\r' => escaped.extend_from_slice(br"\r"),
                b'\t' => escaped.extend_from_slice(br"\t"),
                0x00..=0x1f => {
                    const HEX: &[u8; 16] = b"0123456789abcdef";
                    escaped.extend_from_slice(b"\\u00");
                    escaped.push(HEX[(byte >> 4) as usize]);
                    escaped.push(HEX[(byte & 0x0f) as usize]);
                }
                _ => escaped.push(*byte),
            }
        }
        sink.write_all(&escaped)?;
    }

    io::copy(&mut io::repeat(b' ').take(envelope_bytes), &mut sink)?;
    Ok(JsonWireMeasurement {
        raw_bytes,
        wire_bytes: sink.bytes_written,
        retained_bytes_upper_bound: input.len() + escaped.capacity(),
    })
}

/// SAFE-001 / CONTRACT-011: ordered category boundaries and body-free reports.
#[test]
fn safe_001_ordered_preflight_boundaries_are_exact() {
    let scratch = ScratchDirectory::create().expect("create scoped scratch directory");
    let policy = SpikePolicy::default();

    let normal = scratch.join("normal-boundary.md");
    write_multiline_fixture(&normal, policy.normal_file_bytes, 4095)
        .expect("generate normal boundary");
    let normal_result = scan_file(&normal, policy).expect("scan normal boundary");
    assert_eq!(
        normal_result.outcome,
        SpikeOutcome::Editable(EditableMode::Normal)
    );

    let large = scratch.join("large-after-normal.md");
    write_multiline_fixture(&large, policy.normal_file_bytes + 1, 4095)
        .expect("generate large-text boundary");
    assert_eq!(
        scan_file(&large, policy)
            .expect("scan large-text boundary")
            .outcome,
        SpikeOutcome::Editable(EditableMode::LargeText)
    );

    let max_editable = scratch.join("max-editable.md");
    write_multiline_fixture(&max_editable, policy.max_editable_file_bytes, 4095)
        .expect("generate max editable boundary");
    assert_eq!(
        scan_file(&max_editable, policy)
            .expect("scan max editable boundary")
            .outcome,
        SpikeOutcome::Editable(EditableMode::LargeText)
    );

    let too_large = scratch.join("too-large.md");
    write_multiline_fixture(&too_large, policy.max_editable_file_bytes + 1, 4095)
        .expect("generate over-limit boundary");
    assert!(matches!(
        scan_file(&too_large, policy)
            .expect("scan over-limit boundary")
            .outcome,
        SpikeOutcome::Unsupported(reasons)
            if reasons.contains(&UnsupportedReason::FileTooLarge)
    ));

    for (bytes, expected) in [
        (
            policy.max_normal_line_bytes,
            SpikeOutcome::Editable(EditableMode::Normal),
        ),
        (
            policy.max_normal_line_bytes + 1,
            SpikeOutcome::Editable(EditableMode::LargeText),
        ),
        (
            policy.safety_block_line_bytes,
            SpikeOutcome::Editable(EditableMode::LargeText),
        ),
        (
            policy.safety_block_line_bytes + 1,
            SpikeOutcome::SafetyBlocked(vec![SafetyReason::LineTooLong]),
        ),
    ] {
        let path = scratch.join(&format!("line-{bytes}.md"));
        write_repeated(
            File::create(&path).expect("create line fixture"),
            b'x',
            bytes,
        )
        .expect("write line fixture");
        assert_eq!(
            scan_file(&path, policy)
                .expect("scan line boundary")
                .outcome,
            expected,
            "physical-line boundary at {bytes} bytes"
        );
    }
}

/// SAFE-001 / AC-SAFE-005 / CONTRACT-011: unsupported wins over repairable safety.
#[test]
fn safe_001_binary_and_invalid_utf8_are_unsupported() {
    let policy = SpikePolicy::default();

    let binary = [
        0_u8, b'd', b'a', b't', b'a', b':', b'i', b'm', b'a', b'g', b'e',
    ];
    let binary_result =
        scan_reader(binary.as_slice(), policy, &AtomicBool::new(false)).expect("scan binary bytes");
    assert!(matches!(
        binary_result.outcome,
        SpikeOutcome::Unsupported(reasons) if reasons.contains(&UnsupportedReason::Binary)
    ));

    let invalid_utf8 = [0xf0, 0x28, 0x8c, 0x28];
    let invalid_result = scan_reader(invalid_utf8.as_slice(), policy, &AtomicBool::new(false))
        .expect("scan invalid utf-8 bytes");
    assert!(matches!(
        invalid_result.outcome,
        SpikeOutcome::Unsupported(reasons) if reasons.contains(&UnsupportedReason::InvalidUtf8)
    ));

    let bom_text = [0xef, 0xbb, 0xbf, b'#', b' ', b'o', b'k', b'\n'];
    let bom_result =
        scan_reader(bom_text.as_slice(), policy, &AtomicBool::new(false)).expect("scan UTF-8 BOM");
    assert!(bom_result.report.has_utf8_bom);
    assert_eq!(bom_result.report.line_count_estimate, 1);
    assert_eq!(
        bom_result.outcome,
        SpikeOutcome::Editable(EditableMode::Normal)
    );
}

/// SAFE-003: marker, metadata, and payload state survive arbitrary read boundaries.
#[test]
fn safe_003_data_image_detection_crosses_every_chunk_boundary() {
    let policy = SpikePolicy {
        read_buffer_bytes: 7,
        ..SpikePolicy::default()
    };
    let decoded = policy.safety_block_data_image_decoded_bytes + 1;
    let scratch = ScratchDirectory::create().expect("create scoped scratch directory");
    let path = scratch.join("cross-chunk.md");
    write_data_image_for_decoded_size(&path, decoded).expect("generate data-image boundary");

    let result = scan_file(&path, policy).expect("scan cross-chunk data image");
    assert_eq!(result.report.detected_data_image_count, 1);
    assert_eq!(
        result.report.largest_data_image_estimate_bytes,
        Some(decoded)
    );
    assert!(matches!(
        result.outcome,
        SpikeOutcome::SafetyBlocked(reasons)
            if reasons.contains(&SafetyReason::LargeDataImage)
    ));
}

/// SAFE-003: decoded-byte threshold uses strict greater-than semantics.
#[test]
fn safe_003_data_image_decoded_threshold_is_exact() {
    let scratch = ScratchDirectory::create().expect("create scoped scratch directory");
    let policy = SpikePolicy::default();
    let threshold = policy.safety_block_data_image_decoded_bytes;

    let exact = scratch.join("data-image-exact.md");
    write_data_image_for_decoded_size(&exact, threshold).expect("generate exact data image");
    let exact_result = scan_file(&exact, policy).expect("scan exact data image");
    assert_eq!(
        exact_result.report.largest_data_image_estimate_bytes,
        Some(threshold)
    );
    assert_eq!(
        exact_result.outcome,
        SpikeOutcome::Editable(EditableMode::LargeText)
    );

    let over = scratch.join("data-image-over.md");
    write_data_image_for_decoded_size(&over, threshold + 1)
        .expect("generate over-threshold data image");
    let over_result = scan_file(&over, policy).expect("scan over-threshold data image");
    assert_eq!(
        over_result.report.largest_data_image_estimate_bytes,
        Some(threshold + 1)
    );
    assert!(matches!(
        over_result.outcome,
        SpikeOutcome::SafetyBlocked(reasons)
            if reasons.contains(&SafetyReason::LargeDataImage)
    ));
}

/// PERF-010 / SAFE-003 / AC-SAFE-002: scanner-only release-budget feasibility.
#[test]
fn perf_010_and_safe_003_ten_mib_scans_are_bounded_and_within_budget() {
    let scratch = ScratchDirectory::create().expect("create scoped scratch directory");
    let policy = SpikePolicy::default();
    let retained_limit = SCAN_BUFFER_BYTES + 1024;

    let multiline = scratch.join("generated-large-text.md");
    write_multiline_fixture(&multiline, 10 * MIB, 4095).expect("generate 10 MiB multiline");
    let multiline_start = Instant::now();
    let multiline_result = scan_file(&multiline, policy).expect("scan 10 MiB multiline");
    let multiline_elapsed = multiline_start.elapsed();
    assert_eq!(multiline_result.report.size_bytes, 10 * MIB);
    assert!(multiline_result.report.max_line_bytes <= 4095);
    assert_eq!(
        multiline_result.outcome,
        SpikeOutcome::Editable(EditableMode::LargeText)
    );
    assert!(multiline_result.report.retained_bytes_upper_bound <= retained_limit);
    assert!(
        multiline_elapsed < Duration::from_secs(2),
        "PERF-010 scanner-only budget exceeded: {multiline_elapsed:?}"
    );

    let data_image = scratch.join("generated-data-image.md");
    write_sized_data_image(&data_image, 10 * MIB).expect("generate 10 MiB data image");
    let data_image_start = Instant::now();
    let data_image_result = scan_file(&data_image, policy).expect("scan 10 MiB data image");
    let data_image_elapsed = data_image_start.elapsed();
    assert_eq!(data_image_result.report.size_bytes, 10 * MIB);
    assert!(matches!(
        data_image_result.outcome,
        SpikeOutcome::SafetyBlocked(reasons)
            if reasons.contains(&SafetyReason::LineTooLong)
                && reasons.contains(&SafetyReason::LargeDataImage)
    ));
    assert!(data_image_result.report.retained_bytes_upper_bound <= retained_limit);
    assert!(
        data_image_elapsed < Duration::from_secs(1),
        "SAFE-003 scanner-only budget exceeded: {data_image_elapsed:?}"
    );

    eprintln!(
        "P0_SPIKE_02_METRIC case=multiline_10m bytes={} elapsed_us={} retained_upper_bound_bytes={} outcome=large_text",
        multiline_result.report.size_bytes,
        multiline_elapsed.as_micros(),
        multiline_result.report.retained_bytes_upper_bound
    );
    eprintln!(
        "P0_SPIKE_02_METRIC case=data_image_10m bytes={} elapsed_us={} retained_upper_bound_bytes={} outcome=safety_blocked",
        data_image_result.report.size_bytes,
        data_image_elapsed.as_micros(),
        data_image_result.report.retained_bytes_upper_bound
    );
}

/// CONTRACT-010: cancellation is observed between fixed-size chunks.
#[test]
fn contract_010_cancellation_stops_before_full_consumption() {
    let policy = SpikePolicy::default();
    let cancelled = Arc::new(AtomicBool::new(false));
    let bytes_returned = Arc::new(AtomicU64::new(0));
    let cancel_after = 3 * SCAN_BUFFER_BYTES as u64;
    let source = io::repeat(b'x').take(10 * MIB);
    let reader = CancellingReader {
        inner: source,
        cancel_after_bytes: cancel_after,
        bytes_returned: Arc::clone(&bytes_returned),
        cancelled: Arc::clone(&cancelled),
    };

    let result = scan_reader(reader, policy, &cancelled);
    assert!(matches!(
        result,
        Err(SpikeScanError::Cancelled { bytes_read })
            if bytes_read >= cancel_after
                && bytes_read <= cancel_after + SCAN_BUFFER_BYTES as u64
    ));
    assert!(bytes_returned.load(Ordering::Relaxed) < 10 * MIB);
}

/// SAFE-001: ordinary I/O failure returns a typed local error and no report/body.
#[test]
fn safe_001_read_error_has_no_partial_success_report() {
    struct FailingReader;

    impl Read for FailingReader {
        fn read(&mut self, _buffer: &mut [u8]) -> io::Result<usize> {
            Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "synthetic read denial",
            ))
        }
    }

    assert!(matches!(
        scan_reader(
            FailingReader,
            SpikePolicy::default(),
            &AtomicBool::new(false)
        ),
        Err(SpikeScanError::Io(io::ErrorKind::PermissionDenied))
    ));
}

/// FILE-001 supporting spike: failure before rename retains the complete old file.
#[test]
fn file_001_same_directory_replace_is_all_old_or_all_new() {
    let old = b"complete-old-version";
    let new = b"complete-new-version-with-more-bytes";

    for fault in [
        ReplaceFault::AfterTempCreate,
        ReplaceFault::AfterPartialWrite,
        ReplaceFault::AfterTempSync,
    ] {
        let scratch = ScratchDirectory::create().expect("create scoped scratch directory");
        let target = scratch.join("document.md");
        fs::write(&target, old).expect("write old version");
        assert!(same_directory_atomic_replace(&target, new, fault).is_err());
        assert_eq!(fs::read(&target).expect("read old version"), old);
        assert_eq!(
            count_task_temporaries(&target).expect("count temporary files"),
            0
        );
    }

    let scratch = ScratchDirectory::create().expect("create scoped scratch directory");
    let target = scratch.join("document.md");
    fs::write(&target, old).expect("write old version");
    same_directory_atomic_replace(&target, new, ReplaceFault::None)
        .expect("commit atomic replacement");
    assert_eq!(fs::read(&target).expect("read new version"), new);
    assert_eq!(
        count_task_temporaries(&target).expect("count temporary files"),
        0
    );

    let scratch = ScratchDirectory::create().expect("create scoped scratch directory");
    let target = scratch.join("document.md");
    fs::write(&target, old).expect("write old version");
    assert!(same_directory_atomic_replace(&target, new, ReplaceFault::AfterRename).is_err());
    assert_eq!(fs::read(&target).expect("read committed version"), new);
    assert_eq!(
        count_task_temporaries(&target).expect("count temporary files"),
        0
    );
}

/// Helper invoked only by the parent crash test. A direct harness run is a no-op.
#[test]
fn p0_spike_02_crash_helper_exits_after_synced_temp() {
    let Ok(directory) = env::var("P0_SPIKE_02_CRASH_DIRECTORY") else {
        return;
    };
    let Ok(target_name) = env::var("P0_SPIKE_02_CRASH_TARGET") else {
        return;
    };
    let target = PathBuf::from(directory).join(target_name);
    let temporary = temporary_path_for(&target, 1).expect("create crash temp path");
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(temporary)
        .expect("create crash temp file");
    file.write_all(b"complete-but-uncommitted")
        .expect("write crash temp");
    file.sync_all().expect("sync crash temp");
    process::exit(CRASH_EXIT_CODE);
}

/// FILE-001 supporting spike: a real process exit leaves a scoped, recoverable temp.
#[test]
fn file_001_crash_temp_is_scoped_and_stale_cleanup_is_selective() {
    let scratch = ScratchDirectory::create().expect("create scoped scratch directory");
    let target = scratch.join("document.md");
    let old = b"old-remains-recoverable";
    fs::write(&target, old).expect("write original");
    let decoy = scratch.join("unrelated.tmp");
    fs::write(&decoy, b"must-not-delete").expect("write cleanup decoy");

    let child = Command::new(env::current_exe().expect("resolve test executable"))
        .arg("--exact")
        .arg("p0_spike_02_crash_helper_exits_after_synced_temp")
        .arg("--nocapture")
        .arg("--test-threads=1")
        .env("P0_SPIKE_02_CRASH_DIRECTORY", &scratch.path)
        .env("P0_SPIKE_02_CRASH_TARGET", "document.md")
        .output()
        .expect("run crash helper");
    assert_eq!(child.status.code(), Some(CRASH_EXIT_CODE));
    assert_eq!(fs::read(&target).expect("read original after crash"), old);
    assert_eq!(
        count_task_temporaries(&target).expect("count crash temporary"),
        1
    );

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    assert_eq!(
        cleanup_stale_temporaries(&target, now).expect("clean stale task temp"),
        1
    );
    assert_eq!(
        count_task_temporaries(&target).expect("count after cleanup"),
        0
    );
    assert_eq!(fs::read(&target).expect("read original after cleanup"), old);
    assert_eq!(
        fs::read(&decoy).expect("read cleanup decoy"),
        b"must-not-delete"
    );
}

/// CONTRACT-024 sizing evidence only; this is not an end-to-end Tauri transport test.
#[test]
fn contract_024_worst_case_json_wire_budget_is_streamable_and_exact() {
    let raw_limit = 32 * MIB;
    let envelope_limit = MIB;
    let wire_limit = 193 * MIB;

    let started = Instant::now();
    let at_limit = stream_json_escape_measurement(io::repeat(0x01).take(raw_limit), envelope_limit)
        .expect("measure worst-case JSON escape at limit");
    let elapsed = started.elapsed();
    assert_eq!(at_limit.raw_bytes, raw_limit);
    assert_eq!(at_limit.wire_bytes, wire_limit);
    assert!(at_limit.retained_bytes_upper_bound <= SCAN_BUFFER_BYTES + JSON_ESCAPE_BUFFER_BYTES);

    let over_limit =
        stream_json_escape_measurement(io::repeat(0x01).take(raw_limit + 1), envelope_limit)
            .expect("measure worst-case JSON escape over limit");
    assert_eq!(over_limit.raw_bytes, raw_limit + 1);
    assert!(over_limit.wire_bytes > wire_limit);

    eprintln!(
        "P0_SPIKE_02_METRIC case=json_wire_worst_32m raw_bytes={} wire_bytes={} elapsed_us={} retained_upper_bound_bytes={} transport=end_to_end_not_tested",
        at_limit.raw_bytes,
        at_limit.wire_bytes,
        elapsed.as_micros(),
        at_limit.retained_bytes_upper_bound
    );
}
