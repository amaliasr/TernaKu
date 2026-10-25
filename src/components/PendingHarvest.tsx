"use client";

import { useRef, useState } from "react";
import { Warehouse } from "lucide-react";
import { useFarm } from "@/lib/store";
import { dateLabel, isProductionStocked, number } from "@/lib/domain";
import { categoryLabel, errorMessage } from "./ModuleUI";

export default function PendingHarvest() {
  const { state, user, command } = useFarm();
  const pending = state.productions.filter(row => !isProductionStocked(row) && (user?.role === "admin" || row.user_id === user?.id));
  const [busy, setBusy] = useState("");
  const saving = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function receive(id: string) {
    if (saving.current) return;
    saving.current = true; setBusy(id); setError(""); setNotice("");
    try { await command("production.receive", { id }); setNotice("Panen sudah masuk gudang. Stok tersedia bertambah."); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { saving.current = false; setBusy(""); }
  }
  if (!pending.length && !error && !notice) return null;
  return <section className="panel p-3 mb-3" aria-label="Panen belum masuk gudang">
    <h2 className="h5">Panen belum masuk gudang {pending.length > 0 && <span>({pending.length})</span>}</h2>
    <p className="small text-muted">Pastikan telur sudah diterima di gudang, lalu masukkan catatan panen berikut. Jumlah ini belum termasuk stok tersedia.</p>
    {error && <p className="text-danger" role="alert">{error}</p>}
    {notice && <p className="text-success" role="status">{notice}</p>}
    <div className="d-grid gap-3">
      {pending.map(row => <article key={row.id} className="border rounded p-3">
        <strong>{categoryLabel(row.category)} · {number(row.kg, 3)} kg</strong>
        <p className="small mb-2">{number(row.eggs)} butir · {number(row.trays)} krat · {dateLabel(row.date)}<br />{state.users.find(member => member.id === row.user_id)?.name || "Karyawan"}</p>
        <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => void receive(row.id)}><Warehouse size={18} />{busy === row.id ? "Menyimpan…" : "Masukkan ke gudang"}</button>
      </article>)}
    </div>
  </section>;
}
