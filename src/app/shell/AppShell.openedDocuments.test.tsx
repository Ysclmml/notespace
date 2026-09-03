import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MarkdownEditorProps } from "../../features/editor/MarkdownEditor";
import {
  DemoDesktopAdapter,
  type DesktopAdapter,
  type OpenDocumentResult,
} from "../../infrastructure/tauri/desktopAdapter";
import { AppSettingsProvider } from "../settings";
import { AppShell } from "./AppShell";

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    destroy: async () => undefined,
    onCloseRequested: async () => () => undefined,
  }),
}));

vi.mock("../../features/editor/MarkdownEditor", () => ({
  MarkdownEditor: (props: MarkdownEditorProps) => (
    <textarea
      aria-label={`Document body ${props.documentId}`}
      onChange={(event) => props.onChange(event.currentTarget.value)}
      value={props.value}
    />
  ),
}));

const FIRST = "/tmp/notespace-associated-first.md";
const SECOND = "/tmp/notespace-associated-second.markdown";
const THIRD = "/tmp/notespace-associated-third.md";

type OpenedPathsListener = Parameters<
  NonNullable<DesktopAdapter["listenOpenedDocumentPaths"]>
>[0];

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

class OpenedDocumentsAdapter extends DemoDesktopAdapter {
  private listener?: OpenedPathsListener;
  private readonly registration: Promise<void>;
  private readonly heldPaths = new Map<string, Promise<void>>();
  readonly requestedPaths: string[] = [];
  readonly stopListening = vi.fn(() => {
    this.listener = undefined;
  });
  readonly listenOpenedDocumentPaths = vi.fn(
    async (listener?: OpenedPathsListener): Promise<() => void> => {
      if (!listener) throw new Error("Opened document listener is required");
      await this.registration;
      this.listener = listener;
      return this.stopListening;
    },
  );

  constructor(registration: Promise<void> = Promise.resolve()) {
    super();
    this.registration = registration;
  }

  emit(paths: readonly string[]) {
    this.listener?.(paths);
  }

  get listening() {
    return this.listener !== undefined;
  }

  hold(path: string) {
    const gate = deferred();
    this.heldPaths.set(path, gate.promise);
    return gate.resolve;
  }

  override async openDocument(path: string): Promise<OpenDocumentResult> {
    this.requestedPaths.push(path);
    await this.heldPaths.get(path);
    const content = `# ${path.split("/").at(-1)}\n`;
    return {
      status: "editable",
      path,
      content,
      mode: "normal",
      documentKind: "markdown",
      language: "markdown",
      preflight: {
        sizeBytes: content.length,
        longestLineBytes: content.length - 1,
        containsDataImageBase64: false,
      },
    };
  }
}

function renderApp(adapter: DesktopAdapter) {
  return render(
    <AppSettingsProvider initialSettings={{ locale: "zh-CN" }} storage={null}>
      <AppShell adapter={adapter} />
    </AppSettingsProvider>,
  );
}

async function waitUntilListening(adapter: OpenedDocumentsAdapter) {
  await waitFor(() => expect(adapter.listenOpenedDocumentPaths).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(adapter.listening).toBe(true));
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("AppShell opened document paths", () => {
  it("opens an associated Markdown path in a new foreground tab", async () => {
    const adapter = new OpenedDocumentsAdapter();
    renderApp(adapter);
    await waitUntilListening(adapter);

    act(() => adapter.emit([FIRST]));

    expect(
      await screen.findByRole("textbox", { name: `Document body ${FIRST}` }),
    ).toHaveValue("# notespace-associated-first.md\n");
    const tab = within(screen.getByRole("navigation", { name: "文档标签页" })).getByTitle(
      FIRST,
    );
    expect(tab).toHaveAttribute("aria-current", "page");
    expect(adapter.requestedPaths).toEqual([FIRST]);
  });

  it("serializes every pushed path in order and leaves the final path in the foreground", async () => {
    const adapter = new OpenedDocumentsAdapter();
    const releaseFirst = adapter.hold(FIRST);
    renderApp(adapter);
    await waitUntilListening(adapter);

    act(() => adapter.emit([FIRST, SECOND]));
    await waitFor(() => expect(adapter.requestedPaths).toEqual([FIRST]));
    act(() => adapter.emit([THIRD]));
    expect(adapter.requestedPaths).toEqual([FIRST]);

    await act(async () => releaseFirst());
    await waitFor(() => expect(adapter.requestedPaths).toEqual([FIRST, SECOND, THIRD]));
    expect(
      await screen.findByRole("textbox", { name: `Document body ${THIRD}` }),
    ).toBeVisible();

    const rail = screen.getByRole("navigation", { name: "文档标签页" });
    expect(
      Array.from(rail.querySelectorAll<HTMLButtonElement>(".tab-rail__tab"), (tab) =>
        tab.getAttribute("title"),
      ),
    ).toEqual([FIRST, SECOND, THIRD]);
    expect(within(rail).getByTitle(THIRD)).toHaveAttribute("aria-current", "page");
    expect(within(rail).getByTitle(FIRST)).not.toHaveAttribute("aria-current");
    expect(within(rail).getByTitle(SECOND)).not.toHaveAttribute("aria-current");
  });

  it("stops a registered listener on unmount and ignores later pushes", async () => {
    const adapter = new OpenedDocumentsAdapter();
    const view = renderApp(adapter);
    await waitUntilListening(adapter);

    view.unmount();

    await waitFor(() => expect(adapter.stopListening).toHaveBeenCalledTimes(1));
    act(() => adapter.emit([FIRST]));
    expect(adapter.requestedPaths).toEqual([]);
  });

  it("stops a listener whose asynchronous registration finishes after unmount", async () => {
    const registration = deferred();
    const adapter = new OpenedDocumentsAdapter(registration.promise);
    const view = renderApp(adapter);
    await waitFor(() => expect(adapter.listenOpenedDocumentPaths).toHaveBeenCalledTimes(1));

    view.unmount();
    expect(adapter.stopListening).not.toHaveBeenCalled();
    await act(async () => registration.resolve());

    await waitFor(() => expect(adapter.stopListening).toHaveBeenCalledTimes(1));
    act(() => adapter.emit([FIRST]));
    expect(adapter.requestedPaths).toEqual([]);
  });
});
