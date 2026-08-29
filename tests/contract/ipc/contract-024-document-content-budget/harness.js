(() => {
  "use strict";

  if (globalThis.__markdownWorkspaceContract024Running) return;
  globalThis.__markdownWorkspaceContract024Running = true;

  const RAW_LIMIT_BYTES = 32 * 1024 * 1024;
  const WIRE_LIMIT_BYTES = 193 * 1024 * 1024;
  const DEFAULT_LIMIT_BYTES = 1024 * 1024;
  const invoke = globalThis.__TAURI_INTERNALS__?.invoke;

  const documentAllowed = (rawBytes, wireBytes) =>
    Number.isSafeInteger(rawBytes) &&
    Number.isSafeInteger(wireBytes) &&
    rawBytes >= 0 &&
    wireBytes >= 0 &&
    rawBytes <= RAW_LIMIT_BYTES &&
    wireBytes <= WIRE_LIMIT_BYTES;
  const defaultAllowed = (wireBytes) =>
    Number.isSafeInteger(wireBytes) && wireBytes >= 0 && wireBytes <= DEFAULT_LIMIT_BYTES;

  const reportFailure = async (code) => {
    try {
      await invoke("contract_024_fail", { code });
    } catch {
      // A missing structured result is itself a runner failure; no frontend-only PASS exists.
    }
  };

  const run = async () => {
    if (typeof invoke !== "function") {
      return reportFailure("unexpectedHarnessFailure");
    }

    const boundariesPassed =
      documentAllowed(RAW_LIMIT_BYTES - 1, WIRE_LIMIT_BYTES - 1) &&
      documentAllowed(RAW_LIMIT_BYTES, WIRE_LIMIT_BYTES) &&
      !documentAllowed(RAW_LIMIT_BYTES + 1, WIRE_LIMIT_BYTES) &&
      !documentAllowed(RAW_LIMIT_BYTES, WIRE_LIMIT_BYTES + 1) &&
      defaultAllowed(DEFAULT_LIMIT_BYTES) &&
      !defaultAllowed(DEFAULT_LIMIT_BYTES + 1) &&
      documentAllowed(DEFAULT_LIMIT_BYTES + 1, DEFAULT_LIMIT_BYTES + 1);
    if (!boundariesPassed) return reportFailure("boundaryInvariantFailed");

    const scenario = await invoke("contract_024_scenario");
    if (scenario !== "ordinary" && scenario !== "worstEscaping") {
      return reportFailure("unexpectedHarnessFailure");
    }

    const originalFetch = globalThis.fetch;
    const originalWarn = globalThis.console.warn;
    let ipcFetchStarted = 0;
    let ipcFetchResolved = 0;
    let ipcResponseBodyRead = 0;
    let fallbackUsed = false;
    let transportObservationInstalled = false;

    const isIpcUrl = (input) => {
      const url = typeof input === "string" ? input : input?.url;
      return typeof url === "string" &&
        (url.startsWith("ipc:") || url.startsWith("http://ipc.localhost/") ||
          url.startsWith("https://ipc.localhost/"));
    };

    try {
      globalThis.fetch = async (...args) => {
        const ipcRequest = isIpcUrl(args[0]);
        if (ipcRequest) ipcFetchStarted += 1;
        const response = await originalFetch.apply(globalThis, args);
        if (ipcRequest) ipcFetchResolved += 1;

        if (!ipcRequest) return response;
        return new Proxy(response, {
          get(target, property) {
            if (property === "json" || property === "text" || property === "arrayBuffer") {
              return async (...methodArgs) => {
                const value = await target[property](...methodArgs);
                ipcResponseBodyRead += 1;
                return value;
              };
            }
            const value = Reflect.get(target, property, target);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
      };
      globalThis.console.warn = (...args) => {
        if (
          typeof args[0] === "string" &&
          args[0].startsWith("IPC custom protocol failed")
        ) {
          fallbackUsed = true;
        }
        return originalWarn.apply(globalThis.console, args);
      };
      transportObservationInstalled =
        globalThis.fetch !== originalFetch && globalThis.console.warn !== originalWarn;
    } catch {
      transportObservationInstalled = false;
    }
    if (!transportObservationInstalled) {
      return reportFailure("transportObservationUnavailable");
    }

    const escapeFactor = scenario === "ordinary" ? 1 : 6;
    const content = (scenario === "ordinary" ? "x" : "\u0000").repeat(RAW_LIMIT_BYTES);
    const requestWireBytes = 14 + RAW_LIMIT_BYTES * escapeFactor;
    const responseWireBytes = 2 + RAW_LIMIT_BYTES * escapeFactor;
    const startedAt = globalThis.performance.now();
    let returned;

    try {
      returned = await invoke("contract_024_roundtrip", { payload: content });
    } catch {
      globalThis.fetch = originalFetch;
      globalThis.console.warn = originalWarn;
      return reportFailure("invokeRejected");
    }

    const elapsedMicros = Math.max(
      1,
      Math.round((globalThis.performance.now() - startedAt) * 1000),
    );
    const equal = returned === content;
    globalThis.fetch = originalFetch;
    globalThis.console.warn = originalWarn;

    if (!equal) return reportFailure("responseMismatch");
    const customProtocolObserved =
      ipcFetchStarted === 1 && ipcFetchResolved === 1 && ipcResponseBodyRead === 1;
    if (!customProtocolObserved || fallbackUsed) {
      return reportFailure("customProtocolNotObserved");
    }
    const result = [
      scenario,
      RAW_LIMIT_BYTES,
      requestWireBytes,
      responseWireBytes,
      elapsedMicros,
      equal,
      transportObservationInstalled,
      fallbackUsed,
      boundariesPassed,
    ].join("|");
    await invoke("contract_024_report", { result });
  };

  run().catch(() => reportFailure("unexpectedHarnessFailure"));
})();
