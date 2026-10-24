"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BackStack, LAYER_KEY, type CloseLayer } from "./back-stack";

const EVENT = "ternaku:navigation";
let stack: BackStack | undefined;
function historyStack() {
  if (!stack) {
    stack = new BackStack({
      state: () => window.history.state || {},
      hash: () => window.location.hash,
      push: (state, hash) =>
        window.history.pushState(state, "", hash ?? window.location.href),
      replace: (state) =>
        window.history.replaceState(state, "", window.location.href),
      go: (delta) => window.history.go(delta),
      changed: () => window.dispatchEvent(new Event(EVENT)),
    });
    window.addEventListener("popstate", () => stack!.pop());
  }
  return stack;
}

export function useBackLayer(active: boolean, onClose: CloseLayer) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let release: (() => void) | undefined;
    // React Strict Mode's discarded mount must never create a history entry.
    queueMicrotask(() => {
      if (!cancelled) release = historyStack().open(() => close.current());
    });
    return () => {
      cancelled = true;
      release?.();
    };
  }, [active]);
}

export function pageFromHash(
  hash: string,
  pages: readonly string[],
  fallback: string,
  prefix = "",
) {
  const candidate = hash
    .replace(/^#/, "")
    .replace(new RegExp(`^${prefix}`), "");
  return pages.includes(candidate) ? candidate : fallback;
}

export function usePageNavigation<T extends string>(
  pages: readonly T[],
  fallback: T,
  prefix = "",
  active = true,
) {
  const [page, setPage] = useState<T>(fallback);
  const pageList = pages.join(",");
  useEffect(() => {
    if (!active) return;
    historyStack();
    const read = () =>
      setPage(
        pageFromHash(
          window.location.hash,
          pageList.split(","),
          fallback,
          prefix,
        ) as T,
      );
    const initial = pageFromHash(
      window.location.hash,
      pageList.split(","),
      fallback,
      prefix,
    );
    const canonical = `#${prefix}${initial}`;
    const state = { ...window.history.state };
    delete state[LAYER_KEY];
    window.history.replaceState(state, "", canonical);
    read();
    window.addEventListener(EVENT, read);
    window.addEventListener("hashchange", read);
    return () => {
      window.removeEventListener(EVENT, read);
      window.removeEventListener("hashchange", read);
    };
  }, [pageList, fallback, prefix, active]);
  const go = useCallback(
    (next: T) => {
      const hash = `#${prefix}${next}`;
      if (window.location.hash === hash && !window.history.state?.[LAYER_KEY])
        return;
      historyStack().navigate(hash);
      window.scrollTo({ top: 0, behavior: "auto" });
    },
    [prefix],
  );
  return [page, go] as const;
}
