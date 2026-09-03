export type UpdateCheckStatus = "available" | "upToDate" | "noPublishedRelease";

export interface UpdateCheckResult {
  readonly currentVersion: string;
  readonly latestVersion?: string;
  readonly releaseUrl?: string;
  readonly publishedAt?: string;
  readonly status: UpdateCheckStatus;
}

export interface AvailableUpdate extends UpdateCheckResult {
  readonly status: "available";
  readonly latestVersion: string;
  readonly releaseUrl: string;
}

export function isAvailableUpdate(result: UpdateCheckResult): result is AvailableUpdate {
  return (
    result.status === "available" &&
    Boolean(result.latestVersion) &&
    Boolean(result.releaseUrl)
  );
}
