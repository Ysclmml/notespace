import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

const tauriDevHost = process.env.TAURI_DEV_HOST;
const packageManifest = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { readonly version: string };

export default defineConfig(({ mode }) => {
  const tauriPlatform = process.env.TAURI_ENV_PLATFORM;
  const appSurface =
    mode === "mobile" || tauriPlatform === "android" || tauriPlatform === "ios"
      ? "mobile"
      : "desktop";
  const appDebug = process.env.TAURI_ENV_DEBUG === "true";

  return {
    plugins: [react()],
    define: {
      __APP_VERSION__: JSON.stringify(packageManifest.version),
      __APP_SURFACE__: JSON.stringify(appSurface),
      __APP_DEBUG__: JSON.stringify(appDebug),
    },
    clearScreen: false,
    server: {
      port: 1420,
      strictPort: true,
      host: tauriDevHost || false,
      hmr: tauriDevHost
        ? {
            protocol: "ws",
            host: tauriDevHost,
            port: 1421,
          }
        : undefined,
      watch: {
        ignored: ["**/src-tauri/**"],
      },
    },
    test: {
      environment: "jsdom",
      setupFiles: ["./src/test/setup.ts"],
      css: true,
      restoreMocks: true,
      testTimeout: 10_000,
      maxWorkers: 1,
    },
  };
});
