# Elkitch Mega Sale – Delivery Challan App

React + Supabase web app for raising delivery challans during the mega sale.
Full requirements: [REQUIREMENTS.md](REQUIREMENTS.md).

**Features**
- DC No. auto-generated when the form opens, editable, with a live **duplicate** warning (duplicates can't be saved)
- Line items picked from admin-managed master data. The price is fixed per item, and the amount is calculated by quantity or by weight
- Discount, final amount, Cash / Bank payment, and split payment
- Every challan records **who entered it** and **who last edited it**
- Export a single challan or a filtered list to `.xlsx`
- Admin-only master data and user management, enforced with Postgres Row Level Security

## Setup

### 1. Supabase project
1. Create a project at [supabase.com](https://supabase.com).
2. Open **SQL Editor** and run each file in [supabase/migrations/](supabase/migrations/) in order (`20261013…_init.sql`, then `20261014…_self_register_approval.sql`).
   (Or with the CLI: `supabase link` then `supabase db push`.)
3. **Authentication → Sign In / Providers → Email**: keep "Allow new users to sign up" **on** if staff should use the **Register** link on the login page. New registrations wait on the **Users** page until an admin clicks **Approve**. Turn it off to allow admin-created accounts only.

### 2. First admin
1. **Authentication → Users → Add user** (tick *Auto confirm*).
2. In the SQL Editor:
   ```sql
   update public.profiles set role = 'admin', full_name = 'Your Name'
   where email = 'you@example.com';
   ```

### 3. Edge Function (lets admins create users from the app)
```bash
npm i -g supabase
supabase login
supabase link --project-ref <your-project-ref>
supabase functions deploy admin-create-user
```
If you skip this, you can still add users in the Supabase dashboard. They get the `user` role, and an admin can change it on the **Users** page.

### 4. Run the app
```bash
cp .env.example .env.local   # fill VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm install
npm run dev
```

Production build: `npm run build`, then deploy `dist/` to Vercel / Netlify. Configure the host to serve `index.html` for all routes (SPA fallback).

## How it works

| Piece | Where |
|-------|-------|
| Schema, RLS, RPCs | `supabase/migrations/` |
| `next_dc_no()` | Sequence-based, so two staff never get the same auto number. An abandoned form leaves a gap in the numbering |
| `save_challan(payload)` | One transaction. Looks up prices from master, recomputes amounts, validates discount and split, and stamps `created_by` / `updated_by` |
| `dc_exists()` | Live duplicate check. A unique index on `upper(trim(dc_no))` is the final guard |
| Excel export | `src/lib/excel.ts`. Two sheets: *Challan Items* (one raw row per item) and *Challans* (one row per challan) |

## Roles
| | user | admin |
|--|:--:|:--:|
| Create / edit challans | ✓ | ✓ |
| Export | ✓ | ✓ |
| Delete challans | | ✓ |
| Master data (items & prices) | read only | ✓ |
| Users & roles | | ✓ |

## Scan a paper challan (photo → form)
The **📷 Scan paper challan** button on the challan form takes a photo (phone camera or file). Claude reads the handwriting, matches each item to master data, and fills the form for review. Struck-through rows are skipped, and Cash/Bank amounts become a split payment. Anything uncertain is listed in an amber "Please check" box. Nothing is saved until the user clicks Submit.

Setup (one time):
```bash
npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...   # from console.anthropic.com
npx supabase functions deploy scan-challan
```
Each scan is one Claude Opus 5.5 request. The cost is roughly a few US cents, depending on photo size and how long the product list is.
