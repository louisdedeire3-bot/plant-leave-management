-- Overtime module for Plant Leave Management
-- Run once in Supabase SQL Editor.

do $$
begin
  create type public.overtime_status as enum (
    'pending_supervisor',
    'pending_manager',
    'approved',
    'rejected',
    'cancelled'
  );
exception
  when duplicate_object then null;
end $$;

create table if not exists public.overtime_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,

  overtime_date date not null,
  start_time time not null,
  end_time time not null,
  break_minutes integer not null default 0,
  total_hours numeric(8,2) not null,

  reason text,
  status public.overtime_status not null default 'pending_supervisor',

  supervisor_approved_by uuid references auth.users(id),
  supervisor_approved_at timestamptz,
  supervisor_comment text,

  manager_approved_by uuid references auth.users(id),
  manager_approved_at timestamptz,
  manager_comment text,

  rejected_by uuid references auth.users(id),
  rejected_at timestamptz,
  rejection_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint overtime_break_valid check (break_minutes >= 0),
  constraint overtime_hours_positive check (total_hours > 0),
  constraint overtime_hours_reasonable check (total_hours <= 24)
);

create table if not exists public.overtime_audit_log (
  id bigint generated always as identity primary key,
  overtime_request_id uuid references public.overtime_requests(id) on delete cascade,
  action text not null,
  previous_status public.overtime_status,
  new_status public.overtime_status,
  performed_by uuid references auth.users(id),
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists overtime_requests_employee_idx
  on public.overtime_requests(employee_id);

create index if not exists overtime_requests_date_idx
  on public.overtime_requests(overtime_date);

create index if not exists overtime_requests_status_idx
  on public.overtime_requests(status);

alter table public.overtime_requests enable row level security;
alter table public.overtime_audit_log enable row level security;
