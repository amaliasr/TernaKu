"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Maximize2, Minimize2, X, ZoomIn } from "lucide-react";
import { useBackLayer } from "@/lib/navigation";
import { lockBodyScroll } from "@/lib/scroll-lock";
import styles from "./ImagePreview.module.css";

export default function ImagePreview({ src, alt, className = "", thumbnailClassName = "" }: {
  src: string;
  alt: string;
  className?: string;
  thumbnailClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [original, setOriginal] = useState(false);
  const [failed, setFailed] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const title = useId();
  const close = useCallback(() => setOpen(false), []);
  useBackLayer(open, close);

  useEffect(() => { setFailed(false); setOpen(false); }, [src]);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const releaseScroll = lockBodyScroll();
    closeButton.current?.focus();
    function keydown(event: KeyboardEvent) {
      const overlays = document.querySelectorAll('[role="dialog"]');
      if (overlays[overlays.length - 1] !== dialog.current) return;
      if (event.key === "Escape") {
        event.preventDefault(); event.stopImmediatePropagation(); close();
      }
      if (event.key !== "Tab") return;
      const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]') || []).filter(node => node.getClientRects().length);
      const first = controls[0]; const last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog.current?.contains(document.activeElement))) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.current?.contains(document.activeElement))) {
        event.preventDefault(); first?.focus();
      }
    }
    document.addEventListener("keydown", keydown, true);
    return () => {
      document.removeEventListener("keydown", keydown, true);
      releaseScroll();
      if (previous?.isConnected) previous.focus();
    };
  }, [open, close]);

  if (!src) return null;
  return <>
    <button type="button" className={`${styles.thumbnail} ${className}`} aria-label={`Perbesar ${alt.toLowerCase()}`} onClick={() => { setOriginal(false); setFailed(false); setOpen(true); }}>
      <img src={src} alt={alt} className={thumbnailClassName} />
      <span className={styles.hint}><ZoomIn size={18} aria-hidden="true" /> Perbesar foto</span>
    </button>
    {open && createPortal(<div ref={dialog} className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby={title} data-overlay="image-preview" onClick={event => { if (event.target === event.currentTarget) close(); }}>
      <div className={styles.toolbar}>
        <strong id={title}>{alt}</strong>
        <button type="button" aria-pressed={original} onClick={() => setOriginal(value => !value)}>
          {original ? <Minimize2 size={20} /> : <Maximize2 size={20} />}
          <span>{original ? "Sesuaikan layar" : "Ukuran asli"}</span>
        </button>
        <button ref={closeButton} type="button" aria-label="Tutup foto" onClick={close}><X size={24} /><span>Tutup</span></button>
      </div>
      <div className={`${styles.viewer} ${original ? styles.original : ""}`} tabIndex={0} aria-label={original ? "Foto ukuran asli. Geser untuk melihat bagian lain." : "Foto diperbesar"} onClick={event => { if (event.target === event.currentTarget) close(); }}>
        {failed ? <p role="alert">Foto belum dapat ditampilkan. Tutup lalu coba lagi.</p> : <img src={src} alt={alt} draggable={false} onError={() => setFailed(true)} />}
      </div>
      <p className={styles.caption}>{original ? "Geser foto untuk melihat bagian lain." : "Pilih ukuran asli untuk melihat detail foto."}</p>
    </div>, document.body)}
  </>;
}
