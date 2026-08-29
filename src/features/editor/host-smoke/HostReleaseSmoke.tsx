import { EditorView } from "@codemirror/view";
import { useCallback, useEffect, useRef, useState } from "react";

import { createEditorSpikeMetrics, createEditorSpikeState } from "../spike/editorSpike";
import "./HostReleaseSmoke.css";

const CONFIRM_BASELINE = "\u786e\u8ba4\uff1a";
const CANCEL_BASELINE = "\u53d6\u6d88\uff1a";

type ImeScenario = "confirm" | "cancel";
type HostStatus =
  "starting" | "ready" | "confirm" | "cancel" | "chooser" | "complete" | "failed";

interface HostReportSummary {
  readonly resultState: "starting" | "automatedReady" | "manualPass" | "failed";
}

interface PrivateCaptureResult {
  readonly kind:
    | "confirmBegin"
    | "confirmFinish"
    | "cancelBegin"
    | "cancelFinish"
    | "chooserBegin"
    | "chooserFinish";
  readonly ok: boolean;
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
  const [status, setStatus] = useState<HostStatus>("starting");
  const [message, setMessage] = useState("正在建立受 native nonce 保护的真实事件捕获层…");

  const updateSummary = useCallback((json: string, nextMessage: string) => {
    const summary = JSON.parse(json) as HostReportSummary;
    setMessage(`${nextMessage}（${summary.resultState}）`);
    if (summary.resultState === "failed") setStatus("failed");
    if (summary.resultState === "manualPass") setStatus("complete");
  }, []);

  useEffect(() => {
    const parent = editorHost.current;
    if (!parent) return;

    const view = new EditorView({
      state: createEditorSpikeState(
        CONFIRM_BASELINE,
        { metrics: createEditorSpikeMetrics() },
        CONFIRM_BASELINE.length,
      ),
      parent,
    });
    editorView.current = view;

    const frame = window.requestAnimationFrame(() => {
      const input = chooser.current;
      void hostInvoke<string>("host_release_smoke_frontend_ready", {
        harnessVersion: 2,
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
      view.destroy();
      editorView.current = null;
    };
  }, [updateSummary]);

  useEffect(() => {
    const onPrivateResult = (event: Event) => {
      const detail = (event as CustomEvent<PrivateCaptureResult>).detail;
      if (!detail || typeof detail.kind !== "string") return;
      if (!detail.ok) {
        setStatus("failed");
        setMessage("受保护的捕获层拒绝了本次证据；请重启验证");
        return;
      }
      if (detail.kind === "confirmFinish") {
        setStatus("cancel");
        setMessage("真实候选确认序列已由 native 私有捕获层接受");
      } else if (detail.kind === "cancelFinish") {
        setStatus("chooser");
        setMessage("真实候选取消序列已由 native 私有捕获层接受");
      } else if (detail.kind === "chooserFinish") {
        setStatus("chooser");
        setMessage("原生选择器的可信 cancel 事件已记录");
      }
    };
    document.addEventListener("host-smoke-private-result", onPrivateResult);
    return () => document.removeEventListener("host-smoke-private-result", onPrivateResult);
  }, []);

  const beginScenario = (scenario: ImeScenario) => {
    const view = editorView.current;
    if (!view) return;
    const baseline = scenario === "confirm" ? CONFIRM_BASELINE : CANCEL_BASELINE;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: baseline },
      selection: { anchor: baseline.length },
    });
    setStatus(scenario);
    setMessage(
      scenario === "confirm"
        ? "切换系统拼音，输入 zhongwen 并确认候选“中文”"
        : "在“取消：”后开始拼音组合，然后按 Escape 取消候选",
    );
    view.focus();
  };

  const notePrivateEvaluation = (scenario: ImeScenario) => {
    setMessage(
      scenario === "confirm"
        ? "正在由 native nonce 捕获层核对确认序列…"
        : "正在由 native nonce 捕获层核对取消序列…",
    );
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
      setMessage("人工证据尚未完整：菜单、两次真实 IME 与选择器取消都必须通过");
    });
  };

  return (
    <main className="host-smoke" data-host-release-smoke="P0-HOST-SMOKE-01">
      <header className="host-smoke__header">
        <div>
          <p className="host-smoke__eyebrow">Phase 0 · macOS release host</p>
          <h1>WKWebView 主机验证</h1>
          <p>
            可信事件由 native 注入的私有捕获层记录；React 无法提交
            pass，且不读取用户文档或剪贴板。
          </p>
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
        <div className="host-smoke__editor" data-host-editor ref={editorHost} />
        <div className="host-smoke__actions">
          <button
            data-host-action="begin-confirm"
            type="button"
            onClick={() => beginScenario("confirm")}
          >
            开始候选确认
          </button>
          <button
            data-host-action="finish-confirm"
            type="button"
            onClick={() => notePrivateEvaluation("confirm")}
          >
            记录确认结果
          </button>
          <button
            data-host-action="begin-cancel"
            type="button"
            onClick={() => beginScenario("cancel")}
          >
            开始候选取消
          </button>
          <button
            data-host-action="finish-cancel"
            type="button"
            onClick={() => notePrivateEvaluation("cancel")}
          >
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
          data-host-native-input
          className="host-smoke__native-input"
          type="file"
          accept=".md,text/markdown"
          aria-label="host smoke native file chooser"
        />
        <div className="host-smoke__actions">
          <button
            data-host-action="chooser-open"
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
