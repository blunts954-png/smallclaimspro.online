# Supabase Setup (SmallClaimsPro.online)

Use this guide to connect the landing page form directly to Supabase.

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

## 3) Allow public inserts only

This lets your website submit form rows with the anon key.

```sql
create policy "Allow anon inserts"
on public.intake_submissions
for insert
to anon
with check (true);
```

Optional hardening: if you do not need public reads, do not create any select policy.

## 4) Configure `app.js`

Update the `CONFIG` values:

- `supabaseUrl`: your project URL (example: `https://qxdoiixdsxgqxylygkxp.supabase.co`)
- `supabaseAnonKey`: from Supabase -> Settings -> API -> Project API keys -> `anon public`
- `supabaseTable`: keep as `intake_submissions` unless you renamed it

Do not put your Postgres password or service-role key in frontend code.

## 5) Test

1. Deploy or run locally.
2. Submit the intake form.
3. In Supabase -> Table Editor -> `intake_submissions`, confirm a new row appears.

## 6) Optional Edge Function (automation hook)

The frontend now calls `process-intake-submission` after a successful insert.

Create function:

```bash
supabase functions new process-intake-submission
```

Deploy function:

```bash
supabase functions deploy process-intake-submission
```

Basic function shape (reads form payload from request body):

```ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

serve(async (req) => {
  const payload = await req.json();
  console.log("New intake submission:", payload.email, payload.createdAt);

  // TODO: call OpenAI, send email, update CRM, etc.
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  });
});
```

If the function is not deployed yet, form inserts still succeed.
