import type { EditorView } from "@codemirror/view";

/**
 * jsdom does not implement a platform IME or CodeMirror's browser DOM mutation
 * pipeline. This harness still dispatches the real DOM event types and ordering,
 * while `applyObservedMutation` stands in for the mutation that CodeMirror's DOM
 * observer would convert into a transaction in WebKit/Chromium.
 */
export interface DomInputStep {
  readonly data: string;
  readonly inputType: string;
  readonly isComposing: boolean;
  readonly applyObservedMutation: () => void;
}

export function dispatchCompositionEvent(
  view: EditorView,
  type: "compositionstart" | "compositionend",
  data = "",
): CompositionEvent {
  const event = new CompositionEvent(type, { bubbles: true, data });
  view.contentDOM.dispatchEvent(event);
  return event;
}

export function dispatchDomInputStep(
  view: EditorView,
  step: DomInputStep,
): { readonly beforeInput: InputEvent; readonly input: InputEvent } {
  const init: InputEventInit = {
    bubbles: true,
    cancelable: true,
    composed: true,
    data: step.data,
    inputType: step.inputType,
    isComposing: step.isComposing,
  };
  const beforeInput = new InputEvent("beforeinput", init);
  const accepted = view.contentDOM.dispatchEvent(beforeInput);
  if (accepted) step.applyObservedMutation();

  const input = new InputEvent("input", { ...init, cancelable: false });
  view.contentDOM.dispatchEvent(input);
  return { beforeInput, input };
}
