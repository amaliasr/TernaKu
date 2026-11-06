"use client";

import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { DraftWriter, readDraft, type EntryDraft } from "@/lib/entry-drafts";
import { Dialog } from "./ModuleUI";

type Editor = { writer: DraftWriter; changed(): void; status: string };
const DraftContext = createContext<Editor | null>(null);
export const useEntryDraft = () => useContext(DraftContext);
const storageError = (e: unknown) => e instanceof Error && e.message.includes("tab lain") ? e.message :
  "Draf belum tersimpan di HP. Periksa ruang penyimpanan dan jangan tutup formulir ini.";

export function DraftBoundary({ storageKey, label, onClose, children }: {
  storageKey: string; label: string; onClose(): void; children: ReactNode;
}) {
  const [writer, setWriter] = useState<DraftWriter | null>(null);
  const [stage, setStage] = useState<"load" | "choose" | "edit" | "error">("load");
  const [reload, setReload] = useState(0);
  const [status, setStatus] = useState("");
  const generation = useRef(0);
  useEffect(() => {
    let live = true;
    readDraft(storageKey).then((saved) => {
      if (!live) return;
      const record: EntryDraft = saved || { key: storageKey, id: crypto.randomUUID(), rev: 0, fields: {}, attempt: null, updatedAt: Date.now() };
      setWriter(new DraftWriter(record));
      setStage(saved && !saved.attempt ? "choose" : "edit");
      setStatus(saved ? "Draf tersimpan di HP · Belum terkirim" : "");
    }).catch(() => { if (live) setStage("error"); });
    return () => { live = false; };
  }, [storageKey, reload]);
  const editor = useMemo<Editor | null>(() => writer ? {
    writer, status,
    changed() {
      if (writer.record.attempt) return;
      const stamp = ++generation.current;
      setStatus("Menyimpan draf di HP…");
      writer.save().then(() => {
        if (generation.current === stamp) setStatus("Draf tersimpan di HP · Belum terkirim");
      }).catch((e) => { if (generation.current === stamp) setStatus(storageError(e)); });
    },
  } : null, [writer, status]);
  if (stage === "edit" && editor) return <DraftContext.Provider value={editor}>{children}</DraftContext.Provider>;
  return <Dialog title={stage === "choose" ? `Draf ${label} belum terkirim` : `Catat ${label}`} onClose={onClose}>
    <div className="modal-body-custom" role="status">
      {stage === "load" ? "Membuka formulir…" : stage === "error" ? <>
        <p>Penyimpanan draf di perangkat ini belum bisa dibuka.</p>
        <button type="button" className="btn btn-primary" onClick={() => { setStage("load"); setReload(n => n + 1); }}>Coba lagi</button>
      </> : writer && <>
        <p>Terakhir diisi {new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(writer.record.updatedAt)} WIB. Draf ini belum mengubah stok atau omzet.</p>
        <div className="d-grid gap-2">
          <button className="btn btn-primary" onClick={() => setStage("edit")}>Lanjutkan draf</button>
          <button className="btn btn-light" onClick={async () => {
            if (!window.confirm("Buang isian dan foto draf ini dari HP?")) return;
            setStage("load");
            try { await writer.finish(); setReload(n => n + 1); } catch { setStage("error"); }
          }}>Buang draf dan mulai baru</button>
        </div>
      </>}
    </div>
  </Dialog>;
}

/** Keep all state used to calculate a submission (including compressed photos
 * and a reviewed price) alongside the incomplete human input. */
export function useDraftField<T>(key: string, initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
  const editor = useEntryDraft();
  const [value, setValue] = useState<T>(() => {
    const saved = editor?.writer.record.fields;
    if (saved && Object.hasOwn(saved, key)) return saved[key] as T;
    return typeof initial === "function" ? (initial as () => T)() : initial;
  });
  const ref = useRef(value);
  const writer = editor?.writer;
  useLayoutEffect(() => {
    if (writer && !Object.hasOwn(writer.record.fields, key)) writer.record.fields[key] = ref.current;
  }, [writer, key]);
  return [value, (action) => {
    const next = typeof action === "function" ? (action as (old: T) => T)(ref.current) : action;
    ref.current = next;
    setValue(next);
    if (editor) { editor.writer.record.fields[key] = next; editor.changed(); }
  }];
}

/** Older drafts could contain a native and a controlled copy of this date. */
export function useSaleDueDate() {
  const fields = useEntryDraft()?.writer.record.fields;
  return useDraftField<string>("sale.dueDate", () => {
    const oldValues = [fields?.dueDate, fields?.["native:due_date"]];
    return oldValues.find((value): value is string => typeof value === "string" && value !== "") || "";
  });
}

/** Standard named inputs still use native form validation and FormData. */
export function DraftFields({children, enabled}: {children: ReactNode; enabled: boolean}) {
  const editor = useEntryDraft();
  const root = useRef<HTMLDivElement>(null);
  const writer = editor?.writer;
  useLayoutEffect(() => {
    if (!enabled || !writer) return;
    const fields = root.current?.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input[name]:not([type=file]),select[name],textarea[name]");
    fields?.forEach(el => {
      if (el.hasAttribute("data-draft-controlled")) return;
      const key = "native:" + el.name;
      if (typeof writer.record.fields[key] === "string") el.value = writer.record.fields[key] as string;
      else writer.record.fields[key] = el.value;
    });
  }, [writer, enabled]);
  return <div ref={root} onChangeCapture={e => {
    if (!editor || !enabled) return;
    const el = e.target;
    if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) || !el.name || el.type === "file" || el.hasAttribute("data-draft-controlled")) return;
    editor.writer.record.fields["native:" + el.name] = el.value; editor.changed();
  }}>{enabled && editor && <p className="small text-muted px-3 mt-3 mb-0" role="status">{editor.status || "Isian dan foto disimpan sebagai draf di HP ini."}</p>}{children}</div>;
}
