import type { DocumentSession } from "../../app/state/model";
import type { DocumentStatistics } from "./documentStatistics";

export type StatisticsDocument = Pick<DocumentSession, "id" | "text" | "kind">;

interface CachedStatistics {
  document: WeakRef<StatisticsDocument>;
  statistics: DocumentStatistics;
}

/** Latest version per session, without retaining document bodies after close. */
export class DocumentStatisticsCache {
  private readonly entries = new Map<string, CachedStatistics>();

  constructor(private readonly capacity = 32) {}

  get(document: StatisticsDocument): DocumentStatistics | undefined {
    const entry = this.entries.get(document.id);
    const previous = entry?.document.deref();
    if (!entry || !previous) {
      this.entries.delete(document.id);
      return undefined;
    }
    if (previous.text !== document.text || previous.kind !== document.kind) {
      this.entries.delete(document.id);
      return undefined;
    }
    if (previous !== document) entry.document = new WeakRef(document);
    this.entries.delete(document.id);
    this.entries.set(document.id, entry);
    return entry.statistics;
  }

  set(document: StatisticsDocument, statistics: DocumentStatistics) {
    this.entries.delete(document.id);
    this.entries.set(document.id, { document: new WeakRef(document), statistics });
    while (this.entries.size > Math.max(0, this.capacity)) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}
