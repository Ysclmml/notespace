import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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
};

describe("P0-HOST-SMOKE-01 private initialization capture", () => {
  it("IME-001 and AC-PLATFORM-001 ignore synthetic composition, clicks, and cancel", async () => {
    document.body.innerHTML = `
      <button data-host-action="begin-confirm">begin</button>
      <button data-host-action="finish-confirm">finish</button>
      <button data-host-action="chooser-open">chooser</button>
      <div data-host-editor><div class="cm-content" contenteditable="true">确认：</div></div>
      <input data-host-native-input type="file">
    `;
    const calls: Array<{ command: string; args: Record<string, unknown> }> = [];
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
      calls.push({ command, args });
      return Promise.resolve("{}");
    });
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      value: { invoke },
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

    expect(calls.some(({ command }) => command.includes("trusted_ime"))).toBe(false);
    expect(calls.some(({ command }) => command.includes("trusted_chooser"))).toBe(false);

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
    expect(calls.some(({ command }) => command.endsWith("trusted_ime_begin"))).toBe(true);

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
    await Promise.resolve();
    await Promise.resolve();

    const finishCall = calls.find(({ command }) => command.endsWith("trusted_ime_finish"));
    expect(finishCall).toBeDefined();
    expect((finishCall?.args.counts as number[])[5]).toBeGreaterThan(0);
    expect((finishCall?.args.flags as boolean[]).every(Boolean)).toBe(false);
    expect(new Event("cancel").isTrusted).toBe(false);
    expect(new CompositionEvent("compositionstart").isTrusted).toBe(false);
    addEventListenerSpy.mockRestore();
  });

  it("AC-PLATFORM-001 statically exposes strict fields and no chooser data access", () => {
    for (const required of [
      "event.isTrusted",
      "compositionDataGetter.call(event)",
      "inputDataGetter.call(event)",
      "inputKindGetter.call(event)",
      "inputComposingGetter.call(event)",
      'record.inputType === "insertCompositionText"',
      'record.inputType === "insertFromComposition"',
      'record.data === "中文"',
      "record.data !== expectedEndData",
      "readText(snapshot.target)",
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
