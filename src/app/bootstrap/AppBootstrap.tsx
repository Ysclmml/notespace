import { lazy, Suspense } from "react";

import { AppShell } from "../shell/AppShell";

const HostReleaseSmoke =
  import.meta.env.VITE_HOST_RELEASE_SMOKE === "1"
    ? lazy(() => import("../../features/editor/host-smoke/HostReleaseSmoke"))
    : null;

export function AppBootstrap() {
  const runtimeHostSmokeEnabled = window.__MARKDOWN_WORKSPACE_HOST_RELEASE_SMOKE__ === true;

  if (HostReleaseSmoke && runtimeHostSmokeEnabled) {
    return (
      <Suspense fallback={<main aria-busy="true">正在启动 release host smoke…</main>}>
        <HostReleaseSmoke />
      </Suspense>
    );
  }

  return <AppShell />;
}

declare global {
  interface Window {
    readonly __MARKDOWN_WORKSPACE_HOST_RELEASE_SMOKE__?: boolean;
  }
}
