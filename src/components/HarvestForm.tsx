"use client";

import { useState } from "react";
import { useFarm } from "@/lib/store";
import { number, today } from "@/lib/domain";
import type { Category, CommandPayload } from "@/lib/types";
import { NEW_EGG_TYPES } from "@/lib/egg-types";
import { classifyHarvestDraft, hasLegacyHarvest, normalizeHarvestRows, type HarvestDraftRows } from "@/lib/harvest-draft";
import { Field, LoadingButton, categoryLabel } from "./ModuleUI";
import { useDraftField } from "./DraftBoundary";
import PhotoUpload from "./PhotoUpload";

type Row = HarvestDraftRows[Category];
const categories = NEW_EGG_TYPES;

export default function HarvestForm({
  onSave,
  busy,
  onClose,
}: {
  onSave: (action: string, payload: CommandPayload) => Promise<void>;
  busy: boolean;
  onClose: () => void;
}) {
  const { state, user } = useFarm();
  const [savedRows, setRows] = useDraftField<Partial<HarvestDraftRows>>(
    "harvest.rows",
    () => normalizeHarvestRows(undefined),
  );
  const rows = normalizeHarvestRows(savedRows);
  const legacy = hasLegacyHarvest(rows);
  const [date, setDate] = useDraftField("harvest.date", () => today());
  const [barn, setBarn] = useDraftField("harvest.barn", "");
  const [notes, setNotes] = useDraftField("harvest.notes", "");
  const [location, setLocation] = useDraftField("harvest.location", "");
  const [photo, setPhoto] = useDraftField("harvest.photo", "");
  const [photoBusy, setPhotoBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const [message, setMessage] = useState("");
  const items = categories
    .map((category) => ({
      category,
      eggs: Number(rows[category].eggs),
      kg: Number(rows[category].kg),
      trays: Number(rows[category].trays),
    }))
    .filter((row) => row.eggs || row.kg || row.trays);
  const update = (category: Category, key: keyof Row, value: string) =>
    setRows((previous) => ({
      ...previous,
      [category]: { ...rows[category], [key]: value },
    }));
  return (
    <form
      onInvalidCapture={(e) => {
        const details = (e.target as HTMLElement).closest("details");
        if (details) details.open = true;
      }}
      onSubmit={(e) => {
        e.preventDefault();
        if (busy || photoBusy) return;
        if (legacy) { setMessage("Pilih jenis telur untuk draf bagus lama sebelum menyimpan."); return; }
        if (!items.length) {
          setMessage(
            "Isi jumlah butir dan berat untuk sedikitnya satu jenis telur.",
          );
          return;
        }
        if (items.some((item) => item.eggs < 1 || item.kg <= 0)) {
          setMessage(
            "Isi jumlah butir dan berat untuk setiap jenis telur yang dipanen.",
          );
          return;
        }
        setMessage("");
        void onSave("production.create", {
          date,
          barn_id: barn,
          notes,
          location,
          photo: photo || undefined,
          items,
        });
      }}
    >
      <fieldset disabled={busy} className="modal-body-custom">
        <p className="small text-muted mb-2">
          {user?.name} ·{" "}
          {state.settings?.harvest_auto_stock !== false
            ? "Setelah disimpan, panen langsung masuk stok gudang."
            : "Setelah disimpan, panen menunggu diterima di Gudang."}
        </p>
        <p>
          Isi hasil timbangan untuk setiap jenis telur. Kosongkan baris yang
          tidak dipanen.
        </p>
        {legacy && <div className="alert alert-warning" role="alert">
          <strong>Draf telur bagus belum dibedakan</strong>
          <p className="mb-2">{rows.good.eggs || "0"} butir · {rows.good.kg || "0"} kg. Pilih jenis yang benar. Foto dan isian lain tetap tersimpan.</p>
          <div className="d-flex flex-column flex-sm-row gap-2">
            {(["skm", "skm_new"] as const).map(type => <button key={type} type="button" className="btn btn-outline-secondary" onClick={() => {
              try { setRows(classifyHarvestDraft(rows, type)); setMessage(""); } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Periksa draf panen."); }
            }}>Pindahkan ke {categoryLabel(type)}</button>)}
          </div>
        </div>}
        {categories.map((c) => {
          const row = rows[c],
            estimate = Number(row.trays) * 10;
          return (
            <div key={c}>
            {c === "skm" && <h3 className="h6 mt-3 mb-2">Telur Bagus</h3>}
            {c === "cracked" && <h3 className="h6 mt-4 mb-2">Telur Bentes</h3>}
            <fieldset className="border rounded p-3 mb-3">
              <legend className="float-none w-auto h6 px-1 mb-0">
                {categoryLabel(c)}
              </legend>
              <div className="row g-2">
                {(["eggs", "kg"] as const).map((key) => (
                  <Field
                    key={key}
                    className="col-6"
                    label={
                      key === "eggs" ? "Jumlah butir" : "Berat aktual (kg)"
                    }
                  >
                    <input
                      name={c + "_" + key}
                      aria-label={
                        (key === "eggs"
                          ? "Jumlah butir "
                          : "Berat aktual (kg) ") + categoryLabel(c)
                      }
                      className="form-control"
                      type="number"
                      inputMode={key === "eggs" ? "numeric" : "decimal"}
                      step={key === "eggs" ? "1" : "0.001"}
                      min="0"
                      max={key === "eggs" ? 100000000 : 1000000}
                      placeholder="0"
                      value={row[key]}
                      onChange={(e) => update(c, key, e.target.value)}
                    />
                  </Field>
                ))}
              </div>
              <details className="mt-2 small">
                <summary>Jumlah krat (opsional)</summary>
                <Field
                  className="d-block mt-2"
                  label={"Krat " + categoryLabel(c)}
                >
                  <input
                    name={c + "_trays"}
                    className="form-control"
                    type="number"
                    inputMode="numeric"
                    min="0"
                    step="1"
                    max="1000000"
                    value={row.trays}
                    placeholder="0"
                    onChange={(e) => update(c, "trays", e.target.value)}
                  />
                </Field>
                {estimate > 0 && (
                  <small>
                    Perkiraan {number(estimate, 3)} kg. Stok tetap memakai berat
                    aktual.
                  </small>
                )}
              </details>
              {estimate > 0 &&
                Number(row.kg) > 0 &&
                Math.abs(Number(row.kg) - estimate) / estimate > 0.3 && (
                  <p className="small text-warning-emphasis mb-0">
                    Berat berbeda cukup jauh dari perkiraan krat. Jika timbangan
                    sudah benar, panen tetap bisa disimpan.
                  </p>
                )}
            </fieldset>
            </div>
          );
        })}
        <div className="form-summary mb-3" aria-live="polite">
          <span>Total panen</span>
          <strong>
            {number(items.reduce((n, r) => n + r.eggs, 0))} butir ·{" "}
            {number(
              items.reduce((n, r) => n + r.kg, 0),
              3,
            )}{" "}
            kg
          </strong>
        </div>
        <details>
          <summary>Tanggal, kandang, foto, dan catatan</summary>
          <Field className="d-block mt-3" label="Tanggal panen">
            <input
              name="date"
              className="form-control"
              type="date"
              required
              max={today()}
              value={date}
              onInput={(e) => setDate(e.currentTarget.value)}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
          <Field className="d-block mt-3" label="Kandang asal (opsional)">
            <select
              name="barn_id"
              className="form-select"
              value={barn}
              onChange={(e) => setBarn(e.target.value)}
            >
              <option value="">Tanpa kelompok kandang</option>
              {state.barns.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </Field>
          <Field className="d-block mt-3" label="Catatan (opsional)">
            <textarea
              name="notes"
              className="form-control"
              rows={2}
              maxLength={2000}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>
          <div className="mt-3">
            <PhotoUpload
              value={photo}
              onChange={setPhoto}
              onBusyChange={setPhotoBusy}
              disabled={busy}
            />
          </div>
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm mt-2"
            disabled={locating}
            onClick={() => {
              if (!navigator.geolocation) {
                setMessage(
                  "Perangkat ini tidak mendukung lokasi. Anda tetap bisa menyimpan panen.",
                );
                return;
              }
              setLocating(true);
              navigator.geolocation.getCurrentPosition(
                (p) => {
                  setLocation(
                    p.coords.latitude.toFixed(6) +
                      "," +
                      p.coords.longitude.toFixed(6),
                  );
                  setLocating(false);
                },
                () => {
                  setMessage(
                    "Lokasi tidak tersedia. Anda tetap bisa menyimpan panen.",
                  );
                  setLocating(false);
                },
                { timeout: 10000 },
              );
            }}
          >
            {locating
              ? "Mengambil lokasi…"
              : location
                ? "Perbarui lokasi (opsional)"
                : "Tambahkan lokasi (opsional)"}
          </button>
          {location && <small className="ms-2">{location}</small>}
        </details>
        {message && (
          <p role="alert" className="alert alert-warning mt-3 mb-0">
            {message}
          </p>
        )}
      </fieldset>
      <div className="modal-footer-custom">
        <button
          type="button"
          className="btn btn-light"
          disabled={busy}
          onClick={onClose}
        >
          Tutup
        </button>
        <LoadingButton busy={busy} disabled={photoBusy}>
          {photoBusy ? "Memproses foto…" : "Simpan panen"}
        </LoadingButton>
      </div>
    </form>
  );
}
