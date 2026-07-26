-- 37_INCOMING_LOADS_AND_SCREENING_SELECTION.sql
-- Green Charcoal Namibia
--
-- Adds Management-entered incoming charcoal loads.
-- Screening Supervisors select an existing incoming farmer lot instead of typing it.
--
-- Status workflow:
--   AVAILABLE -> IN_SCREENING -> PENDING_VALIDATION -> SCREENED
--
-- Run this AFTER SQL 36.

begin;

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1) Incoming charcoal loads entered by Management
-- ---------------------------------------------------------------------------

create table if not exists public.incoming_charcoal_loads (
  id uuid primary key default gen_random_uuid(),
  lot_number text not null,
  farmer_name text not null,
  farm_name text,
  received_date date not null default current_date,
  received_weight_kg numeric(14,3) not null,
  truck_registration text,
  transporter_name text,
  driver_name text,
  notes text,
  status text not null default 'AVAILABLE',
  created_by_account_id uuid not null references public.portal_accounts(id),
  cancelled_by_account_id uuid references public.portal_accounts(id),
  cancelled_at timestamptz,
  cancellation_comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint incoming_charcoal_status_check
    check (status in (
      'AVAILABLE',
      'IN_SCREENING',
      'PENDING_VALIDATION',
      'SCREENED',
      'CANCELLED'
    )),
  constraint incoming_charcoal_lot_not_blank
    check (length(trim(lot_number)) > 0),
  constraint incoming_charcoal_farmer_not_blank
    check (length(trim(farmer_name)) > 0),
  constraint incoming_charcoal_weight_positive
    check (received_weight_kg > 0)
);

create unique index if not exists incoming_charcoal_lot_number_unique
  on public.incoming_charcoal_loads(lower(trim(lot_number)));

create index if not exists incoming_charcoal_status_idx
  on public.incoming_charcoal_loads(status, received_date desc);

alter table public.incoming_charcoal_loads enable row level security;
revoke all on table public.incoming_charcoal_loads from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2) Link every screening record to its incoming load
-- ---------------------------------------------------------------------------

alter table public.screening_loads
  add column if not exists incoming_load_id uuid
  references public.incoming_charcoal_loads(id);

create unique index if not exists screening_loads_incoming_load_unique
  on public.screening_loads(incoming_load_id)
  where incoming_load_id is not null
    and status <> 'CANCELLED';

-- Preserve any screening records already entered before this migration.
insert into public.incoming_charcoal_loads(
  lot_number,
  farmer_name,
  received_date,
  received_weight_kg,
  notes,
  status,
  created_by_account_id,
  created_at,
  updated_at
)
select
  load.raw_lot_number,
  'Legacy imported load',
  load.screening_date,
  greatest(load.raw_weight_kg, 0.001),
  'Automatically created from a screening record entered before SQL 37.',
  case load.status
    when 'DRAFT' then 'IN_SCREENING'
    when 'SUBMITTED' then 'PENDING_VALIDATION'
    when 'VALIDATED' then 'SCREENED'
    when 'CANCELLED' then 'CANCELLED'
    else 'AVAILABLE'
  end,
  load.created_by_account_id,
  load.created_at,
  load.updated_at
from public.screening_loads load
where load.incoming_load_id is null
on conflict (lower(trim(lot_number))) do nothing;

update public.screening_loads load
set incoming_load_id = incoming.id
from public.incoming_charcoal_loads incoming
where load.incoming_load_id is null
  and lower(trim(incoming.lot_number)) = lower(trim(load.raw_lot_number));

-- ---------------------------------------------------------------------------
-- 3) JSON helpers
-- ---------------------------------------------------------------------------

create or replace function public.incoming_charcoal_load_json(p_load_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'id', incoming.id,
    'lotNumber', incoming.lot_number,
    'farmerName', incoming.farmer_name,
    'farmName', coalesce(incoming.farm_name, ''),
    'receivedDate', incoming.received_date,
    'receivedWeightKg', incoming.received_weight_kg,
    'truckRegistration', coalesce(incoming.truck_registration, ''),
    'transporterName', coalesce(incoming.transporter_name, ''),
    'driverName', coalesce(incoming.driver_name, ''),
    'notes', coalesce(incoming.notes, ''),
    'status', incoming.status,
    'cancellationComment', coalesce(incoming.cancellation_comment, ''),
    'createdAt', incoming.created_at,
    'createdBy', coalesce(account.display_name, account.login_id, '')
  )
  from public.incoming_charcoal_loads incoming
  left join public.portal_accounts account
    on account.id = incoming.created_by_account_id
  where incoming.id = p_load_id;
$$;

revoke all on function public.incoming_charcoal_load_json(uuid) from public;

create or replace function public.screening_load_json(p_load_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'id', load.id,
    'incomingLoadId', load.incoming_load_id,
    'screeningDate', load.screening_date,
    'shift', load.shift,
    'rawLotNumber', load.raw_lot_number,
    'rawWeightKg', load.raw_weight_kg,
    'farmerName', coalesce(incoming.farmer_name, ''),
    'farmName', coalesce(incoming.farm_name, ''),
    'receivedDate', incoming.received_date,
    'truckRegistration', coalesce(incoming.truck_registration, ''),
    'transporterName', coalesce(incoming.transporter_name, ''),
    'lineName', coalesce(load.line_name, ''),
    'status', load.status,
    'notes', coalesce(load.notes, ''),
    'returnComment', coalesce(load.return_comment, ''),
    'createdAt', load.created_at,
    'submittedAt', load.submitted_at,
    'validatedAt', load.validated_at,
    'createdBy', coalesce(creator.display_name, creator.login_id, ''),
    'validatedBy', coalesce(validator.display_name, validator.login_id, ''),
    'totalOutputKg', coalesce((
      select sum(product.total_weight_kg)
      from public.screening_load_products product
      where product.screening_load_id = load.id
    ), 0),
    'differenceKg', load.raw_weight_kg - coalesce((
      select sum(product.total_weight_kg)
      from public.screening_load_products product
      where product.screening_load_id = load.id
    ), 0),
    'yieldPercent', case
      when load.raw_weight_kg > 0 then round(
        (
          coalesce((
            select sum(product.total_weight_kg)
            from public.screening_load_products product
            where product.screening_load_id = load.id
          ), 0) / load.raw_weight_kg * 100
        )::numeric,
        2
      )
      else 0
    end,
    'products', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', product.id,
          'productType', product.product_type,
          'erpLotNumber', coalesce(product.erp_lot_number, ''),
          'bigBagCount', product.big_bag_count,
          'totalWeightKg', product.total_weight_kg,
          'averageBagWeightKg', case
            when product.big_bag_count > 0
              then round((product.total_weight_kg / product.big_bag_count)::numeric, 2)
            else 0
          end,
          'yieldPercent', case
            when load.raw_weight_kg > 0
              then round((product.total_weight_kg / load.raw_weight_kg * 100)::numeric, 2)
            else 0
          end
        )
        order by case product.product_type
          when 'STANDARD' then 1
          when 'RESTAURANT' then 2
          when 'FINES' then 3
          when 'SAND_ASH' then 4
          when 'UNBURNT' then 5
          else 6
        end
      )
      from public.screening_load_products product
      where product.screening_load_id = load.id
    ), '[]'::jsonb),
    'employees', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', employee.id,
          'employeeCode', employee.employee_id,
          'employeeName', concat_ws(' ', employee.first_name, employee.surname),
          'department', coalesce(department.name, 'Unassigned'),
          'position', coalesce(employee.position_title, employee.primary_role, '')
        )
        order by employee.surname, employee.first_name
      )
      from public.screening_load_employees member
      join public.employees employee on employee.id = member.employee_id
      left join public.departments department on department.id = employee.department_id
      where member.screening_load_id = load.id
    ), '[]'::jsonb)
  )
  from public.screening_loads load
  left join public.incoming_charcoal_loads incoming
    on incoming.id = load.incoming_load_id
  left join public.portal_accounts creator
    on creator.id = load.created_by_account_id
  left join public.portal_accounts validator
    on validator.id = load.validated_by_account_id
  where load.id = p_load_id;
$$;

revoke all on function public.screening_load_json(uuid) from public;

-- ---------------------------------------------------------------------------
-- 4) Bootstrap data for the standalone Screening frontend
-- ---------------------------------------------------------------------------

create or replace function public.portal_screening_bootstrap(
  p_token text,
  p_limit integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_context record;
  v_result jsonb;
begin
  select * into v_context from public.portal_context(p_token);

  if not found
     or v_context.account_role not in ('supervisor', 'manager', 'admin') then
    raise exception 'Supervisor or Manager access required';
  end if;

  select jsonb_build_object(
    'incomingLoads', coalesce((
      select jsonb_agg(
        public.incoming_charcoal_load_json(recent.id)
        order by recent.received_date desc, recent.created_at desc
      )
      from (
        select incoming.id, incoming.received_date, incoming.created_at
        from public.incoming_charcoal_loads incoming
        order by incoming.received_date desc, incoming.created_at desc
        limit greatest(1, least(coalesce(p_limit, 100), 500))
      ) recent
    ), '[]'::jsonb),
    'employees', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', employee.id,
          'employeeCode', employee.employee_id,
          'employeeName', concat_ws(' ', employee.first_name, employee.surname),
          'department', coalesce(department.name, 'Unassigned'),
          'position', coalesce(employee.position_title, employee.primary_role, '')
        )
        order by department.name nulls last, employee.surname, employee.first_name
      )
      from public.employees employee
      left join public.departments department on department.id = employee.department_id
      where coalesce(employee.active, true) = true
    ), '[]'::jsonb),
    'loads', coalesce((
      select jsonb_agg(
        public.screening_load_json(recent.id)
        order by recent.created_at desc
      )
      from (
        select load.id, load.created_at
        from public.screening_loads load
        order by load.created_at desc
        limit greatest(1, least(coalesce(p_limit, 100), 500))
      ) recent
    ), '[]'::jsonb),
    'stock', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', stock.id,
          'productType', stock.product_type,
          'erpLotNumber', stock.erp_lot_number,
          'sourceRawLotNumber', stock.source_raw_lot_number,
          'initialWeightKg', stock.initial_weight_kg,
          'availableWeightKg', stock.available_weight_kg,
          'initialBigBags', stock.initial_big_bags,
          'availableBigBags', stock.available_big_bags,
          'stockStatus', stock.stock_status,
          'createdAt', stock.created_at
        )
        order by stock.created_at desc
      )
      from public.product_stock_lots stock
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5) Management: create or edit an incoming farmer load
-- ---------------------------------------------------------------------------

create or replace function public.portal_save_incoming_charcoal_load(
  p_token text,
  p_load_id uuid,
  p_lot_number text,
  p_farmer_name text,
  p_farm_name text,
  p_received_date date,
  p_received_weight_kg numeric,
  p_truck_registration text,
  p_transporter_name text,
  p_driver_name text,
  p_notes text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_context record;
  v_existing public.incoming_charcoal_loads%rowtype;
  v_load_id uuid;
begin
  select * into v_context from public.portal_context(p_token);

  if not found or v_context.account_role not in ('manager', 'admin') then
    raise exception 'Manager access required';
  end if;

  if nullif(trim(coalesce(p_lot_number, '')), '') is null then
    raise exception 'Farmer lot number is required';
  end if;

  if nullif(trim(coalesce(p_farmer_name, '')), '') is null then
    raise exception 'Farmer or supplier name is required';
  end if;

  if coalesce(p_received_weight_kg, 0) <= 0 then
    raise exception 'Received weight must be greater than zero';
  end if;

  if p_load_id is null then
    insert into public.incoming_charcoal_loads(
      lot_number,
      farmer_name,
      farm_name,
      received_date,
      received_weight_kg,
      truck_registration,
      transporter_name,
      driver_name,
      notes,
      created_by_account_id
    )
    values (
      upper(trim(p_lot_number)),
      trim(p_farmer_name),
      nullif(trim(coalesce(p_farm_name, '')), ''),
      coalesce(p_received_date, current_date),
      p_received_weight_kg,
      nullif(upper(trim(coalesce(p_truck_registration, ''))), ''),
      nullif(trim(coalesce(p_transporter_name, '')), ''),
      nullif(trim(coalesce(p_driver_name, '')), ''),
      nullif(trim(coalesce(p_notes, '')), ''),
      v_context.account_id
    )
    returning id into v_load_id;
  else
    select *
    into v_existing
    from public.incoming_charcoal_loads incoming
    where incoming.id = p_load_id
    for update;

    if not found then
      raise exception 'Incoming load not found';
    end if;

    if v_existing.status <> 'AVAILABLE' then
      raise exception 'Only an available incoming load can be edited';
    end if;

    update public.incoming_charcoal_loads
    set
      lot_number = upper(trim(p_lot_number)),
      farmer_name = trim(p_farmer_name),
      farm_name = nullif(trim(coalesce(p_farm_name, '')), ''),
      received_date = coalesce(p_received_date, current_date),
      received_weight_kg = p_received_weight_kg,
      truck_registration = nullif(upper(trim(coalesce(p_truck_registration, ''))), ''),
      transporter_name = nullif(trim(coalesce(p_transporter_name, '')), ''),
      driver_name = nullif(trim(coalesce(p_driver_name, '')), ''),
      notes = nullif(trim(coalesce(p_notes, '')), ''),
      updated_at = now()
    where id = p_load_id;

    v_load_id := p_load_id;
  end if;

  return public.incoming_charcoal_load_json(v_load_id);
end;
$$;

create or replace function public.portal_cancel_incoming_charcoal_load(
  p_token text,
  p_load_id uuid,
  p_comment text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_context record;
  v_existing public.incoming_charcoal_loads%rowtype;
begin
  select * into v_context from public.portal_context(p_token);

  if not found or v_context.account_role not in ('manager', 'admin') then
    raise exception 'Manager access required';
  end if;

  select *
  into v_existing
  from public.incoming_charcoal_loads incoming
  where incoming.id = p_load_id
  for update;

  if not found then
    raise exception 'Incoming load not found';
  end if;

  if v_existing.status <> 'AVAILABLE' then
    raise exception 'Only an available incoming load can be cancelled';
  end if;

  update public.incoming_charcoal_loads
  set
    status = 'CANCELLED',
    cancelled_by_account_id = v_context.account_id,
    cancelled_at = now(),
    cancellation_comment = nullif(trim(coalesce(p_comment, '')), ''),
    updated_at = now()
  where id = p_load_id;

  return public.incoming_charcoal_load_json(p_load_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6) Screening: choose an incoming load instead of typing a lot
-- ---------------------------------------------------------------------------

drop function if exists public.portal_save_screening_load(
  text,uuid,date,text,text,numeric,text,text,uuid[],jsonb,boolean
);

create or replace function public.portal_save_screening_load(
  p_token text,
  p_load_id uuid,
  p_incoming_load_id uuid,
  p_screening_date date,
  p_shift text,
  p_line_name text,
  p_notes text,
  p_employee_ids uuid[],
  p_products jsonb,
  p_submit boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_context record;
  v_load public.screening_loads%rowtype;
  v_incoming public.incoming_charcoal_loads%rowtype;
  v_load_id uuid;
  v_product jsonb;
  v_product_type text;
  v_erp_lot text;
  v_big_bags integer;
  v_weight numeric;
  v_product_count integer;
  v_employee_count integer;
  v_action text;
begin
  select * into v_context from public.portal_context(p_token);

  if not found
     or v_context.account_role not in ('supervisor', 'manager', 'admin') then
    raise exception 'Supervisor or Manager access required';
  end if;

  if p_incoming_load_id is null then
    raise exception 'Select an incoming farmer load';
  end if;

  if upper(trim(coalesce(p_shift, ''))) not in ('DAY', 'NIGHT') then
    raise exception 'Shift must be DAY or NIGHT';
  end if;

  if jsonb_typeof(coalesce(p_products, '[]'::jsonb)) <> 'array' then
    raise exception 'Products must be a JSON array';
  end if;

  select *
  into v_incoming
  from public.incoming_charcoal_loads incoming
  where incoming.id = p_incoming_load_id
  for update;

  if not found then
    raise exception 'Incoming farmer load not found';
  end if;

  if p_load_id is null then
    if v_incoming.status <> 'AVAILABLE' then
      raise exception 'This incoming load is not available for screening';
    end if;

    insert into public.screening_loads(
      incoming_load_id,
      screening_date,
      shift,
      raw_lot_number,
      raw_weight_kg,
      line_name,
      notes,
      created_by_account_id
    )
    values (
      v_incoming.id,
      coalesce(p_screening_date, current_date),
      upper(trim(p_shift)),
      v_incoming.lot_number,
      v_incoming.received_weight_kg,
      nullif(trim(coalesce(p_line_name, '')), ''),
      nullif(trim(coalesce(p_notes, '')), ''),
      v_context.account_id
    )
    returning id into v_load_id;

    v_action := 'CREATED';
  else
    select *
    into v_load
    from public.screening_loads load
    where load.id = p_load_id
    for update;

    if not found then
      raise exception 'Screening load not found';
    end if;

    if v_load.status <> 'DRAFT' then
      raise exception 'Only a draft screening load can be edited';
    end if;

    if v_load.incoming_load_id <> p_incoming_load_id then
      raise exception 'The incoming farmer load cannot be changed after the draft is created';
    end if;

    if v_context.account_role not in ('manager', 'admin')
       and v_load.created_by_account_id <> v_context.account_id then
      raise exception 'You can edit only your own screening draft';
    end if;

    update public.screening_loads
    set
      screening_date = coalesce(p_screening_date, current_date),
      shift = upper(trim(p_shift)),
      raw_lot_number = v_incoming.lot_number,
      raw_weight_kg = v_incoming.received_weight_kg,
      line_name = nullif(trim(coalesce(p_line_name, '')), ''),
      notes = nullif(trim(coalesce(p_notes, '')), ''),
      return_comment = null,
      updated_at = now()
    where id = p_load_id;

    v_load_id := p_load_id;
    v_action := 'UPDATED';
  end if;

  delete from public.screening_load_employees
  where screening_load_id = v_load_id;

  insert into public.screening_load_employees(screening_load_id, employee_id)
  select
    v_load_id,
    selected.employee_id
  from (
    select distinct unnest(coalesce(p_employee_ids, array[]::uuid[])) as employee_id
  ) selected
  join public.employees employee on employee.id = selected.employee_id
  where coalesce(employee.active, true) = true;

  delete from public.screening_load_products
  where screening_load_id = v_load_id;

  for v_product in
    select value
    from jsonb_array_elements(coalesce(p_products, '[]'::jsonb))
  loop
    v_product_type := upper(trim(coalesce(v_product->>'productType', '')));
    v_erp_lot := nullif(upper(trim(coalesce(v_product->>'erpLotNumber', ''))), '');
    v_big_bags := coalesce(nullif(v_product->>'bigBagCount', ''), '0')::integer;
    v_weight := coalesce(nullif(v_product->>'totalWeightKg', ''), '0')::numeric;

    if v_product_type not in (
      'SAND_ASH',
      'FINES',
      'STANDARD',
      'RESTAURANT',
      'UNBURNT'
    ) then
      raise exception 'Invalid screening product type: %', v_product_type;
    end if;

    insert into public.screening_load_products(
      screening_load_id,
      product_type,
      erp_lot_number,
      big_bag_count,
      total_weight_kg
    )
    values (
      v_load_id,
      v_product_type,
      v_erp_lot,
      v_big_bags,
      v_weight
    );
  end loop;

  update public.incoming_charcoal_loads
  set
    status = case
      when coalesce(p_submit, false) then 'PENDING_VALIDATION'
      else 'IN_SCREENING'
    end,
    updated_at = now()
  where id = p_incoming_load_id;

  if coalesce(p_submit, false) then
    select count(*)
    into v_employee_count
    from public.screening_load_employees
    where screening_load_id = v_load_id;

    select count(*)
    into v_product_count
    from public.screening_load_products
    where screening_load_id = v_load_id;

    if v_employee_count = 0 then
      raise exception 'Select at least one employee before submission';
    end if;

    if v_product_count <> 5 then
      raise exception 'All five screening products must be included';
    end if;

    if exists (
      select 1
      from public.screening_load_products product
      where product.screening_load_id = v_load_id
        and (product.total_weight_kg > 0 or product.big_bag_count > 0)
        and nullif(trim(coalesce(product.erp_lot_number, '')), '') is null
    ) then
      raise exception 'An ERP lot number is required for each product with quantity';
    end if;

    if not exists (
      select 1
      from public.screening_load_products product
      where product.screening_load_id = v_load_id
        and product.total_weight_kg > 0
    ) then
      raise exception 'At least one product must have a positive weight';
    end if;

    update public.screening_loads
    set
      status = 'SUBMITTED',
      submitted_at = now(),
      updated_at = now()
    where id = v_load_id;

    v_action := 'SUBMITTED';
  end if;

  insert into public.screening_audit_log(
    screening_load_id,
    action,
    performed_by_account_id,
    snapshot
  )
  values (
    v_load_id,
    v_action,
    v_context.account_id,
    public.screening_load_json(v_load_id)
  );

  return public.screening_load_json(v_load_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7) Manager validation also updates the incoming-load status
-- ---------------------------------------------------------------------------

create or replace function public.portal_decide_screening_load(
  p_token text,
  p_load_id uuid,
  p_decision text,
  p_comment text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_context record;
  v_load public.screening_loads%rowtype;
  v_decision text := upper(trim(coalesce(p_decision, '')));
begin
  select * into v_context from public.portal_context(p_token);

  if not found or v_context.account_role not in ('manager', 'admin') then
    raise exception 'Manager access required';
  end if;

  select *
  into v_load
  from public.screening_loads load
  where load.id = p_load_id
  for update;

  if not found then
    raise exception 'Screening load not found';
  end if;

  if v_decision = 'VALIDATE' then
    if v_load.status <> 'SUBMITTED' then
      raise exception 'Only a submitted screening load can be validated';
    end if;

    if exists (
      select 1
      from public.screening_load_products product
      where product.screening_load_id = p_load_id
        and (product.total_weight_kg > 0 or product.big_bag_count > 0)
        and nullif(trim(coalesce(product.erp_lot_number, '')), '') is null
    ) then
      raise exception 'Every product with quantity requires an ERP lot number';
    end if;

    insert into public.product_stock_lots(
      product_type,
      erp_lot_number,
      source_screening_load_id,
      source_screening_product_id,
      source_raw_lot_number,
      initial_weight_kg,
      available_weight_kg,
      initial_big_bags,
      available_big_bags
    )
    select
      product.product_type,
      product.erp_lot_number,
      load.id,
      product.id,
      load.raw_lot_number,
      product.total_weight_kg,
      product.total_weight_kg,
      product.big_bag_count,
      product.big_bag_count
    from public.screening_loads load
    join public.screening_load_products product
      on product.screening_load_id = load.id
    where load.id = p_load_id
      and product.total_weight_kg > 0;

    update public.screening_loads
    set
      status = 'VALIDATED',
      return_comment = null,
      validated_by_account_id = v_context.account_id,
      validated_at = now(),
      updated_at = now()
    where id = p_load_id;

    update public.incoming_charcoal_loads
    set
      status = 'SCREENED',
      updated_at = now()
    where id = v_load.incoming_load_id;

  elsif v_decision = 'RETURN' then
    if v_load.status <> 'SUBMITTED' then
      raise exception 'Only a submitted screening load can be returned';
    end if;

    if nullif(trim(coalesce(p_comment, '')), '') is null then
      raise exception 'A return comment is required';
    end if;

    update public.screening_loads
    set
      status = 'DRAFT',
      return_comment = trim(p_comment),
      submitted_at = null,
      updated_at = now()
    where id = p_load_id;

    update public.incoming_charcoal_loads
    set
      status = 'IN_SCREENING',
      updated_at = now()
    where id = v_load.incoming_load_id;

  elsif v_decision = 'CANCEL' then
    if v_load.status = 'VALIDATED' then
      raise exception 'A validated load cannot be cancelled';
    end if;

    update public.screening_loads
    set
      status = 'CANCELLED',
      cancelled_by_account_id = v_context.account_id,
      cancelled_at = now(),
      updated_at = now()
    where id = p_load_id;

    update public.incoming_charcoal_loads
    set
      status = 'AVAILABLE',
      updated_at = now()
    where id = v_load.incoming_load_id;

  else
    raise exception 'Decision must be VALIDATE, RETURN or CANCEL';
  end if;

  insert into public.screening_audit_log(
    screening_load_id,
    action,
    performed_by_account_id,
    comment,
    snapshot
  )
  values (
    p_load_id,
    v_decision,
    v_context.account_id,
    nullif(trim(coalesce(p_comment, '')), ''),
    public.screening_load_json(p_load_id)
  );

  return public.screening_load_json(p_load_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 8) Permissions
-- ---------------------------------------------------------------------------

revoke all on function public.portal_screening_bootstrap(text,integer) from public;
revoke all on function public.portal_save_incoming_charcoal_load(
  text,uuid,text,text,text,date,numeric,text,text,text,text
) from public;
revoke all on function public.portal_cancel_incoming_charcoal_load(
  text,uuid,text
) from public;
revoke all on function public.portal_save_screening_load(
  text,uuid,uuid,date,text,text,text,uuid[],jsonb,boolean
) from public;
revoke all on function public.portal_decide_screening_load(
  text,uuid,text,text
) from public;

grant execute on function public.portal_screening_bootstrap(text,integer)
  to anon, authenticated;
grant execute on function public.portal_save_incoming_charcoal_load(
  text,uuid,text,text,text,date,numeric,text,text,text,text
) to anon, authenticated;
grant execute on function public.portal_cancel_incoming_charcoal_load(
  text,uuid,text
) to anon, authenticated;
grant execute on function public.portal_save_screening_load(
  text,uuid,uuid,date,text,text,text,uuid[],jsonb,boolean
) to anon, authenticated;
grant execute on function public.portal_decide_screening_load(
  text,uuid,text,text
) to anon, authenticated;

commit;

notify pgrst, 'reload schema';

-- Verification
select
  (select count(*) from public.incoming_charcoal_loads) as incoming_loads,
  (select count(*) from public.screening_loads) as screening_loads,
  (select count(*) from public.product_stock_lots) as product_stock_lots;
