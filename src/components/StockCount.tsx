"use client";

import { useRef, useState } from "react";
import { useFarm } from "@/lib/store";
import { dateLabel, eggStock, number } from "@/lib/domain";
import {
  categoryLabel,
  Dialog,
  errorMessage,
  Field,
  LoadingButton,
} from "./ModuleUI";
import type { Category } from "@/lib/types";

const categories = ["good", "cracked"] as const;
const blank = () => ({
  good: { eggs: "", kg: "" },
  cracked: { eggs: "", kg: "" },
});
const signed = (n: number) => (n > 0 ? "+" : "") + number(n, 3);

export default function StockCount() {
  const { state, user } = useFarm();
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState("");
  if (user?.role !== "admin") return null;
  const last = (state.stock_movements || [])
    .filter((m) => m.kind === "reconcile")
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  return (
    <section className="panel p-3 mb-3">
      <div className="d-flex align-items-start justify-content-between flex-wrap gap-2">
        <div>
          <h2 className="h5">Cocokkan stok gudang</h2>
          <p className="small text-muted mb-1">
            Hitung telur yang masih ada di gudang. Telur yang sedang dibawa
            karyawan tidak ikut dihitung.
          </p>
          {last && (
            <small>
              Terakhir dicocokkan {dateLabel(last.created_at, true)} WIB.
            </small>
          )}
        </div>
        <button
          type="button"
          className="btn btn-outline-primary"
          onClick={() => {
            setNotice("");
            setOpen(true);
          }}
        >
          Cocokkan stok
        </button>
      </div>
      {notice && (
        <p className="alert alert-success mt-2 mb-0" role="status">
          {notice}
        </p>
      )}
      {open && (
        <CountDialog
          close={() => setOpen(false)}
          saved={() => {
            setOpen(false);
            setNotice(
              "Hitungan fisik sudah tersimpan. Selisih tercatat di Pergerakan stok.",
            );
          }}
        />
      )}
    </section>
  );
}
function CountDialog({
  close,
  saved,
}: {
  close: () => void;
  saved: () => void;
}) {
  const { state, command, refresh } = useFarm();
  const [expected] = useState(() => ({
    good: eggStock(state, "good"),
    cracked: eggStock(state, "cracked"),
  }));
  const [counts, setCounts] = useState(blank);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const guard = useRef(false);
  const [error, setError] = useState("");
  const rows = categories.map((category) => ({
    category,
    expected: { eggs: expected[category].eggs, kg: expected[category].kg },
    physical: {
      eggs: Number(counts[category].eggs),
      kg: Number(counts[category].kg),
    },
  }));
  const changed = rows.some(
    (r) =>
      r.expected.eggs !== r.physical.eggs || r.expected.kg !== r.physical.kg,
  );
  const stale = rows.some((r) => {
    const live = eggStock(state, r.category);
    return live.eggs !== r.expected.eggs || live.kg !== r.expected.kg;
  });
  const update = (c: Category, key: "eggs" | "kg", value: string) =>
    setCounts((all) => ({ ...all, [c]: { ...all[c], [key]: value } }));
  const safeClose = () => {
    if (guard.current) return false;
    close();
  };
  return (
    <Dialog
      title="Cocokkan stok fisik"
      subtitle="Jumlah hasil hitung menjadi saldo gudang yang baru."
      onClose={safeClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (guard.current || stale) return;
          if (
            rows.some((r) => (r.physical.eggs === 0) !== (r.physical.kg === 0))
          ) {
            setError(
              "Jika telur habis, isi 0 pada butir dan kilogram sekaligus.",
            );
            return;
          }
          if (changed && !reason.trim()) {
            setError("Jelaskan penyebab selisih.");
            return;
          }
          guard.current = true;
          setBusy(true);
          setError("");
          try {
            await command("stock.reconcile", {
              items: rows,
              reason: reason.trim() || "Stok sesuai dengan hitungan fisik.",
            });
            saved();
          } catch (err) {
            setError(errorMessage(err));
            if (errorMessage(err).includes("Stok berubah"))
              await refresh().catch(() => {});
          } finally {
            guard.current = false;
            setBusy(false);
          }
        }}
      >
        <fieldset disabled={busy} className="modal-body-custom">
          <p>
            Masukkan hasil hitung dan timbang hari ini, termasuk angka 0 jika
            kosong.
          </p>
          {rows.map((r) => (
            <fieldset className="border rounded p-3 mb-3" key={r.category}>
              <legend className="float-none w-auto h6 mb-0 px-1">
                {categoryLabel(r.category)}
              </legend>
              <small className="d-block mb-2">
                Menurut aplikasi: {number(r.expected.eggs)} butir ·{" "}
                {number(r.expected.kg, 3)} kg
              </small>
              <div className="row g-2">
                {(["eggs", "kg"] as const).map((k) => (
                  <Field
                    key={k}
                    className="col-6"
                    label={k === "eggs" ? "Butir fisik" : "Berat fisik (kg)"}
                  >
                    <input
                      className="form-control"
                      aria-label={
                        categoryLabel(r.category) +
                        (k === "eggs" ? " butir fisik" : " kg fisik")
                      }
                      type="number"
                      inputMode={k === "eggs" ? "numeric" : "decimal"}
                      min="0"
                      step={k === "eggs" ? "1" : "0.001"}
                      required
                      value={counts[r.category][k]}
                      onChange={(e) => update(r.category, k, e.target.value)}
                    />
                  </Field>
                ))}
              </div>
              {counts[r.category].eggs !== "" &&
                counts[r.category].kg !== "" && (
                  <small className="d-block mt-2" aria-live="polite">
                    Selisih: {signed(r.physical.eggs - r.expected.eggs)} butir ·{" "}
                    {signed(r.physical.kg - r.expected.kg)} kg
                  </small>
                )}
            </fieldset>
          ))}
          <Field className="d-block" label="Catatan (wajib jika ada selisih)">
            <textarea
              className="form-control"
              rows={2}
              maxLength={2000}
              placeholder="Contoh: 2 butir pecah saat dipindahkan."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required={changed}
            />
          </Field>
          {stale && (
            <p role="alert" className="alert alert-warning mt-3">
              Stok berubah saat dihitung. Tutup formulir, lalu cocokkan kembali
              dengan jumlah terbaru.
            </p>
          )}
          {error && (
            <p role="alert" className="alert alert-danger mt-3">
              {error}
            </p>
          )}
        </fieldset>
        <div className="modal-footer-custom">
          <button
            className="btn btn-light"
            type="button"
            disabled={busy}
            onClick={safeClose}
          >
            Batal
          </button>
          <LoadingButton disabled={stale} busy={busy}>
            Simpan hasil hitung
          </LoadingButton>
        </div>
      </form>
    </Dialog>
  );
}
