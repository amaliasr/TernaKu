"use client";

import { useState } from "react";
import { ArrowDownToLine, Info } from "lucide-react";
import { useFarm } from "@/lib/store";
import {
  dateLabel,
  isFreeSaleItem,
  money,
  number as formatNumber,
  pickupBalance,
} from "@/lib/domain";
import { printReceipt } from "@/lib/export";
import type { Pickup, Production, RecordEntity, Sale, User } from "@/lib/types";
import {
  categoryLabel,
  dataFrom,
  Dialog,
  errorMessage,
  Field,
  LoadingButton,
  methodLabel,
  Pill,
} from "./ModuleUI";

const number = (value: number) => formatNumber(value, 3);

export type SelectedRecord = {
  entity: RecordEntity;
  record: Production | Pickup | Sale;
};
function Cancel({
  onClose,
  disabled = false,
}: {
  onClose: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="btn btn-light"
      onClick={onClose}
      disabled={disabled}
    >
      Batal
    </button>
  );
}
export function CorrectionDialog({
  selected,
  onClose,
}: {
  selected: SelectedRecord;
  onClose: () => void;
}) {
  const { command, user } = useFarm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { entity, record } = selected;
  const [saleItems, setSaleItems] = useState(() =>
    entity === "sale"
      ? (record as Sale).items.map((item) => ({
          ...item,
          eggs: String(item.eggs),
          kg: String(item.kg),
          trays: String(item.trays),
        }))
      : [],
  );
  const revisedTotal = saleItems.reduce(
    (sum, item) => sum + Math.round(Number(item.kg) * item.unit_price),
    0,
  );
  const belowPaid = entity === "sale" && revisedTotal < (record as Sale).paid;
  const updateItem = (
    id: string,
    key: "eggs" | "kg" | "trays",
    value: string,
  ) =>
    setSaleItems((items) =>
      items.map((item) => (item.id === id ? { ...item, [key]: value } : item)),
    );
  const direct =
    user?.role === "admin" ||
    (entity === "production" && !record.locked && record.user_id === user?.id);
  return (
    <Dialog
      title={direct ? "Koreksi pencatatan" : "Ajukan koreksi"}
      subtitle="Setiap perubahan disimpan dalam jejak aktivitas."
      onClose={() => {
        if (!busy) onClose();
      }}
      wide={entity === "sale"}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const data = dataFrom(e.currentTarget);
          const changes: Record<string, unknown> = { notes: data.notes };
          if (entity === "production" || entity === "pickup") {
            changes.eggs = Number(data.eggs);
            changes.kg = Number(data.kg);
            changes.trays = Number(data.trays);
          }
          if (entity === "sale") {
            changes.customer = data.customer;
            changes.items = saleItems.map((item) => ({
              id: item.id,
              eggs: Number(item.eggs),
              kg: Number(item.kg),
              trays: Number(item.trays),
            }));
          }
          if (entity === "pickup") changes.area = data.area;
          setBusy(true);
          setError("");
          try {
            await command(direct ? "correction.apply" : "correction.request", {
              entity,
              id: record.id,
              reason: data.reason,
              changes,
            });
            onClose();
          } catch (error) {
            setError(errorMessage(error));
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="modal-body-custom">
          {error && (
            <div className="alert alert-danger" role="alert">
              {error}
            </div>
          )}
          <div className="info-note mb-3">
            <Info size={17} />
            <span>
              {direct
                ? "Perubahan diterapkan setelah validasi stok."
                : "Perubahan akan diperiksa dan disetujui atasan terlebih dahulu."}
              {entity === "sale" &&
                " Harga transaksi tetap memakai harga yang tersimpan pada nota awal."}
              {entity === "pickup" &&
                " Jumlah yang diperbarui harus tetap mencakup telur yang sudah terjual dan dikembalikan."}
            </span>
          </div>
          {(entity === "production" || entity === "pickup") && (
            <div className="row g-3">
              <Field className="col-4" label="Butir">
                <input
                  name="eggs"
                  className="form-control"
                  type="number"
                  min="1"
                  step="1"
                  defaultValue={(record as Production).eggs}
                  required
                />
              </Field>
              <Field className="col-4" label="Berat (kg)">
                <input
                  name="kg"
                  className="form-control"
                  type="number"
                  min="0.001"
                  step="0.001"
                  defaultValue={(record as Production).kg}
                  required
                />
              </Field>
              <Field className="col-4" label="Krat">
                <input
                  name="trays"
                  className="form-control"
                  type="number"
                  min="0"
                  step="1"
                  defaultValue={(record as Production).trays}
                  required
                />
              </Field>
            </div>
          )}
          {entity === "sale" && (
            <>
              <Field className="d-block" label="Pelanggan">
                <input
                  name="customer"
                  className="form-control"
                  defaultValue={(record as Sale).customer}
                  maxLength={150}
                  required={(record as Sale).items.some(isFreeSaleItem)}
                />
              </Field>
              <div className="form-section">
                <h3>Rincian penjualan yang dikoreksi</h3>
                {saleItems.map((item, index) => (
                  <div className="sale-line" key={item.id}>
                    <div className="d-flex justify-content-between gap-2 mb-3">
                      <strong>
                        {index + 1}. {categoryLabel(item.category)}
                      </strong>
                      <small>
                        {isFreeSaleItem(item)
                          ? "Gratis (tetap)"
                          : `Harga tetap ${money(item.unit_price)}/kg`}
                      </small>
                    </div>
                    <div className="row g-3">
                      <Field className="col-4" label="Butir">
                        <input
                          className="form-control"
                          type="number"
                          min="1"
                          step="1"
                          required
                          value={item.eggs}
                          onChange={(e) =>
                            updateItem(item.id, "eggs", e.target.value)
                          }
                        />
                      </Field>
                      <Field className="col-4" label="Berat (kg)">
                        <input
                          className="form-control"
                          type="number"
                          min="0.001"
                          step="0.001"
                          required
                          value={item.kg}
                          onChange={(e) =>
                            updateItem(item.id, "kg", e.target.value)
                          }
                        />
                      </Field>
                      <Field className="col-4" label="Krat">
                        <input
                          className="form-control"
                          type="number"
                          min="0"
                          step="1"
                          required
                          value={item.trays}
                          onChange={(e) =>
                            updateItem(item.id, "trays", e.target.value)
                          }
                        />
                      </Field>
                    </div>
                    <div className="text-end fw-semibold mt-2">
                      {isFreeSaleItem(item)
                        ? "Gratis"
                        : money(Math.round(Number(item.kg) * item.unit_price))}
                    </div>
                  </div>
                ))}
                <div className="invoice-summary">
                  <div>
                    <span>Total setelah koreksi</span>
                    <strong>{money(revisedTotal)}</strong>
                  </div>
                  <div>
                    <span>Sudah dibayar</span>
                    <span>{money((record as Sale).paid)}</span>
                  </div>
                  <div>
                    <span>Sisa tagihan setelah koreksi</span>
                    <strong>
                      {money(Math.max(0, revisedTotal - (record as Sale).paid))}
                    </strong>
                  </div>
                </div>
                {belowPaid && (
                  <div className="alert alert-warning mt-3">
                    Total setelah koreksi tidak boleh kurang dari pembayaran
                    yang sudah diterima. Pengembalian uang belum tersedia.
                  </div>
                )}
              </div>
            </>
          )}
          {entity === "pickup" && (
            <Field className="d-block" label="Tujuan penjualan">
              <input
                name="area"
                className="form-control"
                defaultValue={(record as Pickup).area}
                maxLength={150}
                required
              />
            </Field>
          )}
          <Field className="d-block mt-3" label="Catatan">
            <textarea
              name="notes"
              className="form-control"
              rows={2}
              defaultValue={record.notes}
              maxLength={2000}
            />
          </Field>
          <Field className="d-block mt-3" label="Alasan perubahan (wajib)">
            <textarea
              name="reason"
              className="form-control"
              rows={3}
              minLength={5}
              maxLength={2000}
              required
              placeholder="Jelaskan alasan koreksi, minimal 5 karakter."
            />
          </Field>
        </div>
        <div className="modal-footer-custom">
          <Cancel onClose={onClose} disabled={busy} />
          <LoadingButton busy={busy} disabled={belowPaid}>
            {direct ? "Simpan koreksi" : "Kirim pengajuan"}
          </LoadingButton>
        </div>
      </form>
    </Dialog>
  );
}
export function ReturnDialog({
  pickup,
  onClose,
}: {
  pickup: Pickup;
  onClose: () => void;
}) {
  const { state, command } = useFarm();
  const balance = pickupBalance(state, pickup);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Dialog
      title="Kembalikan telur ke gudang"
      subtitle={`${categoryLabel(pickup.category)} · ${pickup.area}`}
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const data = dataFrom(e.currentTarget);
          setBusy(true);
          setError("");
          try {
            await command("pickup.return", {
              id: pickup.id,
              eggs: Number(data.eggs),
              kg: Number(data.kg),
              trays: Number(data.trays),
              notes: data.notes,
            });
            onClose();
          } catch (error) {
            setError(errorMessage(error));
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="modal-body-custom">
          {error && (
            <div className="alert alert-danger" role="alert">
              {error}
            </div>
          )}
          <div className="form-summary mb-3">
            <span>Sisa yang dibawa</span>
            <strong>
              {number(balance.eggs)} butir · {number(balance.kg)} kg
            </strong>
          </div>
          <div className="row g-3">
            <Field className="col-4" label="Butir retur">
              <input
                name="eggs"
                type="number"
                className="form-control"
                min="1"
                step="1"
                max={balance.eggs}
                defaultValue={balance.eggs}
                required
              />
            </Field>
            <Field className="col-4" label="Berat (kg)">
              <input
                name="kg"
                type="number"
                className="form-control"
                min="0.001"
                step="0.001"
                max={balance.kg}
                defaultValue={balance.kg}
                required
              />
            </Field>
            <Field className="col-4" label="Krat">
              <input
                name="trays"
                type="number"
                className="form-control"
                min="0"
                step="1"
                defaultValue={Math.max(0, balance.trays)}
                required
              />
            </Field>
          </div>
          <Field className="d-block mt-3" label="Catatan pengembalian">
            <textarea
              name="notes"
              className="form-control"
              rows={2}
              placeholder="Contoh: sisa penjualan hari ini"
              maxLength={2000}
            />
          </Field>
          <div className="info-note mt-3">
            <Info size={17} />
            <span>
              Telur yang dikembalikan menambah stok gudang. Hanya sisa yang
              belum terjual yang dapat dikembalikan.
            </span>
          </div>
        </div>
        <div className="modal-footer-custom">
          <Cancel onClose={onClose} disabled={busy} />
          <LoadingButton busy={busy}>Simpan pengembalian</LoadingButton>
        </div>
      </form>
    </Dialog>
  );
}
export function PaymentDialog({
  sale,
  onClose,
}: {
  sale: Sale;
  onClose: () => void;
}) {
  const { command } = useFarm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Dialog
      title="Terima pembayaran"
      subtitle={`${sale.number} · ${sale.customer || "Pelanggan umum"}`}
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const data = dataFrom(e.currentTarget);
          setBusy(true);
          setError("");
          try {
            await command("sale.payment", {
              id: sale.id,
              amount: Number(data.amount),
            });
            onClose();
          } catch (error) {
            setError(errorMessage(error));
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="modal-body-custom">
          {error && (
            <div className="alert alert-danger" role="alert">
              {error}
            </div>
          )}
          <div className="form-summary mb-3">
            <span>Sisa tagihan</span>
            <strong>{money(sale.balance)}</strong>
          </div>
          <Field className="d-block" label="Tambahan pembayaran (Rp)">
            <input
              className="form-control"
              name="amount"
              type="number"
              step="1"
              min="1"
              max={sale.balance}
              defaultValue={sale.balance}
              required
            />
          </Field>
        </div>
        <div className="modal-footer-custom">
          <Cancel onClose={onClose} disabled={busy} />
          <LoadingButton busy={busy}>Catat pembayaran</LoadingButton>
        </div>
      </form>
    </Dialog>
  );
}
export function EmployeeDialog({
  employee,
  onClose,
}: {
  employee: User;
  onClose: () => void;
}) {
  const { command } = useFarm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Dialog title="Kelola karyawan" subtitle={employee.email} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const data = dataFrom(e.currentTarget);
          setBusy(true);
          setError("");
          try {
            await command("user.update", {
              id: employee.id,
              name: data.name,
              target: Number(data.target),
            });
            onClose();
          } catch (error) {
            setError(errorMessage(error));
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="modal-body-custom">
          {error && (
            <div className="alert alert-danger" role="alert">
              {error}
            </div>
          )}
          <Field className="d-block" label="Nama lengkap">
            <input
              className="form-control"
              name="name"
              defaultValue={employee.name}
              minLength={2}
              maxLength={100}
              required
            />
          </Field>
          <Field className="d-block mt-3" label="Target omzet bulanan (Rp)">
            <input
              className="form-control"
              name="target"
              type="number"
              min="0"
              step="1"
              defaultValue={employee.target}
              required
            />
          </Field>
        </div>
        <div className="modal-footer-custom">
          <Cancel onClose={onClose} disabled={busy} />
          <LoadingButton busy={busy}>Simpan perubahan</LoadingButton>
        </div>
      </form>
    </Dialog>
  );
}
export function SaleDetail({
  sale,
  onClose,
}: {
  sale: Sale;
  onClose: () => void;
}) {
  const { state } = useFarm();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      title={sale.number}
      subtitle={`${dateLabel(sale.date, true)} · ${state.users.find((u) => u.id === sale.user_id)?.name || "Karyawan"}`}
      onClose={onClose}
      wide
    >
      <div className="modal-body-custom">
        {error && (
          <div className="alert alert-danger" role="alert">
            {error}
          </div>
        )}
        <div className="d-flex justify-content-between align-items-start mb-4">
          <div>
            <small className="text-muted">
              {sale.items.some(isFreeSaleItem)
                ? "Pelanggan / penerima"
                : "Pelanggan"}
            </small>
            <h3 className="mt-1">{sale.customer || "Pelanggan umum"}</h3>
            {sale.phone && <small>{sale.phone}</small>}
          </div>
          <Pill tone={sale.balance === 0 ? "success" : "warning"}>
            {sale.total === 0
              ? "Gratis"
              : sale.balance === 0
                ? "Lunas"
                : sale.paid > 0
                  ? "Sebagian"
                  : "Belum lunas"}
          </Pill>
        </div>
        <div className="table-responsive">
          <table className="table farm-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Butir / krat</th>
                <th>Berat</th>
                <th>Harga / kg</th>
                <th className="text-end">Jumlah</th>
              </tr>
            </thead>
            <tbody>
              {sale.items.map((item, i) => (
                <tr key={item.id || i}>
                  <td>
                    {categoryLabel(item.category)}
                    {isFreeSaleItem(item) && (
                      <small className="cell-sub">Pemberian gratis</small>
                    )}
                  </td>
                  <td>
                    {number(item.eggs)} / {number(item.trays)}
                  </td>
                  <td>{number(item.kg)} kg</td>
                  <td>
                    {isFreeSaleItem(item) ? "Gratis" : money(item.unit_price)}
                  </td>
                  <td className="text-end">{money(item.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="invoice-summary">
          <div>
            <span>Total penjualan</span>
            <strong>{money(sale.total)}</strong>
          </div>
          <div>
            <span>
              {sale.total === 0
                ? "Gratis · tidak ada pembayaran"
                : `Dibayar · ${methodLabel(sale.payment_method)}`}
            </span>
            <span>{money(sale.paid)}</span>
          </div>
          <div>
            <span>Sisa tagihan</span>
            <strong>{money(sale.balance)}</strong>
          </div>
        </div>
        {sale.notes && <p className="mt-3 mb-0 text-muted">{sale.notes}</p>}
        {sale.photo && (
          <img
            src={sale.photo}
            alt="Bukti pembayaran"
            className="photo-preview mt-3"
          />
        )}
        <div className="info-note mt-3">
          <Info size={16} />
          <span>
            Harga di nota merupakan salinan harga saat transaksi dibuat.
          </span>
        </div>
      </div>
      <div className="modal-footer-custom">
        <button type="button" className="btn btn-light" onClick={onClose}>
          Tutup
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await printReceipt(sale, state);
            } catch (error) {
              setError(errorMessage(error));
            } finally {
              setBusy(false);
            }
          }}
        >
          <ArrowDownToLine size={16} />
          {busy ? "Menyiapkan…" : "Unduh nota PDF"}
        </button>
      </div>
    </Dialog>
  );
}
