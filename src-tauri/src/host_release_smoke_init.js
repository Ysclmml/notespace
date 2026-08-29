/* eslint-disable no-undef -- Rust-injected document-start browser script. */

;(() => {
  "use strict";

  // Replaced by Rust with seven independently generated 256-bit values. This
  // object and every token remain inside this initialization-script closure.
  const injected = __HOST_SMOKE_TOKEN_BUNDLE__;
  let captureReadyToken = injected.captureReady;
  let confirmBeginToken = injected.confirmBegin;
  let confirmFinishToken = injected.confirmFinish;
  let cancelBeginToken = injected.cancelBegin;
  let cancelFinishToken = injected.cancelFinish;
  let chooserBeginToken = injected.chooserBegin;
  let chooserFinishToken = injected.chooserFinish;

  const nativeInvoke = window.__TAURI_INTERNALS__.invoke.bind(
    window.__TAURI_INTERNALS__,
  );
  const TrustedCompositionEvent = window.CompositionEvent;
  const TrustedInputEvent = window.InputEvent;
  const querySelector = Document.prototype.querySelector.bind(document);
  const closest = Element.prototype.closest;
  const contains = Node.prototype.contains;
  const getAttribute = Element.prototype.getAttribute;
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
  const inputDataGetter = Object.getOwnPropertyDescriptor(
    InputEvent.prototype,
    "data",
  ).get;
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
    return candidate instanceof HTMLElement ? candidate : null;
  }

  function nativeFileInput() {
    const candidate = querySelector("[data-host-native-input]");
    return candidate instanceof HTMLInputElement && inputTypeGetter.call(candidate) === "file"
      ? candidate
      : null;
  }

  function readText(node) {
    return textContentGetter.call(node);
  }

  function boundedData(value) {
    return typeof value === "string" && value.length <= MAX_EVENT_DATA_UTF16
      ? value
      : null;
  }

  function beginScenario(scenario) {
    const expectedStage = scenario === "confirm" ? "awaitConfirm" : "awaitCancel";
    const expectedBaseline =
      scenario === "confirm" ? CONFIRM_BASELINE : CANCEL_BASELINE;
    if (localStage !== expectedStage || active !== null) return;

    queueMicrotask(() => {
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
      void nativeInvoke("host_release_smoke_trusted_ime_begin", {
        token,
        scenario,
      })
        .then(() => {
          privateResult(`${scenario}Begin`, true);
        })
        .catch(() => {
          if (active?.scenario === scenario) active.sameTarget = false;
          privateResult(`${scenario}Begin`, false);
        });
    });
  }

  function recordCompositionEvent(event) {
    if (active === null) return;
    if (event.target !== active.target) {
      const editorRoot = closest.call(active.target, "[data-host-editor]");
      if (
        editorRoot !== null &&
        event.target instanceof Node &&
        contains.call(editorRoot, event.target)
      ) {
        active.sameTarget = false;
      }
      return;
    }
    if (!event.isTrusted || !(event instanceof TrustedCompositionEvent)) {
      active.rejectedSyntheticCount += 1;
      return;
    }
    active.records.push({
      type: event.type,
      data: boundedData(compositionDataGetter.call(event)),
    });
  }

  function recordInputEvent(event) {
    if (active === null) return;
    if (event.target !== active.target) {
      const editorRoot = closest.call(active.target, "[data-host-editor]");
      if (
        editorRoot !== null &&
        event.target instanceof Node &&
        contains.call(editorRoot, event.target)
      ) {
        active.sameTarget = false;
      }
      return;
    }
    if (!event.isTrusted || !(event instanceof TrustedInputEvent)) {
      active.rejectedSyntheticCount += 1;
      return;
    }
    active.records.push({
      type: event.type,
      data: boundedData(inputDataGetter.call(event)),
      inputType: inputKindGetter.call(event),
      isComposing: inputComposingGetter.call(event) === true,
    });
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

    for (const record of snapshot.records) {
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
      strictSequenceValid &&
      terminalPhaseValid &&
      countShapeValid &&
      pendingInput === null;

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
    queueMicrotask(() => {
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

      void nativeInvoke("host_release_smoke_trusted_ime_finish", {
        token,
        scenario,
        counts: evidence.counts,
        flags: evidence.flags,
        finalUtf16Length: evidence.finalUtf16Length,
      })
        .then(() => {
          localStage = scenario === "confirm" ? "awaitCancel" : "awaitChooser";
          privateResult(`${scenario}Finish`, true);
        })
        .catch(() => privateResult(`${scenario}Finish`, false));
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
    void chooserBeginPromise
      .then(() => privateResult("chooserBegin", true))
      .catch(() => privateResult("chooserBegin", false));
  }

  function finishChooser(eventKind, event) {
    if (chooserTarget === null || event.target !== chooserTarget) return;
    if (!event.isTrusted || typeof chooserFinishToken !== "string") return;
    const token = chooserFinishToken;
    chooserFinishToken = null;
    const begin = chooserBeginPromise;
    chooserBeginPromise = null;
    chooserTarget = null;
    void Promise.resolve(begin)
      .then(() =>
        nativeInvoke("host_release_smoke_trusted_chooser_finish", {
          token,
          eventKind,
        }),
      )
      .then(() => {
        localStage = eventKind === "cancel" ? "complete" : "failed";
        privateResult("chooserFinish", eventKind === "cancel");
      })
      .catch(() => privateResult("chooserFinish", false));
  }

  document.addEventListener(
    "click",
    (event) => {
      if (!event.isTrusted || !(event.target instanceof Element)) return;
      const actionTarget = closest.call(event.target, "[data-host-action]");
      const action = actionTarget
        ? getAttribute.call(actionTarget, "data-host-action")
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
    void nativeInvoke("host_release_smoke_capture_ready", { token }).catch(() => {});
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", announceCaptureReady, { once: true });
  } else {
    queueMicrotask(announceCaptureReady);
  }
})();
