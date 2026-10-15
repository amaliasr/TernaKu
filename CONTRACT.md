# TernaKu implementation contract

Frontend: Next.js App Router + React + TypeScript, Bootstrap 5, Poppins. Static export deployable on any web hosting. Backend: CodeIgniter 3 + MySQL (InnoDB), separate origin `https://api.buildmanagement.id/ternaku`. UI Indonesian. Repository root contains frontend, `api/` contains CI3 application and SQL.

API base routes: `GET /health`, `POST /auth/login` `{email,password}`, `POST /auth/logout`, `GET /bootstrap`, `POST /commands` `{action,payload,request_id}`. JSON success `{data: ...}`, error `{error: string}` with appropriate status. Login data `{token,user}`. Bearer token; store hashed tokens in DB, expiration, active user check every request. Bootstrap returns State; employees see only their own production/pickup/sales/corrections, public prices/barns/feed plus safe user list and aggregated inventory/feed_inventory, their notifications, no admin audit. All amounts, IDs and dates match `src/lib/types.ts`. Prices are integer Rupiah/kg; weight precision 3 decimal places. Indonesia business timezone Asia/Jakarta.

Public registration: `GET /auth/registration-status` returns `{first_admin_required,setup_enabled}`; `POST /auth/register` accepts only `{name,email,password,password_confirmation,setup_token?}` and returns `{status:'active'|'pending',message}` without a login token. The Daftar button always remains visible on the login screen. Only an empty users table plus a valid owner setup key may create the first admin. Subsequent registrations are employees of the same farm, inactive and pending admin approval; clients cannot choose a role. Passwords preserve whitespace, require at least 12 Unicode characters, and cannot exceed 72 UTF-8 bytes. Pending/rejected users cannot authenticate even if their active flag is inconsistent. Registration status is stored in records; existing/manual accounts default to approved. Setup, duplicate emails, and approval are serialized with the command mutex; signup is limited per IP and email. Owner setup keys/passwords must never enter audit records or public deployment packages.

Commands (all produce refreshed bootstrap State as response data):

- production.create: `{date,barn_id,category,eggs,kg,trays,notes,photo?,location?}`; own recorder; stock increase; valid positive eggs/kg, trays nonnegative independent actual kg.
- pickup.create: `{date,category,eggs,kg,trays,area,notes}`; own employee; locked stock validation both kg and eggs.
- pickup.return: `{id,eggs,kg,trays,notes}` returns unsold balance only, update returned_kg/returned_eggs; status derived.
- sale.create: `{date,customer,phone,items:[{pickup_id,category,eggs,kg,trays}],payment_method,paid,notes,photo?,expected_price_id?}`. Validate own pickup balances, transaction-time active prices (server NOW, never trust user backdate for pricing), save immutable price snapshots, atomic sale; no manual price; total and outstanding server-derived. Staff pickup stock (not warehouse) is consumed.
- sale.payment: `{id,amount}` additional payment not exceeding debt, own/admin. Log.
- price.create ADMIN: `{good_price,cracked_price,effective_at}` no deletes; notify all. active price <= now. effective datetime includes timezone or unambiguous local.
- user.create ADMIN: `{name,email,password,role,target}` hash password, unique email.
- user.update ADMIN: `{id,name?,active?,target?}` prevent self-disable/last admin lockout.
- user.approve ADMIN: `{id}` approve pending/rejected employee registration and activate the account.
- user.reject ADMIN: `{id}` reject pending employee registration. Generic user.update cannot activate pending/rejected registrations.
- Incentives: Coming Soon only; no calculations.
- barn.create ADMIN: `{name,type,capacity,notes}` type ayam.
- Cattle management: Coming Soon only.

- feed.create ADMIN: `{name,unit,min_stock}` unit kg, initial 0.
- feed.purchase ADMIN: `{date,supplier,items:[{feed_id,quantity,unit_price}],paid,notes}` auto invoice PURCHASE number; stock increase; total derived.
- feed.use: `{date,feed_id,barn_id,quantity,notes}` consume quantity <= available locked feed balance.
- notification.read: `{id}` own notification only (or id all).
- correction.request: `{entity:'production'|'sale'|'pickup',id,reason,changes}` requires reason >= 5 chars. Employees unlocked own production may correct using correction.apply, otherwise request.
- correction.apply: `{entity,id,reason,changes}` ADMIN or own unlocked production. Validate all stock/ownership/financial invariants; reason >= 5, store before/after audit. Support production eggs/kg/trays/notes; pickup eggs/kg/trays/notes/area; sale notes/customer/items. Sale items must include all original lines exactly once as {id,eggs,kg,trays}; item price/category/pickup stay immutable. Recompute using historical prices, preserve paid, reject revised total below paid because refunds are not available. Validate all pickup balances after excluding original sale. Pickup corrections apply inverse quantity delta to warehouse and append a dated correction movement; cannot reduce below sold plus returned amounts.
- correction.review ADMIN `{id,approved}` applies safe allowed changes through same validation, record status.
- record.lock ADMIN `{entity,id,locked}`.

All writes atomic, nonnegative quantities, finite numbers, validation; server permissions mandatory. Reject over-selling, over-pickup, over-return/feed use. MySQL row locking and rollback. Employee sales restricted own; cannot override price, user_id, totals. Audit each write, mandatory correction reason.

Local demonstration is explicit in UI and uses localStorage; no fake API fallback. Demo only behind NEXT_PUBLIC_DEMO_MODE=true (default developer preview via .env.local, gitignored). Production config defaults false. Mode must clearly show DEMO. API env configured, real login if demo disabled. Demo data separate from live state.

Authoritative types: src/lib/types.ts. Category good/cracked; Role admin/employee; string IDs; payment_method cash/transfer/qris/credit. All state collections use plural names in types. Employee bootstrap includes inventory {good:{eggs,kg,trays},cracked:{eggs,kg,trays}} and feed_inventory keyed by feed ID so warehouse/feed balances stay correct while individual rows remain private.
