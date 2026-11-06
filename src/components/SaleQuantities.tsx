import { useId, type ReactNode } from "react";
import { number } from "@/lib/domain";
import type { Quantity } from "@/lib/types";
import { Field } from "./ModuleUI";
import styles from "./EmployeeEntry.module.css";

type Props = {
  kg: string;
  eggs: string;
  available?: Quantity;
  estimatedEggs?: number;
  onKg(value: string): void;
  onEggs(value: string): void;
  fieldClassName?: string;
  extraCountField?: ReactNode;
  countSummary?: string;
};

export function SaleQuantities({ kg, eggs, available, estimatedEggs, onKg, onEggs, fieldClassName, extraCountField, countSummary }: Props) {
  const hintId = useId();
  const countField = (
    <Field label="Jumlah butir (opsional)">
      <input className="form-control" type="number" inputMode="numeric"
        aria-label="Jumlah butir (opsional)" aria-describedby={extraCountField ? undefined : hintId}
        min="1" step="1" max={available?.eggs} value={eggs} placeholder="Otomatis"
        onChange={event => onEggs(event.target.value)} />
    </Field>
  );
  const hint = eggs ? `Jumlah yang diisi: ${number(Number(eggs))} butir.`
    : estimatedEggs !== undefined ? `Perkiraan dari berat: ${number(estimatedEggs)} butir.`
    : "Jumlah butir bisa diperkirakan dari berat.";
  return <>
    <Field label="Berat (kg)" className={fieldClassName}>
      <input className="form-control" type="number" inputMode="decimal" required
        min="0.001" step="0.001" max={available?.kg} value={kg} aria-describedby={hintId} placeholder="0,00"
        onChange={event => onKg(event.target.value)} />
    </Field>
    {extraCountField ? <>
      <small className={styles.countHint} aria-live="polite" id={hintId}>{hint}</small>
      <details className={styles.optional}>
        <summary>{countSummary || "Isi butir atau krat (opsional)"}</summary>
        <div className={styles.optionalBody}>{countField}{extraCountField}</div>
      </details>
    </> : <div className={fieldClassName}>
      {countField}
      <small className="text-muted d-block mt-1" aria-live="polite" id={hintId}>{hint}</small>
    </div>}
  </>;
}
