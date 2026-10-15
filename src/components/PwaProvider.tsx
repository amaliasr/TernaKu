"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}
type InstallResult = "accepted" | "dismissed" | "manual" | "failed";
const PwaContext = createContext({
  installed: false,
  canPrompt: false,
  ios: false,
  install: async (): Promise<InstallResult> => "manual",
});

export function PwaProvider({ children }: { children: ReactNode }) {
  const deferred = useRef<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [canPrompt, setCanPrompt] = useState(false);
  const [ios, setIos] = useState(false);
  useEffect(() => {
    const displayMode = window.matchMedia("(display-mode: standalone)");
    const appleStandalone = () => Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
    const detectInstalled = () => setInstalled(displayMode.matches || appleStandalone());
    detectInstalled();
    setIos(/iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
    const onPrompt = (event: Event) => {
      event.preventDefault();
      deferred.current = event as InstallPromptEvent;
      setCanPrompt(true);
    };
    const onInstalled = () => {
      deferred.current = null;
      setCanPrompt(false);
      setInstalled(true);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    displayMode.addEventListener("change", detectInstalled);
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {
        // Web login and recording remain available even if installation is restricted.
      });
    }
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      displayMode.removeEventListener("change", detectInstalled);
    };
  }, []);
  const install = useCallback(async (): Promise<InstallResult> => {
    const event = deferred.current;
    if (!event) return "manual";
    deferred.current = null;
    setCanPrompt(false);
    try {
      await event.prompt();
      return (await event.userChoice).outcome;
    } catch {
      return "failed";
    }
  }, []);
  return <PwaContext.Provider value={{ installed, canPrompt, ios, install }}>{children}</PwaContext.Provider>;
}
export const usePwa = () => useContext(PwaContext);
