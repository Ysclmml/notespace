import { useMemo } from "react";

import { createDemoMobileTransport } from "./demoTransport";
import {
  createDebugHttpMobileTransport,
  type DebugHttpMobileTransportOptions,
} from "./httpTransport";
import {
  createTauriMobileComputerDiscovery,
  type MobileComputerDiscovery,
} from "./lanDiscovery";
import { MobileApp } from "./MobileApp";
import { createNativePairingScanner, isNativeMobileRuntime } from "./pairingScanner";
import type { MobileTransport } from "./transport";
import type { MobilePairingRequest } from "./types";

declare global {
  interface Window {
    __NOTESPACE_MOBILE_TRANSPORT__?: MobileTransport;
    __NOTESPACE_SCAN_PAIRING_CODE__?: () => Promise<MobilePairingRequest | null>;
  }
}

export interface MobileAppBootstrapProps {
  readonly transport?: MobileTransport;
  readonly onScanPairingCode?: () => Promise<MobilePairingRequest | null>;
  /** Optional host/test override. Native mobile builds enable LAN access by default. */
  readonly enableLanHttp?: boolean;
  readonly nativeMobileRuntime?: boolean;
  readonly discovery?: MobileComputerDiscovery;
  readonly lanHttpOptions?: Omit<DebugHttpMobileTransportOptions, "discovery">;
}

/**
 * Mobile entry point. Native builds use the LAN HTTP transport in development and
 * production; browser previews keep the local demo unless a transport is injected.
 */
export function MobileAppBootstrap({
  transport,
  onScanPairingCode,
  enableLanHttp,
  nativeMobileRuntime,
  discovery,
  lanHttpOptions,
}: MobileAppBootstrapProps) {
  const injectedTransport = transport ?? window.__NOTESPACE_MOBILE_TRANSPORT__;
  const nativeRuntime = nativeMobileRuntime ?? isNativeMobileRuntime();
  const lanHttpEnabled = enableLanHttp !== false && !injectedTransport && nativeRuntime;
  const resolvedDiscovery = useMemo(
    () =>
      lanHttpEnabled ? (discovery ?? createTauriMobileComputerDiscovery()) : undefined,
    [lanHttpEnabled, discovery],
  );
  const lanHttpTransport = useMemo(
    () =>
      lanHttpEnabled
        ? createDebugHttpMobileTransport({
            ...lanHttpOptions,
            discovery: resolvedDiscovery,
          })
        : undefined,
    [lanHttpEnabled, lanHttpOptions, resolvedDiscovery],
  );
  const resolvedTransport = useMemo<MobileTransport>(
    () => injectedTransport ?? lanHttpTransport ?? createDemoMobileTransport(),
    [injectedTransport, lanHttpTransport],
  );
  const demoMode = !injectedTransport && !lanHttpTransport;
  const insecureDebugMode = resolvedTransport.securityMode === "insecure-debug-http";
  const resolvedPairingScanner = useMemo(() => {
    if (insecureDebugMode) return undefined;
    const injectedScanner = onScanPairingCode ?? window.__NOTESPACE_SCAN_PAIRING_CODE__;
    if (injectedScanner) return injectedScanner;
    if (!injectedTransport || !nativeRuntime) return undefined;
    return createNativePairingScanner();
  }, [injectedTransport, insecureDebugMode, nativeRuntime, onScanPairingCode]);
  return (
    <MobileApp
      demoMode={demoMode}
      insecureDebugMode={insecureDebugMode}
      onScanPairingCode={resolvedPairingScanner}
      transport={resolvedTransport}
    />
  );
}
