import { StrictMode, type PropsWithChildren } from "react";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as calculation from "./documentStatistics";
import type { StatisticsDocument } from "./statisticsCache";
import { STATISTICS_DEBOUNCE_MS, useDocumentStatistics } from "./useDocumentStatistics";

function document(text: string, id = "document"): StatisticsDocument {
  return { id, text, kind: "markdown" };
}

function finishStatistics() {
  act(() => vi.runAllTimers());
}

describe("useDocumentStatistics", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("has no pending work for no active document and reports an empty document immediately", () => {
    const { result, rerender } = renderHook(
      ({ session }: { session?: StatisticsDocument }) => useDocumentStatistics(session),
      { initialProps: { session: undefined as StatisticsDocument | undefined } },
    );
    expect(result.current).toEqual({ statistics: undefined, pending: false });
    rerender({ session: document("") });
    expect(result.current).toEqual({
      statistics: calculation.EMPTY_DOCUMENT_STATISTICS,
      pending: false,
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("debounces continuous Chinese edits and computes only the latest text", () => {
    const { result, rerender } = renderHook(
      ({ session }) => useDocumentStatistics(session),
      {
        initialProps: { session: document("中") },
      },
    );
    expect(result.current).toEqual({ statistics: undefined, pending: true });
    act(() => vi.advanceTimersByTime(STATISTICS_DEBOUNCE_MS - 1));
    rerender({ session: document("中文") });
    act(() => vi.advanceTimersByTime(STATISTICS_DEBOUNCE_MS - 1));
    expect(result.current.pending).toBe(true);
    finishStatistics();
    expect(result.current.statistics?.wordCount).toBe(2);
    rerender({ session: document("中文输入") });
    finishStatistics();
    expect(result.current.statistics?.wordCount).toBe(4);
    rerender({ session: document("中文输") });
    finishStatistics();
    expect(result.current.statistics?.wordCount).toBe(3);
  });

  it("does not recalculate on unrelated rerenders or returning to an unchanged tab", () => {
    const createTask = vi.spyOn(calculation, "createDocumentStatisticsTask");
    const first = document("中文", "first");
    const second = document("hello world", "second");
    const { result, rerender } = renderHook(
      ({ session }) => useDocumentStatistics(session),
      {
        initialProps: { session: first },
      },
    );
    finishStatistics();
    const firstStatistics = result.current.statistics;
    rerender({ session: first });
    rerender({ session: { ...first } });
    expect(createTask).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    rerender({ session: second });
    expect(result.current.statistics).toBeUndefined();
    finishStatistics();
    expect(result.current.statistics?.wordCount).toBe(2);
    rerender({ session: first });
    expect(result.current.statistics).toBe(firstStatistics);
    expect(result.current.pending).toBe(false);
    expect(createTask).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("invalidates on external reload and kind change without relying on a dirty flag", () => {
    const createTask = vi.spyOn(calculation, "createDocumentStatisticsTask");
    const { result, rerender } = renderHook(
      ({ session }) => useDocumentStatistics(session),
      {
        initialProps: { session: document("test") },
      },
    );
    finishStatistics();
    expect(result.current.statistics?.wordCount).toBe(1);
    rerender({ session: document("外部修改") });
    expect(result.current.pending).toBe(true);
    finishStatistics();
    expect(result.current.statistics?.wordCount).toBe(4);
    rerender({ session: { ...document("外部修改"), kind: "text" } });
    finishStatistics();
    expect(result.current.statistics?.wordCount).toBe(4);
    expect(createTask).toHaveBeenCalledTimes(3);
  });

  it("recomputes an expired weak cache entry even when source dependencies are unchanged", () => {
    const createTask = vi.spyOn(calculation, "createDocumentStatisticsTask");
    const session = document("中文");
    const { result, rerender } = renderHook(({ source }) => useDocumentStatistics(source), {
      initialProps: { source: session },
    });
    finishStatistics();
    expect(result.current.statistics?.wordCount).toBe(2);
    vi.spyOn(WeakRef.prototype, "deref").mockReturnValueOnce(undefined);
    rerender({ source: session });
    expect(result.current.pending).toBe(true);
    finishStatistics();
    expect(result.current.statistics?.wordCount).toBe(2);
    expect(result.current.pending).toBe(false);
    expect(createTask).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels partially completed large work when the same path is reopened", () => {
    const { result, rerender } = renderHook(
      ({ session }: { session?: StatisticsDocument }) => useDocumentStatistics(session),
      {
        initialProps: {
          session: document("正文".repeat(calculation.STATISTICS_CHUNK_SIZE)) as
            StatisticsDocument | undefined,
        },
      },
    );
    act(() => vi.advanceTimersByTime(STATISTICS_DEBOUNCE_MS));
    expect(result.current.pending).toBe(true);
    rerender({ session: undefined });
    expect(vi.getTimerCount()).toBe(0);
    rerender({ session: document("new") });
    finishStatistics();
    expect(result.current.statistics?.wordCount).toBe(1);
    expect(result.current.statistics?.characterCount).toBe(3);
  });

  it("cleans up scheduled work on unmount, including StrictMode effect replays", () => {
    const wrapper = ({ children }: PropsWithChildren) => (
      <StrictMode>{children}</StrictMode>
    );
    const { result, unmount } = renderHook(() => useDocumentStatistics(document("中文")), {
      wrapper,
    });
    expect(vi.getTimerCount()).toBe(1);
    finishStatistics();
    expect(result.current.statistics?.wordCount).toBe(2);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
