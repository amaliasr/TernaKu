import { businessDate, today } from "./domain";

export type ReportPreset = "today" | "yesterday" | "7days" | "30days" | "custom";
export interface ReportRange { from: string; to: string; }

function validDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function previousDay(day: string, offset: number): string {
  if (!validDay(day)) throw new Error("Tanggal laporan tidak valid.");
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - offset);
  return date.toISOString().slice(0, 10);
}

/** Calendar days in WIB; seven days includes today and the previous six dates. */
export function reportRange(preset: Exclude<ReportPreset, "custom">, day = today()): ReportRange {
  const to = previousDay(day, preset === "yesterday" ? 1 : 0);
  return { from: previousDay(to, preset === "7days" ? 6 : preset === "30days" ? 29 : 0), to };
}

export function reportRangeError(range: ReportRange, day = today()): string | null {
  if (!validDay(range.from) || !validDay(range.to)) return "Isi tanggal mulai dan tanggal akhir dengan benar.";
  if (range.from > range.to) return "Tanggal mulai tidak boleh melewati tanggal akhir.";
  if (range.to > day) return "Tanggal akhir paling jauh hari ini.";
  return null;
}

export function inReportRange(value: string, range: ReportRange): boolean {
  const date = businessDate(value);
  return date !== "" && date >= range.from && date <= range.to;
}
