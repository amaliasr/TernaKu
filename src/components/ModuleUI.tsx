"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X, Inbox, Search, LoaderCircle } from "lucide-react";
import { businessDate, dateLabel } from "@/lib/domain";
import { useBackLayer } from "@/lib/navigation";
import { lockBodyScroll } from "@/lib/scroll-lock";
export { businessDate } from "@/lib/domain";

export const categoryLabel = (value: string) =>
  value === "good" ? "Telur bagus" : "Telur bentes";
export const methodLabel = (value: string) =>
  ({ cash: "Tunai", transfer: "Transfer", qris: "QRIS", credit: "Piutang" })[
    value
  ] || value;
export function Field({
  label,
  hint,
  children,
  className = "",
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`form-field ${className}`}>
      <span className="form-label">{label}</span>
      {children}
      {hint && <small className="text-muted d-block mt-1">{hint}</small>}
    </label>
  );
}
export function Pill({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={`status-pill ${tone}`}>{children}</span>;
}
export function Empty({
  title = "Belum ada data",
  description = "Data yang dicatat akan muncul di sini.",
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div className="empty-state">
      <Inbox size={36} strokeWidth={1.4} />
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  );
}
export function LoadingButton({
  busy,
  disabled = false,
  children,
  className = "btn btn-primary",
}: {
  busy: boolean;
  disabled?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button type="submit" className={className} disabled={busy || disabled}>
      {busy && <LoaderCircle className="spin" size={16} />}
      {busy ? "Menyimpan…" : children}
    </button>
  );
}
export function Filters({
  search,
  onSearch,
  from,
  to,
  onFrom,
  onTo,
  children,
  placeholder = "Cari data…",
}: {
  search: string;
  onSearch: (v: string) => void;
  from: string;
  to: string;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
  children?: ReactNode;
  placeholder?: string;
}) {
  return (
    <div className="module-toolbar">
      <div className="search-input">
        <Search size={17} />
        <input
          aria-label={placeholder}
          className="form-control"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder={placeholder}
        />
      </div>
      <div className="date-filters">
        <input
          aria-label="Tanggal mulai"
          type="date"
          className="form-control"
          value={from}
          onChange={(e) => onFrom(e.target.value)}
        />
        <span>–</span>
        <input
          aria-label="Tanggal akhir"
          type="date"
          className="form-control"
          value={to}
          min={from || undefined}
          onChange={(e) => onTo(e.target.value)}
        />
      </div>
      {children}
    </div>
  );
}
export function Dialog({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void | boolean;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useBackLayer(true, onClose);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const releaseScroll = lockBodyScroll();
    const focusable = () =>
      Array.from(
        ref.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]',
        ) || [],
      ).filter(
        (element) =>
          element.getClientRects().length > 0 && !element.matches(":disabled"),
      );
    focusable()[0]?.focus();
    const handler = (event: KeyboardEvent) => {
      const dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
      if (dialogs[dialogs.length - 1] !== ref.current) return;
      if (event.key === "Escape") closeRef.current();
      if (event.key === "Tab") {
        const elements = focusable(),
          first = elements[0],
          last = elements[elements.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        }
        if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => {
      releaseScroll();
      document.removeEventListener("keydown", handler);
      previous?.focus();
    };
  }, []);
  return createPortal(
    <div
      className="modal-backdrop-custom"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className={`modal-dialog-custom ${wide ? "modal-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-header-custom">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button
            className="icon-btn"
            type="button"
            aria-label="Tutup dialog"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
export function RecordDate({ date }: { date: string }) {
  return <span className="text-nowrap">{dateLabel(date)}</span>;
}
export const inRange = (date: string, from: string, to: string) => {
  const day = businessDate(date);
  return (!from || day >= from) && (!to || day <= to);
};
export function dataFrom(form: HTMLFormElement) {
  return Object.fromEntries(new FormData(form).entries());
}
export const errorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Data belum dapat disimpan. Silakan coba lagi.";
export const localNow = () =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .format(new Date())
    .replace(" ", "T");
