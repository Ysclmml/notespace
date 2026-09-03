import { useCallback, useEffect, useRef, useState } from "react";

import type { PageFindTarget } from "./pageFind";

/** Ephemeral, editor-instance-local search state; never stores document text. */
export function usePageFind(request = 0, onRequestConsumed?: (request: number) => void) {
  const targetRef = useRef<PageFindTarget | null>(null);
  const [open, setOpen] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);
  const [query, setQuery] = useState("");
  const [current, setCurrent] = useState(0);
  const [total, setTotal] = useState(0);
  const [navigation, setNavigation] = useState(0);
  const [revision, setRevision] = useState(0);
  const openRef = useRef(open);
  const highlightedRef = useRef(false);
  const refresh = useCallback(() => {
    if (openRef.current) setRevision((value) => value + 1);
  }, []);
  const lastRequestRef = useRef(0);
  const consumeRef = useRef(onRequestConsumed);
  const lastRevealRef = useRef("");

  useEffect(() => {
    consumeRef.current = onRequestConsumed;
  }, [onRequestConsumed]);

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  useEffect(() => {
    if (request <= 0) {
      lastRequestRef.current = 0;
      return;
    }
    if (request === lastRequestRef.current) return;
    lastRequestRef.current = request;
    setOpen(true);
    setFocusRequest((value) => value + 1);
    consumeRef.current?.(request);
  }, [request]);

  useEffect(() => {
    const target = targetRef.current;
    if (!target) return;
    if (!open && !highlightedRef.current) return;
    const matches = open ? target.matches(query) : [];
    const index = matches.length ? Math.min(current, matches.length - 1) : 0;
    const revealKey = `${open}:${focusRequest}:${query}:${index}:${navigation}`;
    const reveal = open && lastRevealRef.current !== revealKey;
    lastRevealRef.current = revealKey;
    target.highlight(matches, index, reveal);
    highlightedRef.current = matches.length > 0;
    setTotal(matches.length);
    if (index !== current) setCurrent(index);
  }, [current, focusRequest, navigation, open, query, revision]);

  const close = useCallback(() => {
    setOpen(false);
    targetRef.current?.focus();
  }, []);
  const changeQuery = useCallback((value: string) => {
    setQuery(value);
    setCurrent(0);
  }, []);
  const move = useCallback(
    (direction: number) => {
      if (total) {
        setCurrent((value) => (value + direction + total) % total);
        setNavigation((value) => value + 1);
      }
    },
    [total],
  );

  return {
    targetRef,
    refresh,
    open,
    query,
    current,
    total,
    request: focusRequest,
    close,
    changeQuery,
    move,
  };
}
