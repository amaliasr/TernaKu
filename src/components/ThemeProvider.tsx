"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
export type Theme = "light" | "dark";
export type FontSize = "small" | "normal" | "large";
const THEME_KEY = "ternaku.theme";
const FONT_KEY = "ternaku.font-size";
const ThemeContext = createContext<{
  theme: Theme;
  toggle: () => void;
  setTheme: (theme: Theme) => void;
  fontSize: FontSize;
  setFontSize: (size: FontSize) => void;
} | null>(null);
function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.bsTheme = theme;
  document.documentElement.style.colorScheme = theme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", theme === "dark" ? "#14231c" : "#196348");
}
function applyFontSize(size: FontSize) {
  document.documentElement.dataset.fontSize = size;
}
function readPreferences(): { theme: Theme; fontSize: FontSize } {
  let theme: Theme = "light";
  let fontSize: FontSize = "normal";
  try {
    if (localStorage.getItem(THEME_KEY) === "dark") theme = "dark";
    const saved = localStorage.getItem(FONT_KEY);
    if (saved === "small" || saved === "large") fontSize = saved;
  } catch {
    /* Default to a readable light view when storage is unavailable. */
  }
  return { theme, fontSize };
}
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, updateTheme] = useState<Theme>("light");
  const [fontSize, updateFontSize] = useState<FontSize>("normal");
  useEffect(() => {
    function syncPreferences() {
      const saved = readPreferences();
      updateTheme(saved.theme);
      updateFontSize(saved.fontSize);
      applyTheme(saved.theme);
      applyFontSize(saved.fontSize);
    }
    syncPreferences();
    function onStorage(event: StorageEvent) {
      if (
        event.key === null ||
        event.key === THEME_KEY ||
        event.key === FONT_KEY
      )
        syncPreferences();
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  function setTheme(next: Theme) {
    updateTheme(next);
    applyTheme(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* Keep this page's selection. */
    }
  }
  function setFontSize(next: FontSize) {
    updateFontSize(next);
    applyFontSize(next);
    try {
      localStorage.setItem(FONT_KEY, next);
    } catch {
      /* Keep this page's selection. */
    }
  }
  return (
    <ThemeContext.Provider
      value={{
        theme,
        toggle: () => setTheme(theme === "dark" ? "light" : "dark"),
        setTheme,
        fontSize,
        setFontSize,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}
export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value)
    throw new Error("Pengaturan tampilan harus berada di dalam ThemeProvider.");
  return value;
}
