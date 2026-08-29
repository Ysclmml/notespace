import { createHmac, webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { TextEncoder } from "node:util";

import { describe, expect, it, vi } from "vitest";

const initSource = readFileSync(
  resolve(process.cwd(), "src-tauri/src/host_release_smoke_init.js"),
  "utf8",
);

const tokens = {
  captureReady: "01".repeat(32),
  confirmBegin: "02".repeat(32),
  confirmFinish: "03".repeat(32),
  cancelBegin: "04".repeat(32),
  cancelFinish: "05".repeat(32),
  chooserBegin: "06".repeat(32),
  chooserFinish: "07".repeat(32),
  evidenceMacKey: "08".repeat(32),
};

function framedField(value: string): string {
  return `${Buffer.byteLength(value, "utf8")}:${value}`;
}

function imeMacMessage(args: Record<string, unknown>): string {
  const counts = (args.counts as number[]).join(",");
  const flags = (args.flags as boolean[]).map((value) => (value ? "1" : "0")).join("");
  const length = String(args.finalUtf16Length);
  return [
    "P0-HOST-SMOKE-IME-V1",
    framedField(args.token as string),
    framedField(args.scenario as string),
    framedField(counts),
    framedField(flags),
    framedField(length),
  ].join("|");
}

function expectedMac(message: string): string {
  return createHmac("sha256", Buffer.from(tokens.evidenceMacKey, "hex"))
    .update(message, "utf8")
    .digest("hex");
}

describe("P0-HOST-SMOKE-01 private initialization capture", () => {
  it("uses a non-extractable WebCrypto HMAC compatible with RFC 4231", async () => {
    const key = await webcrypto.subtle.importKey(
      "raw",
      new Uint8Array(20).fill(0x0b),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    expect(key.extractable).toBe(false);
    const signature = await webcrypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode("Hi There"),
    );
    expect(Buffer.from(signature).toString("hex")).toBe(
      "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7",
    );

    const canonical = imeMacMessage({
      token: tokens.confirmFinish,
      scenario: "confirm",
      counts: [1, 2, 1, 2, 2, 0],
      flags: [true, true, true, true, true, true],
      finalUtf16Length: 5,
    });
    expect(canonical).toBe(
      "P0-HOST-SMOKE-IME-V1|64:0303030303030303030303030303030303030303030303030303030303030303|7:confirm|11:1,2,1,2,2,0|6:111111|1:5",
    );
    const canonicalKey = await webcrypto.subtle.importKey(
      "raw",
      Buffer.from(tokens.evidenceMacKey, "hex"),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const canonicalSignature = await webcrypto.subtle.sign(
      "HMAC",
      canonicalKey,
      new TextEncoder().encode(canonical),
    );
    expect(Buffer.from(canonicalSignature).toString("hex")).toBe(
      "dce9c11dd39f6b63672d4d75f76ceb7d3e0035e71322bd88d610995ec8c6e573",
    );
  });

  it("IME-001 and AC-PLATFORM-001 ignore synthetic composition, clicks, and cancel", async () => {
    document.body.innerHTML = `
      <button data-host-action="begin-confirm">begin</button>
      <button data-host-action="finish-confirm">finish</button>
      <button data-host-action="chooser-open">chooser</button>
      <div data-host-editor><div class="cm-content" contenteditable="true">确认：</div></div>
      <input data-host-native-input type="file">
    `;
    const outboundCalls: Array<{ command: string; args: Record<string, unknown> }> = [];
    const deliveredCalls: Array<{ command: string; args: Record<string, unknown> }> = [];
    const capturedListeners = new Map<string, EventListener[]>();
    const originalAddEventListener = document.addEventListener.bind(document);
    const addEventListenerSpy = vi
      .spyOn(document, "addEventListener")
      .mockImplementation((type, listener, options) => {
        if (typeof listener === "function") {
          const listeners = capturedListeners.get(type) ?? [];
          listeners.push(listener);
          capturedListeners.set(type, listeners);
        }
        originalAddEventListener(type, listener, options);
      });
    const invoke = vi.fn((command: string, args: Record<string, unknown>) => {
      outboundCalls.push({ command, args });
      const deliveredArgs = command.endsWith("trusted_ime_finish")
        ? {
            ...args,
            counts: [1, 2, 1, 2, 2, 0],
            flags: [true, true, true, true, true, true],
            finalUtf16Length: 5,
          }
        : args;
      deliveredCalls.push({ command, args: deliveredArgs });
      return Promise.resolve("{}");
    });
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      value: { invoke },
      configurable: true,
    });
    Object.defineProperty(window, "crypto", {
      value: webcrypto,
      configurable: true,
    });
    Object.defineProperty(window, "TextEncoder", {
      value: TextEncoder,
      configurable: true,
    });

    window.eval(initSource.replace("__HOST_SMOKE_TOKEN_BUNDLE__", JSON.stringify(tokens)));

    document
      .querySelector<HTMLElement>("[data-host-action='begin-confirm']")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const editor = document.querySelector<HTMLElement>(".cm-content");
    editor?.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true, data: "" }),
    );
    editor?.dispatchEvent(
      new CompositionEvent("compositionupdate", { bubbles: true, data: "中" }),
    );
    editor?.dispatchEvent(
      new InputEvent("beforeinput", {
        bubbles: true,
        data: "中",
        inputType: "insertCompositionText",
        isComposing: true,
      }),
    );
    editor?.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        data: "中",
        inputType: "insertCompositionText",
        isComposing: true,
      }),
    );
    editor?.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true, data: "中文" }),
    );
    document
      .querySelector<HTMLElement>("[data-host-action='finish-confirm']")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    document
      .querySelector<HTMLElement>("[data-host-action='chooser-open']")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    document
      .querySelector<HTMLInputElement>("[data-host-native-input]")
      ?.dispatchEvent(new Event("cancel"));
    await Promise.resolve();
    await Promise.resolve();

    expect(outboundCalls.some(({ command }) => command.includes("trusted_ime"))).toBe(
      false,
    );
    expect(outboundCalls.some(({ command }) => command.includes("trusted_chooser"))).toBe(
      false,
    );

    // Browser code cannot manufacture isTrusted=true. Calling the captured listener
    // directly models the one real user click that starts a scenario, then proves
    // synthetic composition events inside that scenario are reported as rejected.
    const beginButton = document.querySelector<HTMLElement>(
      "[data-host-action='begin-confirm']",
    );
    const finishButton = document.querySelector<HTMLElement>(
      "[data-host-action='finish-confirm']",
    );
    const clickListener = capturedListeners.get("click")?.[0];
    expect(beginButton).not.toBeNull();
    expect(finishButton).not.toBeNull();
    expect(clickListener).toBeTypeOf("function");
    clickListener?.({ isTrusted: true, target: beginButton } as unknown as Event);
    await Promise.resolve();
    await Promise.resolve();
    expect(outboundCalls.some(({ command }) => command.endsWith("trusted_ime_begin"))).toBe(
      true,
    );

    editor?.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true, data: "" }),
    );
    editor?.dispatchEvent(
      new CompositionEvent("compositionupdate", { bubbles: true, data: "中文" }),
    );
    editor?.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true, data: "中文" }),
    );
    clickListener?.({ isTrusted: true, target: finishButton } as unknown as Event);
    await vi.waitFor(() => {
      expect(
        outboundCalls.some(({ command }) => command.endsWith("trusted_ime_finish")),
      ).toBe(true);
    });

    const outboundFinish = outboundCalls.find(({ command }) =>
      command.endsWith("trusted_ime_finish"),
    );
    const deliveredFinish = deliveredCalls.find(({ command }) =>
      command.endsWith("trusted_ime_finish"),
    );
    expect(outboundFinish).toBeDefined();
    expect(deliveredFinish).toBeDefined();
    expect((outboundFinish?.args.counts as number[])[5]).toBeGreaterThan(0);
    expect((outboundFinish?.args.flags as boolean[]).every(Boolean)).toBe(false);
    expect(outboundFinish?.args.evidenceMac).toBe(
      expectedMac(imeMacMessage(outboundFinish?.args ?? {})),
    );
    expect(deliveredFinish?.args.evidenceMac).not.toBe(
      expectedMac(imeMacMessage(deliveredFinish?.args ?? {})),
    );
    expect(new Event("cancel").isTrusted).toBe(false);
    expect(new CompositionEvent("compositionstart").isTrusted).toBe(false);
    addEventListenerSpy.mockRestore();
  });

  it("AC-PLATFORM-001 statically exposes strict fields and no chooser data access", () => {
    for (const required of [
      "event.isTrusted",
      "nativeApply(compositionDataGetter, event, [])",
      "nativeApply(inputDataGetter, event, [])",
      "nativeApply(inputKindGetter, event, [])",
      "nativeApply(inputComposingGetter, event, [])",
      'record.inputType === "insertCompositionText"',
      'record.inputType === "insertFromComposition"',
      'record.data === "中文"',
      "record.data !== expectedEndData",
      "readText(snapshot.target)",
      "evidenceMac",
      "subtleImportKey",
      "subtleSign",
    ]) {
      expect(initSource).toContain(required);
    }
    for (const forbidden of [
      "FileReader",
      ".files",
      ".value",
      ".arrayBuffer(",
      ".text(",
      ".stream(",
      ".name",
      ".path",
      "webkitRelativePath",
    ]) {
      expect(initSource).not.toContain(forbidden);
    }
  });
});
