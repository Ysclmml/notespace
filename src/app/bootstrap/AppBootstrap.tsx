import { AppShell } from "../shell/AppShell";
import { AppSettingsProvider } from "../settings";

export function AppBootstrap() {
  return (
    <AppSettingsProvider>
      <AppShell />
    </AppSettingsProvider>
  );
}
