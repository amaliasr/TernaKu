import { businessDate, today } from "./domain";

export type EmployeeHistoryScope = "mine" | "team";
export interface EmployeeHistoryRange { from: string; to: string }

/** Thirty calendar days in Jakarta, including the current day. */
export function employeeHistoryWindow(day = today()): EmployeeHistoryRange {
  const start = new Date(`${day}T00:00:00+07:00`);
  start.setUTCDate(start.getUTCDate() - 29);
  return { from: today(start), to: day };
}

export function nextJakartaDayDelay(now = new Date()): number {
  const midnight = new Date(`${today(now)}T00:00:00+07:00`).getTime();
  return Math.max(1, midnight + 86_400_000 - now.getTime() + 50);
}

export function employeeRecords<T extends { date: string; user_id: string; created_at: string }>(
  rows: T[],
  actor: { id: string; can_check_stock?: boolean },
  range: EmployeeHistoryRange,
  scope: EmployeeHistoryScope = "mine",
  employeeId = "",
): T[] {
  if (!range.from || !range.to || range.from > range.to) return [];
  const team = scope === "team" && actor.can_check_stock === true;
  const selected: { row: T; date: string }[] = [];
  for (const row of rows) {
    if (team ? employeeId && row.user_id !== employeeId : row.user_id !== actor.id) continue;
    const date = businessDate(row.date);
    if (date >= range.from && date <= range.to) selected.push({ row, date });
  }
  return selected.sort((a, b) => b.date.localeCompare(a.date) || b.row.created_at.localeCompare(a.row.created_at)).map(item => item.row);
}
