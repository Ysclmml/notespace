import { EditorView } from "@codemirror/view";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  createEditorSpikeMetrics,
  createEditorSpikeState,
  getEditorSpikeRuntime,
} from "../spike/editorSpike";
import {
  evaluateImeEvidence,
  type HostInputEventSample,
  type ImeScenario,
} from "./hostEvidence";
import "./HostReleaseSmoke.css";

const CONFIRM_BASELINE = "# \n\n";
const CONFIRM_EXPECTED = "# \u4e2d\u6587\n\n";
const CANCEL_BASELINE = "# \u4e2d\u6587\n\n\u53d6\u6d88\uff1a";

type HostStatus =
  "starting" | "ready" | "confirm" | "cancel" | "chooser" | "complete" | "failed";

interface HostReportSummary {
  readonly resultState: "starting" | "automatedReady" | "manualPass" | "failed";
}

interface TauriInternals {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
}

function hostInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const internals = (window as Window & { __TAURI_INTERNALS__?: TauriInternals })
    .__TAURI_INTERNALS__;
  if (!internals) return Promise.reject(new Error("host bridge unavailable"));
  return internals.invoke<T>(command, args);
}

export default function HostReleaseSmoke() {
  const editorHost = useRef<HTMLDivElement>(null);
  const editorView = useRef<EditorView | null>(null);
  const chooser = useRef<HTMLInputElement>(null);
  const samples = useRef<HostInputEventSample[]>([]);
  const scenario = useRef<ImeScenario | null>(null);
  const [status, setStatus] = useState<HostStatus>("starting");
  const [message, setMessage] = useState("正在建立真实 WKWebView / CodeMirror 验证面…");

  const updateSummary = useCallback((json: string, nextMessage: string) => {
    const summary = JSON.parse(json) as HostReportSummary;
    setMessage(`${nextMessage}\uff08${summary.resultState}\uff09`);
    if (summary.resultState === "failed") setStatus("failed");
    if (summary.resultState === "manualPass") setStatus("complete");
  }, []);

  useEffect(() => {
    const parent = editorHost.current;
    if (!parent) return;

    const view = new EditorView({
      state: createEditorSpikeState(
        CONFIRM_BASELINE,
        {
          metrics: createEditorSpikeMetrics(),
        },
        2,
      ),
      parent,
    });
    editorView.current = view;

    const eventTypes = [
      "compositionstart",
      "compositionupdate",
      "compositionend",
      "beforeinput",
      "input",
    ] as const;
    const record = (event: Event) => {
      const activeScenario = scenario.current;
      if (!activeScenario) return;
      const type = event.type as HostInputEventSample["type"];
      queueMicrotask(() => {
        if (scenario.current !== activeScenario || editorView.current !== view) return;
        const runtime = getEditorSpikeRuntime(view);
        samples.current.push({
          type,
          phase: runtime.compositionPhase,
          frozen: runtime.compositionFrozen,
        });
      });
    };
    for (const type of eventTypes) view.contentDOM.addEventListener(type, record);

    const frame = window.requestAnimationFrame(() => {
      const input = chooser.current;
      void hostInvoke<string>("host_release_smoke_frontend_ready", {
        harnessVersion: 1,
        editorKind: "codemirror6",
        capabilities: [
          view.contentDOM.isConnected,
          view.contentDOM.getAttribute("contenteditable") === "true",
          input?.type === "file",
        ],
      })
        .then((json) => {
          updateSummary(json, "自动 host 检查已就绪");
          setStatus("ready");
        })
        .catch(() => {
          setStatus("failed");
          setMessage("host bridge 拒绝了前端就绪证据");
        });
    });

    return () => {
      window.cancelAnimationFrame(frame);
      for (const type of eventTypes) view.contentDOM.removeEventListener(type, record);
      view.destroy();
      editorView.current = null;
    };
  }, [updateSummary]);

  useEffect(() => {
    const input = chooser.current;
    if (!input) return;

    const submit = (eventKind: "cancel" | "change") => {
      const selectedCount = input.files?.length ?? 0;
      void hostInvoke<string>("host_release_smoke_record_chooser", {
        eventKind,
        metrics: [selectedCount, 0, 0],
      })
        .then((json) => {
          updateSummary(
            json,
            eventKind === "cancel"
              ? "原生选择器取消已记录"
              : "检测到文件选择，已按失败关闭",
          );
          setStatus(eventKind === "cancel" && selectedCount === 0 ? "chooser" : "failed");
        })
        .catch(() => {
          setStatus("failed");
          setMessage("原生选择器证据被拒绝；请重新启动验证");
        });
    };
    const onCancel = () => submit("cancel");
    const onChange = () => submit("change");
    input.addEventListener("cancel", onCancel);
    input.addEventListener("change", onChange);
    return () => {
      input.removeEventListener("cancel", onCancel);
      input.removeEventListener("change", onChange);
    };
  }, [updateSummary]);

  const beginScenario = (nextScenario: ImeScenario) => {
    const view = editorView.current;
    if (!view) return;
    const baseline = nextScenario === "confirm" ? CONFIRM_BASELINE : CANCEL_BASELINE;
    const insertion = nextScenario === "confirm" ? 2 : baseline.length;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: baseline },
      selection: { anchor: insertion },
    });
    samples.current = [];
    scenario.current = nextScenario;
    setStatus(nextScenario);
    setMessage(
      nextScenario === "confirm"
        ? "切换系统拼音，输入 zhongwen 并确认候选“中文”"
        : "在“取消：”后开始拼音组合，然后按 Escape 取消候选",
    );
    view.focus();
  };

  const submitScenario = (activeScenario: ImeScenario) => {
    const view = editorView.current;
    if (!view || scenario.current !== activeScenario) return;
    const expected = activeScenario === "confirm" ? CONFIRM_EXPECTED : CANCEL_BASELINE;
    const evidence = evaluateImeEvidence(
      samples.current,
      view.state.doc.toString(),
      expected,
    );
    scenario.current = null;
    void hostInvoke<string>("host_release_smoke_record_ime", {
      scenario: activeScenario,
      counts: [...evidence.counts],
      flags: [...evidence.flags],
      finalUtf16Length: evidence.finalUtf16Length,
    })
      .then((json) => {
        updateSummary(
          json,
          activeScenario === "confirm" ? "候选确认已记录" : "候选取消已记录",
        );
        setStatus(activeScenario === "confirm" ? "cancel" : "chooser");
      })
      .catch(() => {
        setStatus("failed");
        setMessage("IME 证据未满足 fail-closed 条件；请重新启动验证");
      });
  };

  const refreshStatus = () => {
    void hostInvoke<string>("host_release_smoke_status")
      .then((json) => updateSummary(json, "已刷新结构化证据"))
      .catch(() => {
        setStatus("failed");
        setMessage("无法读取结构化证据");
      });
  };

  const finish = () => {
    void hostInvoke<void>("host_release_smoke_finish").catch(() => {
      setStatus("failed");
      setMessage("人工证据尚未完整：菜单、两次 IME 与选择器取消都必须通过");
    });
  };

  return (
    <main className="host-smoke" data-host-release-smoke="P0-HOST-SMOKE-01">
      <header className="host-smoke__header">
        <div>
          <p className="host-smoke__eyebrow">Phase 0 · macOS release host</p>
          <h1>WKWebView 主机验证</h1>
          <p>只记录事件类型、计数、布尔结果和固定测试文本长度；不读取用户文档或剪贴板。</p>
        </div>
        <span className={`host-smoke__badge host-smoke__badge--${status}`}>{status}</span>
      </header>

      <section className="host-smoke__panel" aria-labelledby="ime-title">
        <div className="host-smoke__panel-heading">
          <div>
            <span>01</span>
            <h2 id="ime-title">真实中文 composition</h2>
          </div>
          <p>使用系统输入法；不要粘贴文本。</p>
        </div>
        <div className="host-smoke__editor" ref={editorHost} />
        <div className="host-smoke__actions">
          <button type="button" onClick={() => beginScenario("confirm")}>
            开始候选确认
          </button>
          <button type="button" onClick={() => submitScenario("confirm")}>
            记录确认结果
          </button>
          <button type="button" onClick={() => beginScenario("cancel")}>
            开始候选取消
          </button>
          <button type="button" onClick={() => submitScenario("cancel")}>
            记录取消结果
          </button>
        </div>
      </section>

      <section className="host-smoke__panel" aria-labelledby="native-title">
        <div className="host-smoke__panel-heading">
          <div>
            <span>02</span>
            <h2 id="native-title">系统菜单与原生选择器</h2>
          </div>
          <p>菜单栏选择 Host Smoke → Record Menu Activation。</p>
        </div>
        <input
          ref={chooser}
          className="host-smoke__native-input"
          type="file"
          accept=".md,text/markdown"
          aria-label="host smoke native file chooser"
        />
        <div className="host-smoke__actions">
          <button
            data-host-chooser-button
            type="button"
            onClick={() => chooser.current?.click()}
          >
            打开原生选择器（随后取消）
          </button>
          <button type="button" onClick={refreshStatus}>
            刷新证据
          </button>
          <button className="host-smoke__finish" type="button" onClick={finish}>
            完成并退出
          </button>
        </div>
      </section>

      <footer className="host-smoke__status" role="status" aria-live="polite">
        <span aria-hidden="true" />
        {message}
      </footer>
    </main>
  );
}
