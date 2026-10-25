"use client";

import { useEffect, useState } from "react";
import { useFarm } from "@/lib/store";
import type { MediaReference } from "@/lib/types";

/** Only fetch private photos when their view needs them; never persist them. */
export function usePhoto(source?: string, reference?: MediaReference, enabled = true) {
  const { loadMedia, user } = useFarm();
  const [attempt, setAttempt] = useState(0);
  const key = `${user?.id || ""}:${reference?.kind || ""}:${reference?.id || ""}:${reference?.version || ""}:${attempt}`;
  const [loaded, setLoaded] = useState({ key: "", src: "", error: "" });
  useEffect(() => {
    if (!enabled) { setLoaded({ key: "", src: "", error: "" }); return; }
    if (source || !reference || !enabled) return;
    let active = true;
    let url = "";
    void loadMedia(reference).then(blob => {
      if (!active) return;
      url = URL.createObjectURL(blob);
      setLoaded({ key, src: url, error: "" });
    }).catch(cause => {
      if (active) setLoaded({ key, src: "", error: cause instanceof Error ? cause.message : "Foto belum dapat dimuat." });
    });
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
    // The scalar key contains every reference field and the account identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, source, enabled, loadMedia]);
  return {
    src: source || (enabled && loaded.key === key ? loaded.src : ""),
    error: loaded.key === key ? loaded.error : "",
    retry: () => setAttempt(value => value + 1),
  };
}
