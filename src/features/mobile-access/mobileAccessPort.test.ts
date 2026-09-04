import { describe, expect, it } from "vitest";

import {
  DEFAULT_MOBILE_ACCESS_PORT,
  loadMobileAccessPort,
  MAX_MOBILE_ACCESS_PORT,
  MIN_MOBILE_ACCESS_PORT,
  MOBILE_ACCESS_PORT_STORAGE_KEY,
  parseMobileAccessPort,
  saveMobileAccessPort,
} from "./mobileAccessPort";

function createStorage(initial?: string): Storage {
  const values = new Map<string, string>();
  if (initial !== undefined) values.set(MOBILE_ACCESS_PORT_STORAGE_KEY, initial);
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

describe("mobile access port preferences", () => {
  it("accepts only integer user ports", () => {
    expect(parseMobileAccessPort(String(MIN_MOBILE_ACCESS_PORT))).toBe(
      MIN_MOBILE_ACCESS_PORT,
    );
    expect(parseMobileAccessPort(MAX_MOBILE_ACCESS_PORT)).toBe(MAX_MOBILE_ACCESS_PORT);
    expect(parseMobileAccessPort(MIN_MOBILE_ACCESS_PORT - 1)).toBeNull();
    expect(parseMobileAccessPort(MAX_MOBILE_ACCESS_PORT + 1)).toBeNull();
    expect(parseMobileAccessPort("49920.5")).toBeNull();
    expect(parseMobileAccessPort("port 49920")).toBeNull();
  });

  it("loads the default for missing, malformed, or out-of-range storage", () => {
    expect(loadMobileAccessPort(createStorage())).toBe(DEFAULT_MOBILE_ACCESS_PORT);
    expect(loadMobileAccessPort(createStorage("not json"))).toBe(
      DEFAULT_MOBILE_ACCESS_PORT,
    );
    expect(loadMobileAccessPort(createStorage('{"port":80}'))).toBe(
      DEFAULT_MOBILE_ACCESS_PORT,
    );
  });

  it("persists and restores a valid port without interrupting unavailable storage", () => {
    const storage = createStorage();
    expect(saveMobileAccessPort(50_020, storage)).toBe(true);
    expect(loadMobileAccessPort(storage)).toBe(50_020);
    expect(saveMobileAccessPort(80, storage)).toBe(false);
    expect(loadMobileAccessPort(storage)).toBe(50_020);

    const unavailable = createStorage();
    unavailable.setItem = () => {
      throw new Error("storage unavailable");
    };
    expect(saveMobileAccessPort(49_920, unavailable)).toBe(false);
  });
});
