/* eslint-disable no-undef -- Rust-injected document-start browser script. */

(() => {
  "use strict";

  // Replaced by Rust with eight independently generated 256-bit values. This
  // object, every token, and the non-extractable HMAC key remain private to this
  // document-start closure.
  const injected = __HOST_SMOKE_TOKEN_BUNDLE__;
  let captureReadyToken = injected.captureReady;
  let confirmBeginToken = injected.confirmBegin;
  let confirmFinishToken = injected.confirmFinish;
  let cancelBeginToken = injected.cancelBegin;
  let cancelFinishToken = injected.cancelFinish;
  let chooserBeginToken = injected.chooserBegin;
  let chooserFinishToken = injected.chooserFinish;
  let evidenceMacKeyHex = injected.evidenceMacKey;

  const nativeApply = Reflect.apply;
  const nativePromiseThen = Promise.prototype.then;
  const nativeQueueMicrotask = window.queueMicrotask.bind(window);
  const arrayPush = Array.prototype.push;
  const isPrototypeOf = Object.prototype.isPrototypeOf;
  const nativeInvoke = window.__TAURI_INTERNALS__.invoke.bind(window.__TAURI_INTERNALS__);
  const NativeString = window.String;
  const NativeUint8Array = window.Uint8Array;
  const uint8Fill = NativeUint8Array.prototype.fill;
  const NativeTextEncoder = window.TextEncoder;
  const textEncoder = new NativeTextEncoder();
  const textEncode = NativeTextEncoder.prototype.encode;
  const nativeSubtle = window.crypto.subtle;
  const subtlePrototype = Object.getPrototypeOf(nativeSubtle);
  const subtleImportKey = subtlePrototype.importKey;
  const subtleSign = subtlePrototype.sign;
  const TrustedCompositionEvent = window.CompositionEvent;
  const TrustedInputEvent = window.InputEvent;
  const trustedElementPrototype = window.Element.prototype;
  const trustedNodePrototype = window.Node.prototype;
  const trustedHtmlElementPrototype = window.HTMLElement.prototype;
  const trustedHtmlInputPrototype = window.HTMLInputElement.prototype;
  const querySelector = Document.prototype.querySelector.bind(document);
  const closest = Element.prototype.closest;
  const contains = Node.prototype.contains;
  const getAttribute = Element.prototype.getAttribute;
  const eventTypeGetter = Object.getOwnPropertyDescriptor(Event.prototype, "type").get;
  const eventTargetGetter = Object.getOwnPropertyDescriptor(Event.prototype, "target").get;
  const textContentGetter = Object.getOwnPropertyDescriptor(
    Node.prototype,
    "textContent",
  ).get;
  const inputTypeGetter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "type",
  ).get;
  const compositionDataGetter = Object.getOwnPropertyDescriptor(
    CompositionEvent.prototype,
    "data",
  ).get;
  const inputDataGetter = Object.getOwnPropertyDescriptor(InputEvent.prototype, "data").get;
  const inputKindGetter = Object.getOwnPropertyDescriptor(
    InputEvent.prototype,
    "inputType",
  ).get;
  const inputComposingGetter = Object.getOwnPropertyDescriptor(
    InputEvent.prototype,
    "isComposing",
  ).get;
  const CONFIRM_BASELINE = "确认：";
  const CONFIRM_EXPECTED = "确认：中文";
  const CANCEL_BASELINE = "取消：";
  const MAX_EVENT_DATA_UTF16 = 64;
  let localStage = "awaitConfirm";
  let active = null;
  let chooserTarget = null;
  let chooserBeginPromise = null;

  function privateThen(promise, onFulfilled, onRejected) {
    return nativeApply(nativePromiseThen, promise, [onFulfilled, onRejected]);
  }

  function nativeInstance(prototype, value) {
    return nativeApply(isPrototypeOf, prototype, [value]);
  }

  function eventType(event) {
    return nativeApply(eventTypeGetter, event, []);
  }

  function eventTarget(event) {
    return nativeApply(eventTargetGetter, event, []);
  }

  function encodedBytes(value) {
    return nativeApply(textEncode, textEncoder, [value]);
  }

  function hexBytes(value) {
    if (typeof value !== "string" || value.length !== 64) {
      throw new Error("invalid private HMAC key");
    }
    const bytes = new NativeUint8Array(32);
    for (let index = 0; index < bytes.length; index += 1) {
      const byte = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
      if (!Number.isInteger(byte)) throw new Error("invalid private HMAC key");
      bytes[index] = byte;
    }
    return bytes;
  }

  function bytesHex(value) {
    const bytes = new NativeUint8Array(value);
    const alphabet = "0123456789abcdef";
    let encoded = "";
    for (let index = 0; index < bytes.length; index += 1) {
      encoded += alphabet[bytes[index] >> 4] + alphabet[bytes[index] & 0x0f];
    }
    return encoded;
  }

  function framedField(value) {
    return `${encodedBytes(value).length}:${value}`;
  }

  function imeMacMessage(token, scenario, counts, flags, finalUtf16Length) {
    const countsField = `${counts[0]},${counts[1]},${counts[2]},${counts[3]},${counts[4]},${counts[5]}`;
    const flagsField = `${flags[0] ? 1 : 0}${flags[1] ? 1 : 0}${flags[2] ? 1 : 0}${flags[3] ? 1 : 0}${flags[4] ? 1 : 0}${flags[5] ? 1 : 0}`;
    const lengthField = NativeString(finalUtf16Length);
    return `P0-HOST-SMOKE-IME-V1|${framedField(token)}|${framedField(scenario)}|${framedField(countsField)}|${framedField(flagsField)}|${framedField(lengthField)}`;
  }

  function chooserMacMessage(token, eventKind) {
    return `P0-HOST-SMOKE-CHOOSER-V1|${framedField(token)}|${framedField(eventKind)}`;
  }

  const rawMacKeyBytes = hexBytes(evidenceMacKeyHex);
  const importedKey = nativeApply(subtleImportKey, nativeSubtle, [
    "raw",
    rawMacKeyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  ]);
  const evidenceMacKey = privateThen(importedKey, (key) => {
    nativeApply(uint8Fill, rawMacKeyBytes, [0]);
    evidenceMacKeyHex = null;
    injected.evidenceMacKey = null;
    return key;
  });

  function signEvidence(message) {
    return privateThen(evidenceMacKey, (key) => {
      const signature = nativeApply(subtleSign, nativeSubtle, [
        "HMAC",
        key,
        encodedBytes(message),
      ]);
      return privateThen(signature, bytesHex);
    });
  }

  Object.defineProperty(window, "__MARKDOWN_WORKSPACE_HOST_RELEASE_SMOKE__", {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false,
  });

  function privateResult(kind, ok) {
    document.dispatchEvent(
      new CustomEvent("host-smoke-private-result", {
        detail: { kind, ok: ok === true },
      }),
    );
  }

  function editorContent() {
    const candidate = querySelector("[data-host-editor] .cm-content");
    return nativeInstance(trustedHtmlElementPrototype, candidate) ? candidate : null;
  }

  function nativeFileInput() {
    const candidate = querySelector("[data-host-native-input]");
    return nativeInstance(trustedHtmlInputPrototype, candidate) &&
      nativeApply(inputTypeGetter, candidate, []) === "file"
      ? candidate
      : null;
  }

  function readText(node) {
    return nativeApply(textContentGetter, node, []);
  }

  function boundedData(value) {
    return typeof value === "string" && value.length <= MAX_EVENT_DATA_UTF16 ? value : null;
  }

  function beginScenario(scenario) {
    const expectedStage = scenario === "confirm" ? "awaitConfirm" : "awaitCancel";
    const expectedBaseline = scenario === "confirm" ? CONFIRM_BASELINE : CANCEL_BASELINE;
    if (localStage !== expectedStage || active !== null) return;

    nativeQueueMicrotask(() => {
      const target = editorContent();
      if (target === null || readText(target) !== expectedBaseline) {
        privateResult(`${scenario}Begin`, false);
        return;
      }

      let token;
      if (scenario === "confirm") {
        token = confirmBeginToken;
        confirmBeginToken = null;
      } else {
        token = cancelBeginToken;
        cancelBeginToken = null;
      }
      if (typeof token !== "string") return;

      active = {
        scenario,
        target,
        records: [],
        rejectedSyntheticCount: 0,
        sameTarget: true,
      };
      const beginRequest = nativeInvoke("host_release_smoke_trusted_ime_begin", {
        token,
        scenario,
      });
      void privateThen(
        beginRequest,
        () => {
          privateResult(`${scenario}Begin`, true);
        },
        () => {
          if (active?.scenario === scenario) active.sameTarget = false;
          privateResult(`${scenario}Begin`, false);
        },
      );
    });
  }

  function recordCompositionEvent(event) {
    if (active === null) return;
    const target = eventTarget(event);
    if (target !== active.target) {
      const editorRoot = nativeApply(closest, active.target, ["[data-host-editor]"]);
      if (
        editorRoot !== null &&
        nativeInstance(trustedNodePrototype, target) &&
        nativeApply(contains, editorRoot, [target])
      ) {
        active.sameTarget = false;
      }
      return;
    }
    if (!event.isTrusted || !(event instanceof TrustedCompositionEvent)) {
      active.rejectedSyntheticCount += 1;
      return;
    }
    nativeApply(arrayPush, active.records, [
      {
        type: eventType(event),
        data: boundedData(nativeApply(compositionDataGetter, event, [])),
      },
    ]);
  }

  function recordInputEvent(event) {
    if (active === null) return;
    const target = eventTarget(event);
    if (target !== active.target) {
      const editorRoot = nativeApply(closest, active.target, ["[data-host-editor]"]);
      if (
        editorRoot !== null &&
        nativeInstance(trustedNodePrototype, target) &&
        nativeApply(contains, editorRoot, [target])
      ) {
        active.sameTarget = false;
      }
      return;
    }
    if (!event.isTrusted || !(event instanceof TrustedInputEvent)) {
      active.rejectedSyntheticCount += 1;
      return;
    }
    nativeApply(arrayPush, active.records, [
      {
        type: eventType(event),
        data: boundedData(nativeApply(inputDataGetter, event, [])),
        inputType: nativeApply(inputKindGetter, event, []),
        isComposing: nativeApply(inputComposingGetter, event, []) === true,
      },
    ]);
  }

  function evaluateScenario(snapshot) {
    const counts = [0, 0, 0, 0, 0, snapshot.rejectedSyntheticCount];
    let phase = "expectStart";
    let strictSequenceValid = true;
    let compositionDataValid = true;
    let inputFieldsValid = true;
    let updateCount = 0;
    let pendingInput = null;
    let finalInputPairSeen = false;

    for (let index = 0; index < snapshot.records.length; index += 1) {
      const record = snapshot.records[index];
      if (record.type === "compositionstart") counts[0] += 1;
      if (record.type === "compositionupdate") counts[1] += 1;
      if (record.type === "compositionend") counts[2] += 1;
      if (record.type === "beforeinput") counts[3] += 1;
      if (record.type === "input") counts[4] += 1;

      if (record.type === "compositionstart") {
        if (phase !== "expectStart" || record.data === null) {
          strictSequenceValid = false;
          compositionDataValid = false;
        } else {
          phase = "composing";
        }
        continue;
      }

      if (record.type === "compositionupdate") {
        if (phase !== "composing" || pendingInput !== null) {
          strictSequenceValid = false;
        }
        if (record.data === null) compositionDataValid = false;
        updateCount += 1;
        continue;
      }

      if (record.type === "compositionend") {
        const expectedEndData = snapshot.scenario === "confirm" ? "中文" : "";
        if (phase !== "composing" || pendingInput !== null || updateCount < 1) {
          strictSequenceValid = false;
        }
        if (record.data !== expectedEndData) compositionDataValid = false;
        phase = "ended";
        continue;
      }

      if (record.type === "beforeinput") {
        if (phase === "composing") {
          const valid =
            pendingInput === null &&
            record.inputType === "insertCompositionText" &&
            record.isComposing === true &&
            record.data !== null;
          if (!valid) inputFieldsValid = false;
          pendingInput = {
            kind: "composing",
            data: record.data,
            inputType: record.inputType,
            isComposing: record.isComposing,
          };
        } else if (
          phase === "ended" &&
          snapshot.scenario === "confirm" &&
          !finalInputPairSeen
        ) {
          const valid =
            pendingInput === null &&
            record.inputType === "insertFromComposition" &&
            record.isComposing === false &&
            record.data === "中文";
          if (!valid) inputFieldsValid = false;
          pendingInput = {
            kind: "final",
            data: record.data,
            inputType: record.inputType,
            isComposing: record.isComposing,
          };
          phase = "finalBeforeInput";
        } else {
          strictSequenceValid = false;
          inputFieldsValid = false;
        }
        continue;
      }

      if (record.type === "input") {
        const matchesPending =
          pendingInput !== null &&
          pendingInput.data === record.data &&
          pendingInput.inputType === record.inputType &&
          pendingInput.isComposing === record.isComposing;
        if (!matchesPending) {
          strictSequenceValid = false;
          inputFieldsValid = false;
        }
        if (pendingInput?.kind === "final") {
          finalInputPairSeen = true;
          phase = "finalized";
        } else if (phase !== "composing") {
          strictSequenceValid = false;
        }
        pendingInput = null;
        continue;
      }

      strictSequenceValid = false;
    }

    const terminalPhaseValid =
      snapshot.scenario === "confirm"
        ? phase === "finalized" && finalInputPairSeen
        : phase === "ended" && !finalInputPairSeen;
    const countShapeValid =
      counts[0] === 1 &&
      counts[1] >= 1 &&
      counts[2] === 1 &&
      counts[3] === counts[4] &&
      counts[3] >= 1;
    strictSequenceValid =
      strictSequenceValid && terminalPhaseValid && countShapeValid && pendingInput === null;

    const finalText = readText(snapshot.target);
    const expectedText =
      snapshot.scenario === "confirm" ? CONFIRM_EXPECTED : CANCEL_BASELINE;
    const finalTextMatches = finalText === expectedText;
    return {
      counts,
      flags: [
        strictSequenceValid,
        compositionDataValid,
        inputFieldsValid,
        snapshot.sameTarget,
        finalTextMatches,
        snapshot.rejectedSyntheticCount === 0,
      ],
      finalUtf16Length: typeof finalText === "string" ? finalText.length : 0,
    };
  }

  function finishScenario(scenario) {
    if (active?.scenario !== scenario) return;
    nativeQueueMicrotask(() => {
      if (active?.scenario !== scenario) return;
      const snapshot = active;
      active = null;
      const evidence = evaluateScenario(snapshot);
      let token;
      if (scenario === "confirm") {
        token = confirmFinishToken;
        confirmFinishToken = null;
      } else {
        token = cancelFinishToken;
        cancelFinishToken = null;
      }
      if (typeof token !== "string") return;

      const signedRequest = privateThen(
        signEvidence(
          imeMacMessage(
            token,
            scenario,
            evidence.counts,
            evidence.flags,
            evidence.finalUtf16Length,
          ),
        ),
        (evidenceMac) =>
          nativeInvoke("host_release_smoke_trusted_ime_finish", {
            token,
            scenario,
            counts: evidence.counts,
            flags: evidence.flags,
            finalUtf16Length: evidence.finalUtf16Length,
            evidenceMac,
          }),
      );
      void privateThen(
        signedRequest,
        () => {
          localStage = scenario === "confirm" ? "awaitCancel" : "awaitChooser";
          privateResult(`${scenario}Finish`, true);
        },
        () => privateResult(`${scenario}Finish`, false),
      );
    });
  }

  function beginChooser() {
    if (localStage !== "awaitChooser" || chooserTarget !== null) return;
    const target = nativeFileInput();
    if (target === null || typeof chooserBeginToken !== "string") {
      privateResult("chooserBegin", false);
      return;
    }
    const token = chooserBeginToken;
    chooserBeginToken = null;
    chooserTarget = target;
    chooserBeginPromise = nativeInvoke("host_release_smoke_trusted_chooser_begin", {
      token,
    });
    void privateThen(
      chooserBeginPromise,
      () => privateResult("chooserBegin", true),
      () => privateResult("chooserBegin", false),
    );
  }

  function finishChooser(eventKind, event) {
    if (chooserTarget === null || eventTarget(event) !== chooserTarget) return;
    if (!event.isTrusted || typeof chooserFinishToken !== "string") return;
    const token = chooserFinishToken;
    chooserFinishToken = null;
    const begin = chooserBeginPromise;
    chooserBeginPromise = null;
    chooserTarget = null;
    if (begin === null) {
      privateResult("chooserFinish", false);
      return;
    }
    const signedEvidence = privateThen(begin, () =>
      signEvidence(chooserMacMessage(token, eventKind)),
    );
    const finishRequest = privateThen(signedEvidence, (evidenceMac) =>
      nativeInvoke("host_release_smoke_trusted_chooser_finish", {
        token,
        eventKind,
        evidenceMac,
      }),
    );
    void privateThen(
      finishRequest,
      () => {
        localStage = eventKind === "cancel" ? "complete" : "failed";
        privateResult("chooserFinish", eventKind === "cancel");
      },
      () => privateResult("chooserFinish", false),
    );
  }

  document.addEventListener(
    "click",
    (event) => {
      if (!event.isTrusted || !nativeInstance(trustedElementPrototype, event.target))
        return;
      const actionTarget = nativeApply(closest, event.target, ["[data-host-action]"]);
      const action = actionTarget
        ? nativeApply(getAttribute, actionTarget, ["data-host-action"])
        : null;
      if (action === "begin-confirm") beginScenario("confirm");
      if (action === "finish-confirm") finishScenario("confirm");
      if (action === "begin-cancel") beginScenario("cancel");
      if (action === "finish-cancel") finishScenario("cancel");
      if (action === "chooser-open") beginChooser();
    },
    true,
  );
  for (const type of ["compositionstart", "compositionupdate", "compositionend"]) {
    document.addEventListener(type, recordCompositionEvent, true);
  }
  for (const type of ["beforeinput", "input"]) {
    document.addEventListener(type, recordInputEvent, true);
  }
  document.addEventListener("cancel", (event) => finishChooser("cancel", event), true);
  document.addEventListener("change", (event) => finishChooser("change", event), true);

  function announceCaptureReady() {
    if (typeof captureReadyToken !== "string") return;
    const token = captureReadyToken;
    captureReadyToken = null;
    const readyRequest = privateThen(evidenceMacKey, () =>
      nativeInvoke("host_release_smoke_capture_ready", { token }),
    );
    void privateThen(
      readyRequest,
      () => {},
      () => {},
    );
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", announceCaptureReady, { once: true });
  } else {
    nativeQueueMicrotask(announceCaptureReady);
  }
})();
