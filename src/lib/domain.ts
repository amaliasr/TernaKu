import type {
  Category,
  CommandPayload,
  Correction,
  Pickup,
  PickupBalance,
  Price,
  Quantity,
  RecordEntity,
  RegistrationInput,
  RegistrationResult,
  Sale,
  SaleItem,
  State,
  User,
} from "./types";

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
  return state.prices
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
    )[0]?.price;
}
const round = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;
const emptyQuantity = (): Quantity => ({ eggs: 0, kg: 0, trays: 0 });
export function eggStock(state: State, category?: Category): Quantity {
  if (state.inventory) {
    if (category) return { ...state.inventory[category] };
    return {
      eggs: state.inventory.good.eggs + state.inventory.cracked.eggs,
      kg: round(state.inventory.good.kg + state.inventory.cracked.kg),
      trays: state.inventory.good.trays + state.inventory.cracked.trays,
    };
  }
  const stock = emptyQuantity();
  for (const p of state.productions)
    if (!category || p.category === category) {
      stock.eggs += p.eggs;
      stock.kg += p.kg;
      stock.trays += p.trays;
    }
  for (const p of state.pickups)
    if (!category || p.category === category) {
      stock.eggs += p.returned_eggs - p.eggs;
      stock.kg += p.returned_kg - p.kg;
      stock.trays += p.returned_trays - p.trays;
    }
  stock.kg = round(stock.kg);
  stock.trays = Math.max(0, stock.trays);
  return stock;
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
  };
}
export function visibleState(state: State, user: User | null): State {
  if (!user || accountAccessError(user)) return emptyState();
  if (user.role === "admin")
    return {
      ...state,
      notifications: state.notifications.filter((n) => n.user_id === user.id),
    };
  return {
    ...state,
    users: state.users.filter((u) => u.id === user.id),
    productions: state.productions.filter((p) => p.user_id === user.id),
    pickups: state.pickups.filter((p) => p.user_id === user.id),
    sales: state.sales.filter((s) => s.user_id === user.id),
    notifications: state.notifications.filter((n) => n.user_id === user.id),
    corrections: state.corrections.filter((c) => c.user_id === user.id),
    stock_movements: state.stock_movements?.filter(
      (m) => m.user_id === user.id,
    ),
    activity: [],
    feed_purchases: [],
    feed_usages: state.feed_usages.filter((f) => f.user_id === user.id),
    inventory: {
      good: eggStock(state, "good"),
      cracked: eggStock(state, "cracked"),
    },
    feed_inventory: Object.fromEntries(
      state.feeds.map((f) => [f.id, feedStock(state, f.id)]),
    ),
  };
}

/** Legacy/manual users without registration_status are already approved. */
export function accountAccessError(user: User): string | null {
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
  const stamp = now.toISOString();
  const newUser: User = {
    id: `signup-${now.getTime()}-${state.users.length + 1}`,
    name,
    email,
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
  assert(n <= 1_000_000_000, `${name} terlalu besar.`);
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
    value === "good" || value === "cracked",
    "Pilih kategori telur yang valid.",
  );
  return value;
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
  for (const c of ["good", "cracked"] as const) {
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
        key !== "trays",
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
        return { ...old, ...q, total: Math.round(q.kg * old.unit_price) };
      });
      const total = totalAmount(
        updated.reduce((sum, item) => sum + item.total, 0),
      );
      assert(
        total >= sale.paid,
        "Total koreksi lebih kecil dari pembayaran yang sudah diterima. Pengembalian dana belum tersedia; rekonsiliasi pembayaran diperlukan sebelum koreksi ini.",
      );
      sale.items = sale.items.map((old) =>
        updated.find((item) => item.id === old.id)!,
      );
      sale.total = total;
      sale.balance = total - sale.paid;
      sale.payment_status =
        sale.balance === 0 ? "paid" : sale.paid > 0 ? "partial" : "unpaid";
    } else (row as unknown as CommandPayload)[key] = text(value);
  }
  if (payload.entity === "pickup") checkPickup(state, row as Pickup);
  if (payload.entity === "sale") {
    const sale = row as Sale;
    if (sale.items.some(isFreeSaleItem))
      requiredText(sale.customer, "Nama penerima telur gratis");
    for (const pickupId of new Set(sale.items.map((item) => item.pickup_id))) {
      const pickup = find(state.pickups, pickupId, "Pengambilan");
      assert(
        pickup.user_id === sale.user_id,
        "Pemilik pengambilan berbeda dengan transaksi.",
      );
      checkPickup(state, pickup);
    }
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
  const state: State = structuredClone(input);
  delete state.inventory;
  delete state.feed_inventory;
  const user = find(state.users, userId, "Pengguna");
  const accessError = accountAccessError(user);
  assert(!accessError, accessError || "Akun tidak dapat digunakan.");
  const stamp = now.toISOString();
  let sequence =
    state.activity.length +
    state.productions.length +
    state.sales.length +
    state.pickups.length;
  const id = (prefix: string) => `${prefix}-${now.getTime()}-${++sequence}`;
  const invoice = (prefix: string, count: number) =>
    `${prefix}-${today(now).replaceAll("-", "")}-${String(count + 1).padStart(4, "0")}`;
  let detail: { before?: unknown; after?: unknown } = {};
  switch (action) {
    case "production.create": {
      const q = quantities(payload);
      const barnId = text(payload.barn_id);
      if (barnId) find(state.barns, barnId, "Kandang");
      state.productions.push({
        id: id("prod"),
        date: dateValue(payload.date, now),
        user_id: user.id,
        barn_id: barnId,
        category: category(payload.category),
        ...q,
        notes: text(payload.notes),
        photo: photo(payload.photo),
        location: text(payload.location),
        created_at: stamp,
        locked: false,
      });
      break;
    }
    case "pickup.create": {
      const q = quantities(payload);
      const c = category(payload.category);
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
      detail = { after: { pickup_id: p.id, ...q, notes: text(payload.notes) } };
      break;
    }
    case "sale.create": {
      const price = activePrice(state, now);
      assert(price, "Admin belum menetapkan harga telur yang berlaku.");
      assert(
        payload.expected_price_id === undefined ||
          payload.expected_price_id === price.id,
        "Harga telur telah berubah. Periksa harga terbaru lalu simpan kembali.",
      );
      const entries = list(payload.items);
      const reserved: Record<string, Quantity> = {};
      const items = entries.map((item) => {
        const p = find(state.pickups, item.pickup_id, "Pengambilan");
        assert(
          p.user_id === user.id,
          "Penjualan hanya boleh menggunakan pengambilan milik Anda.",
        );
        const c = category(item.category);
        assert(
          c === p.category,
          "Kategori penjualan harus sesuai pengambilan.",
        );
        const q = quantities(item);
        const available = pickupBalance(state, p);
        const used = reserved[p.id] || emptyQuantity();
        assert(
          q.eggs + used.eggs <= available.eggs &&
            round(q.kg + used.kg) <= available.kg,
          "Jumlah penjualan melebihi sisa telur yang dibawa.",
        );
        reserved[p.id] = {
          eggs: used.eggs + q.eggs,
          kg: round(used.kg + q.kg),
          trays: used.trays + q.trays,
        };
        assert(
          item.is_free === undefined || typeof item.is_free === "boolean",
          "Pilihan gratis tidak valid.",
        );
        assert(
          !item.is_free || c === "cracked",
          "Hanya telur bentes yang boleh diberikan gratis.",
        );
        const is_free =
          c === "cracked" &&
          (item.is_free === true || price.cracked_price === 0);
        const unit_price = is_free
          ? 0
          : c === "good"
            ? price.good_price
            : price.cracked_price;
        return {
          id: id("item"),
          pickup_id: p.id,
          category: c,
          ...q,
          unit_price,
          is_free,
          total: Math.round(q.kg * unit_price),
        };
      });
      for (const [pickupId, used] of Object.entries(reserved)) {
        const available = pickupBalance(state, pickupId);
        completeBalance(available.eggs - used.eggs, available.kg - used.kg);
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
      const customer = items.some(isFreeSaleItem)
        ? requiredText(payload.customer, "Nama penerima telur gratis")
        : text(payload.customer);
      state.sales.push({
        id: id("sale"),
        number: invoice("TRX", state.sales.length),
        date: dateValue(payload.date, now),
        user_id: user.id,
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
        photo: photo(payload.photo),
        created_at: stamp,
        locked: true,
      });
      break;
    }
    case "sale.payment": {
      const sale = find(state.sales, payload.id, "Penjualan");
      own(user, sale);
      const amount = numeric(payload.amount, "Pembayaran", true, true);
      assert(amount <= sale.balance, "Pembayaran melebihi sisa tagihan.");
      detail.before = structuredClone(sale);
      sale.paid += amount;
      sale.balance -= amount;
      sale.payment_status = sale.balance === 0 ? "paid" : "partial";
      detail.after = structuredClone(sale);
      break;
    }
    case "price.create": {
      admin(user);
      const good_price = numeric(
        payload.good_price,
        "Harga telur bagus",
        true,
        true,
      );
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
        good_price,
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
          message: `Mulai ${dateLabel(effective_at, true)}, telur bagus ${money(good_price)}/kg dan telur bentes ${cracked_price === 0 ? "Gratis" : money(cracked_price) + "/kg"}.`,
          read: false,
          created_at: stamp,
        });
      break;
    }
    case "profile.update": {
      assert(
        Object.keys(payload).every((key) => key === "name" || key === "photo"),
        "Profil hanya dapat mengubah nama dan foto.",
      );
      assert(
        typeof payload.name === "string" &&
          payload.name.trim().length > 0 &&
          Array.from(payload.name.trim()).length <= 120,
        "Nama wajib diisi dan maksimal 120 karakter.",
      );
      const profile = state.users.find((u) => u.id === user.id)!;
      const before = profile.name;
      profile.name = payload.name.trim();
      if (Object.hasOwn(payload, "photo")) profile.photo = photo(payload.photo);
      detail = {
        before: { name: before },
        after: {
          name: profile.name,
          photo_changed: Object.hasOwn(payload, "photo"),
        },
      };
      break;
    }
    case "user.create": {
      admin(user);
      const email = requiredText(payload.email, "Email").toLowerCase();
      assert(
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
        "Format email tidak valid.",
      );
      assert(
        !state.users.some((u) => u.email.toLowerCase() === email),
        "Email sudah digunakan.",
      );
      assert(
        text(payload.password).length >= 10,
        "Kata sandi minimal 10 karakter.",
      );
      const role = payload.role;
      assert(role === "admin" || role === "employee", "Peran tidak valid.");
      state.users.push({
        id: id("user"),
        name: requiredText(payload.name, "Nama"),
        email,
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
        payload.role === undefined && payload.registration_status === undefined,
        "Peran dan status pendaftaran tidak dapat diubah lewat pengaturan akun.",
      );
      if (payload.active !== undefined) {
        assert(typeof payload.active === "boolean", "Status akun tidak valid.");
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
            state.users.filter((a) => a.role === "admin" && a.active).length >
              1,
          "Admin terakhir tidak dapat dinonaktifkan.",
        );
        u.active = payload.active;
      }
      if (payload.name !== undefined)
        u.name = requiredText(payload.name, "Nama");
      if (payload.target !== undefined)
        u.target = numeric(payload.target, "Target penjualan");
      break;
    }
    case "user.approve":
    case "user.reject": {
      admin(user);
      const u = find(state.users, payload.id, "Karyawan");
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
      state.feed_purchases.push({
        id: id("purchase"),
        number: invoice("PO", state.feed_purchases.length),
        date: dateValue(payload.date, now),
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
    const q = {
      eggs: p.eggs - (before?.eggs || 0),
      kg: round(p.kg - (before?.kg || 0)),
      trays: p.trays - (before?.trays || 0),
    };
    if (!before || q.eggs || q.kg || q.trays)
      state.stock_movements.push({
        id: id("movement"),
        date: before ? stamp : p.date,
        created_at: stamp,
        user_id: p.user_id,
        category: p.category,
        kind: before ? "correction" : "production",
        reference_id: p.id,
        ...q,
        notes: before
          ? `Koreksi oleh ${user.name}: ${text(payload.reason, state.corrections.find((c) => c.id === payload.id)?.reason || "Koreksi produksi")}`
          : p.notes,
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
  if (action !== "notification.read")
    state.activity.unshift({
      id: id("activity"),
      user_id: user.id,
      action,
      description: `${user.name}: ${action}${payload.reason ? ` — ${text(payload.reason)}` : ""}`,
      created_at: stamp,
      ...detail,
    });
  return state;
}
