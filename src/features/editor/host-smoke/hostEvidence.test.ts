import { describe, expect, it } from "vitest";

import { evaluateImeEvidence, type HostInputEventSample } from "./hostEvidence";

const safeConfirmEvents: readonly HostInputEventSample[] = [
  { type: "compositionstart", phase: "composing", frozen: true },
  { type: "compositionupdate", phase: "composing", frozen: true },
  { type: "beforeinput", phase: "composing", frozen: true },
  { type: "input", phase: "composing", frozen: true },
  { type: "compositionend", phase: "refreshPending", frozen: true },
];

describe("P0-HOST-SMOKE-01 evidence evaluation", () => {
  it("IME-001 records only counts/runtime phases and confirms fixed final state", () => {
    expect(
      evaluateImeEvidence(safeConfirmEvents, "# \u4e2d\u6587\n\n", "# \u4e2d\u6587\n\n"),
    ).toEqual({
      counts: [1, 1, 1, 1, 1, 0],
      flags: [true, true, true, true],
      finalUtf16Length: 6,
    });
  });

  it("IME-001 fails closed on an unfrozen composition sample or changed cancel text", () => {
    const unsafe = safeConfirmEvents.map((sample, index) =>
      index === 1 ? { ...sample, frozen: false } : sample,
    );
    expect(
      evaluateImeEvidence(unsafe, "# \u4e2d\u6587\n\n", "# \u4e2d\u6587\n\n").counts[5],
    ).toBe(1);
    expect(evaluateImeEvidence(safeConfirmEvents, "changed", "unchanged").flags[3]).toBe(
      false,
    );
  });
});
