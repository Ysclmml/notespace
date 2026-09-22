import { expect, it } from "vitest";
import {
  appStateReducer,
  createInitialAppState,
  editDocument,
  openInNewTab,
  openInCurrent,
  splitTabRight,
  type AppStateAction,
} from "../../app/state";
import {
  closingDirtyDocumentIds,
  tabsToClose,
  type PendingCloseRequest,
} from "./tabClosing";

const doc = (path: string) => ({
  path,
  text: path,
  diskMtimeMs: 1,
  mode: "normal" as const,
});
const stateWith = (...actions: AppStateAction[]) =>
  actions.reduce(appStateReducer, createInitialAppState());
const request = (tabIds: string[]): PendingCloseRequest => ({
  kind: "tabs",
  tabIds,
  discardedTexts: new Map(),
});

it("uses the selected tab's group for left/right and the whole window for all", () => {
  const state = stateWith(
    openInNewTab("a", doc("a")),
    openInNewTab("b", doc("b")),
    openInNewTab("c", doc("c")),
    splitTabRight("b", "copy", "right"),
  );
  expect(tabsToClose(state, "b", "left")).toEqual(["a"]);
  expect(tabsToClose(state, "b", "right")).toEqual(["c"]);
  expect(tabsToClose(state, "copy", "left")).toEqual([]);
  expect(tabsToClose(state, "b", "all")).toEqual(["a", "b", "c", "copy"]);
  expect(tabsToClose(state, "missing", "all")).toEqual([]);
});

it("deduplicates dirty history and protects sessions retained by another tab", () => {
  const state = stateWith(
    openInNewTab("a", doc("a")),
    editDocument("a", "edited"),
    openInCurrent("a", doc("b")),
    splitTabRight("a", "copy", "right"),
  );
  expect(closingDirtyDocumentIds(state, request(["a"]))).toEqual([]);
  expect(closingDirtyDocumentIds(state, request(["a", "copy"]))).toEqual(["a"]);
  expect(closingDirtyDocumentIds(state, { ...request([]), kind: "window" })).toEqual(["a"]);
});

it("requires another decision if text changes after a per-file discard choice", () => {
  const state = stateWith(openInNewTab("a", doc("a")), editDocument("a", "edited"));
  const consent = { ...request(["a"]), discardedTexts: new Map([["a", "edited"]]) };
  expect(closingDirtyDocumentIds(state, consent)).toEqual([]);
  const updated = appStateReducer(state, editDocument("a", "later edit"));
  expect(closingDirtyDocumentIds(updated, consent)).toEqual(["a"]);
});
