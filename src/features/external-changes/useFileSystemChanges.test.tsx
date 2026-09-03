import { act, cleanup, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DesktopAdapter } from "../../infrastructure/tauri/desktopAdapter";
import {
  useFileSystemChanges,
  type FileSystemChangesOptions,
} from "./useFileSystemChanges";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function testAdapter() {
  const listeners = new Set<(event: { paths: string[] }) => void>();
  const stops: ReturnType<typeof vi.fn>[] = [];
  const watchFileSystem = vi.fn<(_roots: string[], _paths: string[]) => Promise<void>>(
    async () => undefined,
  );
  const listenFileSystemChanges = vi.fn(
    async (listener: (event: { paths: string[] }) => void): Promise<() => void> => {
      listeners.add(listener);
      const stop = vi.fn(() => {
        listeners.delete(listener);
      });
      stops.push(stop);
      return stop;
    },
  );
  const adapter = { watchFileSystem, listenFileSystemChanges } as unknown as DesktopAdapter;
  return {
    adapter,
    watchFileSystem,
    listenFileSystemChanges,
    listeners,
    stops,
    emit(paths: string[]) {
      act(() => {
        for (const listener of listeners) listener({ paths });
      });
    },
  };
}

async function settle() {
  await act(async () => {
    for (let index = 0; index < 12; index++) await Promise.resolve();
  });
}

async function advance(milliseconds: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
}

function options(adapter: DesktopAdapter): FileSystemChangesOptions {
  return {
    adapter,
    workspaceRoots: ["/fixtures/workspace"],
    documentPaths: ["/fixtures/standalone.md"],
    onChange: vi.fn(),
    onError: vi.fn(),
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(async () => {
  cleanup();
  await settle();
  vi.useRealTimers();
});

describe("filesystem change lifecycle", () => {
  it("registers before configuring and requests one initial check only after readiness", async () => {
    const native = testAdapter();
    const registration = deferred<() => void>();
    const configuration = deferred<void>();
    const stop = vi.fn();
    native.listenFileSystemChanges.mockReturnValueOnce(registration.promise);
    native.watchFileSystem.mockReturnValueOnce(configuration.promise);
    const props = options(native.adapter);
    renderHook(() => useFileSystemChanges(props));
    await settle();
    expect(native.listenFileSystemChanges).toHaveBeenCalledOnce();
    expect(native.watchFileSystem).not.toHaveBeenCalled();
    await act(async () => registration.resolve(stop));
    await settle();
    expect(native.watchFileSystem).toHaveBeenCalledExactlyOnceWith(
      ["/fixtures/workspace"],
      ["/fixtures/standalone.md"],
    );
    expect(props.onChange).not.toHaveBeenCalled();
    await act(async () => configuration.resolve());
    await advance(250);
    expect(props.onChange).toHaveBeenCalledExactlyOnceWith(null);
  });

  it("coalesces burst paths, deduplicates them and never starves a continuous stream", async () => {
    const native = testAdapter();
    const props = options(native.adapter);
    renderHook(() => useFileSystemChanges(props));
    await settle();
    await advance(250);
    vi.mocked(props.onChange).mockClear();
    native.emit(["/fixtures/a.md", "/fixtures/a.md"]);
    await advance(100);
    native.emit(["/fixtures/b.md"]);
    await advance(249);
    expect(props.onChange).not.toHaveBeenCalled();
    await advance(1);
    expect(props.onChange).toHaveBeenCalledExactlyOnceWith([
      "/fixtures/a.md",
      "/fixtures/b.md",
    ]);

    vi.mocked(props.onChange).mockClear();
    for (let index = 0; index < 10; index++) {
      native.emit([`/fixtures/stream-${index}.md`]);
      await advance(100);
    }
    expect(props.onChange).toHaveBeenCalledOnce();
    expect(vi.mocked(props.onChange).mock.calls[0]![0]).toHaveLength(10);
    native.emit(["/fixtures/final.md"]);
    await advance(250);
    expect(props.onChange).toHaveBeenLastCalledWith(["/fixtures/final.md"]);
  });

  it("falls back to a full check for empty, excessive or oversized path batches", async () => {
    const native = testAdapter();
    const props = options(native.adapter);
    renderHook(() => useFileSystemChanges(props));
    await settle();
    await advance(250);
    vi.mocked(props.onChange).mockClear();
    for (const paths of [
      [],
      Array.from({ length: 513 }, (_, index) => `/fixtures/${index}.md`),
      [`/fixtures/${"a".repeat(8_193)}`],
      Array.from({ length: 300 }, (_, index) => `/fixtures/${index}/${"a".repeat(4_000)}`),
    ]) {
      native.emit(paths);
      await advance(250);
      expect(props.onChange).toHaveBeenLastCalledWith(null);
    }
    expect(props.onChange).toHaveBeenCalledTimes(4);
  });

  it("ignores same path sets on rerender and uses the newest callbacks", async () => {
    const native = testAdapter();
    const props = {
      ...options(native.adapter),
      workspaceRoots: ["/fixtures/b", "/fixtures/a", "/fixtures/a"],
    };
    const { rerender } = renderHook((current) => useFileSystemChanges(current), {
      initialProps: props,
    });
    await settle();
    await advance(250);
    const changed = vi.fn();
    const error = vi.fn();
    rerender({
      ...props,
      workspaceRoots: ["/fixtures/a", "/fixtures/b"],
      onChange: changed,
      onError: error,
    });
    await settle();
    expect(native.listenFileSystemChanges).toHaveBeenCalledOnce();
    expect(native.watchFileSystem).toHaveBeenCalledExactlyOnceWith(
      ["/fixtures/a", "/fixtures/b"],
      ["/fixtures/standalone.md"],
    );
    native.emit(["/fixtures/new.md"]);
    await advance(250);
    expect(changed).toHaveBeenCalledExactlyOnceWith(["/fixtures/new.md"]);
    expect(props.onChange).toHaveBeenCalledOnce();
    native.watchFileSystem.mockRejectedValueOnce(new Error("watch failed"));
    await advance(30_000);
    expect(error).toHaveBeenCalledOnce();
    expect(props.onError).not.toHaveBeenCalled();
  });

  it("checks focus and visible restoration and periodically repairs the same native scope", async () => {
    const native = testAdapter();
    const props = options(native.adapter);
    renderHook(() => useFileSystemChanges(props));
    await settle();
    await advance(250);
    vi.mocked(props.onChange).mockClear();
    act(() => window.dispatchEvent(new Event("focus")));
    const visibility = vi.spyOn(document, "visibilityState", "get");
    visibility.mockReturnValue("hidden");
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    visibility.mockReturnValue("visible");
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await advance(250);
    expect(props.onChange).toHaveBeenCalledExactlyOnceWith(null);
    vi.mocked(props.onChange).mockClear();
    const calls = native.watchFileSystem.mock.calls.length;
    await advance(30_000);
    expect(props.onChange).toHaveBeenCalledExactlyOnceWith(null);
    expect(native.watchFileSystem.mock.calls.length).toBe(calls + 1);
    expect(native.watchFileSystem).toHaveBeenLastCalledWith(
      ["/fixtures/workspace"],
      ["/fixtures/standalone.md"],
    );
    expect(native.listenFileSystemChanges).toHaveBeenCalledOnce();
  });

  it("keeps fallback checks and retries after watcher errors, reporting each distinct message once", async () => {
    const native = testAdapter();
    native.watchFileSystem.mockRejectedValue(new Error("root unavailable"));
    const props = options(native.adapter);
    renderHook(() => useFileSystemChanges(props));
    await settle();
    await advance(250);
    await advance(60_000);
    expect(native.watchFileSystem).toHaveBeenCalledTimes(3);
    expect(props.onError).toHaveBeenCalledOnce();
    expect(props.onChange).toHaveBeenCalledTimes(3);
    native.watchFileSystem.mockRejectedValue(new Error("access unavailable"));
    await advance(30_000);
    expect(props.onError).toHaveBeenCalledTimes(2);
    native.watchFileSystem.mockResolvedValue(undefined);
    await advance(30_000);
    expect(native.watchFileSystem).toHaveBeenCalledTimes(5);
    expect(native.listenFileSystemChanges).toHaveBeenCalledOnce();
  });

  it("retries listener registration on fallback without ever configuring before registration", async () => {
    const native = testAdapter();
    native.listenFileSystemChanges.mockRejectedValueOnce(new Error("listener unavailable"));
    const props = options(native.adapter);
    renderHook(() => useFileSystemChanges(props));
    await settle();
    await advance(250);
    expect(native.watchFileSystem).not.toHaveBeenCalled();
    expect(props.onError).toHaveBeenCalledOnce();
    expect(props.onChange).toHaveBeenCalledExactlyOnceWith(null);
    await advance(30_000);
    expect(native.listenFileSystemChanges).toHaveBeenCalledTimes(2);
    expect(native.watchFileSystem).toHaveBeenCalledOnce();
    expect(props.onChange).toHaveBeenCalledTimes(2);
  });

  it("disposes a late listener registration without configuring or leaving timers", async () => {
    const native = testAdapter();
    const registration = deferred<() => void>();
    const stop = vi.fn();
    native.listenFileSystemChanges.mockReturnValueOnce(registration.promise);
    const props = options(native.adapter);
    const { unmount } = renderHook(() => useFileSystemChanges(props));
    await settle();
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => registration.resolve(stop));
    await settle();
    expect(stop).toHaveBeenCalledOnce();
    expect(native.watchFileSystem).not.toHaveBeenCalled();
    expect(props.onChange).not.toHaveBeenCalled();
  });

  it("keeps fallback usable while registration is pending and clears watches when scope becomes empty", async () => {
    const native = testAdapter();
    const registration = deferred<() => void>();
    const stop = vi.fn();
    native.listenFileSystemChanges.mockReturnValueOnce(registration.promise);
    const props = options(native.adapter);
    const { rerender } = renderHook((current) => useFileSystemChanges(current), {
      initialProps: props,
    });
    await settle();
    await advance(30_250);
    expect(props.onChange).toHaveBeenCalledExactlyOnceWith(null);
    expect(native.listenFileSystemChanges).toHaveBeenCalledOnce();
    expect(native.watchFileSystem).not.toHaveBeenCalled();
    await act(async () => registration.resolve(stop));
    await settle();
    expect(native.watchFileSystem).toHaveBeenCalledOnce();
    rerender({ ...props, workspaceRoots: [], documentPaths: [] });
    await settle();
    expect(stop).toHaveBeenCalledOnce();
    expect(native.watchFileSystem).toHaveBeenLastCalledWith([], []);
    expect(vi.getTimerCount()).toBe(0);
    act(() => window.dispatchEvent(new Event("focus")));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("serializes old pending configuration, disposal and a new hook mount on the same adapter", async () => {
    const native = testAdapter();
    const pending = deferred<void>();
    native.watchFileSystem.mockReturnValueOnce(pending.promise);
    const oldProps = options(native.adapter);
    const previous = renderHook(() => useFileSystemChanges(oldProps));
    await settle();
    expect(native.watchFileSystem).toHaveBeenCalledOnce();
    previous.unmount();
    const newProps = { ...options(native.adapter), workspaceRoots: ["/fixtures/new-root"] };
    const next = renderHook(() => useFileSystemChanges(newProps));
    await settle();
    expect(native.watchFileSystem).toHaveBeenCalledOnce();
    expect(native.listenFileSystemChanges).toHaveBeenCalledOnce();
    await act(async () => pending.resolve());
    await settle();
    expect(native.watchFileSystem.mock.calls).toEqual([
      [["/fixtures/workspace"], ["/fixtures/standalone.md"]],
      [[], []],
      [["/fixtures/new-root"], ["/fixtures/standalone.md"]],
    ]);
    expect(native.stops[0]).toHaveBeenCalledOnce();
    expect(native.listeners.size).toBe(1);
    expect(oldProps.onChange).not.toHaveBeenCalled();
    await advance(250);
    expect(newProps.onChange).toHaveBeenCalledExactlyOnceWith(null);
    native.emit(["/fixtures/pending.md"]);
    next.unmount();
    await settle();
    expect(native.watchFileSystem).toHaveBeenLastCalledWith([], []);
    expect(native.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not retain duplicate native listeners or watch scopes after StrictMode cleanup", async () => {
    const native = testAdapter();
    const props = options(native.adapter);
    const { unmount } = renderHook(() => useFileSystemChanges(props), {
      wrapper: StrictMode,
    });
    await settle();
    await advance(250);
    expect(native.listeners.size).toBe(1);
    expect(props.onChange).toHaveBeenCalledExactlyOnceWith(null);
    unmount();
    await settle();
    expect(native.listeners.size).toBe(0);
    expect(native.watchFileSystem).toHaveBeenLastCalledWith([], []);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does no work without supported methods or without relevant paths", async () => {
    const native = testAdapter();
    for (const adapter of [undefined, null, {} as DesktopAdapter]) {
      const result = renderHook(() =>
        useFileSystemChanges({ ...options(native.adapter), adapter }),
      );
      await settle();
      expect(vi.getTimerCount()).toBe(0);
      result.unmount();
    }
    const result = renderHook(() =>
      useFileSystemChanges({
        ...options(native.adapter),
        workspaceRoots: [],
        documentPaths: [],
      }),
    );
    await settle();
    expect(native.listenFileSystemChanges).not.toHaveBeenCalled();
    expect(native.watchFileSystem).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    result.unmount();
  });
});
