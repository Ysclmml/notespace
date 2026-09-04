import { invoke } from "@tauri-apps/api/core";

const DEFAULT_DISCOVERY_POLL_INTERVAL_MS = 5_000;
const MAX_DISCOVERED_COMPUTERS = 100;
const MAX_ADDRESS_CANDIDATES = 8;

export interface MobileDiscoveredComputer {
  readonly id: string;
  readonly name: string;
  readonly host: string;
  readonly port: number;
  readonly baseUrl: string;
  readonly candidateBaseUrls: readonly string[];
  readonly lastSeenAt: number;
}

export interface MobileComputerDiscovery {
  list(): Promise<readonly MobileDiscoveredComputer[]>;
  subscribe?(listener: () => void): () => void;
}

export type MobileDiscoveryInvoke = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;

export interface TauriMobileComputerDiscoveryOptions {
  readonly invokeCommand?: MobileDiscoveryInvoke;
  readonly pollIntervalMs?: number;
}

function boundedText(value: unknown, maximum: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (
    !text ||
    text.length > maximum ||
    [...text].some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    })
  ) {
    return null;
  }
  return text;
}

export function normalizeDiscoveredComputers(
  value: unknown,
): readonly MobileDiscoveredComputer[] {
  if (!Array.isArray(value) || value.length > MAX_DISCOVERED_COMPUTERS) return [];

  const computers: MobileDiscoveredComputer[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const candidate = item as Partial<MobileDiscoveredComputer>;
    const id = boundedText(candidate.id, 256);
    const name = boundedText(candidate.name, 300);
    const host = boundedText(candidate.host, 512);
    const baseUrl = boundedText(candidate.baseUrl, 2_048);
    const rawCandidates = candidate.candidateBaseUrls ?? (baseUrl ? [baseUrl] : []);
    const candidateBaseUrls = Array.isArray(rawCandidates)
      ? rawCandidates.map((item) => boundedText(item, 2_048))
      : [];
    if (
      !id ||
      !name ||
      !host ||
      !baseUrl ||
      candidateBaseUrls.length === 0 ||
      candidateBaseUrls.length > MAX_ADDRESS_CANDIDATES ||
      candidateBaseUrls.some((item) => item === null) ||
      !Number.isInteger(candidate.port) ||
      candidate.port === undefined ||
      candidate.port < 1 ||
      candidate.port > 65_535 ||
      typeof candidate.lastSeenAt !== "number" ||
      !Number.isFinite(candidate.lastSeenAt) ||
      candidate.lastSeenAt < 0
    ) {
      continue;
    }
    computers.push({
      id,
      name,
      host,
      port: candidate.port,
      baseUrl,
      candidateBaseUrls: [...new Set(candidateBaseUrls as string[])],
      lastSeenAt: candidate.lastSeenAt,
    });
  }
  return computers;
}

/**
 * Thin TypeScript bridge for the native discovery command. The native side owns
 * mDNS; this adapter only requests snapshots and emits refresh ticks.
 */
export function createTauriMobileComputerDiscovery({
  invokeCommand = (command, args) => invoke(command, args),
  pollIntervalMs = DEFAULT_DISCOVERY_POLL_INTERVAL_MS,
}: TauriMobileComputerDiscoveryOptions = {}): MobileComputerDiscovery {
  const interval = Math.min(60_000, Math.max(1_000, Math.round(pollIntervalMs)));
  return {
    async list() {
      const value = await invokeCommand("discover_lan_services");
      return normalizeDiscoveredComputers(value);
    },
    subscribe(listener) {
      const timer = globalThis.setInterval(listener, interval);
      return () => globalThis.clearInterval(timer);
    },
  };
}
