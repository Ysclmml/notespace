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
use std::os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt};
#[cfg(target_os = "macos")]
use uuid::Uuid;

const KIB: u64 = 1024;
const MIB: u64 = 1024 * KIB;
const SCAN_BUFFER_BYTES: usize = 64 * 1024;
const JSON_ESCAPE_BUFFER_BYTES: usize = SCAN_BUFFER_BYTES * 6;
const SCRATCH_PREFIX: &str = "markdown-workspace-p0-spike-02-";
#[cfg(target_os = "macos")]
const CRASH_EXIT_CODE: i32 = 86;

static SCRATCH_SEQUENCE: AtomicU64 = AtomicU64::new(0);

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
                if matched > 0 && is_url_ignored_ascii_whitespace(byte) {
                    // The URL parser strips ASCII TAB/LF/CR before parsing.
                    // Keep the partial prefix so `data:im\tage/` cannot evade
                    // detection merely by crossing a scanner chunk boundary.
                    DataImageStage::Seeking(matched)
                } else if matched >= Self::MEDIA_TYPE_STEM.len()
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

fn is_url_ignored_ascii_whitespace(byte: u8) -> bool {
    matches!(byte, b'\t' | b'\n' | b'\r')
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
const TEMP_NAME_VERSION: &str = "v2";
#[cfg(target_os = "macos")]
const MANIFEST_VERSION: &str = "mdapp-spike-manifest-v1";
#[cfg(target_os = "macos")]
const MANIFEST_FILE_PREFIX: &str = "mdapp-spike-v1-";
#[cfg(target_os = "macos")]
const MANIFEST_MAX_BYTES: u64 = 4 * 1024;
#[cfg(target_os = "macos")]
const U32_DIGITS: usize = 10;
#[cfg(target_os = "macos")]
const U64_DIGITS: usize = 20;

#[cfg(target_os = "macos")]
#[derive(Clone, Debug, PartialEq, Eq)]
struct OperationManifest {
    operation_id: Uuid,
    target_file_name: String,
    owner_uid: u32,
    target_dev: u64,
    target_ino: u64,
    temporary_dev: u64,
    temporary_ino: u64,
    issued_at_epoch_seconds: u64,
}

#[cfg(target_os = "macos")]
#[derive(Clone, Debug, PartialEq, Eq)]
struct LoadedManifest {
    manifest: OperationManifest,
    file_dev: u64,
    file_ino: u64,
}

#[cfg(target_os = "macos")]
#[derive(Debug)]
struct IssuedTemporary {
    file: File,
    temporary_path: PathBuf,
    manifest_path: PathBuf,
    manifest: OperationManifest,
}

#[cfg(target_os = "macos")]
#[derive(Debug)]
struct RecoveryStore {
    journal_directory: PathBuf,
    quarantine_directory: PathBuf,
}

#[cfg(target_os = "macos")]
#[derive(Debug)]
struct QuarantinedMismatch {
    operation_id: Uuid,
    path: PathBuf,
}

#[cfg(target_os = "macos")]
#[derive(Debug, Default)]
struct CleanupReport {
    removed: usize,
    quarantined_mismatches: Vec<QuarantinedMismatch>,
}

#[cfg(target_os = "macos")]
impl RecoveryStore {
    fn create(root: &Path, target: &Path) -> io::Result<Self> {
        let target_metadata = fs::symlink_metadata(target)?;
        let target_parent = target
            .parent()
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "target has no parent"))?;
        let journal_directory = root.join(".mdapp-spike-journal-v1");
        let quarantine_directory = target_parent.join(".mdapp-spike-quarantine-v1");
        create_private_directory(&journal_directory, target_metadata.uid())?;
        create_private_directory(&quarantine_directory, target_metadata.uid())?;
        let parent_metadata = fs::symlink_metadata(target_parent)?;
        let quarantine_metadata = fs::symlink_metadata(&quarantine_directory)?;
        if parent_metadata.dev() != quarantine_metadata.dev() {
            return Err(io::Error::other(
                "quarantine must share the target filesystem",
            ));
        }
        Ok(Self {
            journal_directory,
            quarantine_directory,
        })
    }
}

#[cfg(target_os = "macos")]
fn create_private_directory(path: &Path, expected_uid: u32) -> io::Result<()> {
    let mut builder = fs::DirBuilder::new();
    builder.mode(0o700);
    match builder.create(path) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
        Err(error) => return Err(error),
    }
    let metadata = fs::symlink_metadata(path)?;
    if !metadata.file_type().is_dir()
        || metadata.uid() != expected_uid
        || metadata.mode() & 0o077 != 0
    {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "recovery directory is not private and owner-matched",
        ));
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn parse_fixed_decimal<T: std::str::FromStr>(value: &str, digits: usize) -> Option<T> {
    (value.len() == digits && value.bytes().all(|byte| byte.is_ascii_digit()))
        .then(|| value.parse().ok())
        .flatten()
}

#[cfg(target_os = "macos")]
fn parse_uuid_v4(value: &str) -> Option<Uuid> {
    let parsed = Uuid::parse_str(value).ok()?;
    if parsed.hyphenated().to_string() != value
        || parsed.as_bytes()[6] & 0xf0 != 0x40
        || parsed.as_bytes()[8] & 0xc0 != 0x80
    {
        return None;
    }
    Some(parsed)
}

#[cfg(target_os = "macos")]
fn format_temporary_file_name(target_file_name: &str, operation_id: Uuid) -> String {
    format!(".{target_file_name}.mdapp-spike-{TEMP_NAME_VERSION}-{operation_id}.tmp")
}

#[cfg(target_os = "macos")]
fn parse_temporary_file_name(target_file_name: &str, candidate: &str) -> Option<Uuid> {
    let prefix = format!(".{target_file_name}.mdapp-spike-{TEMP_NAME_VERSION}-");
    parse_uuid_v4(candidate.strip_prefix(&prefix)?.strip_suffix(".tmp")?)
}

#[cfg(target_os = "macos")]
fn manifest_path_for(store: &RecoveryStore, operation_id: Uuid) -> PathBuf {
    store
        .journal_directory
        .join(format!("{MANIFEST_FILE_PREFIX}{operation_id}.manifest"))
}

#[cfg(target_os = "macos")]
fn parse_manifest_file_name(candidate: &str) -> Option<Uuid> {
    parse_uuid_v4(
        candidate
            .strip_prefix(MANIFEST_FILE_PREFIX)?
            .strip_suffix(".manifest")?,
    )
}

#[cfg(target_os = "macos")]
fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut encoded = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        encoded.push(HEX[(byte >> 4) as usize] as char);
        encoded.push(HEX[(byte & 0x0f) as usize] as char);
    }
    encoded
}

#[cfg(target_os = "macos")]
fn hex_decode(value: &str) -> Option<Vec<u8>> {
    if !value.len().is_multiple_of(2) {
        return None;
    }

    let (pairs, remainder) = value.as_bytes().as_chunks::<2>();
    debug_assert!(remainder.is_empty());
    pairs
        .iter()
        .map(|pair| {
            let high = (pair[0] as char).to_digit(16)? as u8;
            let low = (pair[1] as char).to_digit(16)? as u8;
            Some((high << 4) | low)
        })
        .collect()
}

#[cfg(target_os = "macos")]
fn serialize_manifest(manifest: &OperationManifest) -> String {
    format!(
        "{MANIFEST_VERSION}\noperation_id={}\ntarget_name_hex={}\nowner_uid={:010}\ntarget_dev={:020}\ntarget_ino={:020}\ntemporary_dev={:020}\ntemporary_ino={:020}\nissued_at={:020}\n",
        manifest.operation_id,
        hex_encode(manifest.target_file_name.as_bytes()),
        manifest.owner_uid,
        manifest.target_dev,
        manifest.target_ino,
        manifest.temporary_dev,
        manifest.temporary_ino,
        manifest.issued_at_epoch_seconds,
    )
}

#[cfg(target_os = "macos")]
fn parse_manifest(contents: &str) -> Option<OperationManifest> {
    let mut lines = contents.lines();
    if lines.next()? != MANIFEST_VERSION {
        return None;
    }
    let operation_id = parse_uuid_v4(lines.next()?.strip_prefix("operation_id=")?)?;
    let target_file_name =
        String::from_utf8(hex_decode(lines.next()?.strip_prefix("target_name_hex=")?)?).ok()?;
    let owner_uid = parse_fixed_decimal(lines.next()?.strip_prefix("owner_uid=")?, U32_DIGITS)?;
    let target_dev = parse_fixed_decimal(lines.next()?.strip_prefix("target_dev=")?, U64_DIGITS)?;
    let target_ino = parse_fixed_decimal(lines.next()?.strip_prefix("target_ino=")?, U64_DIGITS)?;
    let temporary_dev =
        parse_fixed_decimal(lines.next()?.strip_prefix("temporary_dev=")?, U64_DIGITS)?;
    let temporary_ino =
        parse_fixed_decimal(lines.next()?.strip_prefix("temporary_ino=")?, U64_DIGITS)?;
    let issued_at_epoch_seconds =
        parse_fixed_decimal(lines.next()?.strip_prefix("issued_at=")?, U64_DIGITS)?;
    if lines.next().is_some() {
        return None;
    }
    Some(OperationManifest {
        operation_id,
        target_file_name,
        owner_uid,
        target_dev,
        target_ino,
        temporary_dev,
        temporary_ino,
        issued_at_epoch_seconds,
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
fn persist_manifest(store: &RecoveryStore, manifest: &OperationManifest) -> io::Result<PathBuf> {
    let path = manifest_path_for(store, manifest.operation_id);
    let result = (|| {
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .mode(0o600)
            .open(&path)?;
        file.write_all(serialize_manifest(manifest).as_bytes())?;
        file.flush()?;
        file.sync_all()?;
        sync_directory(&store.journal_directory)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&path);
    }
    result.map(|()| path)
}

#[cfg(target_os = "macos")]
fn issue_owned_temporary(
    target: &Path,
    store: &RecoveryStore,
    issued_at_epoch_seconds: u64,
) -> io::Result<IssuedTemporary> {
    let target_metadata = fs::symlink_metadata(target)?;
    if !target_metadata.file_type().is_file() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "target must be a regular file",
        ));
    }
    let parent = target
        .parent()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "target has no parent"))?;
    let target_file_name = target
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "target has no file name"))?;

    for _ in 0..8 {
        let operation_id = Uuid::new_v4();
        let temporary_path =
            parent.join(format_temporary_file_name(target_file_name, operation_id));
        let file = match create_owned_temporary(&temporary_path) {
            Ok(file) => file,
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        };
        let temporary_metadata = fs::symlink_metadata(&temporary_path)?;
        let manifest = OperationManifest {
            operation_id,
            target_file_name: target_file_name.to_owned(),
            owner_uid: target_metadata.uid(),
            target_dev: target_metadata.dev(),
            target_ino: target_metadata.ino(),
            temporary_dev: temporary_metadata.dev(),
            temporary_ino: temporary_metadata.ino(),
            issued_at_epoch_seconds,
        };
        if !temporary_identity_matches(&manifest, &temporary_metadata)
            || temporary_metadata.dev() != target_metadata.dev()
        {
            drop(file);
            let _ = fs::remove_file(&temporary_path);
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "issued temporary is not private, owner-matched, and on the target filesystem",
            ));
        }
        match persist_manifest(store, &manifest) {
            Ok(manifest_path) => {
                return Ok(IssuedTemporary {
                    file,
                    temporary_path,
                    manifest_path,
                    manifest,
                });
            }
            Err(error) => {
                drop(file);
                let _ = fs::remove_file(&temporary_path);
                return Err(error);
            }
        }
    }
    Err(io::Error::new(
        io::ErrorKind::AlreadyExists,
        "could not allocate a unique operation UUID",
    ))
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
    store: &RecoveryStore,
    new_bytes: &[u8],
    fault: ReplaceFault,
) -> io::Result<()> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let mut issued = issue_owned_temporary(target, store, now)?;
    debug_assert_eq!(issued.temporary_path.parent(), target.parent());
    let mut committed = false;

    let result = (|| {
        if fault == ReplaceFault::AfterTempCreate {
            return Err(injected_failure("temp-create"));
        }

        let split = new_bytes.len() / 2;
        issued.file.write_all(&new_bytes[..split])?;
        if fault == ReplaceFault::AfterPartialWrite {
            return Err(injected_failure("partial-write"));
        }
        issued.file.write_all(&new_bytes[split..])?;
        issued.file.flush()?;
        issued.file.sync_all()?;
        if fault == ReplaceFault::AfterTempSync {
            return Err(injected_failure("temp-sync"));
        }

        fs::rename(&issued.temporary_path, target)?;
        committed = true;
        if fault == ReplaceFault::AfterRename {
            return Err(injected_failure("rename-commit"));
        }

        sync_parent_directory(target)?;
        Ok(())
    })();
    drop(issued.file);

    let mut cleanup_error = None;
    if !committed {
        match fs::remove_file(&issued.temporary_path) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => cleanup_error = Some(error),
        }
    }
    if let Err(error) = fs::remove_file(&issued.manifest_path) {
        if error.kind() != io::ErrorKind::NotFound && cleanup_error.is_none() {
            cleanup_error = Some(error);
        }
    }
    if let Err(error) = sync_directory(&store.journal_directory) {
        if cleanup_error.is_none() {
            cleanup_error = Some(error);
        }
    }

    match (result, cleanup_error) {
        (Ok(()), Some(error)) => Err(error),
        (result, _) => result,
    }
}

#[cfg(target_os = "macos")]
fn sync_parent_directory(target: &Path) -> io::Result<()> {
    sync_directory(
        target
            .parent()
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "target has no parent"))?,
    )
}

#[cfg(target_os = "macos")]
fn sync_directory(directory: &Path) -> io::Result<()> {
    File::open(directory)?.sync_all()
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
fn secure_manifest_metadata(metadata: &fs::Metadata) -> bool {
    metadata.file_type().is_file() && metadata.nlink() == 1 && metadata.mode() & 0o777 == 0o600
}

#[cfg(target_os = "macos")]
fn temporary_identity_matches(manifest: &OperationManifest, metadata: &fs::Metadata) -> bool {
    metadata.file_type().is_file()
        && metadata.nlink() == 1
        && metadata.mode() & 0o777 == 0o600
        && metadata.uid() == manifest.owner_uid
        && metadata.dev() == manifest.temporary_dev
        && metadata.ino() == manifest.temporary_ino
}

#[cfg(target_os = "macos")]
fn manifest_matches_target(
    manifest: &OperationManifest,
    target: &Path,
    target_metadata: &fs::Metadata,
) -> bool {
    target_metadata.file_type().is_file()
        && target_metadata.uid() == manifest.owner_uid
        && target_metadata.dev() == manifest.target_dev
        && target_metadata.ino() == manifest.target_ino
        && target
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name == manifest.target_file_name)
}

#[cfg(target_os = "macos")]
fn load_manifest(path: &Path, expected_operation_id: Uuid) -> io::Result<Option<LoadedManifest>> {
    let path_metadata_before = fs::symlink_metadata(path)?;
    if !secure_manifest_metadata(&path_metadata_before) {
        return Ok(None);
    }
    let file = File::open(path)?;
    let file_metadata = file.metadata()?;
    let path_metadata_after = fs::symlink_metadata(path)?;
    if !secure_manifest_metadata(&file_metadata)
        || !secure_manifest_metadata(&path_metadata_after)
        || path_metadata_before.dev() != file_metadata.dev()
        || path_metadata_before.ino() != file_metadata.ino()
        || path_metadata_after.dev() != file_metadata.dev()
        || path_metadata_after.ino() != file_metadata.ino()
    {
        return Ok(None);
    }
    let mut bytes = Vec::new();
    file.take(MANIFEST_MAX_BYTES + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MANIFEST_MAX_BYTES {
        return Ok(None);
    }
    let Some(manifest) = std::str::from_utf8(&bytes).ok().and_then(parse_manifest) else {
        return Ok(None);
    };
    Ok((manifest.operation_id == expected_operation_id
        && file_metadata.uid() == manifest.owner_uid)
        .then_some(LoadedManifest {
            manifest,
            file_dev: file_metadata.dev(),
            file_ino: file_metadata.ino(),
        }))
}

#[cfg(target_os = "macos")]
fn quarantine_path_for(store: &RecoveryStore, operation_id: Uuid) -> PathBuf {
    loop {
        let quarantine_id = Uuid::new_v4();
        let path = store.quarantine_directory.join(format!(
            "mdapp-spike-v1-{operation_id}-{quarantine_id}.quarantine"
        ));
        if !path.exists() {
            return path;
        }
    }
}

#[cfg(target_os = "macos")]
fn cleanup_stale_temporaries(
    target: &Path,
    store: &RecoveryStore,
    older_than_epoch_seconds: u64,
) -> io::Result<CleanupReport> {
    cleanup_stale_temporaries_with_hook(target, store, older_than_epoch_seconds, |_, _| Ok(()))
}

#[cfg(target_os = "macos")]
fn cleanup_stale_temporaries_with_hook<F>(
    target: &Path,
    store: &RecoveryStore,
    older_than_epoch_seconds: u64,
    mut before_quarantine: F,
) -> io::Result<CleanupReport>
where
    F: FnMut(&Path, &OperationManifest) -> io::Result<()>,
{
    let parent = target
        .parent()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "target has no parent"))?;
    let target_metadata = fs::symlink_metadata(target)?;
    let mut report = CleanupReport::default();

    for entry in fs::read_dir(&store.journal_directory)? {
        let entry = entry?;
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            continue;
        };
        let Some(operation_id) = parse_manifest_file_name(name) else {
            continue;
        };
        let Some(loaded_manifest) = load_manifest(&entry.path(), operation_id)? else {
            continue;
        };
        let manifest = &loaded_manifest.manifest;
        if !manifest_matches_target(manifest, target, &target_metadata)
            || manifest.issued_at_epoch_seconds >= older_than_epoch_seconds
        {
            continue;
        }
        let temporary_path = parent.join(format_temporary_file_name(
            &manifest.target_file_name,
            manifest.operation_id,
        ));
        let temporary_metadata = match fs::symlink_metadata(&temporary_path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
            Err(error) => return Err(error),
        };
        if !temporary_identity_matches(manifest, &temporary_metadata)
            || modified_epoch_seconds(&temporary_metadata)
                .is_none_or(|modified| modified >= older_than_epoch_seconds)
        {
            continue;
        }

        before_quarantine(&temporary_path, manifest)?;
        let quarantine_path = quarantine_path_for(store, manifest.operation_id);
        fs::rename(&temporary_path, &quarantine_path)?;
        sync_directory(&store.quarantine_directory)?;

        let quarantined_metadata = fs::symlink_metadata(&quarantine_path)?;
        let target_still_matches = fs::symlink_metadata(target)
            .ok()
            .is_some_and(|metadata| manifest_matches_target(manifest, target, &metadata));
        let manifest_still_matches = load_manifest(&entry.path(), operation_id)?
            .is_some_and(|after| after == loaded_manifest);
        if !temporary_identity_matches(manifest, &quarantined_metadata)
            || !target_still_matches
            || !manifest_still_matches
        {
            report.quarantined_mismatches.push(QuarantinedMismatch {
                operation_id: manifest.operation_id,
                path: quarantine_path,
            });
            continue;
        }
        fs::remove_file(&quarantine_path)?;
        fs::remove_file(entry.path())?;
        sync_directory(&store.quarantine_directory)?;
        sync_directory(&store.journal_directory)?;
        report.removed += 1;
    }

    Ok(report)
}

#[cfg(target_os = "macos")]
fn count_task_temporaries(target: &Path, store: &RecoveryStore) -> io::Result<usize> {
    let parent = target
        .parent()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "target has no parent"))?;
    let target_metadata = fs::symlink_metadata(target)?;
    let mut count = 0;
    for entry in fs::read_dir(&store.journal_directory)? {
        let entry = entry?;
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            continue;
        };
        let Some(operation_id) = parse_manifest_file_name(name) else {
            continue;
        };
        let Some(loaded_manifest) = load_manifest(&entry.path(), operation_id)? else {
            continue;
        };
        let manifest = loaded_manifest.manifest;
        if !manifest_matches_target(&manifest, target, &target_metadata) {
            continue;
        }
        let temporary_path = parent.join(format_temporary_file_name(
            &manifest.target_file_name,
            manifest.operation_id,
        ));
        if fs::symlink_metadata(temporary_path)
            .ok()
            .is_some_and(|metadata| temporary_identity_matches(&manifest, &metadata))
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

/// SAFE-003: URL preprocessing strips TAB/LF/CR even inside `data:image/`.
/// Every insertion position and every possible split through the obfuscated
/// prefix is exercised with the real 512 KiB + 1 decoded-byte boundary. A
/// one-byte read policy additionally makes every byte in the full payload a
/// transport boundary.
#[test]
fn safe_003_prefix_ascii_tab_lf_cr_cannot_evade_at_any_chunk_boundary() {
    let policy = SpikePolicy::default();
    let decoded = policy.safety_block_data_image_decoded_bytes + 1;
    let canonical = data_image_bytes_for_decoded_size(decoded);
    let prefix_start = canonical
        .windows(DataImageDetector::PREFIX.len())
        .position(|window| window.eq_ignore_ascii_case(DataImageDetector::PREFIX))
        .expect("canonical data image prefix");

    for ignored in *b"\t\n\r" {
        for insertion_at in 0..=DataImageDetector::PREFIX.len() {
            let mut candidate = canonical.clone();
            candidate.insert(prefix_start + insertion_at, ignored);
            let obfuscated_prefix_end = prefix_start + DataImageDetector::PREFIX.len() + 1;

            let one_byte_result = scan_reader(
                candidate.as_slice(),
                SpikePolicy {
                    read_buffer_bytes: 1,
                    ..policy
                },
                &AtomicBool::new(false),
            )
            .expect("scan one-byte chunks across obfuscated data image");
            assert_large_data_image_detected(
                &one_byte_result,
                decoded,
                ignored,
                insertion_at,
                usize::MAX,
            );

            for split_at in prefix_start..=obfuscated_prefix_end {
                let result = scan_reader(
                    SplitOnceReader::new(&candidate, split_at),
                    policy,
                    &AtomicBool::new(false),
                )
                .expect("scan split obfuscated data image");
                assert_large_data_image_detected(&result, decoded, ignored, insertion_at, split_at);
            }
        }
    }
}

fn assert_large_data_image_detected(
    result: &SpikeScanResult,
    decoded: u64,
    ignored: u8,
    insertion_at: usize,
    split_at: usize,
) {
    assert_eq!(
        result.report.detected_data_image_count, 1,
        "ignored={ignored:?}, insertion_at={insertion_at}, split_at={split_at}"
    );
    assert_eq!(result.report.uncertain_data_image_count, 0);
    assert_eq!(
        result.report.largest_data_image_estimate_bytes,
        Some(decoded)
    );
    assert!(matches!(
        &result.outcome,
        SpikeOutcome::SafetyBlocked(reasons)
            if reasons.contains(&SafetyReason::LargeDataImage)
    ));
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
        let store = RecoveryStore::create(&scratch.path, &target).expect("create recovery store");
        assert!(same_directory_atomic_replace(&target, &store, new, fault).is_err());
        assert_eq!(fs::read(&target).expect("read old version"), old);
        assert_eq!(
            count_task_temporaries(&target, &store).expect("count temporary files"),
            0
        );
    }

    let scratch = ScratchDirectory::create().expect("create scoped scratch directory");
    let target = scratch.join("document.md");
    fs::write(&target, old).expect("write old version");
    let store = RecoveryStore::create(&scratch.path, &target).expect("create recovery store");
    same_directory_atomic_replace(&target, &store, new, ReplaceFault::None)
        .expect("commit atomic replacement");
    assert_eq!(fs::read(&target).expect("read new version"), new);
    assert_eq!(
        count_task_temporaries(&target, &store).expect("count temporary files"),
        0
    );

    let scratch = ScratchDirectory::create().expect("create scoped scratch directory");
    let target = scratch.join("document.md");
    fs::write(&target, old).expect("write old version");
    let store = RecoveryStore::create(&scratch.path, &target).expect("create recovery store");
    assert!(
        same_directory_atomic_replace(&target, &store, new, ReplaceFault::AfterRename).is_err()
    );
    assert_eq!(fs::read(&target).expect("read committed version"), new);
    assert_eq!(
        count_task_temporaries(&target, &store).expect("count temporary files"),
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
    let root = PathBuf::from(directory);
    let target = root.join(target_name);
    let store = RecoveryStore::create(&root, &target).expect("create crash recovery store");
    let mut issued =
        issue_owned_temporary(&target, &store, 1).expect("issue crash temporary and manifest");
    issued
        .file
        .write_all(b"complete-but-uncommitted")
        .expect("write crash temp");
    issued.file.sync_all().expect("sync crash temp");
    process::exit(CRASH_EXIT_CODE);
}

/// FILE-001 supporting macOS spike: cleanup starts from the durable Rust-issued
/// manifest, never by globbing a predictable filename. Exact-shape unissued
/// same-owner decoys, malformed names, symlinks, directories, and recent issued
/// files all survive.
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
    let store = RecoveryStore::create(&scratch.path, &target).expect("create recovery store");
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
    let mut recent = issue_owned_temporary(&target, &store, now + 60)
        .expect("issue recent temporary and manifest");
    recent
        .file
        .write_all(b"recent-must-not-delete")
        .expect("write recent task temp");
    recent.file.sync_all().expect("sync recent task temp");
    let recent_path = recent.temporary_path.clone();
    assert_eq!(
        parse_temporary_file_name(
            target_name,
            recent_path.file_name().unwrap().to_str().unwrap()
        ),
        Some(recent.manifest.operation_id)
    );
    drop(recent.file);

    let malformed = scratch
        .path
        .join(format!(".{target_name}.mdapp-spike-v2-not-a-uuid.tmp"));
    fs::write(&malformed, b"same-prefix-malformed").expect("write malformed decoy");

    let unissued_id = Uuid::new_v4();
    let unissued = scratch
        .path
        .join(format_temporary_file_name(target_name, unissued_id));
    let mut unissued_file =
        create_owned_temporary(&unissued).expect("create exact-shape unissued decoy");
    unissued_file
        .write_all(b"same-owner-unissued-must-not-delete")
        .expect("write unissued decoy");
    unissued_file.sync_all().expect("sync unissued decoy");
    drop(unissued_file);
    assert_eq!(
        parse_temporary_file_name(target_name, unissued.file_name().unwrap().to_str().unwrap()),
        Some(unissued_id)
    );
    assert!(!manifest_path_for(&store, unissued_id).exists());

    let symlink_decoy = scratch
        .path
        .join(format_temporary_file_name(target_name, Uuid::new_v4()));
    symlink(&decoy, &symlink_decoy).expect("create exact-name symlink decoy");

    let directory_decoy = scratch
        .path
        .join(format_temporary_file_name(target_name, Uuid::new_v4()));
    fs::create_dir(&directory_decoy).expect("create exact-name directory decoy");

    assert_eq!(
        count_task_temporaries(&target, &store).expect("count crash and recent temporaries"),
        2
    );
    let cleanup =
        cleanup_stale_temporaries(&target, &store, now + 1).expect("clean stale issued temporary");
    assert_eq!(cleanup.removed, 1);
    assert!(cleanup.quarantined_mismatches.is_empty());
    assert_eq!(
        count_task_temporaries(&target, &store).expect("count after cleanup"),
        1
    );
    assert_eq!(
        fs::read(&recent_path).expect("read retained recent temp"),
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
        fs::read(&unissued).expect("read exact-shape unissued decoy"),
        b"same-owner-unissued-must-not-delete"
    );
    assert!(fs::symlink_metadata(&symlink_decoy)
        .expect("symlink decoy metadata")
        .file_type()
        .is_symlink());
    assert!(directory_decoy.is_dir());
}

/// FILE-001 supporting macOS spike: even a manifest-issued temporary with an
/// old issuance time is retained until its filesystem mtime is strictly older
/// than the cleanup cutoff.
#[cfg(target_os = "macos")]
#[test]
fn file_001_cleanup_preserves_recently_modified_owned_temporary() {
    let scratch = ScratchDirectory::create().expect("create scoped scratch directory");
    let target = scratch.join("document.md");
    fs::write(&target, b"original").expect("write target");
    let store = RecoveryStore::create(&scratch.path, &target).expect("create recovery store");
    let mut recent =
        issue_owned_temporary(&target, &store, 1).expect("issue old-manifest recent temporary");
    recent
        .file
        .write_all(b"recent")
        .expect("write old-name recent temp");
    recent.file.sync_all().expect("sync old-name recent temp");
    let recent_path = recent.temporary_path.clone();
    drop(recent.file);
    let modified =
        modified_epoch_seconds(&fs::symlink_metadata(&recent_path).expect("recent metadata"))
            .expect("recent mtime");

    let cleanup =
        cleanup_stale_temporaries(&target, &store, modified).expect("run strict recent cleanup");
    assert_eq!(cleanup.removed, 0);
    assert!(cleanup.quarantined_mismatches.is_empty());
    assert_eq!(
        fs::read(&recent_path).expect("read retained recent temp"),
        b"recent"
    );
}

/// FILE-001 supporting macOS spike: a deterministic swap after the initial
/// identity check cannot cause deletion of the replacement. The replacement is
/// moved into the private, same-filesystem quarantine, detected by inode/dev,
/// retained, and demonstrably recoverable by an explicit rename.
#[cfg(target_os = "macos")]
#[test]
fn file_001_path_swap_is_quarantined_not_deleted_and_recoverable() {
    let scratch = ScratchDirectory::create().expect("create scoped scratch directory");
    let target = scratch.join("document.md");
    fs::write(&target, b"original-remains-intact").expect("write target");
    let store = RecoveryStore::create(&scratch.path, &target).expect("create recovery store");
    let mut issued =
        issue_owned_temporary(&target, &store, 1).expect("issue stale temporary and manifest");
    issued
        .file
        .write_all(b"issued-temporary")
        .expect("write issued temporary");
    issued.file.sync_all().expect("sync issued temporary");
    let issued_path = issued.temporary_path.clone();
    let issued_manifest_path = issued.manifest_path.clone();
    let operation_id = issued.manifest.operation_id;
    drop(issued.file);

    let swap_source = scratch.join("same-owner-path-swap-decoy");
    let mut swap_file = create_owned_temporary(&swap_source).expect("create path-swap decoy");
    swap_file
        .write_all(b"decoy-must-not-be-deleted")
        .expect("write path-swap decoy");
    swap_file.sync_all().expect("sync path-swap decoy");
    drop(swap_file);
    let rescued_issued = scratch.join("rescued-issued-temporary");
    let cutoff = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        + 1;

    let report =
        cleanup_stale_temporaries_with_hook(&target, &store, cutoff, |candidate, _manifest| {
            fs::rename(candidate, &rescued_issued)?;
            fs::rename(&swap_source, candidate)
        })
        .expect("run cleanup with deterministic path swap");

    assert_eq!(report.removed, 0);
    assert_eq!(report.quarantined_mismatches.len(), 1);
    let mismatch = &report.quarantined_mismatches[0];
    assert_eq!(mismatch.operation_id, operation_id);
    assert_eq!(
        fs::read(&mismatch.path).expect("read quarantined decoy"),
        b"decoy-must-not-be-deleted"
    );
    assert_eq!(
        fs::read(&rescued_issued).expect("read rescued issued temporary"),
        b"issued-temporary"
    );
    assert!(!issued_path.exists());
    assert!(issued_manifest_path.exists());
    assert_eq!(
        fs::read(&target).expect("read unchanged target"),
        b"original-remains-intact"
    );

    let recovered_decoy = scratch.join("operator-recovered-decoy");
    fs::rename(&mismatch.path, &recovered_decoy).expect("recover quarantined mismatch by rename");
    assert_eq!(
        fs::read(&recovered_decoy).expect("read recovered decoy"),
        b"decoy-must-not-be-deleted"
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
