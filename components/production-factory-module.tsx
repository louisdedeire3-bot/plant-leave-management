-- 46_PRODUCTION_CONSUMABLE_STOCK.sql
-- Green Charcoal Namibia
--
-- Production consumable stock V1:
--   * tracks bags and slip sheets only;
--   * excludes stretch film and wooden pallets;
--   * deducts stock only when Management validates a Production Order;
--   * applies 3% estimated loss and always rounds up to a whole unit;
--   * rejected/damaged bags entered in Production are not added separately;
--   * keeps an idempotent stock-movement history;
--   * allows negative stock so an inventory mismatch never blocks Production.
--
-- Run after SQL 45.

begin;

create extension if not exists pgcrypto;

-- ===========================================================================
-- 1) Consumable master, product BOM and movement ledger
-- ===========================================================================

create table if not exists public.production_consumables (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  description text not null,
  consumable_type text not null,
  unit text not null default 'UNIT',
  current_stock numeric(14,3) not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint production_consumable_code_not_blank
    check (length(trim(code)) > 0),
  constraint production_consumable_description_not_blank
    check (length(trim(description)) > 0),
  constraint production_consumable_type_check
    check (consumable_type in ('BAG', 'SLIP_SHEET')),
  constraint production_consumable_unit_check
    check (unit = 'UNIT')
);

create unique index if not exists production_consumables_code_unique
  on public.production_consumables(upper(trim(code)));

create table if not exists public.production_product_consumables (
  product_code text not null
    references public.production_products(code) on update cascade on delete cascade,
  consumable_id uuid not null
    references public.production_consumables(id) on update cascade on delete restrict,
  calculation_basis text not null,
  quantity_per_basis numeric(12,4) not null default 1,
  bags_per_pallet integer,
  waste_percent numeric(6,3) not null default 3,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (product_code, consumable_id),
  constraint production_product_consumable_basis_check
    check (calculation_basis in ('PER_BAG', 'PER_PALLET')),
  constraint production_product_consumable_quantity_positive
    check (quantity_per_basis > 0),
  constraint production_product_consumable_pallet_rule
    check (
      (calculation_basis = 'PER_BAG' and bags_per_pallet is null)
      or
      (calculation_basis = 'PER_PALLET' and bags_per_pallet > 0)
    ),
  constraint production_product_consumable_waste_valid
    check (waste_percent >= 0 and waste_percent <= 100)
);

create table if not exists public.production_consumable_movements (
  id bigint generated always as identity primary key,
  consumable_id uuid not null
    references public.production_consumables(id) on update cascade on delete restrict,
  production_order_id uuid
    references public.production_orders(id) on update cascade on delete restrict,
  movement_type text not null,
  theoretical_quantity numeric(14,3) not null default 0,
  waste_percent numeric(6,3) not null default 0,
  quantity_delta numeric(14,3) not null,
  balance_after numeric(14,3) not null,
  performed_by_account_id uuid
    references public.portal_accounts(id) on update cascade on delete set null,
  comment text,
  reverses_movement_id bigint
    references public.production_consumable_movements(id) on delete restrict,
  reversed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint production_consumable_movement_type_check
    check (
      movement_type in (
        'STOCK_RECEIPT',
        'ADJUSTMENT',
        'PRODUCTION_CONSUMPTION',
        'PRODUCTION_REVERSAL'
      )
    ),
  constraint production_consumable_movement_nonzero
    check (quantity_delta <> 0),
  constraint production_consumable_movement_whole_units
    check (quantity_delta = trunc(quantity_delta)),
  constraint production_consumable_movement_theory_valid
    check (theoretical_quantity >= 0),
  constraint production_consumable_movement_waste_valid
    check (waste_percent >= 0 and waste_percent <= 100)
);

create index if not exists production_consumable_movements_item_date_idx
  on public.production_consumable_movements(consumable_id, created_at desc);

create index if not exists production_consumable_movements_order_idx
  on public.production_consumable_movements(production_order_id, created_at desc);

create unique index if not exists production_consumable_active_issue_unique
  on public.production_consumable_movements(
    production_order_id,
    consumable_id
  )
  where movement_type = 'PRODUCTION_CONSUMPTION'
    and reversed_at is null;

create unique index if not exists production_consumable_reversal_unique
  on public.production_consumable_movements(reverses_movement_id)
  where reverses_movement_id is not null;

alter table public.production_consumables enable row level security;
alter table public.production_product_consumables enable row level security;
alter table public.production_consumable_movements enable row level security;

revoke all on table public.production_consumables from anon, authenticated;
revoke all on table public.production_product_consumables from anon, authenticated;
revoke all on table public.production_consumable_movements from anon, authenticated;

-- ===========================================================================
-- 2) First completed Product Sheet
--    This product requires one bag per finished bag and no slip sheet.
-- ===========================================================================

insert into public.production_consumables (
  code,
  description,
  consumable_type,
  unit,
  active
)
values (
  'BAG-60251ALG228FSC',
  'Kraft bag for 60251ALG228FSC',
  'BAG',
  'UNIT',
  true
)
on conflict ((upper(trim(code)))) do update
set
  description = excluded.description,
  consumable_type = excluded.consumable_type,
  unit = excluded.unit,
  active = true,
  updated_at = now();

insert into public.production_product_consumables (
  product_code,
  consumable_id,
  calculation_basis,
  quantity_per_basis,
  bags_per_pallet,
  waste_percent,
  active
)
select
  '60251ALG228FSC',
  consumable.id,
  'PER_BAG',
  1,
  null,
  3,
  true
from public.production_consumables consumable
where upper(trim(consumable.code)) = 'BAG-60251ALG228FSC'
on conflict (product_code, consumable_id) do update
set
  calculation_basis = excluded.calculation_basis,
  quantity_per_basis = excluded.quantity_per_basis,
  bags_per_pallet = excluded.bags_per_pallet,
  waste_percent = excluded.waste_percent,
  active = true,
  updated_at = now();

-- ===========================================================================
-- 3) Automatic, idempotent consumption at Manager validation
-- ===========================================================================

create or replace function public.apply_production_consumable_usage(
  p_order_id uuid,
  p_account_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_config record;
  v_theoretical numeric(14,3);
  v_quantity numeric(14,3);
  v_balance numeric(14,3);
begin
  for v_config in
    select
      production_order.id as order_id,
      production_run.actual_bags,
      product_consumable.consumable_id,
      product_consumable.calculation_basis,
      product_consumable.quantity_per_basis,
      product_consumable.bags_per_pallet,
      product_consumable.waste_percent
    from public.production_orders production_order
    join public.production_runs production_run
      on production_run.production_order_id = production_order.id
    join public.production_product_consumables product_consumable
      on product_consumable.product_code = production_order.product_code
     and product_consumable.active = true
    join public.production_consumables consumable
      on consumable.id = product_consumable.consumable_id
     and consumable.active = true
    where production_order.id = p_order_id
  loop
    if v_config.actual_bags <= 0 then
      continue;
    end if;

    if exists (
      select 1
      from public.production_consumable_movements existing_movement
      where existing_movement.production_order_id = p_order_id
        and existing_movement.consumable_id = v_config.consumable_id
        and existing_movement.movement_type = 'PRODUCTION_CONSUMPTION'
        and existing_movement.reversed_at is null
    ) then
      continue;
    end if;

    if v_config.calculation_basis = 'PER_BAG' then
      v_theoretical :=
        v_config.actual_bags::numeric * v_config.quantity_per_basis;
    else
      v_theoretical :=
        ceil(
          v_config.actual_bags::numeric
          / v_config.bags_per_pallet::numeric
        ) * v_config.quantity_per_basis;
    end if;

    v_quantity := ceil(
      v_theoretical * (1 + v_config.waste_percent / 100)
    );

    if v_quantity <= 0 then
      continue;
    end if;

    perform 1
    from public.production_consumables consumable
    where consumable.id = v_config.consumable_id
    for update;

    update public.production_consumables consumable
    set
      current_stock = consumable.current_stock - v_quantity,
      updated_at = now()
    where consumable.id = v_config.consumable_id
    returning consumable.current_stock into v_balance;

    insert into public.production_consumable_movements (
      consumable_id,
      production_order_id,
      movement_type,
      theoretical_quantity,
      waste_percent,
      quantity_delta,
      balance_after,
      performed_by_account_id,
      comment
    )
    values (
      v_config.consumable_id,
      p_order_id,
      'PRODUCTION_CONSUMPTION',
      v_theoretical,
      v_config.waste_percent,
      -v_quantity,
      v_balance,
      p_account_id,
      'Automatic deduction at Management validation'
    );
  end loop;
end;
$$;

revoke all on function public.apply_production_consumable_usage(uuid,uuid)
from public;

create or replace function public.reverse_production_consumable_usage(
  p_order_id uuid,
  p_account_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_issue record;
  v_balance numeric(14,3);
begin
  for v_issue in
    select movement.*
    from public.production_consumable_movements movement
    where movement.production_order_id = p_order_id
      and movement.movement_type = 'PRODUCTION_CONSUMPTION'
      and movement.reversed_at is null
    order by movement.id
    for update
  loop
    perform 1
    from public.production_consumables consumable
    where consumable.id = v_issue.consumable_id
    for update;

    update public.production_consumables consumable
    set
      current_stock = consumable.current_stock + abs(v_issue.quantity_delta),
      updated_at = now()
    where consumable.id = v_issue.consumable_id
    returning consumable.current_stock into v_balance;

    update public.production_consumable_movements movement
    set reversed_at = now()
    where movement.id = v_issue.id;

    insert into public.production_consumable_movements (
      consumable_id,
      production_order_id,
      movement_type,
      theoretical_quantity,
      waste_percent,
      quantity_delta,
      balance_after,
      performed_by_account_id,
      comment,
      reverses_movement_id
    )
    values (
      v_issue.consumable_id,
      p_order_id,
      'PRODUCTION_REVERSAL',
      v_issue.theoretical_quantity,
      v_issue.waste_percent,
      abs(v_issue.quantity_delta),
      v_balance,
      p_account_id,
      'Automatic reversal after Production validation was cancelled',
      v_issue.id
    );
  end loop;
end;
$$;

revoke all on function public.reverse_production_consumable_usage(uuid,uuid)
from public;

create or replace function public.sync_production_consumables_after_status()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if new.status = 'VALIDATED' and old.status is distinct from 'VALIDATED' then
    perform public.apply_production_consumable_usage(
      new.id,
      new.validated_by_account_id
    );
  elsif old.status = 'VALIDATED' and new.status is distinct from 'VALIDATED' then
    perform public.reverse_production_consumable_usage(
      new.id,
      coalesce(new.cancelled_by_account_id, new.validated_by_account_id)
    );
  end if;

  return new;
end;
$$;

drop trigger if exists production_order_sync_consumables
on public.production_orders;

create trigger production_order_sync_consumables
after update of status on public.production_orders
for each row
execute function public.sync_production_consumables_after_status();

-- ===========================================================================
-- 4) Portal read API
-- ===========================================================================

create or replace function public.portal_production_consumables(
  p_token text,
  p_limit integer default 300
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
  select *
  into v_context
  from public.portal_context(p_token);

  if not found
     or v_context.account_role not in ('supervisor', 'manager', 'admin') then
    raise exception 'Supervisor or Manager access required';
  end if;

  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', consumable.id,
          'code', consumable.code,
          'description', consumable.description,
          'consumableType', consumable.consumable_type,
          'unit', consumable.unit,
          'currentStock', consumable.current_stock,
          'active', consumable.active,
          'configuredProducts', (
            select count(*)
            from public.production_product_consumables product_consumable
            where product_consumable.consumable_id = consumable.id
              and product_consumable.active = true
          ),
          'updatedAt', consumable.updated_at
        )
        order by consumable.consumable_type, consumable.code
      )
      from public.production_consumables consumable
      where consumable.active = true
    ), '[]'::jsonb),
    'movements', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', recent.id,
          'consumableId', recent.consumable_id,
          'consumableCode', recent.consumable_code,
          'consumableDescription', recent.consumable_description,
          'consumableType', recent.consumable_type,
          'movementType', recent.movement_type,
          'quantityDelta', recent.quantity_delta,
          'theoreticalQuantity', recent.theoretical_quantity,
          'wastePercent', recent.waste_percent,
          'lossQuantity', greatest(
            abs(recent.quantity_delta) - recent.theoretical_quantity,
            0
          ),
          'balanceAfter', recent.balance_after,
          'productionOrderId', recent.production_order_id,
          'productCode', coalesce(recent.product_code, ''),
          'finishedErpLotNumber', coalesce(recent.finished_erp_lot_number, ''),
          'actualBags', coalesce(recent.actual_bags, 0),
          'performedBy', coalesce(recent.performed_by, ''),
          'comment', coalesce(recent.comment, ''),
          'createdAt', recent.created_at
        )
        order by recent.created_at desc, recent.id desc
      )
      from (
        select
          movement.id,
          movement.consumable_id,
          consumable.code as consumable_code,
          consumable.description as consumable_description,
          consumable.consumable_type,
          movement.movement_type,
          movement.quantity_delta,
          movement.theoretical_quantity,
          movement.waste_percent,
          movement.balance_after,
          movement.production_order_id,
          production_order.product_code,
          production_order.finished_erp_lot_number,
          production_run.actual_bags,
          account.display_name as performed_by,
          movement.comment,
          movement.created_at
        from public.production_consumable_movements movement
        join public.production_consumables consumable
          on consumable.id = movement.consumable_id
        left join public.production_orders production_order
          on production_order.id = movement.production_order_id
        left join public.production_runs production_run
          on production_run.production_order_id = production_order.id
        left join public.portal_accounts account
          on account.id = movement.performed_by_account_id
        order by movement.created_at desc, movement.id desc
        limit greatest(1, least(coalesce(p_limit, 300), 1000))
      ) recent
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

-- ===========================================================================
-- 5) Management manual receipt / correction API
-- ===========================================================================

create or replace function public.portal_adjust_production_consumable_stock(
  p_token text,
  p_consumable_id uuid,
  p_quantity_delta numeric,
  p_comment text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_context record;
  v_consumable public.production_consumables%rowtype;
  v_balance numeric(14,3);
  v_movement_type text;
begin
  select *
  into v_context
  from public.portal_context(p_token);

  if not found or v_context.account_role not in ('manager', 'admin') then
    raise exception 'Manager access required';
  end if;

  if p_quantity_delta is null or p_quantity_delta = 0 then
    raise exception 'Quantity must be different from zero';
  end if;

  if p_quantity_delta <> trunc(p_quantity_delta) then
    raise exception 'Consumable quantities must use whole units';
  end if;

  if nullif(trim(coalesce(p_comment, '')), '') is null then
    raise exception 'A stock movement reason is required';
  end if;

  select *
  into v_consumable
  from public.production_consumables consumable
  where consumable.id = p_consumable_id
    and consumable.active = true
  for update;

  if not found then
    raise exception 'Active consumable not found';
  end if;

  v_movement_type := case
    when p_quantity_delta > 0 then 'STOCK_RECEIPT'
    else 'ADJUSTMENT'
  end;

  update public.production_consumables consumable
  set
    current_stock = consumable.current_stock + p_quantity_delta,
    updated_at = now()
  where consumable.id = p_consumable_id
  returning consumable.current_stock into v_balance;

  insert into public.production_consumable_movements (
    consumable_id,
    movement_type,
    quantity_delta,
    balance_after,
    performed_by_account_id,
    comment
  )
  values (
    p_consumable_id,
    v_movement_type,
    p_quantity_delta,
    v_balance,
    v_context.account_id,
    trim(p_comment)
  );

  return jsonb_build_object(
    'consumableId', p_consumable_id,
    'quantityDelta', p_quantity_delta,
    'currentStock', v_balance,
    'movementType', v_movement_type
  );
end;
$$;

revoke all on function public.portal_production_consumables(text,integer)
from public;
revoke all on function public.portal_adjust_production_consumable_stock(
  text,uuid,numeric,text
) from public;

grant execute on function public.portal_production_consumables(text,integer)
to anon, authenticated;
grant execute on function public.portal_adjust_production_consumable_stock(
  text,uuid,numeric,text
) to anon, authenticated;

commit;

notify pgrst, 'reload schema';

-- Verification: the first configured bag must appear with a 3% rule.
select
  consumable.code,
  consumable.description,
  consumable.consumable_type,
  consumable.current_stock,
  product_consumable.product_code,
  product_consumable.calculation_basis,
  product_consumable.waste_percent
from public.production_consumables consumable
left join public.production_product_consumables product_consumable
  on product_consumable.consumable_id = consumable.id
order by consumable.code, product_consumable.product_code;
