"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "./ThemeProvider";

export default function ThemeToggle({
  compact = false,
}: {
  compact?: boolean;
}) {
  const { theme, toggle } = useTheme();
  const dark = theme === "dark";
  const label = dark ? "Gunakan tampilan terang" : "Gunakan tampilan gelap";
  return (
    <button
      type="button"
      className={`theme-toggle${compact ? " theme-toggle-compact" : ""}`}
      onClick={toggle}
      aria-label={label}
      title={label}
      aria-pressed={dark}
    >
      {dark ? (
        <Sun size={21} aria-hidden="true" />
      ) : (
        <Moon size={21} aria-hidden="true" />
      )}
      {!compact && <span>{dark ? "Mode terang" : "Mode gelap"}</span>}
    </button>
  );
}
