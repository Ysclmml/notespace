import { useEffect, useRef, useState } from "react";

import {
  createDocumentStatisticsTask,
  EMPTY_DOCUMENT_STATISTICS,
  type DocumentStatistics,
} from "./documentStatistics";
import { DocumentStatisticsCache, type StatisticsDocument } from "./statisticsCache";

export const STATISTICS_DEBOUNCE_MS = 120;

export interface DocumentStatisticsState {
  statistics: Readonly<DocumentStatistics> | undefined;
  pending: boolean;
}

/** Only current in-memory content is observed; no disk, network or persistence. */
export function useDocumentStatistics(
  session: StatisticsDocument | undefined,
): DocumentStatisticsState {
  const [cache] = useState(() => new DocumentStatisticsCache());
  const [, refresh] = useState(0);
  const currentDocument = useRef(session);
  const id = session?.id;
  const text = session?.text;
  const kind = session?.kind;
  const statistics = session
    ? !text
      ? EMPTY_DOCUMENT_STATISTICS
      : cache.get(session)
    : undefined;

  useEffect(() => {
    currentDocument.current = session;
  }, [session]);

  useEffect(() => {
    const document = currentDocument.current;
    if (!document || !text || statistics) return;
    const task = createDocumentStatisticsTask(text);
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const advance = () => {
      if (cancelled) return;
      const statistics = task.advance();
      if (!statistics) {
        timer = setTimeout(advance, 0);
        return;
      }
      cache.set(document, statistics);
      refresh((value) => value + 1);
    };
    timer = setTimeout(advance, STATISTICS_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [cache, id, text, kind, statistics]);

  return { statistics, pending: Boolean(session && !statistics) };
}
