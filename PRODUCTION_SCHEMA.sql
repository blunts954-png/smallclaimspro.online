-- Run in Supabase SQL editor for production pipeline support.

create table if not exists public.pipeline_events (
  id bigserial primary key,
  event_id text not null unique,
  event_type text not null,
  status text not null default 'received',
  error_message text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pipeline_events_status_idx on public.pipeline_events(status);
create index if not exists pipeline_events_created_at_idx on public.pipeline_events(created_at desc);

-- Keep RLS on and avoid public access.
alter table public.pipeline_events enable row level security;

drop policy if exists "No public access to pipeline events" on public.pipeline_events;
create policy "No public access to pipeline events"
  on public.pipeline_events
  for all
  to public
  using (false)
  with check (false);
