# Supabase Setup (SmallClaimsPro.online)

Use this guide to connect the landing page form through Netlify Functions to Supabase.

## 1) Create table

Run this SQL in Supabase SQL Editor:

```sql
create table if not exists public.intake_submissions (
  id bigserial primary key,
  name text not null,
  email text not null,
  phone text,
  description text not null,
  consent boolean not null default false,
  source text not null,
  created_at timestamptz not null default now()
);
```

## 2) Enable Row Level Security

```sql
alter table public.intake_submissions enable row level security;
```

## 3) Tighten policies (recommended)

Because submissions now run through a server-side Netlify Function using the service role key,
you should avoid direct public inserts from the browser.

```sql
drop policy if exists "Allow anon inserts" on public.intake_submissions;
```

Leave RLS enabled and do not create public `select` policies unless required.

## 4) Configure Netlify Environment Variables

In Netlify -> Site configuration -> Environment variables, add:

- `SUPABASE_URL` (example: `https://your-project-ref.supabase.co`)
- `SUPABASE_SERVICE_ROLE_KEY` (from Supabase -> Settings -> API -> service_role key)
- `INTAKE_WEBHOOK_URL` (optional; Slack/Zapier/custom webhook for instant alerts)

Do not put the service-role key in frontend code.

## 5) Deploy function

This repo includes `netlify/functions/intake-submit.js`.

On deploy, Netlify exposes:

- `/.netlify/functions/intake-submit`

`app.js` posts to this endpoint first and only falls back to Netlify Forms if needed.

## 6) Test end-to-end

1. Deploy or run locally.
2. Submit the intake form.
3. Submit the intake form from production URL.
4. Confirm row appears in Supabase `intake_submissions`.
5. If configured, verify `INTAKE_WEBHOOK_URL` receives the event.
6. Temporarily break `SUPABASE_SERVICE_ROLE_KEY` and verify fallback still captures form via Netlify Forms.
