-- Plant Leave Management: restricted kiosk API for Supabase
-- Run once in Supabase SQL Editor after schema.sql and 03_overtime_schema.sql.

create or replace function public.leave_days_between(p_start date, p_end date)
returns numeric
language sql
immutable
as $$
  select count(*)::numeric
  from generate_series(p_start, p_end, interval '1 day') as day_value
  where extract(dow from day_value) <> 0;
$$;

create or replace function public.kiosk_employees()
returns table (
  id uuid,
  employee_code text,
  first_name text,
  surname text,
  nickname text,
  department text,
  supervisor text,
  manager text,
  earned numeric,
  used numeric,
  balance numeric
)
language sql
security definer
set search_path = public
as $$
  with approved_leave as (
    select
      lr.employee_id,
      coalesce(sum(lr.requested_days), 0)::numeric as used
    from public.leave_requests lr
    where lr.status = 'approved'
      and extract(year from lr.start_date) = extract(year from current_date)
    group by lr.employee_id
  ),
  reserved_leave as (
    select
      lr.employee_id,
      coalesce(sum(lr.requested_days), 0)::numeric as reserved
    from public.leave_requests lr
    where lr.status in ('pending_supervisor', 'pending_manager', 'approved')
      and extract(year from lr.start_date) = extract(year from current_date)
    group by lr.employee_id
  )
  select
    e.id,
    e.employee_id as employee_code,
    e.first_name,
    e.surname,
    coalesce(e.nickname, '') as nickname,
    coalesce(d.name, 'Unassigned') as department,
    coalesce(nullif(concat_ws(' ', supervisor_employee.first_name, supervisor_employee.surname), ''), 'Not assigned') as supervisor,
    'Not assigned'::text as manager,
    case
      when lb.employee_id is null then (extract(month from current_date)::numeric * 2)
      else lb.accrued
    end as earned,
    coalesce(al.used, 0) as used,
    (
      coalesce(lb.opening_balance, 0)
      + case
          when lb.employee_id is null then (extract(month from current_date)::numeric * 2)
          else lb.accrued
        end
      + coalesce(lb.adjusted, 0)
      - coalesce(rl.reserved, 0)
    )::numeric as balance
  from public.employees e
  left join public.departments d on d.id = e.department_id
  left join public.employees supervisor_employee on supervisor_employee.id = e.supervisor_employee_id
  left join public.leave_balances lb on lb.employee_id = e.id
  left join approved_leave al on al.employee_id = e.id
  left join reserved_leave rl on rl.employee_id = e.id
  where e.active = true
  order by e.surname, e.first_name;
$$;

create or replace function public.kiosk_leave_requests()
returns table (
  id uuid,
  employee_id uuid,
  start_date date,
  end_date date,
  requested_days numeric,
  comment text,
  status text,
  created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    lr.id,
    lr.employee_id,
    lr.start_date,
    lr.end_date,
    lr.requested_days,
    coalesce(lr.comment, '') as comment,
    lr.status::text,
    lr.created_at
  from public.leave_requests lr
  order by lr.created_at desc;
$$;

create or replace function public.kiosk_overtime_requests()
returns table (
  id uuid,
  employee_id uuid,
  overtime_date date,
  start_time time,
  end_time time,
  break_minutes integer,
  total_hours numeric,
  reason text,
  status text,
  created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    overtime.id,
    overtime.employee_id,
    overtime.overtime_date,
    overtime.start_time,
    overtime.end_time,
    overtime.break_minutes,
    overtime.total_hours,
    coalesce(overtime.reason, '') as reason,
    overtime.status::text,
    overtime.created_at
  from public.overtime_requests overtime
  order by overtime.created_at desc;
$$;

create or replace function public.kiosk_submit_leave(
  p_employee_id uuid,
  p_start_date date,
  p_end_date date,
  p_comment text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_days numeric;
  v_balance numeric;
  v_request_id uuid;
begin
  if p_start_date is null or p_end_date is null or p_end_date < p_start_date then
    raise exception 'Invalid leave dates';
  end if;

  if not exists (
    select 1 from public.employees e where e.id = p_employee_id and e.active = true
  ) then
    raise exception 'Employee not found';
  end if;

  v_days := public.leave_days_between(p_start_date, p_end_date);
  if v_days <= 0 then
    raise exception 'The selected period contains no leave day';
  end if;

  if exists (
    select 1
    from public.leave_requests lr
    where lr.employee_id = p_employee_id
      and lr.status in ('pending_supervisor', 'pending_manager', 'approved')
      and daterange(lr.start_date, lr.end_date, '[]') && daterange(p_start_date, p_end_date, '[]')
  ) then
    raise exception 'A leave request already overlaps these dates';
  end if;

  select employee_list.balance
  into v_balance
  from public.kiosk_employees() employee_list
  where employee_list.id = p_employee_id;

  if coalesce(v_balance, 0) < v_days then
    raise exception 'Not enough leave balance';
  end if;

  insert into public.leave_requests (
    employee_id,
    start_date,
    end_date,
    requested_days,
    comment,
    status
  )
  values (
    p_employee_id,
    p_start_date,
    p_end_date,
    v_days,
    nullif(trim(coalesce(p_comment, '')), ''),
    'pending_supervisor'
  )
  returning id into v_request_id;

  insert into public.leave_audit_log (
    leave_request_id,
    action,
    new_status,
    notes
  ) values (
    v_request_id,
    'submitted_from_kiosk',
    'pending_supervisor',
    'Employee submission from factory kiosk'
  );

  return v_request_id;
end;
$$;

create or replace function public.kiosk_submit_overtime(
  p_employee_id uuid,
  p_overtime_date date,
  p_start_time time,
  p_end_time time,
  p_break_minutes integer default 0,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start timestamptz;
  v_end timestamptz;
  v_total_minutes numeric;
  v_total_hours numeric;
  v_request_id uuid;
begin
  if p_overtime_date is null or p_start_time is null or p_end_time is null then
    raise exception 'Invalid overtime date or time';
  end if;

  if coalesce(p_break_minutes, 0) < 0 then
    raise exception 'Break minutes cannot be negative';
  end if;

  if not exists (
    select 1 from public.employees e where e.id = p_employee_id and e.active = true
  ) then
    raise exception 'Employee not found';
  end if;

  v_start := (p_overtime_date + p_start_time) at time zone 'UTC';
  v_end := (p_overtime_date + p_end_time) at time zone 'UTC';

  if v_end <= v_start then
    v_end := v_end + interval '1 day';
  end if;

  v_total_minutes := extract(epoch from (v_end - v_start)) / 60 - coalesce(p_break_minutes, 0);
  v_total_hours := round((v_total_minutes / 60)::numeric, 2);

  if v_total_hours <= 0 or v_total_hours > 24 then
    raise exception 'Overtime duration must be greater than 0 and no more than 24 hours';
  end if;

  if exists (
    select 1
    from public.overtime_requests overtime
    where overtime.employee_id = p_employee_id
      and overtime.overtime_date = p_overtime_date
      and overtime.start_time = p_start_time
      and overtime.end_time = p_end_time
      and overtime.status not in ('rejected', 'cancelled')
  ) then
    raise exception 'This overtime request already exists';
  end if;

  insert into public.overtime_requests (
    employee_id,
    overtime_date,
    start_time,
    end_time,
    break_minutes,
    total_hours,
    reason,
    status
  )
  values (
    p_employee_id,
    p_overtime_date,
    p_start_time,
    p_end_time,
    coalesce(p_break_minutes, 0),
    v_total_hours,
    nullif(trim(coalesce(p_reason, '')), ''),
    'pending_supervisor'
  )
  returning id into v_request_id;

  insert into public.overtime_audit_log (
    overtime_request_id,
    action,
    new_status,
    notes
  ) values (
    v_request_id,
    'submitted_from_kiosk',
    'pending_supervisor',
    'Employee submission from factory kiosk'
  );

  return v_request_id;
end;
$$;

revoke all on function public.kiosk_employees() from public;
revoke all on function public.kiosk_leave_requests() from public;
revoke all on function public.kiosk_overtime_requests() from public;
revoke all on function public.kiosk_submit_leave(uuid, date, date, text) from public;
revoke all on function public.kiosk_submit_overtime(uuid, date, time, time, integer, text) from public;

grant execute on function public.kiosk_employees() to anon, authenticated;
grant execute on function public.kiosk_leave_requests() to anon, authenticated;
grant execute on function public.kiosk_overtime_requests() to anon, authenticated;
grant execute on function public.kiosk_submit_leave(uuid, date, date, text) to anon, authenticated;
grant execute on function public.kiosk_submit_overtime(uuid, date, time, time, integer, text) to anon, authenticated;

-- Tables remain protected by RLS. The public key can only use the five functions above.
