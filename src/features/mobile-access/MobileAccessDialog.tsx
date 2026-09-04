import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import "./MobileAccessDialog.css";
import { parseMobileAccessPort } from "./mobileAccessPort";

export type MobileAccessStatus = "stopped" | "starting" | "running" | "stopping" | "failed";

export type MobileAccessDiscoveryStatus = "starting" | "active" | "unavailable";

export interface MobileAccessWorkspace {
  readonly id: string;
  readonly name: string;
  readonly detail?: string;
  readonly disabled?: boolean;
}

export interface MobileAccessServerInfo {
  /** Complete, user-facing connection URLs returned by the desktop host. */
  readonly addresses: readonly string[];
  readonly port: number | null;
  readonly discoveryStatus: MobileAccessDiscoveryStatus;
  readonly activeRequestCount: number;
}

export interface MobileAccessLabels {
  readonly title: string;
  readonly description: string;
  readonly close: string;
  readonly statusTitle: string;
  readonly status: Readonly<Record<MobileAccessStatus, string>>;
  readonly workspacesTitle: string;
  readonly workspacesDescription: string;
  readonly noWorkspaces: string;
  readonly selectionLocked: string;
  readonly portDescription: string;
  readonly portInvalid: string;
  readonly start: string;
  readonly stop: string;
  readonly serviceTitle: string;
  readonly addressTitle: string;
  readonly addressUnavailable: string;
  readonly portTitle: string;
  readonly discoveryTitle: string;
  readonly discovery: Readonly<Record<MobileAccessDiscoveryStatus, string>>;
  readonly activeRequestsTitle: string;
  readonly activeRequestCount: (count: number) => string;
  readonly copyAddress: string;
  readonly copyingAddress: string;
  readonly copiedAddress: string;
  readonly copyFailed: string;
  readonly refresh: string;
  readonly refreshing: string;
}

export interface MobileAccessDialogProps {
  readonly open: boolean;
  readonly status: MobileAccessStatus;
  readonly workspaces: readonly MobileAccessWorkspace[];
  readonly selectedWorkspaceIds: readonly string[];
  readonly port: string;
  readonly serverInfo?: MobileAccessServerInfo | null;
  readonly errorMessage?: string | null;
  readonly labels: MobileAccessLabels;
  readonly onClose: () => void;
  readonly onSelectionChange: (workspaceIds: readonly string[]) => void;
  readonly onPortChange: (port: string) => void;
  readonly onStart: (port: number) => void | Promise<void>;
  readonly onStop: () => void | Promise<void>;
  readonly onCopyAddress: (address: string) => void | Promise<void>;
  readonly onRefresh: () => void | Promise<void>;
}

export function MobileAccessDialog(props: MobileAccessDialogProps) {
  return props.open ? <MobileAccessDialogContent {...props} /> : null;
}

function StatusMark({ status }: { readonly status: MobileAccessStatus }) {
  return (
    <span
      aria-hidden="true"
      className={`mobile-access-status__mark mobile-access-status__mark--${status}`}
    />
  );
}

function MobileAccessDialogContent({
  status,
  workspaces,
  selectedWorkspaceIds,
  port,
  serverInfo,
  errorMessage,
  labels,
  onClose,
  onSelectionChange,
  onPortChange,
  onStart,
  onStop,
  onCopyAddress,
  onRefresh,
}: MobileAccessDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const portDescriptionId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const callbacksRef = useRef({ onClose });
  const mountedRef = useRef(false);
  const refreshPendingRef = useRef(false);
  const copyPendingRef = useRef<string | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [copyResult, setCopyResult] = useState<
    | { readonly address: string; readonly status: "copying" | "copied" | "failed" }
    | undefined
  >();

  useLayoutEffect(() => {
    callbacksRef.current = { onClose };
  }, [onClose]);

  useEffect(() => {
    mountedRef.current = true;
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented && !event.isComposing) {
        event.preventDefault();
        event.stopImmediatePropagation();
        callbacksRef.current.onClose();
        return;
      }
      if (event.key !== "Tab" || event.defaultPrevented) return;
      const controls = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      const first = controls[0];
      const last = controls.at(-1);
      if (
        !dialogRef.current?.contains(document.activeElement) ||
        document.activeElement === (event.shiftKey ? first : last)
      ) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      mountedRef.current = false;
      refreshPendingRef.current = false;
      copyPendingRef.current = null;
      window.removeEventListener("keydown", handleKeyDown, true);
      if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus();
    };
  }, []);

  const selected = new Set(selectedWorkspaceIds);
  const requestedPort = parseMobileAccessPort(port);
  const selectionLocked =
    status === "starting" || status === "running" || status === "stopping";
  const canStart =
    (status === "stopped" || status === "failed") &&
    selectedWorkspaceIds.length > 0 &&
    requestedPort !== null;
  const canStop = status === "running";
  const transitionPending = status === "starting" || status === "stopping";

  const toggleWorkspace = (workspaceId: string, checked: boolean) => {
    const next = new Set(selectedWorkspaceIds);
    if (checked) next.add(workspaceId);
    else next.delete(workspaceId);
    onSelectionChange(
      workspaces.filter((workspace) => next.has(workspace.id)).map(({ id }) => id),
    );
  };

  const refresh = async () => {
    if (refreshPendingRef.current) return;
    refreshPendingRef.current = true;
    setRefreshing(true);
    try {
      await onRefresh();
    } catch {
      // The parent owns the service status and presents refresh failures through props.
    } finally {
      refreshPendingRef.current = false;
      if (mountedRef.current) setRefreshing(false);
    }
  };

  const copyAddress = async (address: string) => {
    if (copyPendingRef.current) return;
    copyPendingRef.current = address;
    setCopyResult({ address, status: "copying" });
    try {
      await onCopyAddress(address);
      if (mountedRef.current) setCopyResult({ address, status: "copied" });
    } catch {
      if (mountedRef.current) setCopyResult({ address, status: "failed" });
    } finally {
      copyPendingRef.current = null;
    }
  };

  return createPortal(
    <div
      className="mobile-access-dialog-layer"
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        aria-modal="true"
        className="mobile-access-dialog"
        ref={dialogRef}
        role="dialog"
      >
        <header className="mobile-access-dialog__titlebar">
          <div>
            <h2 id={titleId}>{labels.title}</h2>
            <p id={descriptionId}>{labels.description}</p>
          </div>
          <button
            aria-label={labels.close}
            className="mobile-access-dialog__close"
            onClick={onClose}
            ref={closeRef}
            type="button"
          >
            ×
          </button>
        </header>

        <div className="mobile-access-dialog__body">
          <div aria-live="polite" className="mobile-access-status">
            <StatusMark status={status} />
            <span>{labels.statusTitle}</span>
            <strong>{labels.status[status]}</strong>
          </div>

          <section className="mobile-access-port-setting">
            <label htmlFor={`${titleId}-port`}>
              <strong>{labels.portTitle}</strong>
              <span id={portDescriptionId}>{labels.portDescription}</span>
            </label>
            <div>
              <input
                aria-describedby={portDescriptionId}
                aria-invalid={requestedPort === null}
                aria-label={labels.portTitle}
                disabled={selectionLocked}
                id={`${titleId}-port`}
                inputMode="numeric"
                max={65_535}
                min={1_024}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  onPortChange(value);
                }}
                step={1}
                type="number"
                value={port}
              />
              {requestedPort === null ? (
                <small className="mobile-access-port-setting__error" role="alert">
                  {labels.portInvalid}
                </small>
              ) : null}
            </div>
          </section>

          <section
            aria-labelledby={`${titleId}-workspaces`}
            className="mobile-access-section"
          >
            <div className="mobile-access-section__heading">
              <div>
                <h3 id={`${titleId}-workspaces`}>{labels.workspacesTitle}</h3>
                <p>{labels.workspacesDescription}</p>
              </div>
              {selectionLocked ? <small>{labels.selectionLocked}</small> : null}
            </div>

            {workspaces.length === 0 ? (
              <p className="mobile-access-workspaces__empty">{labels.noWorkspaces}</p>
            ) : (
              <div className="mobile-access-workspaces">
                {workspaces.map((workspace) => (
                  <label className="mobile-access-workspace" key={workspace.id}>
                    <span className="mobile-access-workspace__copy">
                      <strong>{workspace.name}</strong>
                      {workspace.detail ? <small>{workspace.detail}</small> : null}
                    </span>
                    <span className="mobile-access-checkbox">
                      <input
                        checked={selected.has(workspace.id)}
                        disabled={selectionLocked || workspace.disabled}
                        onChange={(event) =>
                          toggleWorkspace(workspace.id, event.currentTarget.checked)
                        }
                        type="checkbox"
                      />
                      <span aria-hidden="true" />
                    </span>
                  </label>
                ))}
              </div>
            )}
          </section>

          {(status === "running" || serverInfo) && (
            <section
              aria-labelledby={`${titleId}-service`}
              className="mobile-access-section"
            >
              <div className="mobile-access-section__heading mobile-access-section__heading--service">
                <h3 id={`${titleId}-service`}>{labels.serviceTitle}</h3>
                <button
                  aria-busy={refreshing}
                  className="mobile-access-secondary-button"
                  disabled={refreshing || transitionPending}
                  onClick={() => void refresh()}
                  type="button"
                >
                  {refreshing ? labels.refreshing : labels.refresh}
                </button>
              </div>

              <dl className="mobile-access-service">
                <div className="mobile-access-service__addresses">
                  <dt>{labels.addressTitle}</dt>
                  <dd>
                    {serverInfo?.addresses.length ? (
                      serverInfo.addresses.map((address) => {
                        const copyStatus =
                          copyResult?.address === address ? copyResult.status : undefined;
                        return (
                          <div className="mobile-access-address" key={address}>
                            <code>{address}</code>
                            <button
                              aria-busy={copyStatus === "copying"}
                              className="mobile-access-copy-button"
                              disabled={copyResult?.status === "copying"}
                              onClick={() => void copyAddress(address)}
                              type="button"
                            >
                              {copyStatus === "copying"
                                ? labels.copyingAddress
                                : copyStatus === "copied"
                                  ? labels.copiedAddress
                                  : labels.copyAddress}
                            </button>
                            {copyStatus === "failed" ? (
                              <small className="mobile-access-address__error" role="alert">
                                {labels.copyFailed}
                              </small>
                            ) : null}
                          </div>
                        );
                      })
                    ) : (
                      <span className="mobile-access-service__muted">
                        {labels.addressUnavailable}
                      </span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt>{labels.portTitle}</dt>
                  <dd>{serverInfo?.port ?? "—"}</dd>
                </div>
                <div>
                  <dt>{labels.discoveryTitle}</dt>
                  <dd>
                    {serverInfo
                      ? labels.discovery[serverInfo.discoveryStatus]
                      : labels.discovery.starting}
                  </dd>
                </div>
                <div>
                  <dt>{labels.activeRequestsTitle}</dt>
                  <dd className="mobile-access-service__active-request-count">
                    {labels.activeRequestCount(serverInfo?.activeRequestCount ?? 0)}
                  </dd>
                </div>
              </dl>
            </section>
          )}

          {errorMessage ? (
            <p className="mobile-access-dialog__error" role="alert">
              {errorMessage}
            </p>
          ) : null}
        </div>

        <footer className="mobile-access-dialog__footer">
          {canStop || status === "stopping" ? (
            <button
              className="mobile-access-danger-button"
              disabled={!canStop}
              onClick={() => void onStop()}
              type="button"
            >
              {status === "stopping" ? labels.status.stopping : labels.stop}
            </button>
          ) : (
            <button
              className="mobile-access-primary-button"
              disabled={!canStart}
              onClick={() => {
                if (requestedPort !== null) void onStart(requestedPort);
              }}
              type="button"
            >
              {status === "starting" ? labels.status.starting : labels.start}
            </button>
          )}
        </footer>
      </section>
    </div>,
    document.body,
  );
}
