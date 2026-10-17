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
The **📷 Scan paper challan** button on the challan form takes a photo with the phone camera or from a file. The photo is shrunk in the browser and sent to the `scan-challan` Edge Function. There, **Google Gemini (free tier)** reads the handwriting and matches each item to master data. The form is then filled for review: struck-through rows are skipped, and Cash/Bank amounts become a split payment. Anything uncertain is listed in an amber "Please check" box. Nothing is saved until the user clicks Submit.

Setup (one time):
1. Create a free API key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey). No billing is needed.
2. Run:
   ```bash
   npx supabase secrets set GEMINI_API_KEY=your-key
   npx supabase functions deploy scan-challan
   ```
3. **Change the key or add more accounts:** run `npx supabase secrets set GEMINI_API_KEY=key1,key2` (comma-separated, no spaces needed). It takes effect immediately without redeploying. Keys are used in order. When one account's free quota runs out or its key is invalid, the next one is used, so each extra Google account adds its own free daily scans.
4. Optional: change the model with `npx supabase secrets set GEMINI_MODEL=gemini-3.6-flash`. The default is `gemini-3.8-flash`.

Free-tier notes:
- Daily limits apply per Google project. Check them under AI Studio → Rate limits. They reset at midnight Pacific (12:30 PM IST). When the limit is hit, staff see a message and type the challan instead.
- On the free tier, Google may use the photos to improve its products.
