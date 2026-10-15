"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

type Theme = "light" | "dark";
type Preference = Theme | "system";
const STORAGE_KEY = "ternaku.theme";
const ThemeContext = createContext<{ theme: Theme; toggle: () => void } | null>(
  null,
);

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.bsTheme = theme;
  document.documentElement.style.colorScheme = theme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", theme === "dark" ? "#14231c" : "#196348");
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>("light");
  const [preference, setPreference] = useState<Preference>("system");

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    let saved: Preference = "system";
    try {
      const value = localStorage.getItem(STORAGE_KEY);
      if (value === "dark" || value === "light") saved = value;
    } catch {
      /* The selected theme still works when device storage is unavailable. */
    }
    const next =
      saved === "system" ? (media.matches ? "dark" : "light") : saved;
    setPreference(saved);
    setTheme(next);
    applyTheme(next);
    function onStorage(event: StorageEvent) {
      if (event.key !== STORAGE_KEY && event.key !== null) return;
      const value: Preference =
        event.newValue === "dark" || event.newValue === "light"
          ? event.newValue
          : "system";
      const current =
        value === "system" ? (media.matches ? "dark" : "light") : value;
      setPreference(value);
      setTheme(current);
      applyTheme(current);
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    if (preference !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    function onChange(event: MediaQueryListEvent) {
      const next = event.matches ? "dark" : "light";
      setTheme(next);
      applyTheme(next);
    }
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [preference]);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    setPreference(next);
    setTheme(next);
    applyTheme(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* Do not block a theme change when browser storage is restricted. */
    }
  }
  return (
    <ThemeContext.Provider value={{ theme, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value)
    throw new Error("ThemeToggle harus berada di dalam ThemeProvider.");
  return value;
}
