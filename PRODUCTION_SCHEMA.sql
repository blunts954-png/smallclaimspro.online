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

create table if not exists public.pipeline_jobs (
  id bigserial primary key,
  job_key text not null unique,
  job_type text not null,
  status text not null default 'pending',
  attempts int not null default 0,
  max_attempts int not null default 3,
  run_after timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  last_error text,
  sla_alerted_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pipeline_jobs_status_idx on public.pipeline_jobs(status);
create index if not exists pipeline_jobs_run_after_idx on public.pipeline_jobs(run_after);
create index if not exists pipeline_jobs_created_at_idx on public.pipeline_jobs(created_at desc);

alter table public.pipeline_jobs enable row level security;

drop policy if exists "No public access to pipeline jobs" on public.pipeline_jobs;
create policy "No public access to pipeline jobs"
  on public.pipeline_jobs
  for all
  to public
  using (false)
  with check (false);

create table if not exists public.review_queue (
  id bigserial primary key,
  source_job_key text not null unique,
  job_type text not null,
  confidence_score numeric(5,4),
  reason text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists review_queue_status_idx on public.review_queue(status);
create index if not exists review_queue_created_at_idx on public.review_queue(created_at desc);

alter table public.review_queue enable row level security;

drop policy if exists "No public access to review queue" on public.review_queue;
create policy "No public access to review queue"
  on public.review_queue
  for all
  to public
  using (false)
  with check (false);
