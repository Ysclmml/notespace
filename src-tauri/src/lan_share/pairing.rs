use super::model::{
    encode_opaque, DeviceCredential, DeviceId, DeviceToken, EntropySource, PairedDevice,
    PairingChallenge, PairingClaimSecret, PairingNonce, PairingRequestId, PairingRequestReceipt,
    PairingVerificationCode, PendingPairingRequest, ShareError, ShareLimits, ShareResult,
};
use std::collections::HashMap;

const ID_BYTES: usize = 16;
const NONCE_BYTES: usize = 24;
const CLAIM_BYTES: usize = 32;
const TOKEN_BYTES: usize = 32;
const VERIFICATION_CODE_LIMIT: u32 = 1_000_000;
const VERIFICATION_CODE_MASK: u32 = 0x0f_ffff;
const MAX_GENERATION_ATTEMPTS: usize = 16;
const MIN_PAIRING_TTL_MS: u64 = 30_000;
const MAX_PAIRING_TTL_MS: u64 = 10 * 60_000;
const MAX_DEVICE_NAME_CHARS: usize = 80;

#[derive(Clone)]
struct StoredChallenge {
    expires_at_epoch_ms: u64,
}

#[derive(Clone)]
struct StoredPairingRequest {
    public: PendingPairingRequest,
    claim_secret: PairingClaimSecret,
    approved_credential: Option<DeviceCredential>,
}

#[derive(Clone)]
struct StoredDevice {
    public: PairedDevice,
    token: DeviceToken,
}

/// In-memory pairing state with an explicit desktop approval boundary.
///
/// A QR challenge can only create a phone request. It cannot issue a device
/// token. The desktop adapter must separately approve the matching short code,
/// after which the phone can claim the credential exactly once with its private
/// claim secret. Credentials remain valid until explicitly revoked.
pub struct PairingState {
    limits: ShareLimits,
    challenges: HashMap<PairingNonce, StoredChallenge>,
    requests: HashMap<PairingRequestId, StoredPairingRequest>,
    devices: HashMap<DeviceId, StoredDevice>,
}

impl PairingState {
    pub fn new(limits: ShareLimits) -> Self {
        Self {
            limits,
            challenges: HashMap::new(),
            requests: HashMap::new(),
            devices: HashMap::new(),
        }
    }

    /// Desktop-only: create the one-time nonce placed in a pairing QR code.
    pub fn begin_pairing(
        &mut self,
        now_epoch_ms: u64,
        ttl_ms: u64,
        entropy: &mut impl EntropySource,
    ) -> ShareResult<PairingChallenge> {
        self.remove_expired(now_epoch_ms);
        if !(MIN_PAIRING_TTL_MS..=MAX_PAIRING_TTL_MS).contains(&ttl_ms) {
            return Err(ShareError::new(
                "invalidPairingLifetime",
                "pairing lifetime must be between 30 seconds and 10 minutes",
            ));
        }
        if self.pending_operation_count() >= self.limits.max_pending_pairings {
            return Err(ShareError::new(
                "pairingLimit",
                "too many pairing requests are already pending",
            ));
        }
        let nonce = unique_secret("pair_", NONCE_BYTES, entropy, |candidate| {
            self.challenges
                .keys()
                .any(|existing| existing.as_str() == candidate)
        })?;
        let expires_at_epoch_ms = now_epoch_ms.saturating_add(ttl_ms);
        let nonce = PairingNonce::from_generated(nonce);
        self.challenges.insert(
            nonce.clone(),
            StoredChallenge {
                expires_at_epoch_ms,
            },
        );
        Ok(PairingChallenge {
            nonce,
            expires_at_epoch_ms,
        })
    }

    /// Phone-facing: consume a QR nonce and apply for desktop approval.
    ///
    /// The returned claim secret stays on the phone. The desktop sees only the
    /// device name, request ID and short verification code.
    pub fn request_pairing(
        &mut self,
        nonce: &PairingNonce,
        device_name: &str,
        now_epoch_ms: u64,
        entropy: &mut impl EntropySource,
    ) -> ShareResult<PairingRequestReceipt> {
        self.remove_expired(now_epoch_ms);
        validate_device_name(device_name)?;
        if !has_secret_shape(nonce.as_str(), "pair_", NONCE_BYTES) {
            return Err(invalid_pairing_nonce());
        }
        let expires_at_epoch_ms = self
            .challenges
            .get(nonce)
            .map(|challenge| challenge.expires_at_epoch_ms)
            .ok_or_else(invalid_pairing_nonce)?;

        let request_id = unique_secret("request_", ID_BYTES, entropy, |candidate| {
            self.requests
                .keys()
                .any(|existing| existing.as_str() == candidate)
        })?;
        let claim_secret = unique_secret("claim_", CLAIM_BYTES, entropy, |candidate| {
            self.requests
                .values()
                .any(|request| constant_time_eq(request.claim_secret.as_str(), candidate))
        })?;
        let verification_code = unique_verification_code(entropy, |candidate| {
            self.requests.values().any(|request| {
                constant_time_eq(request.public.verification_code.as_str(), candidate)
            })
        })?;

        // Consume the QR nonce only after all fallible generation succeeds.
        self.challenges.remove(nonce);
        let request_id = PairingRequestId::from_generated(request_id);
        let claim_secret = PairingClaimSecret::from_generated(claim_secret);
        let verification_code = PairingVerificationCode::from_generated(verification_code);
        let public = PendingPairingRequest {
            request_id: request_id.clone(),
            device_name: device_name.trim().to_owned(),
            verification_code: verification_code.clone(),
            requested_at_epoch_ms: now_epoch_ms,
            expires_at_epoch_ms,
        };
        self.requests.insert(
            request_id.clone(),
            StoredPairingRequest {
                public,
                claim_secret: claim_secret.clone(),
                approved_credential: None,
            },
        );
        Ok(PairingRequestReceipt {
            request_id,
            claim_secret,
            verification_code,
            expires_at_epoch_ms,
        })
    }

    /// Desktop-only: approve one visible request after confirming its short
    /// code. This prepares, but does not expose, the bearer credential.
    pub fn approve_pairing(
        &mut self,
        request_id: &PairingRequestId,
        verification_code: &PairingVerificationCode,
        now_epoch_ms: u64,
        entropy: &mut impl EntropySource,
    ) -> ShareResult<PairedDevice> {
        self.remove_expired(now_epoch_ms);
        if !has_secret_shape(request_id.as_str(), "request_", ID_BYTES) {
            return Err(invalid_pairing_request());
        }
        if !has_verification_code_shape(verification_code.as_str()) {
            return Err(ShareError::new(
                "pairingCodeMismatch",
                "pairing verification code does not match",
            ));
        }
        let request = self
            .requests
            .get(request_id)
            .ok_or_else(invalid_pairing_request)?;
        if !constant_time_eq(
            request.public.verification_code.as_str(),
            verification_code.as_str(),
        ) {
            return Err(ShareError::new(
                "pairingCodeMismatch",
                "pairing verification code does not match",
            ));
        }
        if request.approved_credential.is_some() {
            return Err(ShareError::new(
                "pairingAlreadyApproved",
                "pairing request has already been approved",
            ));
        }
        let reserved_devices = self
            .requests
            .values()
            .filter(|request| request.approved_credential.is_some())
            .count();
        if self.devices.len().saturating_add(reserved_devices) >= self.limits.max_paired_devices {
            return Err(ShareError::new(
                "deviceLimit",
                "too many devices are already paired",
            ));
        }

        let device_id = unique_secret("dev_", ID_BYTES, entropy, |candidate| {
            self.devices
                .keys()
                .any(|existing| existing.as_str() == candidate)
                || self.requests.values().any(|request| {
                    request
                        .approved_credential
                        .as_ref()
                        .is_some_and(|credential| credential.device.id.as_str() == candidate)
                })
        })?;
        let token = unique_secret("token_", TOKEN_BYTES, entropy, |candidate| {
            self.devices
                .values()
                .any(|device| constant_time_eq(device.token.as_str(), candidate))
                || self.requests.values().any(|request| {
                    request
                        .approved_credential
                        .as_ref()
                        .is_some_and(|credential| {
                            constant_time_eq(credential.token.as_str(), candidate)
                        })
                })
        })?;

        let device = PairedDevice {
            id: DeviceId::from_generated(device_id),
            name: request.public.device_name.clone(),
            paired_at_epoch_ms: now_epoch_ms,
            last_seen_at_epoch_ms: now_epoch_ms,
        };
        let credential = DeviceCredential {
            device: device.clone(),
            token: DeviceToken::from_generated(token),
        };
        self.requests
            .get_mut(request_id)
            .expect("pairing request was checked above")
            .approved_credential = Some(credential);
        Ok(device)
    }

    /// Phone-facing: retrieve an approved credential exactly once.
    pub fn claim_pairing(
        &mut self,
        request_id: &PairingRequestId,
        claim_secret: &PairingClaimSecret,
        now_epoch_ms: u64,
    ) -> ShareResult<DeviceCredential> {
        self.remove_expired(now_epoch_ms);
        if !has_secret_shape(request_id.as_str(), "request_", ID_BYTES)
            || !has_secret_shape(claim_secret.as_str(), "claim_", CLAIM_BYTES)
        {
            return Err(invalid_pairing_request());
        }
        let request = self
            .requests
            .get(request_id)
            .ok_or_else(invalid_pairing_request)?;
        if !constant_time_eq(request.claim_secret.as_str(), claim_secret.as_str()) {
            return Err(invalid_pairing_request());
        }
        if request.approved_credential.is_none() {
            return Err(ShareError::new(
                "pairingAwaitingApproval",
                "pairing request is waiting for desktop approval",
            ));
        }

        let request = self
            .requests
            .remove(request_id)
            .expect("pairing request was checked above");
        let credential = request
            .approved_credential
            .expect("approved credential was checked above");
        self.devices.insert(
            credential.device.id.clone(),
            StoredDevice {
                public: credential.device.clone(),
                token: credential.token.clone(),
            },
        );
        Ok(credential)
    }

    pub fn authenticate(
        &mut self,
        token: &DeviceToken,
        now_epoch_ms: u64,
    ) -> ShareResult<DeviceId> {
        if !has_secret_shape(token.as_str(), "token_", TOKEN_BYTES) {
            return Err(unauthorized_device());
        }
        let Some(stored) = self
            .devices
            .values_mut()
            .find(|device| constant_time_eq(device.token.as_str(), token.as_str()))
        else {
            return Err(unauthorized_device());
        };
        stored.public.last_seen_at_epoch_ms = stored.public.last_seen_at_epoch_ms.max(now_epoch_ms);
        Ok(stored.public.id.clone())
    }

    pub fn pending_requests(&mut self, now_epoch_ms: u64) -> Vec<PendingPairingRequest> {
        self.remove_expired(now_epoch_ms);
        let mut requests = self
            .requests
            .values()
            .filter(|request| request.approved_credential.is_none())
            .map(|request| request.public.clone())
            .collect::<Vec<_>>();
        requests.sort_by(|left, right| {
            left.requested_at_epoch_ms
                .cmp(&right.requested_at_epoch_ms)
                .then_with(|| left.request_id.cmp(&right.request_id))
        });
        requests
    }

    pub fn devices(&self) -> Vec<PairedDevice> {
        let mut devices: Vec<_> = self
            .devices
            .values()
            .map(|device| device.public.clone())
            .collect();
        devices.sort_by(|left, right| {
            left.name
                .to_lowercase()
                .cmp(&right.name.to_lowercase())
                .then_with(|| left.name.cmp(&right.name))
                .then_with(|| left.id.cmp(&right.id))
        });
        devices
    }

    pub fn revoke_device(&mut self, id: &DeviceId) -> bool {
        let removed_device = self.devices.remove(id).is_some();
        let before = self.requests.len();
        self.requests.retain(|_, request| {
            request
                .approved_credential
                .as_ref()
                .is_none_or(|credential| &credential.device.id != id)
        });
        removed_device || self.requests.len() != before
    }

    pub fn revoke_all_devices(&mut self) {
        self.devices.clear();
        self.requests
            .retain(|_, request| request.approved_credential.is_none());
    }

    pub fn cancel_pairing(&mut self, nonce: &PairingNonce) -> bool {
        self.challenges.remove(nonce).is_some()
    }

    pub fn reject_pairing(&mut self, request_id: &PairingRequestId) -> bool {
        self.requests.remove(request_id).is_some()
    }

    pub fn clear_pending_pairings(&mut self) {
        self.challenges.clear();
        self.requests.clear();
    }

    pub fn pending_pairing_count(&mut self, now_epoch_ms: u64) -> usize {
        self.remove_expired(now_epoch_ms);
        self.pending_operation_count()
    }

    fn pending_operation_count(&self) -> usize {
        self.challenges.len().saturating_add(self.requests.len())
    }

    fn remove_expired(&mut self, now_epoch_ms: u64) {
        self.challenges
            .retain(|_, challenge| challenge.expires_at_epoch_ms > now_epoch_ms);
        self.requests
            .retain(|_, request| request.public.expires_at_epoch_ms > now_epoch_ms);
    }
}

impl Default for PairingState {
    fn default() -> Self {
        Self::new(ShareLimits::default())
    }
}

fn validate_device_name(name: &str) -> ShareResult<()> {
    let trimmed = name.trim();
    if trimmed.is_empty()
        || trimmed.chars().count() > MAX_DEVICE_NAME_CHARS
        || trimmed.chars().any(char::is_control)
    {
        return Err(ShareError::new(
            "invalidDeviceName",
            "device name must contain 1 to 80 printable characters",
        ));
    }
    Ok(())
}

fn unique_secret(
    prefix: &str,
    byte_count: usize,
    entropy: &mut impl EntropySource,
    collision: impl Fn(&str) -> bool,
) -> ShareResult<String> {
    for _ in 0..MAX_GENERATION_ATTEMPTS {
        let mut bytes = vec![0_u8; byte_count];
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

fn unique_verification_code(
    entropy: &mut impl EntropySource,
    collision: impl Fn(&str) -> bool,
) -> ShareResult<String> {
    for _ in 0..MAX_GENERATION_ATTEMPTS {
        let mut bytes = [0_u8; 3];
        entropy.fill_bytes(&mut bytes).map_err(|_| {
            ShareError::new("entropyUnavailable", "secure randomness is unavailable")
        })?;
        let candidate =
            u32::from_be_bytes([0, bytes[0], bytes[1], bytes[2]]) & VERIFICATION_CODE_MASK;
        if candidate >= VERIFICATION_CODE_LIMIT {
            continue;
        }
        let candidate = format!("{candidate:06}");
        if !collision(&candidate) {
            return Ok(candidate);
        }
    }
    Err(ShareError::new(
        "verificationCodeCollision",
        "could not allocate a unique pairing verification code",
    ))
}

fn constant_time_eq(left: &str, right: &str) -> bool {
    let left = left.as_bytes();
    let right = right.as_bytes();
    let mut difference = left.len() ^ right.len();
    let compared = left.len().max(right.len());
    for index in 0..compared {
        let left_byte = left.get(index).copied().unwrap_or(0);
        let right_byte = right.get(index).copied().unwrap_or(0);
        difference |= (left_byte ^ right_byte) as usize;
    }
    difference == 0
}

fn has_secret_shape(value: &str, prefix: &str, byte_count: usize) -> bool {
    value.len() == prefix.len() + byte_count * 2
        && value.starts_with(prefix)
        && value[prefix.len()..]
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit())
}

fn has_verification_code_shape(value: &str) -> bool {
    value.len() == 6 && value.bytes().all(|byte| byte.is_ascii_digit())
}

fn invalid_pairing_nonce() -> ShareError {
    ShareError::new(
        "invalidPairingNonce",
        "pairing challenge is missing, expired, or already used",
    )
}

fn invalid_pairing_request() -> ShareError {
    ShareError::new(
        "invalidPairingRequest",
        "pairing request is missing, expired, rejected, or already claimed",
    )
}

fn unauthorized_device() -> ShareError {
    ShareError::new(
        "unauthorizedDevice",
        "device credential is invalid or has been revoked",
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lan_share::model::EntropyError;

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

    fn request(
        state: &mut PairingState,
        entropy: &mut CounterEntropy,
        now_epoch_ms: u64,
        name: &str,
    ) -> PairingRequestReceipt {
        let challenge = state.begin_pairing(now_epoch_ms, 60_000, entropy).unwrap();
        state
            .request_pairing(&challenge.nonce, name, now_epoch_ms + 1, entropy)
            .unwrap()
    }

    #[test]
    fn generated_nonce_matches_the_mobile_pairing_contract() {
        let contract: serde_json::Value = serde_json::from_str(include_str!(
            "../../test-fixtures/mobile-pairing-contract.json"
        ))
        .unwrap();
        let mut entropy = CounterEntropy(0);
        let mut state = PairingState::default();
        let challenge = state.begin_pairing(1_000, 60_000, &mut entropy).unwrap();

        assert_eq!(
            challenge.nonce.as_str(),
            contract["nonce"].as_str().unwrap()
        );
    }

    #[test]
    fn approval_is_required_before_a_single_use_claim_and_token_is_revocable() {
        let mut entropy = CounterEntropy(1);
        let mut state = PairingState::default();
        let receipt = request(&mut state, &mut entropy, 1_000, " Pixel ");

        assert_eq!(state.devices().len(), 0);
        assert_eq!(state.pending_requests(1_002).len(), 1);
        assert_eq!(
            state
                .claim_pairing(&receipt.request_id, &receipt.claim_secret, 1_002)
                .unwrap_err()
                .code,
            "pairingAwaitingApproval"
        );
        let wrong_code = PairingVerificationCode::from_generated("000000".to_owned());
        assert_eq!(
            state
                .approve_pairing(&receipt.request_id, &wrong_code, 1_003, &mut entropy)
                .unwrap_err()
                .code,
            "pairingCodeMismatch"
        );

        let approved = state
            .approve_pairing(
                &receipt.request_id,
                &receipt.verification_code,
                1_004,
                &mut entropy,
            )
            .unwrap();
        assert_eq!(approved.name, "Pixel");
        assert!(state.pending_requests(1_005).is_empty());
        assert!(state.devices().is_empty());

        let wrong_claim =
            PairingClaimSecret::from_generated(format!("claim_{}", "00".repeat(CLAIM_BYTES)));
        assert_eq!(
            state
                .claim_pairing(&receipt.request_id, &wrong_claim, 1_005)
                .unwrap_err()
                .code,
            "invalidPairingRequest"
        );
        let credential = state
            .claim_pairing(&receipt.request_id, &receipt.claim_secret, 1_006)
            .unwrap();
        assert_eq!(credential.device, approved);
        assert_eq!(state.devices().len(), 1);
        assert_eq!(
            state.authenticate(&credential.token, 2_000).unwrap(),
            credential.device.id
        );
        assert_eq!(state.devices()[0].last_seen_at_epoch_ms, 2_000);
        assert_eq!(
            state
                .claim_pairing(&receipt.request_id, &receipt.claim_secret, 2_001)
                .unwrap_err()
                .code,
            "invalidPairingRequest"
        );
        assert!(state.revoke_device(&credential.device.id));
        assert_eq!(
            state
                .authenticate(&credential.token, 2_002)
                .unwrap_err()
                .code,
            "unauthorizedDevice"
        );
    }

    #[test]
    fn challenge_is_single_use_and_cannot_directly_create_a_device() {
        let mut entropy = CounterEntropy(11);
        let mut state = PairingState::default();
        let challenge = state.begin_pairing(100, 30_000, &mut entropy).unwrap();
        let receipt = state
            .request_pairing(&challenge.nonce, "Phone", 101, &mut entropy)
            .unwrap();
        assert!(state.devices().is_empty());
        assert_eq!(
            state
                .request_pairing(&challenge.nonce, "Other", 102, &mut entropy)
                .unwrap_err()
                .code,
            "invalidPairingNonce"
        );
        assert_eq!(
            state.pending_requests(103)[0].request_id,
            receipt.request_id
        );
        let pending_json = serde_json::to_string(&state.pending_requests(103)).unwrap();
        assert!(!pending_json.contains(receipt.claim_secret.as_str()));
    }

    #[test]
    fn expired_cancelled_and_rejected_flows_cannot_be_claimed() {
        let mut entropy = CounterEntropy(21);
        let mut state = PairingState::default();
        let expired = state.begin_pairing(100, 30_000, &mut entropy).unwrap();
        assert_eq!(state.pending_pairing_count(30_100), 0);
        assert_eq!(
            state
                .request_pairing(&expired.nonce, "Phone", 30_100, &mut entropy)
                .unwrap_err()
                .code,
            "invalidPairingNonce"
        );

        let cancelled = state.begin_pairing(40_000, 30_000, &mut entropy).unwrap();
        assert!(state.cancel_pairing(&cancelled.nonce));
        assert_eq!(
            state
                .request_pairing(&cancelled.nonce, "Phone", 40_001, &mut entropy)
                .unwrap_err()
                .code,
            "invalidPairingNonce"
        );

        let rejected = request(&mut state, &mut entropy, 50_000, "Tablet");
        assert!(state.reject_pairing(&rejected.request_id));
        assert_eq!(
            state
                .claim_pairing(&rejected.request_id, &rejected.claim_secret, 50_002)
                .unwrap_err()
                .code,
            "invalidPairingRequest"
        );
    }

    #[test]
    fn configured_limits_cover_challenges_requests_and_approved_reservations() {
        let mut entropy = CounterEntropy(31);
        let limits = ShareLimits {
            max_pending_pairings: 1,
            max_paired_devices: 1,
            ..ShareLimits::default()
        };
        let mut state = PairingState::new(limits);
        assert_eq!(
            state.begin_pairing(0, 1, &mut entropy).unwrap_err().code,
            "invalidPairingLifetime"
        );
        let first = state.begin_pairing(0, 30_000, &mut entropy).unwrap();
        assert_eq!(
            state
                .begin_pairing(1, 30_000, &mut entropy)
                .unwrap_err()
                .code,
            "pairingLimit"
        );
        assert_eq!(
            state
                .request_pairing(&first.nonce, "\n", 1, &mut entropy)
                .unwrap_err()
                .code,
            "invalidDeviceName"
        );
        let first = state
            .request_pairing(&first.nonce, "Phone", 1, &mut entropy)
            .unwrap();
        state
            .approve_pairing(&first.request_id, &first.verification_code, 2, &mut entropy)
            .unwrap();

        let second_limits = ShareLimits {
            max_pending_pairings: 2,
            max_paired_devices: 1,
            ..ShareLimits::default()
        };
        let mut second_state = PairingState::new(second_limits);
        let one = request(&mut second_state, &mut entropy, 10, "One");
        let two = request(&mut second_state, &mut entropy, 20, "Two");
        second_state
            .approve_pairing(&one.request_id, &one.verification_code, 30, &mut entropy)
            .unwrap();
        assert_eq!(
            second_state
                .approve_pairing(&two.request_id, &two.verification_code, 31, &mut entropy,)
                .unwrap_err()
                .code,
            "deviceLimit"
        );
    }

    #[test]
    fn entropy_failures_do_not_consume_or_approve_requests() {
        let mut entropy = CounterEntropy(41);
        let mut state = PairingState::default();
        let challenge = state.begin_pairing(0, 30_000, &mut entropy).unwrap();
        let mut failing = |_output: &mut [u8]| Err(EntropyError);
        assert_eq!(
            state
                .request_pairing(&challenge.nonce, "Phone", 1, &mut failing)
                .unwrap_err()
                .code,
            "entropyUnavailable"
        );
        let receipt = state
            .request_pairing(&challenge.nonce, "Phone", 2, &mut entropy)
            .unwrap();
        assert_eq!(
            state
                .approve_pairing(
                    &receipt.request_id,
                    &receipt.verification_code,
                    3,
                    &mut failing,
                )
                .unwrap_err()
                .code,
            "entropyUnavailable"
        );
        assert_eq!(
            state
                .claim_pairing(&receipt.request_id, &receipt.claim_secret, 4)
                .unwrap_err()
                .code,
            "pairingAwaitingApproval"
        );
    }

    #[test]
    fn revoking_an_approved_unclaimed_device_invalidates_its_claim() {
        let mut entropy = CounterEntropy(51);
        let mut state = PairingState::default();
        let receipt = request(&mut state, &mut entropy, 100, "Phone");
        let device = state
            .approve_pairing(
                &receipt.request_id,
                &receipt.verification_code,
                102,
                &mut entropy,
            )
            .unwrap();
        assert!(state.revoke_device(&device.id));
        assert_eq!(
            state
                .claim_pairing(&receipt.request_id, &receipt.claim_secret, 103)
                .unwrap_err()
                .code,
            "invalidPairingRequest"
        );
    }

    #[test]
    fn token_comparison_handles_different_lengths() {
        assert!(constant_time_eq("same", "same"));
        assert!(!constant_time_eq("same", "short"));
        assert!(!constant_time_eq("same", "same!"));
    }
}
