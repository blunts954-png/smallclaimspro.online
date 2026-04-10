# Supabase Setup (SmallClaimsPro.online)

Use this guide to connect intake + payment webhooks through Netlify Functions to Supabase.

## 1) Create intake table

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

## 4) Create pipeline dedupe table

Run `PRODUCTION_SCHEMA.sql` in Supabase SQL editor.

This creates `pipeline_events`, which powers:

- webhook idempotency (dedupe by `event_id`)
- delivery status tracking (`received`, `completed`, `failed`)
- replay visibility for production incidents

## 5) Configure Netlify Environment Variables

In Netlify -> Site configuration -> Environment variables, add:

- `SUPABASE_URL` (example: `https://your-project-ref.supabase.co`)
- `SUPABASE_SERVICE_ROLE_KEY` (from Supabase -> Settings -> API -> service_role key)
- `AUTO_PROCESS_INTAKE` (`true` to auto-generate + send free plan)
- `OPENAI_API_KEY`
- `OPENAI_MODEL` (optional; defaults to `gpt-4.1-mini`)
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL` (example: `support@smallclaimspro.online`)
- `SQUARE_WEBHOOK_SIGNATURE_KEY`
- `SQUARE_WEBHOOK_NOTIFICATION_URL` (exact URL configured in Square dashboard)
- `OPS_ALERT_WEBHOOK_URL` (optional; Slack/Discord/webhook for failures)
- `INTAKE_WEBHOOK_URL` (optional; secondary event sink)

Do not put the service-role key in frontend code.

## 6) Deploy functions

This repo includes:

- `netlify/functions/intake-submit.js`
- `netlify/functions/square-webhook.js`

On deploy, Netlify exposes:

- `/.netlify/functions/intake-submit`
- `/.netlify/functions/square-webhook`

## 7) Test end-to-end

1. Deploy or run locally.
2. Submit the intake form.
3. Submit the intake form from production URL.
4. Confirm row appears in Supabase `intake_submissions`.
5. Confirm free-plan email sends (if `AUTO_PROCESS_INTAKE=true`).
6. Create a Square test payment and verify `pipeline_events` records the event.
7. Confirm paid packet email sends for $29 or $99 tiers.
