import { emptyState, money, today } from "./domain";
import type { Category, State } from "./types";

export const DEMO_PASSWORD = "Demo123!";
export const DEMO_ACCOUNTS = [
  {
    email: "admin@ternaku.id",
    password: DEMO_PASSWORD,
    name: "Amalia Putri",
    role: "admin",
  },
  {
    email: "sari@ternaku.id",
    password: DEMO_PASSWORD,
    name: "Sari Wulandari",
    role: "employee",
  },
];

export function createDemoState(now = new Date()): State {
  const state = emptyState();
  const day = (offset: number) =>
    today(new Date(now.getTime() + offset * 86400000));
  const stamp = (offset: number, hour = "08:00") =>
    `${day(offset)}T${hour}:00+07:00`;
  state.users = [
    {
      id: "admin",
      name: "Amalia Putri",
      email: "admin@ternaku.id",
      role: "admin",
      active: true,
      target: 0,
    },
    {
      id: "emp-1",
      name: "Sari Wulandari",
      email: "sari@ternaku.id",
      role: "employee",
      active: true,
      target: 15000000,
    },
    {
      id: "emp-2",
      name: "Budi Santoso",
      email: "budi@ternaku.id",
      role: "employee",
      active: true,
      target: 15000000,
    },
    {
      id: "emp-3",
      name: "Rina Anggraini",
      email: "rina@ternaku.id",
      role: "employee",
      active: true,
      target: 12000000,
    },
  ];
  state.barns = [
    {
      id: "barn-1",
      name: "Kandang A",
      type: "ayam",
      capacity: 1200,
      notes: "Ayam petelur · Blok timur",
    },
    {
      id: "barn-2",
      name: "Kandang B",
      type: "ayam",
      capacity: 1000,
      notes: "Ayam petelur · Blok barat",
    },
  ];
  state.prices = [
    {
      id: "price-1",
      good_price: 26500,
      cracked_price: 16500,
      effective_at: stamp(-30, "00:00"),
      created_at: stamp(-30),
      created_by: "admin",
    },
    {
      id: "price-2",
      good_price: 27000,
      cracked_price: 17000,
      effective_at: stamp(-7, "00:00"),
      created_at: stamp(-8),
      created_by: "admin",
    },
    {
      id: "price-3",
      good_price: 28000,
      cracked_price: 18000,
      effective_at: stamp(0, "00:00"),
      created_at: stamp(-1, "16:30"),
      created_by: "admin",
    },
  ];
  const customers = [
    "Toko Sumber Rezeki",
    "Warung Bu Sri",
    "Dapur Bu Nani",
    "Toko Berkah Jaya",
    "Katering Sedap",
    "Pasar Sukamaju",
  ];
  for (let offset = -13; offset <= 0; offset++) {
    const idx = offset + 13;
    for (const c of ["good", "cracked"] as Category[]) {
      const kg =
        c === "good"
          ? 97 + (idx % 5) * 3 + (offset === 0 ? 4 : 0)
          : 3 + (idx % 3) * 0.3;
      state.productions.push({
        id: `prod-${idx}-${c}`,
        date: day(offset),
        user_id: `emp-${(idx % 3) + 1}`,
        barn_id: idx % 2 === 0 ? "barn-1" : "barn-2",
        category: c,
        eggs: Math.round(kg / 0.058),
        kg,
        trays: c === "good" ? 10 : 0,
        notes:
          c === "good"
            ? "Panen pagi, kualitas baik."
            : "Dipisahkan saat sortir.",
        created_at: stamp(offset, "07:15"),
        locked: offset < -1,
      });
    }
    for (let worker = 1; worker <= 3; worker++) {
      const kg = 27 + ((idx + worker) % 4) * 2;
      const eggs = Math.round(kg / 0.058);
      const pickupId = `pickup-${idx}-${worker}`;
      const returnKg = offset === -2 && worker === 2 ? 2 : 0;
      const returnEggs = returnKg ? 34 : 0;
      state.pickups.push({
        id: pickupId,
        date: day(offset),
        user_id: `emp-${worker}`,
        category: "good",
        eggs,
        kg,
        trays: 3,
        area: ["Pasar Sukamaju", "Pelanggan & warung", "Katering & toko"][
          worker - 1
        ],
        notes: "Distribusi pagi",
        returned_eggs: returnEggs,
        returned_kg: returnKg,
        returned_trays: 0,
        created_at: stamp(offset, "08:00"),
        locked: offset < -1,
      });
      const soldKg =
        offset === 0
          ? kg - (worker === 1 ? 8 : worker === 2 ? 12 : 5)
          : kg - returnKg;
      const soldEggs =
        offset === 0 ? Math.round(soldKg / 0.058) : eggs - returnEggs;
      const unit_price = offset === 0 ? 28000 : offset >= -7 ? 27000 : 26500;
      const total = soldKg * unit_price;
      const partial = worker === 2 && offset >= -2;
      const paid = partial ? Math.round(total / 2) : total;
      state.sales.push({
        id: `sale-${idx}-${worker}`,
        number: `TRX-${day(offset).replaceAll("-", "")}-${String(worker).padStart(4, "0")}`,
        date: day(offset),
        user_id: `emp-${worker}`,
        customer: customers[(idx + worker) % customers.length],
        phone: "",
        items: [
          {
            id: `item-${idx}-${worker}`,
            pickup_id: pickupId,
            category: "good",
            eggs: soldEggs,
            kg: soldKg,
            trays: offset === 0 ? 2 : 3,
            unit_price,
            total,
          },
        ],
        total,
        paid,
        balance: total - paid,
        payment_method: partial
          ? "credit"
          : worker === 1
            ? "transfer"
            : worker === 2
              ? "cash"
              : "qris",
        payment_status: partial ? "partial" : "paid",
        notes: partial ? "Pelunasan pada pengiriman berikutnya." : "",
        created_at: stamp(offset, "10:30"),
        locked: true,
      });
    }
    if (idx % 2 === 0) {
      const kg = 2.5;
      const eggs = 43;
      const unit_price = offset >= -7 ? 17000 : 16500;
      const pickupId = `pickup-cracked-${idx}`;
      state.pickups.push({
        id: pickupId,
        date: day(offset),
        user_id: "emp-1",
        category: "cracked",
        eggs,
        kg,
        trays: 0,
        area: "Dapur Bu Nani",
        notes: "Telur bentes untuk olahan.",
        returned_eggs: 0,
        returned_kg: 0,
        returned_trays: 0,
        created_at: stamp(offset),
        locked: true,
      });
      state.sales.push({
        id: `sale-cracked-${idx}`,
        number: `TRX-${day(offset).replaceAll("-", "")}-0004`,
        date: day(offset),
        user_id: "emp-1",
        customer: "Dapur Bu Nani",
        phone: "",
        items: [
          {
            id: `item-cracked-${idx}`,
            pickup_id: pickupId,
            category: "cracked",
            eggs,
            kg,
            trays: 0,
            unit_price,
            total: kg * unit_price,
          },
        ],
        total: kg * unit_price,
        paid: kg * unit_price,
        balance: 0,
        payment_method: "cash",
        payment_status: "paid",
        notes: "",
        created_at: stamp(offset, "11:00"),
        locked: true,
      });
    }
  }
  state.feeds = [
    { id: "feed-1", name: "Konsentrat Layer", unit: "kg", min_stock: 500 },
    { id: "feed-2", name: "Jagung Giling", unit: "kg", min_stock: 400 },
    { id: "feed-3", name: "Dedak Halus", unit: "kg", min_stock: 300 },
  ];
  state.feed_purchases = [
    {
      id: "purchase-1",
      number: `PO-${day(-14).replaceAll("-", "")}-0001`,
      date: day(-14),
      supplier: "CV Sumber Pakan Makmur",
      items: [
        {
          feed_id: "feed-1",
          quantity: 2500,
          unit_price: 8500,
          total: 21250000,
        },
        { feed_id: "feed-2", quantity: 1200, unit_price: 5500, total: 6600000 },
        { feed_id: "feed-3", quantity: 600, unit_price: 3500, total: 2100000 },
      ],
      total: 29950000,
      paid: 29950000,
      balance: 0,
      notes: "Pengadaan pakan awal periode.",
      user_id: "admin",
      created_at: stamp(-14),
    },
    {
      id: "purchase-2",
      number: `PO-${day(-2).replaceAll("-", "")}-0002`,
      date: day(-2),
      supplier: "UD Tani Sejahtera",
      items: [
        { feed_id: "feed-1", quantity: 500, unit_price: 8600, total: 4300000 },
      ],
      total: 4300000,
      paid: 3000000,
      balance: 1300000,
      notes: "Sisa pembayaran akhir pekan.",
      user_id: "admin",
      created_at: stamp(-2, "14:00"),
    },
  ];
  for (let offset = -13; offset <= 0; offset++)
    for (let f = 1; f <= 3; f++)
      state.feed_usages.push({
        id: `usage-${offset + 13}-${f}`,
        date: day(offset),
        feed_id: `feed-${f}`,
        barn_id: offset % 2 === 0 ? "barn-1" : "barn-2",
        quantity: f === 1 ? 112 : f === 2 ? 38 : 25,
        notes: "Pemberian pakan pagi dan sore.",
        user_id: `emp-${((offset + 13) % 3) + 1}`,
        created_at: stamp(offset, "07:00"),
      });
  for (const u of state.users)
    state.notifications.push({
      id: `notif-${u.id}`,
      user_id: u.id,
      title: "Harga telur diperbarui",
      message: `Mulai hari ini, harga telur bagus ${money(28000)}/kg dan telur bentes ${money(18000)}/kg.`,
      created_at: stamp(-1, "16:30"),
      read: false,
    });
  state.activity = state.sales
    .slice(-9)
    .reverse()
    .map((sale, i) => ({
      id: `log-${i}`,
      user_id: sale.user_id,
      action: "sale.create",
      description: `Mencatat penjualan ${sale.number} kepada ${sale.customer}.`,
      created_at: sale.created_at,
    }));
  state.activity.unshift({
    id: "log-price",
    user_id: "admin",
    action: "price.create",
    description: "Memperbarui harga telur bagus menjadi Rp28.000/kg.",
    created_at: stamp(-1, "16:30"),
  });
  state.stock_movements = state.productions.map((p) => ({
    id: `movement-${p.id}`,
    date: p.date,
    created_at: p.created_at,
    user_id: p.user_id,
    category: p.category,
    kind: "production" as const,
    reference_id: p.id,
    eggs: p.eggs,
    kg: p.kg,
    trays: p.trays,
    notes: p.notes,
  }));
  for (const p of state.pickups) {
    state.stock_movements.push({
      id: `movement-${p.id}`,
      date: p.date,
      created_at: p.created_at,
      user_id: p.user_id,
      category: p.category,
      kind: "pickup",
      reference_id: p.id,
      eggs: -p.eggs,
      kg: -p.kg,
      trays: -p.trays,
      notes: p.notes,
    });
    if (p.returned_eggs || p.returned_kg)
      state.stock_movements.push({
        id: `movement-return-${p.id}`,
        date: `${p.date}T16:00:00+07:00`,
        created_at: `${p.date}T16:00:00+07:00`,
        user_id: p.user_id,
        category: p.category,
        kind: "return",
        reference_id: p.id,
        eggs: p.returned_eggs,
        kg: p.returned_kg,
        trays: p.returned_trays,
        notes: "Sisa distribusi dikembalikan sore hari.",
      });
  }
  return state;
}
