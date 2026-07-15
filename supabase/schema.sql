-- Plant Leave Management - initial PostgreSQL schema
-- Run this in the Supabase SQL editor after creating the project.

create extension if not exists pgcrypto;

create type public.app_role as enum ('supervisor', 'manager', 'admin');
create type public.leave_status as enum (
  'pending_supervisor',
  'pending_manager',
  'approved',
  'rejected',
  'cancelled'
);

create table public.departments (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  maximum_simultaneous_leave integer,
  created_at timestamptz not null default now()
);

create table public.employees (
  id uuid primary key default gen_random_uuid(),
  employee_id text not null unique,
  first_name text not null,
  surname text not null,
  nickname text,
  department_id uuid references public.departments(id),
  supervisor_employee_id uuid references public.employees(id),
  hire_date date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  employee_id uuid references public.employees(id),
  role public.app_role not null,
  created_at timestamptz not null default now()
);

create table public.leave_balances (
  employee_id uuid primary key references public.employees(id) on delete cascade,
  opening_balance numeric(8,2) not null default 0,
  accrued numeric(8,2) not null default 0,
  used numeric(8,2) not null default 0,
  adjusted numeric(8,2) not null default 0,
  updated_at timestamptz not null default now()
);

create table public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id),
  start_date date not null,
  end_date date not null,
  requested_days numeric(8,2) not null,
  comment text,
  status public.leave_status not null default 'pending_supervisor',
  supervisor_approved_by uuid references auth.users(id),
  supervisor_approved_at timestamptz,
  manager_approved_by uuid references auth.users(id),
  manager_approved_at timestamptz,
  rejected_by uuid references auth.users(id),
  rejected_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint leave_dates_valid check (end_date >= start_date),
  constraint leave_days_positive check (requested_days > 0)
);

create table public.leave_audit_log (
  id bigint generated always as identity primary key,
  leave_request_id uuid references public.leave_requests(id) on delete cascade,
  action text not null,
  previous_status public.leave_status,
  new_status public.leave_status,
  performed_by uuid references auth.users(id),
  notes text,
  created_at timestamptz not null default now()
);

alter table public.departments enable row level security;
alter table public.employees enable row level security;
alter table public.user_profiles enable row level security;
alter table public.leave_balances enable row level security;
alter table public.leave_requests enable row level security;
alter table public.leave_audit_log enable row level security;

-- Public kiosk read access should be exposed through a restricted server action or RPC,
-- not by allowing anonymous access to all employee records.
-- Add production RLS policies after manager/supervisor authentication is configured.
