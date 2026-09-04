import { isTauri } from "@tauri-apps/api/core";

import type { MobilePairingRequest } from "./types";

const MAX_PAIRING_PAYLOAD_LENGTH = 4_096;
const MAX_ADDRESS_CANDIDATES = 4;
const PAIRING_NONCE_PATTERN = /^pair_[a-f0-9]{48}$/;
const INSTANCE_ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const SHA256_FINGERPRINT_PATTERN = /^sha256:([A-Fa-f0-9]{64})$/;
const HOST_LABEL_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
const ALLOWED_PARAMETERS = new Set([
  "v",
  "instance",
  "host",
  "port",
  "nonce",
  "fingerprint",
]);

type CameraPermissionState = "granted" | "denied" | "prompt" | "prompt-with-rationale";

export interface PairingScannerNativeAdapter {
  checkCameraPermission(): Promise<CameraPermissionState>;
  requestCameraPermission(): Promise<CameraPermissionState>;
  scanQrCode(): Promise<{ readonly content: string; readonly format: string }>;
}

export interface NativePairingScannerOptions {
  readonly loadAdapter?: () => Promise<PairingScannerNativeAdapter>;
}

export class MobilePairingCodeError extends Error {
  readonly code:
    | "invalid-format"
    | "invalid-address"
    | "invalid-fingerprint"
    | "invalid-identity"
    | "invalid-nonce"
    | "unsupported-version";

  constructor(code: MobilePairingCodeError["code"], message: string) {
    super(message);
    this.name = "MobilePairingCodeError";
    this.code = code;
  }
}

export class MobilePairingScannerError extends Error {
  readonly code: "permission-denied" | "scanner-unavailable";

  constructor(code: MobilePairingScannerError["code"], message: string) {
    super(message);
    this.name = "MobilePairingScannerError";
    this.code = code;
  }
}

function invalidFormat(): never {
  throw new MobilePairingCodeError(
    "invalid-format",
    "这不是有效的 NoteSpace 配对二维码，请在桌面端重新生成后再试。",
  );
}

function singleParameter(parameters: URLSearchParams, name: string): string {
  const values = parameters.getAll(name);
  if (values.length !== 1 || values[0] === "") invalidFormat();
  return values[0]!;
}

function parseIpv4(host: string): string | null {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  if (parts.some((part) => !/^(?:0|[1-9][0-9]{0,2})$/.test(part) || Number(part) > 255)) {
    return null;
  }
  const first = Number(parts[0]);
  const second = Number(parts[1]);
  const isPrivate =
    first === 10 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168);
  if (!isPrivate) return null;
  return parts.join(".");
}

function parseIpv6(host: string): string | null {
  if (!host.includes(":") || !/^[A-Fa-f0-9:]+$/.test(host)) return null;
  try {
    const parsed = new URL(`http://[${host}]/`);
    const normalized = parsed.hostname.slice(1, -1).toLowerCase();
    if (normalized === "::" || normalized === "::1") return null;
    const firstGroup = Number.parseInt(normalized.split(":", 1)[0] ?? "", 16);
    const isPrivate = (firstGroup & 0xfe00) === 0xfc00 || (firstGroup & 0xffc0) === 0xfe80;
    if (!isPrivate) return null;
    return normalized;
  } catch {
    return null;
  }
}

function parseHostname(host: string): string | null {
  if (host.length > 253 || host.endsWith(".") || !host.toLowerCase().endsWith(".local")) {
    return null;
  }
  const labels = host.split(".");
  if (labels.some((label) => !HOST_LABEL_PATTERN.test(label))) return null;
  return host.toLowerCase();
}

function parseHost(host: string): string {
  if (host.length === 0 || host !== host.trim()) {
    throw new MobilePairingCodeError(
      "invalid-address",
      "二维码中的电脑地址无效，请在桌面端重新生成。",
    );
  }
  const normalized = /^[0-9.]+$/.test(host)
    ? parseIpv4(host)
    : (parseIpv6(host) ?? parseHostname(host));
  if (!normalized) {
    throw new MobilePairingCodeError(
      "invalid-address",
      "二维码中的电脑地址无效，请在桌面端重新生成。",
    );
  }
  return normalized;
}

function formatAddress(host: string, port: number): string {
  return host.includes(":") ? `[${host}]:${port}` : `${host}:${port}`;
}

/**
 * Parse the compact, data-only payload emitted by the desktop pairing dialog.
 * Secrets are never included in thrown errors or logs.
 *
 * Canonical shape:
 * notespace://pair?v=1&instance=...&host=...&port=...&nonce=pair_...&fingerprint=sha256:...
 * `host` may be repeated up to four times for LAN address candidates.
 */
export function parseNoteSpacePairingPayload(payload: string): MobilePairingRequest {
  if (
    payload.length === 0 ||
    payload.length > MAX_PAIRING_PAYLOAD_LENGTH ||
    payload !== payload.trim() ||
    /[^\x20-\x7E]/.test(payload)
  ) {
    invalidFormat();
  }

  let parsed: URL;
  try {
    parsed = new URL(payload);
  } catch {
    invalidFormat();
  }

  if (
    parsed.protocol !== "notespace:" ||
    parsed.hostname !== "pair" ||
    (parsed.pathname !== "" && parsed.pathname !== "/") ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.port !== "" ||
    parsed.hash !== ""
  ) {
    invalidFormat();
  }
  for (const key of parsed.searchParams.keys()) {
    if (!ALLOWED_PARAMETERS.has(key)) invalidFormat();
  }

  const version = singleParameter(parsed.searchParams, "v");
  if (version !== "1") {
    throw new MobilePairingCodeError(
      "unsupported-version",
      "这个二维码来自不兼容的 NoteSpace 版本，请先更新电脑端或手机端。",
    );
  }

  const instanceId = singleParameter(parsed.searchParams, "instance");
  if (!INSTANCE_ID_PATTERN.test(instanceId)) {
    throw new MobilePairingCodeError(
      "invalid-identity",
      "二维码中的电脑身份无效，请在桌面端重新生成。",
    );
  }

  const rawPort = singleParameter(parsed.searchParams, "port");
  if (!/^[1-9][0-9]{0,4}$/.test(rawPort)) {
    throw new MobilePairingCodeError(
      "invalid-address",
      "二维码中的连接端口无效，请在桌面端重新生成。",
    );
  }
  const port = Number(rawPort);
  if (port > 65_535) {
    throw new MobilePairingCodeError(
      "invalid-address",
      "二维码中的连接端口无效，请在桌面端重新生成。",
    );
  }

  const hosts = parsed.searchParams.getAll("host");
  if (
    hosts.length === 0 ||
    hosts.length > MAX_ADDRESS_CANDIDATES ||
    new Set(hosts).size !== hosts.length
  ) {
    throw new MobilePairingCodeError(
      "invalid-address",
      "二维码中的电脑地址无效，请在桌面端重新生成。",
    );
  }
  const addressCandidates = hosts.map((host) => formatAddress(parseHost(host), port));
  if (new Set(addressCandidates).size !== addressCandidates.length) {
    throw new MobilePairingCodeError(
      "invalid-address",
      "二维码中的电脑地址无效，请在桌面端重新生成。",
    );
  }

  const pairingCode = singleParameter(parsed.searchParams, "nonce");
  if (!PAIRING_NONCE_PATTERN.test(pairingCode)) {
    throw new MobilePairingCodeError(
      "invalid-nonce",
      "这个配对二维码无效或已经过期，请在桌面端重新生成。",
    );
  }

  const fingerprintMatch = SHA256_FINGERPRINT_PATTERN.exec(
    singleParameter(parsed.searchParams, "fingerprint"),
  );
  if (!fingerprintMatch) {
    throw new MobilePairingCodeError(
      "invalid-fingerprint",
      "二维码缺少可信的电脑证书信息，请在桌面端重新生成。",
    );
  }

  return {
    address: addressCandidates[0]!,
    addressCandidates,
    certificateFingerprint: `sha256:${fingerprintMatch[1]!.toLowerCase()}`,
    instanceId,
    pairingCode,
    protocolVersion: 1,
  };
}

async function loadNativeBarcodeScanner(): Promise<PairingScannerNativeAdapter> {
  const plugin = await import("@tauri-apps/plugin-barcode-scanner");
  return {
    checkCameraPermission: plugin.checkPermissions,
    requestCameraPermission: plugin.requestPermissions,
    scanQrCode: async () => {
      const result = await plugin.scan({
        cameraDirection: "back",
        formats: [plugin.Format.QRCode],
      });
      return { content: result.content, format: result.format };
    },
  };
}

function isCancelled(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /cancel(?:led|ed)?|canceled|取消/i.test(message);
}

/** Create a scanner callback suitable for MobileApp's injectable boundary. */
export function createNativePairingScanner({
  loadAdapter = loadNativeBarcodeScanner,
}: NativePairingScannerOptions = {}): () => Promise<MobilePairingRequest | null> {
  return async () => {
    try {
      const adapter = await loadAdapter();
      let permission = await adapter.checkCameraPermission();
      if (permission === "prompt" || permission === "prompt-with-rationale") {
        permission = await adapter.requestCameraPermission();
      }
      if (permission !== "granted") {
        throw new MobilePairingScannerError(
          "permission-denied",
          "需要相机权限才能扫码。请在系统设置中允许 NoteSpace 使用相机。",
        );
      }

      const scanned = await adapter.scanQrCode();
      if (scanned.format !== "QR_CODE") invalidFormat();
      return parseNoteSpacePairingPayload(scanned.content);
    } catch (error) {
      if (isCancelled(error)) return null;
      if (
        error instanceof MobilePairingCodeError ||
        error instanceof MobilePairingScannerError
      ) {
        throw error;
      }
      throw new MobilePairingScannerError(
        "scanner-unavailable",
        "没有完成扫码，请确认相机可用后重试。",
      );
    }
  };
}

export function isNativeMobileRuntime(
  appSurface: string = __APP_SURFACE__,
  tauriRuntime: boolean = isTauri(),
): boolean {
  return appSurface === "mobile" && tauriRuntime;
}
