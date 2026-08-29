//! P0-SPIKE-02 disposable Native/Safety feasibility harness.
//!
//! This deliberately lives in the integration-test tree. It validates the
//! accepted policy without exposing a product command or freezing a Phase 1
//! implementation prematurely.

use std::env;
#[cfg(target_os = "macos")]
use std::fs::OpenOptions;
use std::fs::{self, File};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::process;
#[cfg(target_os = "macos")]
use std::process::Command;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
#[cfg(target_os = "macos")]
use std::time::{SystemTime, UNIX_EPOCH};

#[cfg(target_os = "macos")]
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};

const KIB: u64 = 1024;
const MIB: u64 = 1024 * KIB;
const SCAN_BUFFER_BYTES: usize = 64 * 1024;
const JSON_ESCAPE_BUFFER_BYTES: usize = SCAN_BUFFER_BYTES * 6;
const SCRATCH_PREFIX: &str = "markdown-workspace-p0-spike-02-";
#[cfg(target_os = "macos")]
const CRASH_EXIT_CODE: i32 = 86;

static SCRATCH_SEQUENCE: AtomicU64 = AtomicU64::new(0);
#[cfg(target_os = "macos")]
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
    uncertain_data_image_count: u64,
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
    Quarantined,
}

#[derive(Debug)]
struct DataImageDetector {
    stage: DataImageStage,
    detected_count: u64,
    uncertain_count: u64,
    largest_decoded_estimate: Option<u64>,
}

impl DataImageDetector {
    const PREFIX: &'static [u8] = b"data:image/";
    const MEDIA_TYPE_STEM: &'static [u8] = b"data:image";
    const BASE64_SUFFIX: &'static [u8] = b";base64,";
    // A normal media type/header is tiny. Crossing this bounded window is not
    // permission to forget a candidate: the scanner quarantines it instead.
    const MAX_HEADER_BYTES: usize = 4 * 1024;

    fn new() -> Self {
        Self {
            stage: DataImageStage::Seeking(0),
            detected_count: 0,
            uncertain_count: 0,
            largest_decoded_estimate: None,
        }
    }

    fn feed(&mut self, byte: u8) {
        self.stage = match self.stage {
            DataImageStage::Seeking(matched) => {
                if matched >= Self::MEDIA_TYPE_STEM.len()
                    && (byte == b'%' || byte.is_ascii_whitespace())
                {
                    self.quarantine_candidate();
                    DataImageStage::Quarantined
                } else {
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
            }
            DataImageStage::Header {
                suffix_matched,
                header_bytes,
            } => {
                let next_header_bytes = header_bytes.saturating_add(1);
                if next_header_bytes > Self::MAX_HEADER_BYTES || byte == b'%' {
                    self.quarantine_candidate();
                    DataImageStage::Quarantined
                } else if is_data_uri_terminator(byte) {
                    // Once the exact data-image prefix has been observed, an
                    // incomplete header is still an unprovable candidate.
                    self.quarantine_candidate();
                    seeking_stage_for(byte)
                } else if byte == b',' {
                    let next =
                        advance_ascii_case_insensitive(Self::BASE64_SUFFIX, suffix_matched, byte);
                    if next == Self::BASE64_SUFFIX.len() {
                        self.detected_count += 1;
                        DataImageStage::Payload {
                            encoded_chars: 0,
                            padding_chars: 0,
                        }
                    } else {
                        // A non-base64, partial, or obfuscated image data URI
                        // has no bounded decoded-size proof in this spike.
                        self.quarantine_candidate();
                        DataImageStage::Quarantined
                    }
                } else if byte.is_ascii_whitespace() {
                    // MIME/data URI implementations may accept folded or stray
                    // ASCII whitespace. Ignore it for matching while retaining
                    // the bounded header counter.
                    DataImageStage::Header {
                        suffix_matched,
                        header_bytes: next_header_bytes,
                    }
                } else {
                    let next =
                        advance_ascii_case_insensitive(Self::BASE64_SUFFIX, suffix_matched, byte);
                    if next == Self::BASE64_SUFFIX.len() {
                        self.detected_count += 1;
                        DataImageStage::Payload {
                            encoded_chars: 0,
                            padding_chars: 0,
                        }
                    } else {
                        DataImageStage::Header {
                            suffix_matched: next,
                            header_bytes: next_header_bytes,
                        }
                    }
                }
            }
            DataImageStage::Payload {
                encoded_chars,
                padding_chars,
            } => {
                if byte.is_ascii_whitespace() {
                    DataImageStage::Payload {
                        encoded_chars,
                        padding_chars,
                    }
                } else if is_base64_alphabet(byte) && padding_chars == 0 {
                    DataImageStage::Payload {
                        encoded_chars: encoded_chars + 1,
                        padding_chars,
                    }
                } else if byte == b'=' && padding_chars < 2 {
                    DataImageStage::Payload {
                        encoded_chars: encoded_chars + 1,
                        padding_chars: padding_chars + 1,
                    }
                } else if is_data_uri_terminator(byte) {
                    self.record_payload(encoded_chars, padding_chars);
                    seeking_stage_for(byte)
                } else {
                    // Percent escapes, alphabet after padding, excess padding,
                    // and unknown punctuation make the decoded size ambiguous.
                    // Keep the document out of the editor rather than ending the
                    // payload early and under-counting it.
                    self.quarantine_candidate();
                    DataImageStage::Quarantined
                }
            }
            DataImageStage::Quarantined => {
                if is_data_uri_terminator(byte) {
                    seeking_stage_for(byte)
                } else {
                    DataImageStage::Quarantined
                }
            }
        };
    }

    fn finish(&mut self) {
        match self.stage {
            DataImageStage::Payload {
                encoded_chars,
                padding_chars,
            } => self.record_payload(encoded_chars, padding_chars),
            DataImageStage::Header { .. } => self.quarantine_candidate(),
            DataImageStage::Seeking(_) | DataImageStage::Quarantined => {}
        }
        self.stage = DataImageStage::Seeking(0);
    }

    fn quarantine_candidate(&mut self) {
        self.uncertain_count += 1;
    }

    fn record_payload(&mut self, encoded_chars: u64, padding_chars: u8) {
        let complete_quads = encoded_chars / 4;
        let remainder = encoded_chars % 4;
        let invalid_shape = remainder == 1
            || (padding_chars > 0 && remainder != 0)
            || (padding_chars > 0 && encoded_chars < 4);
        if invalid_shape {
            self.quarantine_candidate();
            return;
        }
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

    fn requires_safety_block(&self) -> bool {
        self.uncertain_count > 0
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

fn is_data_uri_terminator(byte: u8) -> bool {
    matches!(byte, b')' | b'>' | b'<' | b'\'' | b'"' | b'`' | b']')
}

/// Streaming physical-line accounting for the P0 UTF-8 contract.
///
/// `size_bytes` remains the raw file length, while line thresholds exclude the
/// three-byte UTF-8 BOM and exclude both bytes of a CRLF terminator. A lone CR
/// is treated as content because P0 recognizes LF/CRLF, not legacy CR lines.
#[derive(Debug)]
struct PhysicalLineMetrics {
    bom_probe: [u8; 3],
    bom_probe_len: usize,
    bom_decided: bool,
    has_utf8_bom: bool,
    content_stream_bytes: u64,
    current_line_bytes: u64,
    max_line_bytes: u64,
    newline_count: u64,
    pending_cr: bool,
    last_was_line_ending: bool,
}

impl PhysicalLineMetrics {
    fn new() -> Self {
        Self {
            bom_probe: [0; 3],
            bom_probe_len: 0,
            bom_decided: false,
            has_utf8_bom: false,
            content_stream_bytes: 0,
            current_line_bytes: 0,
            max_line_bytes: 0,
            newline_count: 0,
            pending_cr: false,
            last_was_line_ending: false,
        }
    }

    fn feed(&mut self, byte: u8) {
        if !self.bom_decided {
            self.bom_probe[self.bom_probe_len] = byte;
            self.bom_probe_len += 1;
            if self.bom_probe_len == self.bom_probe.len() {
                self.decide_bom();
            }
            return;
        }
        self.feed_content_byte(byte);
    }

    fn finish(&mut self) {
        if !self.bom_decided {
            self.decide_bom();
        }
        if self.pending_cr {
            self.pending_cr = false;
            self.extend_line(1);
            self.last_was_line_ending = false;
        }
    }

    fn decide_bom(&mut self) {
        self.bom_decided = true;
        self.has_utf8_bom = self.bom_probe_len == 3 && self.bom_probe == [0xef, 0xbb, 0xbf];
        if !self.has_utf8_bom {
            let bytes = self.bom_probe;
            for byte in bytes.into_iter().take(self.bom_probe_len) {
                self.feed_content_byte(byte);
            }
        }
    }

    fn feed_content_byte(&mut self, byte: u8) {
        self.content_stream_bytes += 1;
        if self.pending_cr {
            self.pending_cr = false;
            if byte == b'\n' {
                self.finish_line();
                return;
            }
            self.extend_line(1);
        }

        match byte {
            b'\r' => {
                self.pending_cr = true;
                self.last_was_line_ending = false;
            }
            b'\n' => self.finish_line(),
            _ => {
                self.extend_line(1);
                self.last_was_line_ending = false;
            }
        }
    }

    fn extend_line(&mut self, bytes: u64) {
        self.current_line_bytes += bytes;
        self.max_line_bytes = self.max_line_bytes.max(self.current_line_bytes);
    }

    fn finish_line(&mut self) {
        self.max_line_bytes = self.max_line_bytes.max(self.current_line_bytes);
        self.current_line_bytes = 0;
        self.newline_count += 1;
        self.last_was_line_ending = true;
    }

    fn line_count_estimate(&self) -> u64 {
        if self.content_stream_bytes == 0 {
            0
        } else if self.last_was_line_ending {
            self.newline_count
        } else {
            self.newline_count + 1
        }
    }
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
    let mut line_metrics = PhysicalLineMetrics::new();
    let mut utf8 = StreamingUtf8Validator::new();
    let mut data_images = DataImageDetector::new();
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

            if binary_sampled < 8 * KIB {
                binary_sampled += 1;
                if matches!(byte, 0x01..=0x08 | 0x0b | 0x0c | 0x0e..=0x1f | 0x7f) {
                    binary_controls += 1;
                }
            }
            saw_nul |= byte == 0;
            utf8.feed(byte);
            data_images.feed(byte);
            line_metrics.feed(byte);
        }

        total_bytes = observed_after_read;
        if total_bytes > policy.max_editable_file_bytes {
            exceeded_file_limit = true;
            break;
        }
    }

    data_images.finish();
    line_metrics.finish();
    let line_count_estimate = line_metrics.line_count_estimate();
    let max_line_bytes = line_metrics.max_line_bytes;
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
            || data_images.requires_safety_block()
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
            has_utf8_bom: line_metrics.has_utf8_bom,
            detected_data_image_count: data_images.detected_count,
            uncertain_data_image_count: data_images.uncertain_count,
            largest_data_image_estimate_bytes: data_images.largest_decoded_estimate,
            retained_bytes_upper_bound: policy.read_buffer_bytes
                + std::mem::size_of::<DataImageDetector>()
                + std::mem::size_of::<StreamingUtf8Validator>()
                + std::mem::size_of::<PhysicalLineMetrics>(),
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
    write_data_image_bytes(&mut file, decoded_bytes)?;
    file.sync_all()
}

fn data_image_bytes_for_decoded_size(decoded_bytes: u64) -> Vec<u8> {
    let mut bytes = Vec::new();
    write_data_image_bytes(&mut bytes, decoded_bytes).expect("Vec writes cannot fail");
    bytes
}

fn write_data_image_bytes(mut writer: impl Write, decoded_bytes: u64) -> io::Result<()> {
    writer.write_all(b"![synthetic](data:image/png;base64,")?;
    let complete_groups = decoded_bytes / 3;
    write_repeated(&mut writer, b'A', complete_groups * 4)?;
    match decoded_bytes % 3 {
        1 => writer.write_all(b"AA==")?,
        2 => writer.write_all(b"AAA=")?,
        _ => {}
    }
    writer.write_all(b")")
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
struct SplitOnceReader<'a> {
    bytes: &'a [u8],
    split_at: usize,
    position: usize,
}

impl<'a> SplitOnceReader<'a> {
    fn new(bytes: &'a [u8], split_at: usize) -> Self {
        assert!(split_at <= bytes.len());
        Self {
            bytes,
            split_at,
            position: 0,
        }
    }
}

impl Read for SplitOnceReader<'_> {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        if self.position == self.bytes.len() {
            return Ok(0);
        }
        let segment_end = if self.position < self.split_at {
            self.split_at
        } else {
            self.bytes.len()
        };
        let read = (segment_end - self.position).min(buffer.len());
        buffer[..read].copy_from_slice(&self.bytes[self.position..self.position + read]);
        self.position += read;
        Ok(read)
    }
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

#[cfg(target_os = "macos")]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ReplaceFault {
    None,
    AfterTempCreate,
    AfterPartialWrite,
    AfterTempSync,
    AfterRename,
}

#[cfg(target_os = "macos")]
const TEMP_NAME_VERSION: &str = "v1";
#[cfg(target_os = "macos")]
const TEMP_TIMESTAMP_DIGITS: usize = 20;
#[cfg(target_os = "macos")]
const TEMP_U32_DIGITS: usize = 10;
#[cfg(target_os = "macos")]
const TEMP_SEQUENCE_DIGITS: usize = 20;

#[cfg(target_os = "macos")]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct OwnedTemporaryName {
    timestamp: u64,
    owner_uid: u32,
}

#[cfg(target_os = "macos")]
fn format_temporary_file_name(
    target_file_name: &str,
    timestamp: u64,
    owner_uid: u32,
    pid: u32,
    sequence: u64,
) -> String {
    format!(
        ".{target_file_name}.mdapp-spike-{TEMP_NAME_VERSION}-{timestamp:020}-{owner_uid:010}-{pid:010}-{sequence:020}.tmp"
    )
}

#[cfg(target_os = "macos")]
fn temporary_path_for(target: &Path, timestamp: u64) -> io::Result<PathBuf> {
    let parent = target
        .parent()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "target has no parent"))?;
    let file_name = target
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "target has no file name"))?;
    let owner_uid = fs::symlink_metadata(target)?.uid();
    let sequence = TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    Ok(parent.join(format_temporary_file_name(
        file_name,
        timestamp,
        owner_uid,
        process::id(),
        sequence,
    )))
}

#[cfg(target_os = "macos")]
fn parse_fixed_decimal<T: std::str::FromStr>(value: &str, digits: usize) -> Option<T> {
    (value.len() == digits && value.bytes().all(|byte| byte.is_ascii_digit()))
        .then(|| value.parse().ok())
        .flatten()
}

#[cfg(target_os = "macos")]
fn parse_owned_temporary_name(
    target_file_name: &str,
    candidate: &str,
) -> Option<OwnedTemporaryName> {
    let prefix = format!(".{target_file_name}.mdapp-spike-");
    let remainder = candidate.strip_prefix(&prefix)?.strip_suffix(".tmp")?;
    let mut components = remainder.split('-');
    if components.next()? != TEMP_NAME_VERSION {
        return None;
    }
    let timestamp = parse_fixed_decimal(components.next()?, TEMP_TIMESTAMP_DIGITS)?;
    let owner_uid = parse_fixed_decimal(components.next()?, TEMP_U32_DIGITS)?;
    let pid: u32 = parse_fixed_decimal(components.next()?, TEMP_U32_DIGITS)?;
    let _sequence: u64 = parse_fixed_decimal(components.next()?, TEMP_SEQUENCE_DIGITS)?;
    if components.next().is_some() || pid == 0 {
        return None;
    }
    Some(OwnedTemporaryName {
        timestamp,
        owner_uid,
    })
}

#[cfg(target_os = "macos")]
fn create_owned_temporary(path: &Path) -> io::Result<File> {
    OpenOptions::new()
        .create_new(true)
        .write(true)
        .mode(0o600)
        .open(path)
}

#[cfg(target_os = "macos")]
fn injected_failure(stage: &'static str) -> io::Error {
    io::Error::other(format!("P0-SPIKE-02 injected failure at {stage}"))
}

/// macOS-only feasibility path. Windows replace/share-mode semantics require a
/// dedicated production adapter and are intentionally not inferred here.
#[cfg(target_os = "macos")]
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
        let mut file = create_owned_temporary(&temporary)?;
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

#[cfg(target_os = "macos")]
fn sync_parent_directory(target: &Path) -> io::Result<()> {
    File::open(
        target
            .parent()
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "target has no parent"))?,
    )?
    .sync_all()
}

#[cfg(target_os = "macos")]
fn owned_temporary_metadata(
    target: &Path,
    candidate_name: &str,
    metadata: &fs::Metadata,
) -> io::Result<Option<OwnedTemporaryName>> {
    let target_name = target
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "target has no file name"))?;
    let Some(parsed) = parse_owned_temporary_name(target_name, candidate_name) else {
        return Ok(None);
    };
    let target_metadata = fs::symlink_metadata(target)?;
    let owner_matches = target_metadata.file_type().is_file()
        && target_metadata.uid() == parsed.owner_uid
        && metadata.uid() == parsed.owner_uid;
    let secure_regular_file =
        metadata.file_type().is_file() && metadata.nlink() == 1 && metadata.mode() & 0o777 == 0o600;
    Ok((owner_matches && secure_regular_file).then_some(parsed))
}

#[cfg(target_os = "macos")]
fn modified_epoch_seconds(metadata: &fs::Metadata) -> Option<u64> {
    metadata
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_secs())
}

#[cfg(target_os = "macos")]
fn cleanup_stale_temporaries(target: &Path, older_than_epoch_seconds: u64) -> io::Result<usize> {
    let parent = target
        .parent()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "target has no parent"))?;
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
        let metadata = fs::symlink_metadata(entry.path())?;
        let Some(parsed) = owned_temporary_metadata(target, name, &metadata)? else {
            continue;
        };
        let Some(modified_at) = modified_epoch_seconds(&metadata) else {
            continue;
        };
        if parsed.timestamp < older_than_epoch_seconds && modified_at < older_than_epoch_seconds {
            fs::remove_file(entry.path())?;
            removed += 1;
        }
    }

    Ok(removed)
}

#[cfg(target_os = "macos")]
fn count_task_temporaries(target: &Path) -> io::Result<usize> {
    let parent = target
        .parent()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "target has no parent"))?;
    let mut count = 0;
    for entry in fs::read_dir(parent)? {
        let entry = entry?;
        if !entry.file_type()?.is_file() {
            continue;
        }
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            continue;
        };
        let metadata = fs::symlink_metadata(entry.path())?;
        if owned_temporary_metadata(target, name, &metadata)?.is_some() {
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

/// SAFE-001 / AC-SAFE-005 / CONTRACT-011: unsupported forms stay typed.
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

/// SAFE-001: UTF-8 BOM is not line content and CRLF contributes no line bytes.
#[test]
fn safe_001_bom_and_crlf_line_boundaries_are_explicit_and_exact() {
    let policy = SpikePolicy {
        max_normal_line_bytes: 4,
        safety_block_line_bytes: 4,
        read_buffer_bytes: 1,
        ..SpikePolicy::default()
    };

    let exact = b"\xef\xbb\xbfabcd\r\n";
    let exact_result = scan_reader(exact.as_slice(), policy, &AtomicBool::new(false))
        .expect("scan BOM + CRLF exact boundary");
    assert!(exact_result.report.has_utf8_bom);
    assert_eq!(exact_result.report.size_bytes, exact.len() as u64);
    assert_eq!(exact_result.report.max_line_bytes, 4);
    assert_eq!(exact_result.report.line_count_estimate, 1);
    assert_eq!(
        exact_result.outcome,
        SpikeOutcome::Editable(EditableMode::Normal)
    );

    let over = b"\xef\xbb\xbfabcde\r\n";
    let over_result = scan_reader(over.as_slice(), policy, &AtomicBool::new(false))
        .expect("scan BOM + CRLF over boundary");
    assert_eq!(over_result.report.max_line_bytes, 5);
    assert_eq!(over_result.report.line_count_estimate, 1);
    assert_eq!(
        over_result.outcome,
        SpikeOutcome::SafetyBlocked(vec![SafetyReason::LineTooLong])
    );

    let bom_only = b"\xef\xbb\xbf";
    let bom_only_result = scan_reader(bom_only.as_slice(), policy, &AtomicBool::new(false))
        .expect("scan BOM-only document");
    assert!(bom_only_result.report.has_utf8_bom);
    assert_eq!(bom_only_result.report.max_line_bytes, 0);
    assert_eq!(bom_only_result.report.line_count_estimate, 0);
}

/// SAFE-003: marker/header/payload and -1/exact/+1 decoded thresholds survive
/// every possible split between two read calls.
#[test]
fn safe_003_data_image_thresholds_survive_every_split_boundary() {
    let policy = SpikePolicy {
        safety_block_data_image_decoded_bytes: 12,
        ..SpikePolicy::default()
    };
    let threshold = policy.safety_block_data_image_decoded_bytes;

    for decoded in [threshold - 1, threshold, threshold + 1] {
        let bytes = data_image_bytes_for_decoded_size(decoded);
        for split_at in 0..=bytes.len() {
            let result = scan_reader(
                SplitOnceReader::new(&bytes, split_at),
                policy,
                &AtomicBool::new(false),
            )
            .expect("scan split data image");
            assert_eq!(result.report.detected_data_image_count, 1);
            assert_eq!(result.report.uncertain_data_image_count, 0);
            assert_eq!(
                result.report.largest_data_image_estimate_bytes,
                Some(decoded),
                "decoded={decoded}, split_at={split_at}"
            );
            if decoded > threshold {
                assert!(matches!(
                    result.outcome,
                    SpikeOutcome::SafetyBlocked(reasons)
                        if reasons == vec![SafetyReason::LargeDataImage]
                ));
            } else {
                assert_eq!(
                    result.outcome,
                    SpikeOutcome::Editable(EditableMode::Normal),
                    "decoded={decoded}, split_at={split_at}"
                );
            }
        }
    }
}

/// SAFE-003: whitespace/newlines are ignored inside Base64 payloads, including
/// when the folded header or payload crosses every possible read split.
#[test]
fn safe_003_folded_data_image_whitespace_cannot_under_count_payload() {
    let policy = SpikePolicy {
        safety_block_data_image_decoded_bytes: 12,
        ..SpikePolicy::default()
    };
    let decoded = policy.safety_block_data_image_decoded_bytes + 1;
    let canonical = data_image_bytes_for_decoded_size(decoded);
    let comma = canonical
        .iter()
        .position(|byte| *byte == b',')
        .expect("canonical data image comma");
    let mut folded = Vec::new();
    folded.extend_from_slice(b"![synthetic](data:image/png; \r\nBaSe64\t,");
    for (index, byte) in canonical[comma + 1..canonical.len() - 1].iter().enumerate() {
        if index > 0 && index % 3 == 0 {
            folded.extend_from_slice(b" \r\n\t");
        }
        folded.push(*byte);
    }
    folded.push(b')');

    for split_at in 0..=folded.len() {
        let result = scan_reader(
            SplitOnceReader::new(&folded, split_at),
            policy,
            &AtomicBool::new(false),
        )
        .expect("scan folded data image");
        assert_eq!(result.report.detected_data_image_count, 1);
        assert_eq!(result.report.uncertain_data_image_count, 0);
        assert_eq!(
            result.report.largest_data_image_estimate_bytes,
            Some(decoded),
            "split_at={split_at}"
        );
        assert!(matches!(
            result.outcome,
            SpikeOutcome::SafetyBlocked(reasons)
                if reasons.contains(&SafetyReason::LargeDataImage)
        ));
    }
}

/// SAFE-003: percent-obfuscated, overlong-header, and malformed data-image
/// candidates are quarantined when decoded size cannot be proven.
#[test]
fn safe_003_ambiguous_data_image_candidates_fail_closed() {
    let mut long_header = b"![x](data:image/".to_vec();
    long_header.extend(std::iter::repeat_n(
        b'x',
        DataImageDetector::MAX_HEADER_BYTES + 1,
    ));
    long_header.extend_from_slice(b";base64,AAAA)");

    let candidates = [
        long_header,
        b"![x](data:image%2Fpng%3Bbase64%2CAAAAAAAAAAAA)".to_vec(),
        b"![x](data:image \r\n/png;base64,AAAAAAAAAAAA)".to_vec(),
        b"![x](data:image/png%3Bbase64%2CAAAAAAAAAAAA)".to_vec(),
        b"![x](data:image/png;base64,AAAA%2FAAAAAAAA)".to_vec(),
        b"![x](data:image/png;base64,A)".to_vec(),
        b"![x](data:image/png;bas,AAAAAAAAAAAA)".to_vec(),
        b"![x](data:image/png;base64)".to_vec(),
        b"truncated data:image/png;base64".to_vec(),
    ];

    for candidate in candidates {
        for split_at in 0..=candidate.len() {
            let result = scan_reader(
                SplitOnceReader::new(&candidate, split_at),
                SpikePolicy::default(),
                &AtomicBool::new(false),
            )
            .expect("scan ambiguous data image");
            assert!(
                result.report.uncertain_data_image_count > 0,
                "split_at={split_at}"
            );
            assert!(matches!(
                result.outcome,
                SpikeOutcome::SafetyBlocked(reasons)
                    if reasons.contains(&SafetyReason::LargeDataImage)
            ));
        }
    }
}

/// SAFE-001 / CONTRACT-011: Unsupported wins when the same bytes also meet
/// both SafetyBlocked thresholds.
#[test]
fn safe_001_unsupported_precedes_simultaneous_safety_blockers() {
    let policy = SpikePolicy {
        safety_block_line_bytes: 16,
        safety_block_data_image_decoded_bytes: 3,
        ..SpikePolicy::default()
    };
    let bytes = b"\0data:image/png;base64,AAAAAAAAAAAAAAAA)";
    let result = scan_reader(bytes.as_slice(), policy, &AtomicBool::new(false))
        .expect("scan binary plus safety blockers");
    assert!(result.report.max_line_bytes > policy.safety_block_line_bytes);
    assert!(result
        .report
        .largest_data_image_estimate_bytes
        .is_some_and(|size| size > policy.safety_block_data_image_decoded_bytes));
    assert_eq!(
        result.outcome,
        SpikeOutcome::Unsupported(vec![UnsupportedReason::Binary])
    );
}

/// SAFE-003: production decoded-byte policy also covers threshold -1/exact/+1.
#[test]
fn safe_003_production_data_image_decoded_threshold_is_exact() {
    let scratch = ScratchDirectory::create().expect("create scoped scratch directory");
    let policy = SpikePolicy::default();
    let threshold = policy.safety_block_data_image_decoded_bytes;

    for decoded in [threshold - 1, threshold, threshold + 1] {
        let path = scratch.join(&format!("data-image-{decoded}.md"));
        write_data_image_for_decoded_size(&path, decoded).expect("generate data image boundary");
        let result = scan_file(&path, policy).expect("scan data image boundary");
        assert_eq!(
            result.report.largest_data_image_estimate_bytes,
            Some(decoded)
        );
        if decoded > threshold {
            assert!(matches!(
                result.outcome,
                SpikeOutcome::SafetyBlocked(reasons)
                    if reasons.contains(&SafetyReason::LargeDataImage)
            ));
        } else {
            assert_eq!(
                result.outcome,
                SpikeOutcome::Editable(EditableMode::LargeText)
            );
        }
    }
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

/// FILE-001 supporting macOS spike: failure before rename retains the complete
/// old file. This does not claim Windows replace/share-mode semantics.
#[cfg(target_os = "macos")]
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
#[cfg(target_os = "macos")]
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
    let mut file = create_owned_temporary(&temporary).expect("create crash temp file");
    file.write_all(b"complete-but-uncommitted")
        .expect("write crash temp");
    file.sync_all().expect("sync crash temp");
    process::exit(CRASH_EXIT_CODE);
}

/// FILE-001 supporting macOS spike: cleanup accepts only the exact versioned
/// target-owned name, secure regular-file metadata, and two independent age
/// checks. Same-prefix decoys, symlinks, directories, and recent files survive.
#[cfg(target_os = "macos")]
#[test]
fn file_001_crash_temp_is_scoped_and_stale_cleanup_is_selective() {
    use std::os::unix::fs::symlink;

    let scratch = ScratchDirectory::create().expect("create scoped scratch directory");
    let target = scratch.join("document.md");
    let old = b"old-remains-recoverable";
    fs::write(&target, old).expect("write original");
    let target_name = target
        .file_name()
        .and_then(|name| name.to_str())
        .expect("UTF-8 target name");
    let owner_uid = fs::symlink_metadata(&target)
        .expect("target metadata")
        .uid();
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

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let recent = temporary_path_for(&target, now + 60).expect("create recent temp path");
    let mut recent_file = create_owned_temporary(&recent).expect("create recent task temp");
    recent_file
        .write_all(b"recent-must-not-delete")
        .expect("write recent task temp");
    recent_file.sync_all().expect("sync recent task temp");
    drop(recent_file);

    let malformed = scratch.path.join(format!(
        ".{target_name}.mdapp-spike-v1-{timestamp:020}-{owner_uid:010}-{pid:010}-{sequence:020}-extra.tmp",
        timestamp = 1_u64,
        pid = process::id(),
        sequence = 900_u64,
    ));
    fs::write(&malformed, b"same-prefix-malformed").expect("write malformed decoy");

    let wrong_owner_uid = if owner_uid == u32::MAX {
        owner_uid - 1
    } else {
        owner_uid + 1
    };
    let wrong_owner = scratch.path.join(format_temporary_file_name(
        target_name,
        1,
        wrong_owner_uid,
        process::id(),
        901,
    ));
    let mut wrong_owner_file =
        create_owned_temporary(&wrong_owner).expect("create wrong-owner decoy");
    wrong_owner_file
        .write_all(b"wrong-owner-must-not-delete")
        .expect("write wrong-owner decoy");
    wrong_owner_file.sync_all().expect("sync wrong-owner decoy");
    drop(wrong_owner_file);

    let symlink_decoy = scratch.path.join(format_temporary_file_name(
        target_name,
        1,
        owner_uid,
        process::id(),
        902,
    ));
    symlink(&decoy, &symlink_decoy).expect("create exact-name symlink decoy");

    let directory_decoy = scratch.path.join(format_temporary_file_name(
        target_name,
        1,
        owner_uid,
        process::id(),
        903,
    ));
    fs::create_dir(&directory_decoy).expect("create exact-name directory decoy");

    assert_eq!(
        count_task_temporaries(&target).expect("count crash and recent temporaries"),
        2
    );
    assert_eq!(
        cleanup_stale_temporaries(&target, now + 1).expect("clean stale task temp"),
        1
    );
    assert_eq!(
        count_task_temporaries(&target).expect("count after cleanup"),
        1
    );
    assert_eq!(
        fs::read(&recent).expect("read retained recent temp"),
        b"recent-must-not-delete"
    );
    assert_eq!(fs::read(&target).expect("read original after cleanup"), old);
    assert_eq!(
        fs::read(&decoy).expect("read cleanup decoy"),
        b"must-not-delete"
    );
    assert_eq!(
        fs::read(&malformed).expect("read malformed decoy"),
        b"same-prefix-malformed"
    );
    assert_eq!(
        fs::read(&wrong_owner).expect("read wrong-owner decoy"),
        b"wrong-owner-must-not-delete"
    );
    assert!(fs::symlink_metadata(&symlink_decoy)
        .expect("symlink decoy metadata")
        .file_type()
        .is_symlink());
    assert!(directory_decoy.is_dir());
}

/// FILE-001 supporting macOS spike: even an exact, secure, task-owned filename
/// with an old embedded timestamp is retained until its filesystem mtime is
/// strictly older than the cleanup cutoff.
#[cfg(target_os = "macos")]
#[test]
fn file_001_cleanup_preserves_recently_modified_owned_temporary() {
    let scratch = ScratchDirectory::create().expect("create scoped scratch directory");
    let target = scratch.join("document.md");
    fs::write(&target, b"original").expect("write target");
    let recent = temporary_path_for(&target, 1).expect("create old-name recent temp path");
    let mut file = create_owned_temporary(&recent).expect("create old-name recent temp");
    file.write_all(b"recent")
        .expect("write old-name recent temp");
    file.sync_all().expect("sync old-name recent temp");
    drop(file);
    let modified = modified_epoch_seconds(&fs::symlink_metadata(&recent).expect("recent metadata"))
        .expect("recent mtime");

    assert_eq!(
        cleanup_stale_temporaries(&target, modified).expect("run strict recent cleanup"),
        0
    );
    assert_eq!(
        fs::read(&recent).expect("read retained recent temp"),
        b"recent"
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
