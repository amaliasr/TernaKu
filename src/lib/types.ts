export type Category = "good" | "cracked";
export type Role = "admin" | "employee";
export type RegistrationStatus = "pending" | "approved" | "rejected";
export interface MediaReference {
  kind: "production" | "sale" | "profile";
  id: string;
  version: string;
}
export interface FarmSettings {
  harvest_auto_stock: boolean;
}
export interface RegistrationAvailability {
  first_admin_required: boolean;
  setup_enabled: boolean;
}
export interface RegistrationInput {
  name: string;
  email: string;
  username?: string;
  password: string;
  password_confirmation: string;
  setup_token?: string;
}
export interface RegistrationResult {
  status: "active" | "pending";
  message: string;
  username?: string;
}
export type PaymentMethod = "cash" | "transfer" | "qris" | "credit";
export interface InvoicePayment {
  kind: "initial" | "installment";
  amount: number;
  recorded_at: string;
  user_id: string;
  method?: Exclude<PaymentMethod, "credit">;
}
export interface InvoiceLedger {
  /** Old invoices can omit both fields. Never guess their due date or payment times. */
  due_date?: string | null;
  payments?: InvoicePayment[];
}
export interface User {
  id: string;
  name: string;
  email: string;
  username?: string;
  role: Role;
  active: boolean;
  registration_status?: RegistrationStatus;
  target: number;
  avatar?: string;
  photo?: string;
  photo_ref?: MediaReference;
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
  harvest_id?: string;
  date: string;
  user_id: string;
  barn_id: string;
  category: Category;
  eggs: number;
  kg: number;
  trays: number;
  notes: string;
  photo?: string;
  photo_ref?: MediaReference;
  location?: string;
  created_at: string;
  locked: boolean;
  /** Explicit null awaits warehouse receipt; missing means legacy received stock. */
  stocked_at?: string | null;
  stocked_by?: string | null;
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
  /** The count was calculated from the available stock and measured sale weight. */
  eggs_estimated?: boolean;
  kg: number;
  trays: number;
  unit_price: number;
  /** Immutable free-gift snapshot. Older transactions may omit this field. */
  is_free?: boolean;
  total: number;
}
export interface Sale extends InvoiceLedger {
  id: string;
  number: string;
  date: string;
  user_id: string;
  /** Older sales were always made from an employee's pickup. */
  stock_source?: "warehouse" | "pickup";
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
  photo_ref?: MediaReference;
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
export interface FeedPurchase extends InvoiceLedger {
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
export type FarmActivity = "sale.create" | "production.create" | "production.stocked"
  | "production.receive" | "pickup.return" | "stock.add";
export interface Notification {
  id: string;
  user_id: string;
  title: string;
  message: string;
  created_at: string;
  read: boolean;
  type?: "farm.activity";
  event_id?: string;
  activity?: FarmActivity;
}
export interface Activity {
  id: string;
  user_id: string;
  action: string;
  description: string;
  created_at: string;
  before?: unknown;
  after?: unknown;
  /** Demo-only replay metadata, saved atomically with the new sale or harvest. */
  demo_write?: { request_id: string; fingerprint: string; record_id: string };
}
export type RecordEntity = "production" | "pickup" | "sale";
export type StockAdjustmentMethod = "count" | "add" | "subtract";
export interface StockMovement {
  id: string;
  date: string;
  created_at: string;
  user_id: string;
  category: Category;
  kind: "production" | "pickup" | "sale" | "return" | "correction" | "reconcile";
  /** Older reconcile movements always came from a physical count. */
  method?: StockAdjustmentMethod;
  /** Older physical counts recorded only eggs and kilograms. */
  expected?: StockCountQuantity;
  physical?: StockCountQuantity;
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
  /** Present only for an API snapshot/delta; never used to timestamp a transaction. */
  price_cursor?: string;
  /** Server-confirmed carried stock for pickups involved in the last live receipts. */
  pickup_balances?: Record<string, PickupBalance>;
  settings?: FarmSettings;
  command_result?: { action: string; record_id: string; request_id: string };
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
export interface PriceSyncResponse {
  mode?: "delta";
  since?: string;
  cursor?: string;
  more?: boolean;
  read_notices?: string[];
  prices: Price[];
  notifications: Notification[];
  user: Omit<User, "photo" | "photo_ref">;
  settings: FarmSettings;
}
export interface Quantity {
  eggs: number;
  kg: number;
  trays: number;
}
export type StockCountQuantity = Pick<Quantity, "eggs" | "kg"> & { trays?: number };
export type PickupStatus =
  "Dibawa" | "Sebagian terjual" | "Terjual" | "Dikembalikan";
export interface PickupBalance extends Quantity {
  status: PickupStatus;
}
export type CommandPayload = Record<string, unknown>;
