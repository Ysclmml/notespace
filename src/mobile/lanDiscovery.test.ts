import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createTauriMobileComputerDiscovery,
  normalizeDiscoveredComputers,
} from "./lanDiscovery";

afterEach(() => {
  vi.useRealTimers();
});

describe("mobile LAN discovery bridge", () => {
  it("requests the fixed Tauri command and validates its data-only response", async () => {
    const invokeCommand = vi.fn(async () => [
      {
        id: "service-1",
        name: "书房电脑",
        host: "192.168.1.20",
        port: 43127,
        baseUrl: "http://192.168.1.20:43127/api/v1",
        candidateBaseUrls: [
          "http://192.168.1.20:43127/api/v1",
          "http://192.168.50.20:43127/api/v1",
        ],
        lastSeenAt: 1_788_480_000_000,
      },
      {
        id: "bad-service",
        name: "错误端口",
        host: "192.168.1.21",
        port: 70_000,
        baseUrl: "http://192.168.1.21:70000/api/v1",
        lastSeenAt: 1,
      },
    ]);
    const discovery = createTauriMobileComputerDiscovery({ invokeCommand });

    expect(await discovery.list()).toEqual([
      {
        id: "service-1",
        name: "书房电脑",
        host: "192.168.1.20",
        port: 43127,
        baseUrl: "http://192.168.1.20:43127/api/v1",
        candidateBaseUrls: [
          "http://192.168.1.20:43127/api/v1",
          "http://192.168.50.20:43127/api/v1",
        ],
        lastSeenAt: 1_788_480_000_000,
      },
    ]);
    expect(invokeCommand).toHaveBeenCalledWith("discover_lan_services");
  });

  it("emits bounded polling ticks without implementing native discovery", () => {
    vi.useFakeTimers();
    const discovery = createTauriMobileComputerDiscovery({
      invokeCommand: vi.fn(),
      pollIntervalMs: 2_000,
    });
    const listener = vi.fn();
    const unsubscribe = discovery.subscribe?.(listener);

    vi.advanceTimersByTime(4_100);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe?.();
    vi.advanceTimersByTime(2_100);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("rejects a non-array or oversized native payload as an empty snapshot", () => {
    expect(normalizeDiscoveredComputers({ path: "/Users/alice" })).toEqual([]);
    expect(normalizeDiscoveredComputers(new Array(101).fill({}))).toEqual([]);
  });
});
