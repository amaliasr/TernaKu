export type Category = "good" | "cracked";
export type Role = "admin" | "employee";
export type RegistrationStatus = "pending" | "approved" | "rejected";
export interface RegistrationAvailability {
  first_admin_required: boolean;
  setup_enabled: boolean;
}
export interface RegistrationInput {
  name: string;
  email: string;
  password: string;
  password_confirmation: string;
  setup_token?: string;
}
export interface RegistrationResult {
  status: "active" | "pending";
  message: string;
}
export type PaymentMethod = "cash" | "transfer" | "qris" | "credit";
export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  registration_status?: RegistrationStatus;
  target: number;
  avatar?: string;
}
export interface Barn {
  id: string;
  name: string;
  type: "ayam";
  capacity: number;
  notes: string;
}
export interface Production {
  id: string;
  date: string;
  user_id: string;
  barn_id: string;
  category: Category;
  eggs: number;
  kg: number;
  trays: number;
  notes: string;
  photo?: string;
  location?: string;
  created_at: string;
  locked: boolean;
}
export interface Pickup {
  id: string;
  date: string;
  user_id: string;
  category: Category;
  eggs: number;
  kg: number;
  trays: number;
  area: string;
  notes: string;
  returned_eggs: number;
  returned_kg: number;
  returned_trays: number;
  created_at: string;
  locked: boolean;
}
export interface SaleItem {
  id: string;
  pickup_id: string;
  category: Category;
  eggs: number;
  kg: number;
  trays: number;
  unit_price: number;
  total: number;
}
export interface Sale {
  id: string;
  number: string;
  date: string;
  user_id: string;
  customer: string;
  phone: string;
  items: SaleItem[];
  total: number;
  paid: number;
  balance: number;
  payment_method: PaymentMethod;
  payment_status: "paid" | "partial" | "unpaid";
  notes: string;
  photo?: string;
  created_at: string;
  locked: boolean;
}
export interface Price {
  id: string;
  good_price: number;
  cracked_price: number;
  effective_at: string;
  created_at: string;
  created_by: string;
}
export interface Feed {
  id: string;
  name: string;
  unit: "kg";
  min_stock: number;
}
export interface FeedPurchaseItem {
  feed_id: string;
  quantity: number;
  unit_price: number;
  total: number;
}
export interface FeedPurchase {
  id: string;
  number: string;
  date: string;
  supplier: string;
  items: FeedPurchaseItem[];
  total: number;
  paid: number;
  balance: number;
  notes: string;
  created_at: string;
  user_id: string;
}
export interface FeedUsage {
  id: string;
  date: string;
  feed_id: string;
  barn_id: string;
  quantity: number;
  notes: string;
  created_at: string;
  user_id: string;
}
export interface Notification {
  id: string;
  user_id: string;
  title: string;
  message: string;
  created_at: string;
  read: boolean;
}
export interface Activity {
  id: string;
  user_id: string;
  action: string;
  description: string;
  created_at: string;
  before?: unknown;
  after?: unknown;
}
export type RecordEntity = "production" | "pickup" | "sale";
export interface StockMovement {
  id: string;
  date: string;
  created_at: string;
  user_id: string;
  category: Category;
  kind: "production" | "pickup" | "return" | "correction";
  reference_id: string;
  eggs: number;
  kg: number;
  trays: number;
  notes: string;
}
export interface Correction {
  id: string;
  user_id: string;
  entity: RecordEntity;
  record_id: string;
  reason: string;
  changes: Record<string, unknown>;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  reviewed_at?: string;
  reviewed_by?: string;
}
export interface State {
  users: User[];
  barns: Barn[];
  productions: Production[];
  pickups: Pickup[];
  sales: Sale[];
  prices: Price[];
  feeds: Feed[];
  feed_purchases: FeedPurchase[];
  feed_usages: FeedUsage[];
  notifications: Notification[];
  activity: Activity[];
  corrections: Correction[];
  stock_movements?: StockMovement[];
  inventory?: Record<Category, Quantity>;
  feed_inventory?: Record<string, number>;
}
export interface Quantity {
  eggs: number;
  kg: number;
  trays: number;
}
export type PickupStatus =
  "Dibawa" | "Sebagian terjual" | "Terjual" | "Dikembalikan";
export interface PickupBalance extends Quantity {
  status: PickupStatus;
}
export type CommandPayload = Record<string, unknown>;
