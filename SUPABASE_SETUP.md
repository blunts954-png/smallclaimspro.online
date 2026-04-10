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

This creates:

- `pipeline_events` for webhook idempotency
- `pipeline_jobs` for async queue processing + retries
- `review_queue` for low-confidence AI outputs requiring human review

## 5) Configure Netlify Environment Variables

In Netlify -> Site configuration -> Environment variables, add:

- `SUPABASE_URL` (example: `https://your-project-ref.supabase.co`)
- `SUPABASE_SERVICE_ROLE_KEY` (from Supabase -> Settings -> API -> service_role key)
- `AUTO_PROCESS_INTAKE` (`true` to auto-generate + send free plan)
- `OPENAI_API_KEY`
- `OPENAI_MODEL` (optional; defaults to `gpt-4.1-mini`)
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL` (example: `support@smallclaimspro.online`)
- `PDFSHIFT_API_KEY` (optional; PDF attachments)
- `SQUARE_WEBHOOK_SIGNATURE_KEY`
- `SQUARE_WEBHOOK_NOTIFICATION_URL` (exact URL configured in Square dashboard)
- `WORKER_SECRET` (used by queue worker + SLA monitor)
- `ADMIN_REPLAY_TOKEN` (for replay endpoint access)
- `AI_CONFIDENCE_THRESHOLD` (suggested `0.72`)
- `JOB_SLA_MINUTES` (suggested `15`)
- `OPS_ALERT_WEBHOOK_URL` (optional; Slack/Discord/webhook for failures)
- `INTAKE_WEBHOOK_URL` (optional; secondary event sink)

Do not put the service-role key in frontend code.

## 6) Deploy functions

This repo includes:

- `netlify/functions/intake-submit.js`
- `netlify/functions/square-webhook.js`
- `netlify/functions/queue-worker.js`
- `netlify/functions/admin-replay.js`
- `netlify/functions/sla-monitor.js`

On deploy, Netlify exposes:

- `/.netlify/functions/intake-submit`
- `/.netlify/functions/square-webhook`
- `/.netlify/functions/queue-worker`
- `/.netlify/functions/admin-replay`
- `/.netlify/functions/sla-monitor`

## 7) Test end-to-end

1. Deploy or run locally.
2. Submit the intake form.
3. Submit the intake form from production URL.
4. Confirm row appears in Supabase `intake_submissions`.
5. Confirm free-plan email sends (if `AUTO_PROCESS_INTAKE=true`).
6. Create a Square test payment and verify `pipeline_events` records the event.
7. Trigger `queue-worker` and verify queued jobs complete.
8. Confirm paid packet email sends for $29 or $99 tiers.
9. Force a low-confidence run and verify a `review_queue` entry is created.
