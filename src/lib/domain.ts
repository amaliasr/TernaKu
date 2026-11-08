import type {
  Category,
  CommandPayload,
  Correction,
  FarmActivity,
  Pickup,
  PickupBalance,
  Price,
  Production,
  Quantity,
  RecordEntity,
  RegistrationInput,
  RegistrationResult,
  Sale,
  SaleItem,
  State,
  StockCountQuantity,
  User,
} from "./types";
import { dueDate, paymentEntry } from "./invoice-ledger";
import { ApiError } from "./request-errors";
import { resolveSaleEggs, saleEggCount } from "./sale-eggs";
import { assignUsername, withUsernames } from "./usernames";
import { validateAccountPassword, validateNewPassword } from "./account-policy";
import { applyDemoStockCheck, demoStockCheckContext, recordStockAssignment } from "./stock-checks";
import { ALL_EGG_TYPES, NEW_EGG_TYPES, canonicalEggType, emptyEggQuantities, eggTypeLabel, eggTypePrice, isEggType } from "./egg-types";

export const money = (value: number) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value || 0);
export const number = (value: number, maximumFractionDigits = 1) =>
  new Intl.NumberFormat("id-ID", { maximumFractionDigits }).format(value || 0);
export function today(at = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}
export function businessDate(value: string): string {
  if (!value) return "";
  const date = new Date(normalizeDateTime(value));
  return Number.isFinite(date.getTime()) ? today(date) : "";
}
export function dateLabel(value: string, withTime = false): string {
  if (!value) return "—";
  const date = new Date(
    value.length === 10 ? `${value}T12:00:00+07:00` : normalizeDateTime(value),
  );
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(date);
}
export function normalizeDateTime(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T00:00:00+07:00`;
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/.test(value))
    return `${value.replace(" ", "T")}+07:00`;
  return value;
}
export function activePrice(
  state: State,
  at: Date | string = new Date(),
): Price | undefined {
  const time = new Date(at).getTime();
  const eligible = state.prices
    .map((price, index) => ({ price, index }))
    .filter(
      ({ price }) =>
        new Date(normalizeDateTime(price.effective_at)).getTime() <= time,
    )
    .sort(
      (a, b) =>
        new Date(normalizeDateTime(b.price.effective_at)).getTime() -
          new Date(normalizeDateTime(a.price.effective_at)).getTime() ||
        new Date(b.price.created_at).getTime() -
          new Date(a.price.created_at).getTime() ||
        b.price.created_at.localeCompare(a.price.created_at) ||
        b.index - a.index,
    ).map(row => row.price);
  if (!eligible.length) return undefined;
  // Once the first common-price schedule is active, older split schedules are
  // history only. They cannot split the two good rates again in the future.
  const resolved = { ...(eligible.find(row => row.pricing_mode === "shared_good") ?? eligible[0]) };
  const shared = resolved.good_price ?? (resolved.skm_price !== undefined && resolved.skm_price === resolved.skm_new_price ? resolved.skm_price : undefined);
  if (shared === undefined) { delete resolved.good_price; delete resolved.skm_price; delete resolved.skm_new_price; }
  else { resolved.good_price = shared; resolved.skm_price = shared; resolved.skm_new_price = shared; }
  return resolved;
}
const round = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;
const emptyQuantity = (): Quantity => ({ eggs: 0, kg: 0, trays: 0 });
function soldQuantity(items: SaleItem[], category: Category): Quantity {
  const total = emptyQuantity();
  for (const item of items) {
    if (item.category !== category) continue;
    total.eggs += item.eggs;
    total.kg += item.kg;
    total.trays += item.trays;
  }
  total.kg = round(total.kg);
  return total;
}
export function isProductionStocked(production: Pick<Production, "stocked_at">): boolean {
  return production.stocked_at !== null;
}
function rawEggStock(state: State, category: Category): Quantity {
  if (state.inventory) return { ...(state.inventory[category] ?? emptyQuantity()) };
  const stock = emptyQuantity();
  for (const p of state.productions)
    if (isProductionStocked(p) && p.category === category) {
      stock.eggs += p.eggs;
      stock.kg += p.kg;
      stock.trays += p.trays;
    }
  for (const p of state.pickups)
    if (p.category === category) {
      stock.eggs += p.returned_eggs - p.eggs;
      stock.kg += p.returned_kg - p.kg;
      stock.trays += p.returned_trays - p.trays;
    }
  for (const sale of state.sales) {
    if (sale.stock_source !== "warehouse") continue;
    const sold = soldQuantity(sale.items, category);
    stock.eggs -= sold.eggs;
    stock.kg -= sold.kg;
    stock.trays -= sold.trays;
  }
  stock.kg = round(stock.kg);
  let countedTrays: number | undefined;
  for (const movement of state.stock_movements || []) {
    if (movement.category !== category) continue;
    if (movement.kind === "reconcile" || movement.kind === "classify_in" || movement.kind === "classify_out") {
      stock.eggs += movement.eggs;
      stock.kg = round(stock.kg + movement.kg);
      if (movement.kind !== "reconcile") stock.trays += movement.trays;
      if (movement.physical?.trays !== undefined) countedTrays = movement.physical.trays;
      else if (countedTrays !== undefined) countedTrays = Math.max(0, countedTrays + movement.trays);
    } else if (countedTrays !== undefined) {
      // Repacking can use more trays than previously recorded. Once trays have
      // been counted, the demo replays subsequent movements from that baseline.
      countedTrays = Math.max(0, countedTrays + movement.trays);
    }
    if (movement.merged_trays_after !== undefined) countedTrays = movement.merged_trays_after;
  }
  stock.trays = countedTrays ?? Math.max(0, stock.trays);
  return stock;
}
export function eggStock(state: State, category?: Category): Quantity {
  if (category === "good") return emptyQuantity();
  const types: readonly Category[] = category === "skm" ? ["skm", "good"] : category ? [category] : ALL_EGG_TYPES;
  return types.reduce((sum, type) => {
    const q = rawEggStock(state, type);
    return { eggs: sum.eggs + q.eggs, kg: round(sum.kg + q.kg), trays: sum.trays + q.trays };
  }, emptyQuantity());
}
/** Explicit owner policy: all formerly unclassified eggs are SKM. Monetary and
 * photo snapshots, request fingerprints, and audit evidence are not rewritten. */
export function normalizeFarmState(input: State, stamp = new Date().toISOString()): State {
  const hasLegacy = input.productions.some(r => r.category === "good") || input.pickups.some(r => r.category === "good")
    || input.sales.some(s => s.items.some(r => r.category === "good")) || input.stock_movements?.some(r => r.category === "good")
    || !!input.inventory?.good && Object.values(input.inventory.good).some(n => n !== 0)
    || input.stock_check_context && [input.stock_check_context.warehouse, input.stock_check_context.harvest].some(q => !q.skm || !q.skm_new || q.good && Object.values(q.good).some(n => n !== 0))
    || input.stock_checks?.some(c => [c.expected.warehouse, c.expected.harvest, c.warehouse_actual, c.harvest_actual].some(q => !q.skm || !q.skm_new || q.good && Object.values(q.good).some(n => n !== 0)));
  if (!hasLegacy) return input;
  const before = eggStock(input, "skm");
  const row = <T extends { category: Category }>(r: T): T => r.category === "good" ? { ...r, category: "skm" } : r;
  const counts = (value: State["inventory"]): NonNullable<State["inventory"]> => {
    const next = { ...emptyEggQuantities(), ...value };
    next.skm = { eggs: next.skm.eggs + next.good.eggs, kg: round(next.skm.kg + next.good.kg), trays: next.skm.trays + next.good.trays };
    next.good = emptyQuantity(); return next;
  };
  const movements = input.stock_movements?.map(row);
  // Each old bucket had its own physical tray counts. Continue from their sum,
  // while leaving the original counted quantities visible in historical rows.
  if (movements) for (let i = movements.length - 1; i >= 0; i--) if (movements[i].category === "skm") {
    movements[i] = { ...movements[i], merged_trays_after: before.trays }; break;
  }
  return { ...input,
    productions: input.productions.map(row), pickups: input.pickups.map(row),
    sales: input.sales.map(s => s.items.some(i => i.category === "good") ? { ...s, items: s.items.map(row) } : s),
    ...(movements ? { stock_movements: movements } : {}),
    ...(input.inventory ? { inventory: counts(input.inventory) } : {}),
    ...(input.stock_check_context ? { stock_check_context: { ...input.stock_check_context, warehouse: counts(input.stock_check_context.warehouse), harvest: counts(input.stock_check_context.harvest) } } : {}),
    ...(input.stock_checks ? { stock_checks: input.stock_checks.map(c => ({ ...c,
      expected: { warehouse: counts(c.expected.warehouse), harvest: counts(c.expected.harvest) }, warehouse_actual: counts(c.warehouse_actual), harvest_actual: counts(c.harvest_actual),
      ...(c.status === "pending" ? { status: "rejected" as const, migration_invalidated_at: stamp, reviewed_at: stamp, reviewed_by: null, updated_at: stamp, review_reason: "Data lama sudah menjadi SKM. Periksa ulang jumlah per jenis sebelum disetujui." } : {}),
    })) } : {}),
  };
}
export function allEggStock(state: State): Record<Category, Quantity> {
  const quantities = emptyEggQuantities();
  for (const c of ALL_EGG_TYPES) quantities[c] = eggStock(state, c);
  return quantities;
}
/** Farm-wide history needs the full admin ledger: undo movements after the WIB day.
 * This preserves opening stock and posts deferred receipts on their actual receipt day. */
export function closingEggStock(state: State, category: Category, day: string, currentDay = today()): Pick<Quantity, "eggs" | "kg"> | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day > currentDay) return null;
  if (category === "good") return { eggs: 0, kg: 0 };
  state = normalizeFarmState(state);
  const { eggs, kg } = eggStock(state, category);
  if (day === currentDay) return { eggs, kg };
  if (!state.stock_movements) return null;
  const moves = state.stock_movements.filter(m => m.category === category);
  const origins = new Set(moves.filter(m => m.kind === "pickup" || m.kind === "production" || m.kind === "sale").map(m => m.reference_id));
  // A stock change without a ledger entry cannot safely be dated.
  const verified = moves.some(m => m.kind === "reconcile" &&
    (m.method === undefined || m.method === "count") && businessDate(m.date) <= day);
  if (!verified && (state.productions.some(p => p.category === category && isProductionStocked(p) && !origins.has(p.id)) ||
    state.pickups.some(p => p.category === category && !origins.has(p.id)) ||
    state.sales.some(s => s.stock_source === "warehouse" && s.items.some(i => i.category === category) && !origins.has(s.id)))) return null;
  const balance = { eggs, kg };
  for (const move of moves) if (businessDate(move.date) > day) {
    balance.eggs -= move.eggs;
    balance.kg = round(balance.kg - move.kg);
  }
  return balance.eggs < 0 || balance.kg < 0 ? null : balance;
}
export function pickupBalance(
  state: State,
  pickup: Pickup | string,
): PickupBalance {
  const p =
    typeof pickup === "string"
      ? state.pickups.find((row) => row.id === pickup)
      : pickup;
  if (!p) return { ...emptyQuantity(), status: "Dibawa" };
  const confirmed = state.pickup_balances?.[p.id];
  if (confirmed) return { ...confirmed };
  const sold = state.sales
    .flatMap((s) => s.items)
    .filter((item) => item.pickup_id === p.id)
    .reduce(
      (sum, item) => ({
        eggs: sum.eggs + item.eggs,
        kg: sum.kg + item.kg,
        trays: sum.trays + item.trays,
      }),
      emptyQuantity(),
    );
  const kg = round(p.kg - p.returned_kg - sold.kg);
  const eggs = p.eggs - p.returned_eggs - sold.eggs;
  const trays = Math.max(0, p.trays - p.returned_trays - sold.trays);
  const status =
    kg <= 0 && eggs <= 0
      ? p.returned_kg > 0 || p.returned_eggs > 0
        ? "Dikembalikan"
        : "Terjual"
      : sold.kg > 0 || sold.eggs > 0
        ? "Sebagian terjual"
        : "Dibawa";
  return { eggs, kg, trays, status };
}
export function feedStock(state: State, feedId: string): number {
  if (state.feed_inventory && feedId in state.feed_inventory)
    return state.feed_inventory[feedId];
  return round(
    state.feed_purchases
      .flatMap((p) => p.items)
      .filter((i) => i.feed_id === feedId)
      .reduce((sum, i) => sum + i.quantity, 0) -
      state.feed_usages
        .filter((u) => u.feed_id === feedId)
        .reduce((sum, u) => sum + u.quantity, 0),
  );
}
export function emptyState(): State {
  return {
    settings: { harvest_auto_stock: true },
    users: [],
    barns: [],
    productions: [],
    pickups: [],
    sales: [],
    prices: [],
    feeds: [],
    feed_purchases: [],
    feed_usages: [],
    notifications: [],
    activity: [],
    corrections: [],
    stock_movements: [],
    stock_checks: [],
    stock_check_assignments: [],
  };
}
export function visibleState(state: State, user: User | null): State {
  if (!user || accountAccessError(user)) return emptyState();
  state = normalizeFarmState(state);
  const checker = !!user.can_check_stock;
  const day = today();
  const since = new Date(`${day}T12:00:00Z`); since.setUTCDate(since.getUTCDate() - 29);
  const cutoff = since.toISOString().slice(0, 10);
  const canRead = (row: { user_id: string; date: string }) => row.user_id === user.id || (checker && businessDate(row.date) >= cutoff && businessDate(row.date) <= day);
  const context = user.role === "admin" || checker ? demoStockCheckContext(state, day, allEggStock(state)) : undefined;
  if (user.role === "admin")
    return {
      ...state,
      stock_check_context: context,
      notifications: state.notifications.filter((n) => n.user_id === user.id),
    };
  return {
    ...state,
    users: checker ? state.users.map(u => u.id === user.id ? u : { id: u.id, name: u.name, email: "", role: u.role, active: u.active, target: 0 }) : state.users.filter((u) => u.id === user.id),
    productions: state.productions.filter(canRead),
    pickups: state.pickups.filter((p) => p.user_id === user.id),
    sales: state.sales.filter(canRead),
    stock_check_context: context,
    stock_checks: state.stock_checks?.filter(c => c.user_id === user.id),
    stock_check_assignments: state.stock_check_assignments?.filter(a => a.user_id === user.id),
    notifications: state.notifications.filter((n) => n.user_id === user.id),
    corrections: state.corrections.filter((c) => c.user_id === user.id),
    stock_movements: state.stock_movements?.filter(
      (m) => m.user_id === user.id,
    ),
    activity: [],
    feed_purchases: [],
    feed_usages: state.feed_usages.filter((f) => f.user_id === user.id),
    inventory: allEggStock(state),
    feed_inventory: Object.fromEntries(
      state.feeds.map((f) => [f.id, feedStock(state, f.id)]),
    ),
  };
}

/** Legacy/manual users without registration_status are already approved. */
export function accountAccessError(user: User): string | null {
  if (user.deleted_at) return "Akun ini sudah dihapus. Hubungi admin.";
  if (user.registration_status === "pending")
    return "Pendaftaran Anda menunggu persetujuan admin.";
  if (user.registration_status === "rejected")
    return "Pendaftaran Anda ditolak. Hubungi admin peternakan.";
  if (!user.active) return "Akun Anda dinonaktifkan. Hubungi admin.";
  return null;
}

/** Demo-only public registration. The seeded demo already has its farm admin. */
export function registerDemoEmployee(
  input: State,
  payload: RegistrationInput,
  now = new Date(),
): { state: State; user: User; result: RegistrationResult } {
  assert(
    Object.keys(payload).every((key) =>
      [
        "name",
        "email",
        "username",
        "password",
        "password_confirmation",
        "setup_token",
      ].includes(key),
    ),
    "Peran dan status akun ditentukan oleh sistem.",
  );
  const name = requiredText(payload.name, "Nama");
  assert(Array.from(name).length <= 120, "Nama maksimal 120 karakter.");
  const email = requiredText(payload.email, "Email").toLowerCase();
  assert(
    email.length <= 190 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
    "Format email tidak valid.",
  );
  assert(
    !input.users.some((u) => u.email.toLowerCase() === email),
    "Email sudah digunakan.",
  );
  assert(typeof payload.password === "string", "Kata sandi wajib diisi.");
  const passwordBytes = new TextEncoder().encode(payload.password).length;
  assert(
    Array.from(payload.password).length >= 12 &&
      passwordBytes <= 72 &&
      !payload.password.includes("\0"),
    "Kata sandi minimal 12 karakter dan maksimal 72 byte, tanpa karakter null.",
  );
  assert(
    payload.password === payload.password_confirmation,
    "Konfirmasi kata sandi tidak sesuai.",
  );
  assert(
    input.users.some((u) => u.role === "admin"),
    "Admin demo belum tersedia. Muat ulang data demo.",
  );

  const state = structuredClone(input);
  state.users = withUsernames(state.users);
  const stamp = now.toISOString();
  const newUser: User = {
    id: `signup-${now.getTime()}-${state.users.length + 1}`,
    name,
    email,
    username: assignUsername(state.users, email, Object.hasOwn(payload, "username") ? payload.username : undefined),
    role: "employee",
    active: false,
    registration_status: "pending",
    target: 0,
  };
  state.users.push(newUser);
  for (const recipient of state.users.filter(
    (u) => u.role === "admin" && !accountAccessError(u),
  )) {
    state.notifications.push({
      id: `signup-notification-${newUser.id}-${recipient.id}`,
      user_id: recipient.id,
      title: "Pendaftaran karyawan baru",
      message: `${name} (${email}) menunggu persetujuan Anda. Buka menu Karyawan untuk meninjau.`,
      created_at: stamp,
      read: false,
    });
  }
  state.activity.unshift({
    id: `signup-activity-${newUser.id}`,
    user_id: newUser.id,
    action: "user.register",
    description: `${name} mendaftar sebagai karyawan dan menunggu persetujuan admin.`,
    created_at: stamp,
    after: structuredClone(newUser),
  });
  return {
    state,
    user: newUser,
    result: {
      status: "pending",
      username: newUser.username,
      message:
        "Pendaftaran berhasil. Akun Anda menunggu persetujuan admin sebelum dapat masuk.",
    },
  };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function numeric(
  value: unknown,
  name: string,
  positive = false,
  integer = false,
  maximum = 1_000_000_000,
): number {
  assert(
    value !== "" &&
      value !== null &&
      value !== undefined &&
      typeof value !== "boolean",
    `${name} wajib diisi.`,
  );
  const n = Number(value);
  assert(
    Number.isFinite(n) && (positive ? n > 0 : n >= 0),
    `${name} harus berupa angka ${positive ? "lebih dari nol" : "nol atau lebih"}.`,
  );
  assert(n <= maximum, `${name} terlalu besar.`);
  if (integer) assert(Number.isInteger(n), `${name} harus bilangan bulat.`);
  else
    assert(
      Math.abs(n * 1000 - Math.round(n * 1000)) < 0.00001,
      `${name} maksimal 3 angka desimal.`,
    );
  return n;
}
function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim().slice(0, 10000) : fallback;
}
function requiredText(value: unknown, name: string): string {
  const valueText = text(value);
  assert(valueText, `${name} wajib diisi.`);
  return valueText;
}
function boundedName(value: unknown, label: string, maximum: number): string {
  const name = requiredText(value, label);
  assert(Array.from(name).length <= maximum, `${label} maksimal ${maximum} karakter.`);
  return name;
}
function stockCountQuantity(value: unknown): StockCountQuantity {
  assert(value && typeof value === "object" && !Array.isArray(value), "Jumlah stok tidak valid.");
  const input = value as CommandPayload;
  for (const field of ["eggs", "kg", ...(Object.hasOwn(input, "trays") ? ["trays"] : [])]) {
    const measure = input[field];
    assert(typeof measure === "number" || (typeof measure === "string" && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(measure.trim())),
      "Isi jumlah stok menggunakan angka.");
  }
  const eggs = numeric(input.eggs, "Jumlah butir", false, true, 1_000_000_000_000);
  const kg = round(numeric(input.kg, "Berat aktual", false, false, 999_999_999_999.999));
  return Object.hasOwn(input, "trays")
    ? { eggs, kg, trays: numeric(input.trays, "Jumlah krat", false, true, 1_000_000_000_000) }
    : { eggs, kg };
}
function photo(value: unknown): string {
  if (value === undefined || value === "") return "";
  assert(
    typeof value === "string" && value.length <= 1398130,
    "Foto maksimal 1 MB.",
  );
  const match =
    /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  assert(match, "Foto harus berupa gambar JPEG, PNG, atau WebP.");
  let bytes: string;
  try {
    bytes = atob(match[2]);
  } catch {
    throw new Error("Data foto tidak valid.");
  }
  assert(btoa(bytes) === match[2], "Data foto tidak valid.");
  assert(bytes.length <= 1048576, "Foto maksimal 1 MB setelah dikompres.");
  const valid =
    match[1] === "jpeg"
      ? bytes.startsWith("\xff\xd8\xff")
      : match[1] === "png"
        ? bytes.startsWith("\x89PNG\r\n\x1a\n")
        : bytes.startsWith("RIFF") && bytes.slice(8, 12) === "WEBP";
  assert(valid, "Isi foto tidak sesuai dengan format JPEG, PNG, atau WebP.");
  return value;
}
function category(value: unknown): Category {
  assert(
    isEggType(value),
    "Pilih kategori telur yang valid.",
  );
  return canonicalEggType(value);
}
function newCategory(value: unknown): Category {
  assert(isEggType(value), "Pilih Telur SKM, SKM Baru, atau Bentes.");
  return canonicalEggType(value);
}

function farmNotice(activity: FarmActivity, name: string, kg: number) {
  const first = name.trim().split(/\s+/u)[0];
  const who = /^\p{L}[\p{L}\p{M}.'’\-]*$/u.test(first)
    ? Array.from(first).slice(0, 32).join("")
    : "Petugas";
  const weight = number(kg, 3) + " kg telur";
  switch (activity) {
    case "sale.create": return { title: "Penjualan telur", message: `${who} menjual ${weight}.` };
    case "production.create": return { title: "Panen tercatat", message: `${who} mencatat panen ${weight}.` };
    case "production.stocked": return { title: "Panen masuk gudang", message: `${who} mencatat panen ${weight} yang langsung masuk gudang.` };
    case "production.receive": return { title: "Panen diterima di gudang", message: `${who} menerima ${weight} dari panen.` };
    case "pickup.return": return { title: "Telur kembali ke gudang", message: `${who} mengembalikan ${weight} ke gudang.` };
    case "stock.add": return {
      title: "Stok gudang bertambah",
      message: kg > 0 ? `${who} menambahkan ${weight} ke gudang.` : `${who} menambah persediaan di gudang.`,
    };
  }
}
function quantities(p: CommandPayload): Quantity {
  return {
    eggs: numeric(p.eggs, "Jumlah butir", true, true),
    kg: numeric(p.kg, "Berat aktual", true),
    trays: numeric(p.trays ?? 0, "Jumlah krat", false, true),
  };
}
function dateValue(value: unknown, now: Date): string {
  const date = requiredText(value, "Tanggal");
  assert(
    /^\d{4}-\d{2}-\d{2}(T.*)?$/.test(date) &&
      Number.isFinite(new Date(normalizeDateTime(date)).getTime()),
    "Tanggal tidak valid.",
  );
  const day = date.slice(0, 10);
  assert(day <= today(now), "Tanggal transaksi tidak boleh di masa depan.");
  const check = new Date(`${day}T12:00:00Z`);
  assert(check.toISOString().slice(0, 10) === day, "Tanggal tidak valid.");
  return date;
}
function find<T extends { id: string }>(
  list: T[],
  id: unknown,
  label: string,
): T {
  const row = list.find((r) => r.id === String(id));
  assert(row, `${label} tidak ditemukan.`);
  return row;
}
function own(user: User, row: { user_id: string }): void {
  assert(
    user.role === "admin" || row.user_id === user.id,
    "Anda tidak memiliki akses ke data ini.",
  );
}
function admin(user: User): void {
  assert(user.role === "admin", "Tindakan ini hanya untuk admin.");
}
function completeBalance(eggs: number, kg: number): void {
  assert(
    (eggs === 0) === (round(kg) === 0),
    "Jika seluruh telur habis, jumlah butir dan berat harus dihabiskan bersama.",
  );
}
/** Call before replacing the sale, while eggStock still reflects the previous quantities. */
function postWarehouseSale(state: State, sale: Sale, previous: Sale | undefined, now: Date, notes: string) {
  state.stock_movements ??= [];
  const stamp = now.toISOString();
  for (const category of ALL_EGG_TYPES) {
    const prior = previous ? soldQuantity(previous.items, category) : emptyQuantity();
    const next = soldQuantity(sale.items, category);
    const eggs = prior.eggs - next.eggs;
    const kg = round(prior.kg - next.kg);
    const trays = prior.trays - next.trays;
    if (!eggs && !kg && !trays) continue;
    const stock = eggStock(state, category);
    const remainingKg = round(stock.kg + kg);
    assert(stock.eggs + eggs >= 0 && remainingKg >= 0 && stock.trays + trays >= 0,
      "Jumlah penjualan melebihi stok yang tersedia di gudang.");
    completeBalance(stock.eggs + eggs, remainingKg);
    state.stock_movements.push({
      id: `movement-${sale.id}-${category}-${state.stock_movements.length}`,
      reference_id: sale.id, category, eggs, kg, trays,
      user_id: sale.user_id, date: previous ? stamp : sale.date, created_at: stamp,
      kind: previous ? "correction" : "sale",
      notes,
    });
  }
}
function totalAmount(value: number): number {
  assert(
    Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000_000_000,
    "Total transaksi melebihi batas nominal yang didukung.",
  );
  return value;
}
export function isFreeSaleItem(
  item: Pick<SaleItem, "category" | "unit_price">,
): boolean {
  return item.category === "cracked" && item.unit_price === 0;
}
function list(value: unknown): CommandPayload[] {
  assert(
    Array.isArray(value) && value.length > 0 && value.length <= 100,
    "Tambahkan minimal satu item, maksimal 100.",
  );
  assert(
    value.every(
      (v) => typeof v === "object" && v !== null && !Array.isArray(v),
    ),
    "Item tidak valid.",
  );
  return value as CommandPayload[];
}
function record(state: State, entity: unknown, id: unknown) {
  assert(
    entity === "production" || entity === "pickup" || entity === "sale",
    "Jenis data tidak valid.",
  );
  return find(
    entity === "production"
      ? state.productions
      : entity === "pickup"
        ? state.pickups
        : (state.sales as Array<State["productions"][number] | Pickup | Sale>),
    id,
    "Data",
  );
}
function checkStock(state: State): void {
  for (const c of ALL_EGG_TYPES) {
    const stock = eggStock(state, c);
    assert(
      stock.eggs >= 0 && stock.kg >= 0,
      "Koreksi membuat stok gudang negatif. Periksa telur yang sudah diambil.",
    );
    completeBalance(stock.eggs, stock.kg);
  }
}
function checkPickup(state: State, pickup: Pickup): void {
  const balance = pickupBalance(state, pickup);
  assert(
    balance.eggs >= 0 && balance.kg >= 0,
    "Koreksi melebihi sisa pengambilan atau lebih kecil dari telur yang sudah terjual dan dikembalikan.",
  );
  completeBalance(balance.eggs, balance.kg);
}
function correct(
  state: State,
  user: User,
  payload: CommandPayload,
  now: Date,
): { before: unknown; after: unknown } {
  const row = record(state, payload.entity, payload.id);
  own(user, row);
  const reason = requiredText(payload.reason, "Alasan koreksi");
  assert(reason.length >= 5, "Alasan koreksi minimal 5 karakter.");
  assert(
    user.role === "admin" || (payload.entity === "production" && !row.locked),
    "Data ini harus diajukan kepada admin untuk dikoreksi.",
  );
  assert(
    payload.changes &&
      typeof payload.changes === "object" &&
      !Array.isArray(payload.changes),
    "Perubahan wajib diisi.",
  );
  const changes = payload.changes as CommandPayload;
  const allowed =
    payload.entity === "production"
      ? ["eggs", "kg", "trays", "notes"]
      : payload.entity === "sale"
        ? ["notes", "customer", "items"]
        : ["eggs", "kg", "trays", "notes", "area"];
  assert(
    Object.keys(changes).length > 0 &&
      Object.keys(changes).every((k) => allowed.includes(k)),
    "Koreksi hanya boleh mengubah kolom yang diizinkan. Harga dan pembayaran tidak dapat diubah.",
  );
  const before = structuredClone(row);
  for (const [key, value] of Object.entries(changes)) {
    if (["eggs", "kg", "trays"].includes(key))
      (row as unknown as CommandPayload)[key] = numeric(
        value,
        key === "eggs"
          ? "Jumlah butir"
          : key === "kg"
            ? "Berat aktual"
            : "Jumlah krat",
        key !== "trays" && !(payload.entity === "production" && user.role === "admin"),
        key !== "kg",
      );
    else if (key === "items") {
      const sale = row as Sale;
      const items = list(value);
      assert(
        items.length === sale.items.length,
        "Koreksi harus mencakup semua item lama tanpa menambah atau menghapus item.",
      );
      const seen = new Set<string>();
      const updated = items.map((item) => {
        assert(
          Object.keys(item).every((field) =>
            ["id", "eggs", "kg", "trays"].includes(field),
          ),
          "Harga, kategori, dan sumber pengambilan item tidak dapat diubah.",
        );
        const itemId = requiredText(item.id, "ID item");
        assert(!seen.has(itemId), "ID item koreksi tidak boleh berulang.");
        seen.add(itemId);
        const old = sale.items.find((original) => original.id === itemId);
        assert(old, "Item koreksi tidak ditemukan pada transaksi ini.");
        const q = quantities(item);
        const updatedItem = { ...old, ...q, total: Math.round(q.kg * old.unit_price) };
        if (q.eggs !== old.eggs) delete updatedItem.eggs_estimated;
        return updatedItem;
      });
      const total = totalAmount(
        updated.reduce((sum, item) => sum + item.total, 0),
      );
      assert(
        total >= sale.paid,
        "Total koreksi lebih kecil dari pembayaran yang sudah diterima. Pengembalian dana belum tersedia; rekonsiliasi pembayaran diperlukan sebelum koreksi ini.",
      );
      if (sale.stock_source === "warehouse")
        postWarehouseSale(state, { ...sale, items: updated }, sale, now, `Koreksi penjualan oleh ${user.name}: ${reason}`);
      sale.items = sale.items.map((old) =>
        updated.find((item) => item.id === old.id)!,
      );
      sale.total = total;
      sale.balance = total - sale.paid;
      sale.payment_status =
        sale.balance === 0 ? "paid" : sale.paid > 0 ? "partial" : "unpaid";
    } else if (payload.entity === "sale" && key === "customer") {
      (row as Sale).customer = boundedName(value, (row as Sale).items.some(isFreeSaleItem) ? "Nama penerima telur gratis" : "Nama pelanggan", 190);
    } else (row as unknown as CommandPayload)[key] = text(value);
  }
  if (payload.entity === "pickup") checkPickup(state, row as Pickup);
  if (payload.entity === "sale" && (row as Sale).stock_source !== "warehouse") {
    const sale = row as Sale;
    for (const pickupId of new Set(sale.items.map((item) => item.pickup_id))) {
      const pickup = find(state.pickups, pickupId, "Pengambilan");
      assert(
        pickup.user_id === sale.user_id,
        "Pemilik pengambilan berbeda dengan transaksi.",
      );
      checkPickup(state, pickup);
    }
  }
  if (payload.entity === "production") {
    const production = row as Production;
    assert((production.eggs > 0 && production.kg > 0) || (user.role === "admin" && production.eggs === 0 && production.kg === 0 && production.trays === 0),
      "Untuk membatalkan panen yang keliru, isi butir, berat, dan krat dengan 0.");
  }
  checkStock(state);
  return {
    before,
    after: {
      ...row,
      correction_reason: reason,
      corrected_at: now.toISOString(),
    },
  };
}

/** Pure transactional command engine used exclusively in the clearly marked demo. CI3 repeats validation on the server. */
export function executeCommand(
  input: State,
  userId: string,
  action: string,
  payload: CommandPayload,
  now = new Date(),
): State {
  const state: State = structuredClone(normalizeFarmState(input, now.toISOString()));
  state.users = withUsernames(state.users);
  delete state.command_result;
  delete state.inventory;
  delete state.feed_inventory;
  delete state.stock_check_context;
  const user = find(state.users, userId, "Pengguna");
  const accessError = accountAccessError(user);
  assert(!accessError, accessError || "Akun tidak dapat digunakan.");
  const stamp = now.toISOString();
  let sequence =
    state.activity.length +
    state.productions.length +
    state.sales.length +
    state.pickups.length;
  // Several saves can share a clock tick (and tests use a fixed clock). Continue
  // after existing IDs so repeated equal-price updates remain distinct events.
  const suffix = new RegExp(`-${now.getTime()}-(\\d+)$`);
  for (const rows of Object.values(state)) if (Array.isArray(rows)) {
    for (const row of rows) {
      const match = typeof row?.id === "string" ? row.id.match(suffix) : null;
      if (match) sequence = Math.max(sequence, Number(match[1]));
    }
  }
  const id = (prefix: string) => `${prefix}-${now.getTime()}-${++sequence}`;
  const invoice = (prefix: string, count: number) =>
    `${prefix}-${today(now).replaceAll("-", "")}-${String(count + 1).padStart(4, "0")}`;
  let detail: { before?: unknown; after?: unknown } = {};
  let farmEvent: { activity: FarmActivity; kg: number } | undefined;
  switch (action) {
    case "stock_check.submit":
    case "stock_check.review":
      detail = applyDemoStockCheck(state, user, action, payload,
        demoStockCheckContext(state, today(now), allEggStock(state)), stamp, id);
      break;
    case "production.create": {
      const entries = payload.items === undefined ? [payload] : list(payload.items);
      assert(entries.length <= NEW_EGG_TYPES.length, "Satu panen maksimal tiga jenis telur.");
      assert(new Set(entries.map(item => category(item.category))).size === entries.length, "Kategori telur tidak boleh berulang.");
      const barnId = text(payload.barn_id);
      if (barnId) find(state.barns, barnId, "Kandang");
      const harvestId = id("harvest");
      const common = {
        harvest_id: harvestId,
        date: dateValue(payload.date, now),
        user_id: user.id,
        barn_id: barnId,
        notes: text(payload.notes),
        photo: photo(payload.photo),
        location: text(payload.location),
        created_at: stamp,
        locked: false,
        stocked_at: state.settings?.harvest_auto_stock === false ? null : stamp,
        ...(state.settings?.harvest_auto_stock === false ? {} : { stocked_by: user.id }),
      };
      const records = entries.map(item => ({ ...common, id: id("prod"), category: newCategory(item.category), ...quantities(item) }));
      state.productions.push(...records);
      farmEvent = { activity: common.stocked_at ? "production.stocked" : "production.create", kg: records.reduce((sum, p) => sum + p.kg, 0) };
      break;
    }
    case "stock.classify":
      throw new Error("Semua stok bagus lama sudah menjadi SKM. Muat ulang aplikasi.");
    case "stock.reconcile": {
      admin(user);
      const method = payload.method === undefined ? "count" : payload.method;
      assert(method === "count" || method === "add" || method === "subtract", "Pilih cara penyesuaian stok.");
      const items = list(payload.items);
      assert(items.length <= NEW_EGG_TYPES.length && new Set(items.map(item => category(item.category))).size === items.length,
        "Setiap kategori telur hanya boleh dihitung sekali.");
      const reason = boundedName(payload.reason, "Alasan penyesuaian", 2000);
      const reference = id("count");
      state.stock_movements ??= [];
      const counts = items.map(item => {
        const c = category(item.category);
        const before = eggStock(state, c);
        const expected = stockCountQuantity(item.expected);
        const physical = stockCountQuantity(item.physical);
        completeBalance(physical.eggs, physical.kg);
        assert((expected.trays === undefined) === (physical.trays === undefined),
          "Sertakan jumlah krat sebelum dan sesudah penyesuaian.");
        if (expected.eggs !== before.eggs || expected.kg !== before.kg ||
            (expected.trays !== undefined && expected.trays !== before.trays)) {
          throw new ApiError("Stok berubah saat dihitung. Cek stok terbaru, lalu cocokkan lagi.", 409);
        }
        const eggs = physical.eggs - expected.eggs;
        const kg = round(physical.kg - expected.kg);
        const trays = (physical.trays ?? 0) - (expected.trays ?? 0);
        if (method === "add" || method === "subtract") {
          const differences = [eggs, kg, trays];
          assert(differences.some(n => n !== 0), "Isi jumlah yang ingin disesuaikan.");
          assert(method === "add" ? differences.every(n => n >= 0) : differences.every(n => n <= 0),
            "Jumlah akhir tidak sesuai dengan jenis penyesuaian.");
        }
        return { category: c, expected, physical, eggs, kg, trays };
      });
      for (const count of counts) {
        state.stock_movements.push({
          id: `${reference}-${count.category}`, reference_id: reference, kind: "reconcile",
          date: stamp, created_at: stamp, user_id: user.id, method, ...count,
          notes: reason,
        });
      }
      detail.after = { id: reference, counts, reason, method };
      if (method === "add") farmEvent = { activity: "stock.add", kg: counts.reduce((sum, item) => sum + item.kg, 0) };
      break;
    }
    case "production.receive": {
      assert(Object.keys(payload).every((key) => key === "id"), "Penerimaan hanya membutuhkan ID panen.");
      const production = find(state.productions, payload.id, "Panen");
      own(user, production);
      assert(!isProductionStocked(production), "Panen ini sudah masuk stok gudang.");
      production.stocked_at = stamp;
      production.stocked_by = user.id;
      farmEvent = { activity: "production.receive", kg: production.kg };
      detail = { after: { production_id: production.id, stocked_at: stamp, stocked_by: user.id } };
      break;
    }
    case "settings.update": {
      admin(user);
      assert(Object.keys(payload).every((key) => key === "harvest_auto_stock") && typeof payload.harvest_auto_stock === "boolean", "Pilihan stok otomatis harus berupa aktif atau nonaktif.");
      detail.before = { harvest_auto_stock: state.settings?.harvest_auto_stock !== false };
      state.settings = { harvest_auto_stock: payload.harvest_auto_stock };
      detail.after = { ...state.settings };
      break;
    }
    case "pickup.create": {
      const q = quantities(payload);
      const c = newCategory(payload.category);
      const stock = eggStock(state, c);
      assert(
        q.eggs <= stock.eggs && q.kg <= stock.kg,
        `Stok tidak cukup. Tersedia ${number(stock.eggs)} butir / ${number(stock.kg, 3)} kg.`,
      );
      completeBalance(stock.eggs - q.eggs, stock.kg - q.kg);
      state.pickups.push({
        id: id("pickup"),
        date: dateValue(payload.date, now),
        user_id: user.id,
        category: c,
        ...q,
        area: requiredText(payload.area, "Area penjualan"),
        notes: text(payload.notes),
        returned_eggs: 0,
        returned_kg: 0,
        returned_trays: 0,
        created_at: stamp,
        locked: false,
      });
      break;
    }
    case "pickup.return": {
      const p = find(state.pickups, payload.id, "Pengambilan");
      own(user, p);
      const q = quantities(payload);
      const balance = pickupBalance(state, p);
      assert(
        q.eggs <= balance.eggs && q.kg <= balance.kg,
        "Retur melebihi sisa telur yang belum terjual.",
      );
      completeBalance(balance.eggs - q.eggs, balance.kg - q.kg);
      p.returned_eggs += q.eggs;
      p.returned_kg = round(p.returned_kg + q.kg);
      p.returned_trays += q.trays;
      farmEvent = { activity: "pickup.return", kg: q.kg };
      detail = { after: { pickup_id: p.id, ...q, notes: text(payload.notes) } };
      break;
    }
    case "sale.create": {
      const source = payload.stock_source === undefined ? "pickup" : payload.stock_source;
      assert(source === "pickup" || source === "warehouse", "Pilih sumber stok penjualan.");
      const price = activePrice(state, now);
      assert(price, "Admin belum menetapkan harga telur yang berlaku.");
      assert(
        payload.expected_price_id === undefined ||
          payload.expected_price_id === price.id,
        "Harga telur telah berubah. Periksa harga terbaru lalu simpan kembali.",
      );
      const entries = list(payload.items);
      const stockGroups = new Map<string, SaleItem[]>();
      const items = entries.map((item) => {
        const c = category(item.category);
        const count = saleEggCount(item.eggs);
        const kg = numeric(item.kg, "Berat aktual", true, false, 1_000_000);
        assert(kg >= 0.001, "Berat aktual minimal 0,001 kg.");
        const trays = numeric(item.trays ?? 0, "Jumlah krat", false, true, 1_000_000);
        let pickupId = "";
        if (source === "warehouse") {
          assert(item.pickup_id === undefined || item.pickup_id === "",
            "Penjualan dari gudang tidak dapat menggunakan pengambilan.");
        } else {
          const p = find(state.pickups, item.pickup_id, "Pengambilan");
          assert(p.user_id === user.id, "Penjualan hanya boleh menggunakan pengambilan milik Anda.");
          assert(c === p.category, "Kategori penjualan harus sesuai pengambilan.");
          pickupId = p.id;
        }
        assert(
          item.is_free === undefined || typeof item.is_free === "boolean",
          "Pilihan gratis tidak valid.",
        );
        assert(
          !item.is_free || c === "cracked",
          "Hanya telur bentes yang boleh diberikan gratis.",
        );
        assert(
          !item.is_free || price.cracked_price === 0 || user.role === "admin",
          "Hanya atasan yang bisa memberikan telur bentes gratis. Gunakan harga yang berlaku.",
        );
        const is_free =
          c === "cracked" &&
          (item.is_free === true || price.cracked_price === 0);
        const unit_price = is_free ? 0 : eggTypePrice(price, c);
        assert(unit_price !== undefined, `Harga ${eggTypeLabel(c)} belum diatur oleh atasan.`);
        const line: SaleItem = {
          id: id("item"),
          pickup_id: pickupId,
          category: c,
          eggs: count ?? 0,
          ...(count === undefined ? { eggs_estimated: true } : {}),
          kg,
          trays,
          unit_price,
          is_free,
          total: Math.round(kg * unit_price),
        };
        const key = source === "warehouse" ? c : pickupId;
        const group = stockGroups.get(key);
        if (group) group.push(line);
        else stockGroups.set(key, [line]);
        return line;
      });
      for (const [key, group] of stockGroups) {
        const available = source === "warehouse" ? eggStock(state, group[0].category) : pickupBalance(state, key);
        const counts = resolveSaleEggs(group.map(i => ({ eggs: i.eggs_estimated ? undefined : i.eggs, kg: i.kg })), available);
        group.forEach((line, index) => { line.eggs = counts[index]; });
        if (source === "pickup") {
          const used = soldQuantity(group, group[0].category);
          assert(used.eggs <= available.eggs && used.kg <= available.kg, "Jumlah penjualan melebihi sisa telur yang dibawa.");
          completeBalance(available.eggs - used.eggs, available.kg - used.kg);
        }
      }
      const total = totalAmount(items.reduce((sum, i) => sum + i.total, 0));
      const paid = numeric(payload.paid ?? 0, "Nominal dibayar", false, true);
      assert(paid <= total, "Pembayaran tidak boleh melebihi total transaksi.");
      const method = payload.payment_method;
      assert(
        method === "cash" ||
          method === "transfer" ||
          method === "qris" ||
          method === "credit",
        "Metode pembayaran tidak valid.",
      );
      const customer = boundedName(payload.customer, items.some(isFreeSaleItem) ? "Nama penerima telur gratis" : "Nama pelanggan", 190);
      const documentation = photo(payload.photo);
      assert(documentation !== "", "Foto dokumentasi penjualan wajib diisi.");
      const saleDate = dateValue(payload.date, now);
      const sale: Sale = {
        id: id("sale"),
        number: invoice("TRX", state.sales.length),
        date: saleDate,
        due_date: dueDate(payload.due_date, businessDate(saleDate)),
        payments: paid ? [paymentEntry("initial", paid, stamp, user.id, method === "credit" ? undefined : method)] : [],
        user_id: user.id,
        stock_source: source,
        customer,
        phone: text(payload.phone),
        items,
        total,
        paid,
        balance: total - paid,
        payment_method: total === 0 ? "cash" : method,
        payment_status:
          paid === total ? "paid" : paid > 0 ? "partial" : "unpaid",
        notes: text(payload.notes),
        photo: documentation,
        created_at: stamp,
        locked: true,
      };
      if (source === "warehouse") postWarehouseSale(state, sale, undefined, now, `Penjualan gudang ${sale.number}`);
      state.sales.push(sale);
      farmEvent = { activity: "sale.create", kg: items.reduce((sum, item) => sum + item.kg, 0) };
      break;
    }
    case "sale.due":
    case "feed.due":
    case "feed.payment":
    case "sale.payment": {
      const isFeed = action.startsWith("feed.");
      if (isFeed) admin(user);
      const record = isFeed ? find(state.feed_purchases, payload.id, "Pembelian pakan") : find(state.sales, payload.id, "Penjualan");
      own(user, record);
      if (action.endsWith(".due")) assert(record.balance > 0, "Nota ini sudah lunas.");
      detail.before = { id: record.id, number: record.number, paid: record.paid, balance: record.balance, due_date: record.due_date ?? null };
      if (action.endsWith(".due")) {
        const due = dueDate(payload.due_date, businessDate(record.date));
        assert(due, "Isi tanggal jatuh tempo.");
        record.due_date = due;
        detail.after = { id: record.id, due_date: due };
        break;
      }
      if (isFeed || payload.expected_paid !== undefined)
        assert(numeric(payload.expected_paid, "Pembayaran sebelumnya", false, true) === record.paid, "Pembayaran sudah berubah. Buka kembali nota dan periksa riwayatnya.");
      const amount = numeric(payload.amount, "Pembayaran", true, true);
      assert(amount <= record.balance, "Pembayaran melebihi sisa tagihan.");
      const entry = paymentEntry("installment", amount, stamp, user.id, payload.method);
      (record.payments ??= []).push(entry);
      record.paid += amount;
      record.balance = record.total - record.paid;
      if ("payment_status" in record) record.payment_status = record.balance === 0 ? "paid" : "partial";
      detail.after = { id: record.id, number: record.number, paid: record.paid, balance: record.balance, payment: entry };
      break;
    }
    case "price.create": {
      admin(user);
      assert(Object.keys(payload).every(key => ["good_price", "cracked_price", "effective_at"].includes(key)), "Perbarui aplikasi. SKM dan SKM Baru sekarang memakai satu harga Telur Bagus.");
      const good_price = numeric(payload.good_price, "Harga Telur Bagus", true, true, 10000000);
      const cracked_price = numeric(
        payload.cracked_price,
        "Harga telur bentes",
        false,
        true,
      );
      const effective_at = normalizeDateTime(
        requiredText(payload.effective_at, "Waktu mulai berlaku"),
      );
      assert(
        Number.isFinite(new Date(effective_at).getTime()),
        "Waktu mulai berlaku tidak valid.",
      );
      const effectiveDay = effective_at.slice(0, 10);
      assert(
        new Date(`${effectiveDay}T12:00:00Z`).toISOString().slice(0, 10) ===
          effectiveDay,
        "Tanggal mulai berlaku tidak valid.",
      );
      state.prices.push({
        id: id("price"),
        pricing_mode: "shared_good",
        good_price,
        skm_price: good_price,
        skm_new_price: good_price,
        cracked_price,
        effective_at,
        created_at: stamp,
        created_by: user.id,
      });
      for (const u of state.users.filter((u) => u.active))
        state.notifications.push({
          id: id("notif"),
          user_id: u.id,
          title:
            new Date(effective_at) > now
              ? "Harga telur dijadwalkan"
              : "Harga telur diperbarui",
          message: `Mulai ${dateLabel(effective_at, true)}, Telur Bagus (SKM dan SKM Baru) ${money(good_price)}/kg dan Telur Bentes ${cracked_price === 0 ? "Gratis" : money(cracked_price) + "/kg"}.`,
          read: false,
          created_at: stamp,
        });
      break;
    }
    case "profile.update": {
      assert(
        Object.keys(payload).every((key) => key === "name" || key === "photo" || key === "username"),
        "Profil hanya dapat mengubah nama, username, dan foto.",
      );
      assert(
        typeof payload.name === "string" &&
          payload.name.trim().length > 0 &&
          Array.from(payload.name.trim()).length <= 120,
        "Nama wajib diisi dan maksimal 120 karakter.",
      );
      const profile = state.users.find((u) => u.id === user.id)!;
      const before = { name: profile.name, username: profile.username };
      profile.name = payload.name.trim();
      if (Object.hasOwn(payload, "username")) profile.username = assignUsername(state.users, profile.email, payload.username, profile.id);
      if (Object.hasOwn(payload, "photo")) profile.photo = photo(payload.photo);
      detail = {
        before,
        after: {
          name: profile.name,
          username: profile.username,
          photo_changed: Object.hasOwn(payload, "photo"),
        },
      };
      break;
    }
    case "user.create": {
      admin(user);
      assert(Object.keys(payload).every(key => ["name","email","username","password","password_confirmation","role","target"].includes(key)), "Kolom akun tidak didukung.");
      const email = requiredText(payload.email, "Email").toLowerCase();
      assert(
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
        "Format email tidak valid.",
      );
      assert(
        !state.users.some((u) => u.email.toLowerCase() === email),
        "Email sudah digunakan.",
      );
      validateAccountPassword(payload.password,payload.password_confirmation);
      const role = payload.role;
      assert(role === "admin" || role === "employee", "Peran tidak valid.");
      state.users.push({
        id: id("user"),
        name: requiredText(payload.name, "Nama"),
        email,
        username: assignUsername(state.users, email, Object.hasOwn(payload, "username") ? payload.username : undefined),
        role,
        active: true,
        registration_status: "approved",
        target: numeric(payload.target ?? 0, "Target penjualan"),
      });
      break;
    }
    case "user.update": {
      admin(user);
      const u = find(state.users, payload.id, "Karyawan");
      assert(
        Object.keys(payload).every((key) => ["id", "name", "email", "username", "photo", "target", "active", "role", "password", "password_confirmation", "can_check_stock"].includes(key)),
        "Kolom ini tidak dapat diubah lewat pengaturan akun.",
      );
      assert(!u.deleted_at, "Akun ini sudah dihapus dan tidak dapat diubah.");
      const safeIdentity = ({ id, name, email, username, role, active, target, registration_status, is_superadmin, deleted_at, can_check_stock }: User) => ({ id, name, email, username, role, active, target, registration_status, is_superadmin, deleted_at, can_check_stock });
      detail.before = safeIdentity(u);
      const passwordChanged = Object.hasOwn(payload, "password") || Object.hasOwn(payload, "password_confirmation");
      if (passwordChanged) {
        assert(!u.is_superadmin, "Kata sandi superadmin dilindungi dan tidak dapat diganti.");
        validateNewPassword(payload.password, payload.password_confirmation);
      }
      if (Object.hasOwn(payload, "role")) {
        assert(payload.role === "admin" || payload.role === "employee", "Peran tidak valid.");
        assert(!u.is_superadmin || payload.role === "admin", "Peran superadmin tidak dapat diubah.");
        assert(u.registration_status !== "pending" && u.registration_status !== "rejected", "Setujui pendaftaran sebelum mengubah peran.");
        assert(payload.role !== "employee" || u.role !== "admin" || state.users.some(a => a.id !== u.id && a.role === "admin" && !accountAccessError(a)), "Minimal satu atasan harus aktif.");
        u.role = payload.role;
      }
      if (Object.hasOwn(payload, "active")) {
        assert(typeof payload.active === "boolean", "Status akun tidak valid.");
        assert(!u.is_superadmin || payload.active, "Superadmin tidak dapat dinonaktifkan.");
        assert(
          !payload.active ||
            (u.registration_status !== "pending" &&
              u.registration_status !== "rejected"),
          "Gunakan persetujuan pendaftaran untuk akun ini.",
        );
        assert(
          payload.active || u.id !== user.id,
          "Anda tidak dapat menonaktifkan akun sendiri.",
        );
        assert(
          payload.active ||
            u.role !== "admin" ||
            state.users.filter((a) => a.role === "admin" && !accountAccessError(a)).length >
              1,
          "Admin terakhir tidak dapat dinonaktifkan.",
        );
        u.active = payload.active;
      }
      if (Object.hasOwn(payload, "name"))
        u.name = boundedName(payload.name, "Nama", 120);
      if (Object.hasOwn(payload, "email")) {
        const email = requiredText(payload.email, "Email").toLowerCase();
        assert(email.length <= 190 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), "Format email tidak valid.");
        assert(!state.users.some((member) => member.id !== u.id && member.email.toLowerCase() === email), "Email sudah digunakan.");
        u.email = email;
      }
      if (Object.hasOwn(payload, "username")) {
        u.username = assignUsername(state.users, u.email, payload.username, u.id);
      }
      if (Object.hasOwn(payload, "photo")) {
        assert(typeof payload.photo === "string", "Foto harus berupa gambar JPEG, PNG, atau WebP.");
        u.photo = photo(payload.photo);
        delete u.photo_ref;
      }
      if (Object.hasOwn(payload, "target"))
        u.target = numeric(payload.target, "Target penjualan");
      if (Object.hasOwn(payload, "can_check_stock")) {
        assert(typeof payload.can_check_stock === "boolean", "Pilihan petugas pemeriksa tidak valid.");
        assert(!payload.can_check_stock || (u.role === "employee" && !accountAccessError(u)), "Hanya karyawan aktif yang sudah disetujui dapat ditunjuk.");
        recordStockAssignment(state, u, payload.can_check_stock, user, stamp, id);
      }
      if (u.role !== "employee" || accountAccessError(u)) recordStockAssignment(state, u, false, user, stamp, id);
      detail.after = { ...safeIdentity(u), photo_changed: Object.hasOwn(payload, "photo"), password_changed: passwordChanged };
      break;
    }
    case "profile.password": {
      assert(Object.keys(payload).every(key => ["current_password", "new_password", "password_confirmation"].includes(key)), "Kolom kata sandi tidak didukung.");
      assert(!user.is_superadmin, "Kata sandi superadmin dilindungi dan tidak dapat diganti.");
      assert(typeof payload.current_password === "string" && payload.current_password.length > 0, "Masukkan kata sandi saat ini.");
      validateNewPassword(payload.new_password, payload.password_confirmation);
      // The store verifies the current password hash before this synchronous write.
      detail.after = { id: user.id, password_changed: true };
      break;
    }
    case "user.delete": {
      admin(user);
      assert(Object.keys(payload).every(key => ["id", "reason"].includes(key)), "Kolom penghapusan akun tidak didukung.");
      const u = find(state.users, payload.id, "Karyawan");
      assert(!u.is_superadmin && u.role === "employee", "Hanya akun karyawan yang dapat dihapus.");
      assert(u.id !== user.id, "Akun sendiri tidak dapat dihapus melalui menu ini.");
      assert(!u.deleted_at, "Akun ini sudah dihapus.");
      const reason = requiredText(payload.reason, "Alasan penghapusan");
      assert(Array.from(reason).length <= 500, "Alasan penghapusan maksimal 500 karakter.");
      assert(!state.pickups.some(p => p.user_id === u.id && (pickupBalance(state,p).kg > 0 || pickupBalance(state,p).eggs > 0)), "Kembalikan atau selesaikan telur yang masih dibawa sebelum menghapus akun.");
      detail.before = { id: u.id, name: u.name, role: u.role, active: u.active };
      u.active = false;
      u.deleted_at = stamp;
      recordStockAssignment(state, u, false, user, stamp, id);
      detail.after = { id: u.id, name: u.name, active: false, deleted_at: stamp, reason };
      break;
    }
    case "user.approve":
    case "user.reject": {
      admin(user);
      const u = find(state.users, payload.id, "Karyawan");
      assert(!u.deleted_at, "Akun ini sudah dihapus dan tidak dapat disetujui kembali.");
      assert(
        Object.keys(payload).every((key) => key === "id"),
        "Persetujuan hanya menerima ID akun.",
      );
      assert(
        u.role === "employee",
        "Hanya pendaftaran karyawan yang dapat ditinjau.",
      );
      assert(
        u.registration_status === "pending" ||
          (action === "user.approve" && u.registration_status === "rejected"),
        "Pendaftaran sudah ditinjau.",
      );
      detail.before = structuredClone(u);
      u.registration_status =
        action === "user.approve" ? "approved" : "rejected";
      u.active = action === "user.approve";
      detail.after = structuredClone(u);
      if (u.active)
        state.notifications.push({
          id: id("notif"),
          user_id: u.id,
          title: "Pendaftaran disetujui",
          message:
            "Akun Anda telah disetujui admin. Selamat bergabung di TernaKu.",
          created_at: stamp,
          read: false,
        });
      break;
    }
    case "barn.create": {
      admin(user);
      assert(
        payload.type === undefined || payload.type === "ayam",
        "Manajemen kandang sapi segera hadir.",
      );
      state.barns.push({
        id: id("barn"),
        name: requiredText(payload.name, "Nama kandang"),
        type: "ayam",
        capacity: numeric(payload.capacity ?? 0, "Kapasitas", false, true),
        notes: text(payload.notes),
      });
      break;
    }
    case "feed.create": {
      admin(user);
      state.feeds.push({
        id: id("feed"),
        name: requiredText(payload.name, "Nama pakan"),
        unit: "kg",
        min_stock: numeric(payload.min_stock ?? 0, "Stok minimum"),
      });
      break;
    }
    case "feed.purchase": {
      admin(user);
      const items = list(payload.items).map((item) => {
        const feed = find(state.feeds, item.feed_id, "Pakan");
        const quantity = numeric(item.quantity, "Jumlah pembelian", true);
        const unit_price = numeric(item.unit_price, "Harga satuan", true, true);
        return {
          feed_id: feed.id,
          quantity,
          unit_price,
          total: Math.round(quantity * unit_price),
        };
      });
      const total = totalAmount(items.reduce((sum, i) => sum + i.total, 0));
      const paid = numeric(payload.paid ?? 0, "Nominal dibayar", false, true);
      assert(paid <= total, "Pembayaran tidak boleh melebihi total pembelian.");
      const purchaseDate = dateValue(payload.date, now);
      state.feed_purchases.push({
        id: id("purchase"),
        number: invoice("PO", state.feed_purchases.length),
        date: purchaseDate,
        due_date: dueDate(payload.due_date, businessDate(purchaseDate)),
        payments: paid ? [paymentEntry("initial", paid, stamp, user.id)] : [],
        supplier: requiredText(payload.supplier, "Nama pemasok"),
        items,
        total,
        paid,
        balance: total - paid,
        notes: text(payload.notes),
        created_at: stamp,
        user_id: user.id,
      });
      break;
    }
    case "feed.use": {
      const feed = find(state.feeds, payload.feed_id, "Pakan");
      const barn = find(state.barns, payload.barn_id, "Kandang");
      const quantity = numeric(payload.quantity, "Pemakaian pakan", true);
      assert(quantity <= feedStock(state, feed.id), "Stok pakan tidak cukup.");
      state.feed_usages.push({
        id: id("usage"),
        date: dateValue(payload.date, now),
        feed_id: feed.id,
        barn_id: barn.id,
        quantity,
        notes: text(payload.notes),
        created_at: stamp,
        user_id: user.id,
      });
      break;
    }
    case "notification.read": {
      const notifications =
        payload.id === "all"
          ? state.notifications.filter((n) => n.user_id === user.id)
          : [find(state.notifications, payload.id, "Notifikasi")];
      for (const n of notifications) {
        assert(n.user_id === user.id, "Notifikasi bukan milik Anda.");
        n.read = true;
      }
      break;
    }
    case "record.lock": {
      admin(user);
      const row = record(state, payload.entity, payload.id);
      assert(typeof payload.locked === "boolean", "Status kunci tidak valid.");
      row.locked = payload.locked;
      break;
    }
    case "correction.request": {
      const row = record(state, payload.entity, payload.id);
      own(user, row);
      const reason = requiredText(payload.reason, "Alasan koreksi");
      assert(reason.length >= 5, "Alasan koreksi minimal 5 karakter.");
      // Validate the requested change with the same rules, on an isolated copy, before queuing it.
      if (user.role !== "admin" && payload.entity === "production" && payload.changes && typeof payload.changes === "object") {
        const proposed = payload.changes as CommandPayload;
        for (const key of ["eggs", "kg"] as const) if (Object.hasOwn(proposed, key))
          numeric(proposed[key], key === "eggs" ? "Jumlah butir" : "Berat aktual", true, key === "eggs");
      }
      correct(structuredClone(state), { ...user, role: "admin" }, payload, now);
      const correction: Correction = {
        id: id("correction"),
        user_id: user.id,
        entity: payload.entity as RecordEntity,
        record_id: row.id,
        reason,
        changes: structuredClone(payload.changes as CommandPayload),
        status: "pending",
        created_at: stamp,
      };
      state.corrections.push(correction);
      break;
    }
    case "correction.apply":
      detail = correct(state, user, payload, now);
      break;
    case "correction.review": {
      admin(user);
      const request = find(state.corrections, payload.id, "Pengajuan koreksi");
      assert(request.status === "pending", "Pengajuan sudah ditinjau.");
      assert(typeof payload.approved === "boolean", "Keputusan tidak valid.");
      if (payload.approved)
        detail = correct(
          state,
          user,
          {
            entity: request.entity,
            id: request.record_id,
            reason: request.reason,
            changes: request.changes,
          },
          now,
        );
      request.status = payload.approved ? "approved" : "rejected";
      request.reviewed_at = stamp;
      request.reviewed_by = user.id;
      break;
    }
    default:
      throw new Error("Tindakan tidak tersedia.");
  }
  state.stock_movements ??= [];
  for (const p of state.productions) {
    const before = input.productions.find((row) => row.id === p.id);
    const stocked = isProductionStocked(p);
    const wasStocked = !!before && isProductionStocked(before);
    const q = {
      eggs: (stocked ? p.eggs : 0) - (wasStocked ? before.eggs : 0),
      kg: round((stocked ? p.kg : 0) - (wasStocked ? before.kg : 0)),
      trays: (stocked ? p.trays : 0) - (wasStocked ? before.trays : 0),
    };
    if (q.eggs || q.kg || q.trays)
      state.stock_movements.push({
        id: id("movement"),
        date: before ? stamp : p.date,
        created_at: stamp,
        user_id: p.user_id,
        category: p.category,
        kind: wasStocked ? "correction" : "production",
        reference_id: p.id,
        ...q,
        notes: wasStocked
          ? `Koreksi oleh ${user.name}: ${text(payload.reason, state.corrections.find((c) => c.id === payload.id)?.reason || "Koreksi produksi")}`
          : before ? `Panen diterima di gudang oleh ${user.name}.` : p.notes,
      });
  }
  for (const p of state.pickups) {
    const before = input.pickups.find((row) => row.id === p.id);
    if (!before)
      state.stock_movements.push({
        id: id("movement"),
        date: p.date,
        created_at: stamp,
        user_id: p.user_id,
        category: p.category,
        kind: "pickup",
        reference_id: p.id,
        eggs: -p.eggs,
        kg: -p.kg,
        trays: -p.trays,
        notes: p.notes,
      });
    else {
      const correction = {
        eggs: before.eggs - p.eggs,
        kg: round(before.kg - p.kg),
        trays: before.trays - p.trays,
      };
      if (correction.eggs || correction.kg || correction.trays)
        state.stock_movements.push({
          id: id("movement"),
          date: stamp,
          created_at: stamp,
          user_id: p.user_id,
          category: p.category,
          kind: "correction",
          reference_id: p.id,
          ...correction,
          notes: `Koreksi pengambilan oleh ${user.name}: ${text(payload.reason, state.corrections.find((c) => c.id === payload.id)?.reason || "Koreksi pengambilan")}`,
        });
      const q = {
        eggs: p.returned_eggs - before.returned_eggs,
        kg: round(p.returned_kg - before.returned_kg),
        trays: p.returned_trays - before.returned_trays,
      };
      if (q.eggs || q.kg || q.trays)
        state.stock_movements.push({
          id: id("movement"),
          date: stamp,
          created_at: stamp,
          user_id: p.user_id,
          category: p.category,
          kind: "return",
          reference_id: p.id,
          ...q,
          notes: text(payload.notes),
        });
    }
  }
  if (farmEvent) {
    const eventId = `farm-${now.getTime()}-${input.activity.length + 1}`;
    const notice = farmNotice(farmEvent.activity, user.name, farmEvent.kg);
    for (const recipient of state.users.filter(u => !accountAccessError(u))) {
      state.notifications.push({
        id: `${eventId}-${recipient.id}`, event_id: eventId, type: "farm.activity", activity: farmEvent.activity,
        user_id: recipient.id, ...notice, read: false, created_at: stamp,
      });
    }
  }
  if (action !== "notification.read")
    state.activity.unshift({
      id: id("activity"),
      user_id: user.id,
      action,
        actor_role: user.role,
      description: `${user.name}: ${action}${payload.reason ? ` — ${text(payload.reason)}` : ""}`,
      created_at: stamp,
      ...detail,
    });
  return state;
}
