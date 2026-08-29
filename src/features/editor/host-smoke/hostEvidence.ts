import type { CompositionRefreshPhase } from "../spike/editorSpike";

export type ImeScenario = "confirm" | "cancel";

export interface HostInputEventSample {
  readonly type:
    "compositionstart" | "compositionupdate" | "compositionend" | "beforeinput" | "input";
  readonly phase: CompositionRefreshPhase;
  readonly frozen: boolean;
}

export interface ImeWireEvidence {
  readonly counts: readonly [number, number, number, number, number, number];
  readonly flags: readonly [boolean, boolean, boolean, boolean];
  readonly finalUtf16Length: number;
}

export function evaluateImeEvidence(
  samples: readonly HostInputEventSample[],
  finalText: string,
  expectedText: string,
): ImeWireEvidence {
  const types = samples.map((sample) => sample.type);
  const firstStart = types.indexOf("compositionstart");
  const lastEnd = types.lastIndexOf("compositionend");
  let insideComposition = false;
  let unsafeRuntimeSamples = 0;

  for (const sample of samples) {
    if (sample.type === "compositionstart") insideComposition = true;
    if (insideComposition && !sample.frozen) unsafeRuntimeSamples += 1;
    if (sample.type === "compositionend") insideComposition = false;
  }

  return {
    counts: [
      count(types, "compositionstart"),
      count(types, "compositionupdate"),
      count(types, "compositionend"),
      count(types, "beforeinput"),
      count(types, "input"),
      unsafeRuntimeSamples,
    ],
    flags: [
      firstStart >= 0 && lastEnd > firstStart,
      samples.some((sample) => sample.phase === "composing"),
      samples.some((sample) => sample.phase === "refreshPending"),
      finalText === expectedText,
    ],
    finalUtf16Length: finalText.length,
  };
}

function count(values: readonly string[], expected: string): number {
  return values.reduce((total, value) => total + Number(value === expected), 0);
}
