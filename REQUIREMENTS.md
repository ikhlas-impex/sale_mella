# Elkitch Mega Sale – Delivery Challan App

Source: handwritten notes *"Requirements elkitch for mega sale.pdf"*.

A web app used by sales staff during the mega sale to raise **Delivery Challans (DC)**,
record payment, and export the data to Excel. Every record is stamped with the user who
created / last edited it. Product master data (items + fixed prices) is managed by admins only.

---

## 1. Users & Roles

| Role  | Can do |
|-------|--------|
| **admin** | Everything a user can + create users, change roles, add/edit/deactivate master products & prices, delete challans |
| **user**  | Create challans, edit challans, view list, export to Excel |

- Authentication: **Supabase Auth** (email + password).
- Each auth user has a row in `profiles` (`full_name`, `role`). A trigger creates it automatically on sign-up with role `user`.
- Admins create users from the **Users** page (via the `admin-create-user` Edge Function), or from the Supabase dashboard.
- The first admin is promoted manually with SQL (see README).
- Every challan stores `created_by`, `updated_by`, `created_at`, `updated_at`.

## 2. Delivery Challan Form

### 2.1 Header
| Field | Type | Rules |
|-------|------|-------|
| **DC No.** | text | **Auto-generated when the form opens**, **editable**. Per user: the user's last DC No. + 1, keeping prefix and padding (`EK-2806` → `EK-2807`); numbers already used are skipped; first-time users get `DC-00001`. Shows a live **"Duplicate DC No."** warning if another challan already uses it. Saving with a duplicate is blocked (unique in DB). |
| **Date** | date | Defaults to today |
| **Name** | text | Customer / party name, required |

### 2.2 Line items (repeating table)
| Column | Type | Rules |
|--------|------|-------|
| **Sl. No.** | auto | 1, 2, 3 … renumbered on add/remove |
| **Particulars** | dropdown | Selected from **master products** (active only) |
| **Weight** | number | Optional input |
| **Quantity** | number | Input |
| **Price** | number | **Read-only**, taken from master data (constant per item) |
| **Amount** | calc | `Price × Quantity` – or `Price × Weight` when the product is priced *per weight* |

### 2.3 Summary & Payment
| Field | Rules |
|-------|-------|
| **Sub Total** | Σ Amount |
| **Discount Amount** | Input, 0 ≤ discount ≤ sub total |
| **Final Amount** | Sub Total − Discount |
| **Payment Mode** | `Cash` / `Bank` |
| **Split Payment** | Toggle. When on, enter Cash amount + Bank amount; they must add up to Final Amount |

### 2.4 Actions
- **Submit** – saves challan + items to the database (atomic RPC; amounts recomputed server-side from master prices).
- **Export** – downloads the challan as a raw `.xlsx` file.
- **New** – clears the form and generates a fresh DC No.

## 3. Challan List
- Table of all challans: DC No., Date, Name, Final Amount, Payment, Entered by.
- Search (DC No. / Name) and date range filter.
- **Edit** opens the challan in the form (DC No. still editable, duplicate check excludes itself).
- **Delete** – admin only.
- **Export to Excel** – raw rows (one row per line item, with header & payment columns) for the filtered list.

## 4. Master Data (admin only)
- Products: `name`, `unit` (pcs / kg …), `price_basis` (`quantity` | `weight`), `price`, `active`.
- Add / edit / activate-deactivate. Non-admins can only read.
- Enforced by **Row Level Security**, not just hidden UI.

## 5. Data Model (Supabase / Postgres)

```
profiles      (id → auth.users, full_name, role['admin'|'user'], created_at)
products      (id, name unique, unit, price_basis, price, active, created_at, updated_at)
challans      (id, dc_no unique, dc_date, customer_name, sub_total, discount, final_amount,
               payment_mode['cash'|'bank'], is_split, cash_amount, bank_amount,
               created_by, updated_by, created_at, updated_at)
challan_items (id, challan_id → challans, sl_no, product_id → products, product_name,
               weight, quantity, price, amount)
```

Functions:
- `next_dc_no()` – returns the signed-in user's last DC No. + 1 (skipping used numbers); falls back to a shared `DC-00001` sequence for users with no challans.
- `dc_exists(p_dc_no, p_exclude_id)` – live duplicate check.
- `save_challan(payload jsonb)` – insert/update challan + items in one transaction; looks up prices from master, recomputes amounts, validates split payment, sets `created_by` / `updated_by`.
- `is_admin()` – helper for RLS policies.

## 6. Tech Stack
- **Frontend:** React 19 + Vite + TypeScript + Tailwind CSS, React Router
- **Backend:** Supabase (Auth, Postgres, RLS, RPC, Edge Function)
- **Excel:** SheetJS (`xlsx`)
- Deployable as a static site (Vercel / Netlify / Supabase hosting).

## 7. Out of scope (for now)
- Printing a formatted challan PDF
- Stock / inventory tracking
- Offline mode
