import { describe, expect, it } from "vitest";
import configJson from "../../../src-tauri/tauri.conf.json?raw";

const config: { app: { security: { csp: string; devCsp: string } } } =
  JSON.parse(configJson);

function sources(policy: string, directive: string): readonly string[] {
  const entry = policy
    .split(";")
    .map((value) => value.trim().split(/\s+/))
    .find(([name]) => name === directive);
  expect(entry, `${directive} must be explicit`).toBeDefined();
  return entry?.slice(1) ?? [];
}

describe("desktop content security policy", () => {
  it.each(["csp", "devCsp"] as const)(
    "%s permits bundled and Vite-inlined fonts without remote font access",
    (key) => {
      // Crepe's common theme imports KaTeX. Vite inlines its small WOFF2 asset,
      // so a standalone bundle needs data: even though it loads no remote font.
      expect(sources(config.app.security[key], "font-src")).toEqual(["'self'", "data:"]);
    },
  );

  it("does not extend the font exception to production scripts or connections", () => {
    const policy = config.app.security.csp;
    expect(sources(policy, "default-src")).toEqual(["'self'"]);
    expect(sources(policy, "script-src")).toEqual(["'self'"]);
    expect(sources(policy, "connect-src")).toEqual(["ipc:", "http://ipc.localhost"]);
  });
});
