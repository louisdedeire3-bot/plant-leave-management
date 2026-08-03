"use client";

// GCN PRODUCTION MODULE V2 — BREAKDOWNS
// Office orders, Supervisor execution, multi-lot traceability,
// breakdown/downtime recording and Manager validation.

import {
  ArrowRight,
  Boxes,
  Check,
  ChevronRight,
  CircleAlert,
  ClipboardCheck,
  Clock3,
  Factory,
  FileCheck2,
  Gauge,
  History,
  Layers3,
  LoaderCircle,
  PackageCheck,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Trash2,
  UserRoundCheck,
  Warehouse,
  Wrench,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import {
  getProductionProductSheet,
  lineNumberFromCodeOrLabel,
  productionProductSheets,
  type ProductionProductSheet,
} from "@/lib/production-product-sheets";

type PortalRole = "employee" | "supervisor" | "manager";
type ProductionSection =
  | "control"
  | "orders"
  | "product-sheets"
  | "run"
  | "history"
  | "raw-stock"
  | "finished-stock";
type ProductionStatus =
  | "PLANNED"
  | "IN_PROGRESS"
  | "SUBMITTED"
  | "VALIDATED"
  | "CANCELLED";
type RawMaterialType = "STANDARD" | "RESTAURANT" | "BRIQUETTE";
type Shift = "DAY" | "NIGHT";
type BreakdownCategory =
  | "MECHANICAL"
  | "ELECTRICAL"
  | "PNEUMATIC_HYDRAULIC"
  | "CONVEYOR"
  | "WEIGHING_SCALE"
  | "PRINTER"
  | "BAGGING_MACHINE"
  | "OTHER";

export interface ProductionFactoryProfile {
  accountId: string;
  loginId: string;
  employeeId: string | null;
  displayName: string;
  role: PortalRole;
  department: string;
  expiresAt: string;
}

interface ProductionProduct {
  code: string;
  description: string;
  bagWeightKg: number;
  rawMaterialType: RawMaterialType;
  active: boolean;
}

interface ProductionLine {
  code: string;
  label: string;
  minBagWeightKg: number;
  maxBagWeightKg: number;
  allowsStandard: boolean;
  allowsRestaurant: boolean;
  allowsBriquette: boolean;
  active: boolean;
}

interface ProductionEmployee {
  id: string;
  employeeCode: string;
  employeeName: string;
  department: string;
  position: string;
}

interface ProductionRawLot {
  sourceModule: "SCREENING" | "BRIQUETTES";
  id: string;
  rawMaterialType: RawMaterialType;
  erpLotNumber: string;
  sourceReference: string;
  stockStatus: string;
  quantityKnown: boolean;
  availableWeightKg: number;
  availableBigBags: number;
  lastUsedAt: string | null;
  reservedByOrderId: string | null;
}

interface ProductionOrderRawLot {
  sourceModule: "SCREENING" | "BRIQUETTES";
  sourceLotId: string;
  rawMaterialType: RawMaterialType;
  erpLotNumber: string;
  sourceReference: string;
  lotFinished: boolean;
  currentStockStatus: string;
  quantityKnown: boolean;
  availableWeightKg: number;
  availableBigBags: number;
}

interface ProductionBreakdown {
  id: string;
  category: BreakdownCategory;
  equipment: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  productionStopped: boolean;
  maintenanceNotified: boolean;
  description: string;
  actionTaken: string;
}

interface RunBreakdownPayload {
  category: BreakdownCategory;
  equipment: string;
  startTime: string;
  endTime: string;
  productionStopped: boolean;
  maintenanceNotified: boolean;
  description: string;
  actionTaken: string;
}

interface BreakdownDraft extends RunBreakdownPayload {
  clientId: string;
}

interface ProductionOrder {
  id: string;
  productCode: string;
  productDescription: string;
  bagWeightKg: number;
  rawMaterialType: RawMaterialType;
  targetBags: number;
  finishedErpLotNumber: string;
  lineCode: string;
  lineName: string;
  plannedDate: string;
  shift: Shift;
  officeNotes: string;
  status: ProductionStatus;
  returnComment: string;
  createdAt: string;
  startedAt: string | null;
  submittedAt: string | null;
  validatedAt: string | null;
  createdBy: string;
  startedBy: string;
  submittedBy: string;
  validatedBy: string;
  actualBags: number;
  rejectedBags: number;
  startTime: string;
  endTime: string;
  productionNotes: string;
  varianceBags: number;
  achievementPercent: number;
  netPackedWeightKg: number;
  employees: ProductionEmployee[];
  rawLots: ProductionOrderRawLot[];
  breakdowns: ProductionBreakdown[];
  totalDowntimeMinutes: number;
}

interface FinishedProductStockLot {
  id: string;
  productionOrderId: string;
  productCode: string;
  productDescription: string;
  erpLotNumber: string;
  bagWeightKg: number;
  initialBags: number;
  availableBags: number;
  initialWeightKg: number;
  availableWeightKg: number;
  stockStatus: string;
  createdAt: string;
}

interface ProductionBootstrap {
  products: ProductionProduct[];
  lines: ProductionLine[];
  employees: ProductionEmployee[];
  orders: ProductionOrder[];
  rawLots: ProductionRawLot[];
  finishedStock: FinishedProductStockLot[];
}

interface OrderSavePayload {
  orderId: string | null;
  productCode: string;
  targetBags: number;
  finishedErpLotNumber: string;
  lineCode: string;
  plannedDate: string;
  shift: Shift;
  officeNotes: string;
}

interface RunRawLotPayload {
  sourceModule: "SCREENING" | "BRIQUETTES";
  sourceLotId: string;
  lotFinished: boolean;
}

interface RunSavePayload {
  orderId: string;
  actualBags: number;
  rejectedBags: number;
  startTime: string | null;
  endTime: string | null;
  notes: string;
  employeeIds: string[];
  rawLots: RunRawLotPayload[];
  breakdowns: RunBreakdownPayload[];
  submit: boolean;
}

const emptyBootstrap: ProductionBootstrap = {
  products: [],
  lines: [],
  employees: [],
  orders: [],
  rawLots: [],
  finishedStock: [],
};

const inputClass =
  "h-12 w-full border border-[#cfc4b7] bg-white px-4 text-sm font-semibold text-[#171310] outline-none transition placeholder:text-slate-400 focus:border-[#b86c2c] focus:ring-2 focus:ring-[#b86c2c]/15";

function isoDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDate(value: string): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-NA", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value.slice(0, 10)}T00:00:00`));
}

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-NA", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatKg(value: number): string {
  return `${Number(value || 0).toLocaleString("en-NA", {
    maximumFractionDigits: 2,
  })} kg`;
}

function formatNumber(value: number): string {
  return Number(value || 0).toLocaleString("en-NA", {
    maximumFractionDigits: 2,
  });
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return "Unknown database error";
}

function statusStyle(status: ProductionStatus): string {
  return {
    PLANNED: "border-blue-300 bg-blue-100 text-blue-900",
    IN_PROGRESS: "border-violet-300 bg-violet-100 text-violet-900",
    SUBMITTED: "border-amber-300 bg-amber-100 text-amber-900",
    VALIDATED: "border-emerald-300 bg-emerald-100 text-emerald-900",
    CANCELLED: "border-red-300 bg-red-100 text-red-800",
  }[status];
}

function rawTypeStyle(type: RawMaterialType): string {
  return {
    STANDARD: "border-[#c49156] bg-[#fff4e8] text-[#7b471d]",
    RESTAURANT: "border-slate-500 bg-slate-900 text-white",
    BRIQUETTE: "border-emerald-600 bg-emerald-50 text-emerald-900",
  }[type];
}

function isLineCompatible(
  line: ProductionLine,
  product: ProductionProduct,
): boolean {
  const productSheet = getProductionProductSheet(product.code);
  if (productSheet) {
    const lineNumber = lineNumberFromCodeOrLabel(line.code, line.label);
    return (
      lineNumber !== null &&
      productSheet.compatibleLineNumbers.includes(lineNumber)
    );
  }

  const weightOkay =
    product.bagWeightKg >= line.minBagWeightKg &&
    product.bagWeightKg <= line.maxBagWeightKg;

  if (!weightOkay) return false;
  if (product.rawMaterialType === "STANDARD") return line.allowsStandard;
  if (product.rawMaterialType === "RESTAURANT") return line.allowsRestaurant;
  return line.allowsBriquette;
}

const breakdownCategoryLabels: Record<BreakdownCategory, string> = {
  MECHANICAL: "Mechanical",
  ELECTRICAL: "Electrical",
  PNEUMATIC_HYDRAULIC: "Pneumatic / Hydraulic",
  CONVEYOR: "Conveyor",
  WEIGHING_SCALE: "Weighing / Scale",
  PRINTER: "Printer",
  BAGGING_MACHINE: "Bagging machine",
  OTHER: "Other",
};

const breakdownCategories = Object.keys(
  breakdownCategoryLabels,
) as BreakdownCategory[];

function durationMinutes(start: string, end: string): number {
  if (!start || !end) return 0;
  const [startHour, startMinute] = start.split(":").map(Number);
  const [endHour, endMinute] = end.split(":").map(Number);
  let minutes = endHour * 60 + endMinute - (startHour * 60 + startMinute);
  if (minutes < 0) minutes += 24 * 60;
  return minutes;
}

function formatDowntime(minutes: number): string {
  const safeMinutes = Math.max(0, Math.round(Number(minutes || 0)));
  const hours = Math.floor(safeMinutes / 60);
  const remainder = safeMinutes % 60;
  if (hours === 0) return `${remainder} min`;
  if (remainder === 0) return `${hours} h`;
  return `${hours} h ${remainder} min`;
}

function durationHours(start: string, end: string): number {
  if (!start || !end) return 0;
  const [startHour, startMinute] = start.split(":").map(Number);
  const [endHour, endMinute] = end.split(":").map(Number);
  let minutes = endHour * 60 + endMinute - (startHour * 60 + startMinute);
  if (minutes < 0) minutes += 24 * 60;
  return minutes / 60;
}

export function ProductionFactoryModule({
  profile,
  sessionToken,
}: {
  profile: ProductionFactoryProfile;
  sessionToken: string;
}) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [section, setSection] = useState<ProductionSection>("control");
  const [data, setData] = useState<ProductionBootstrap>(emptyBootstrap);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);
  const [requestedRunOrderId, setRequestedRunOrderId] = useState<string | null>(
    null,
  );

  const loadData = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    setMessage(null);

    try {
      const { data: response, error } = await supabase.rpc(
        "portal_production_bootstrap",
        {
          p_token: sessionToken,
          p_limit: 300,
        },
      );

      if (error) throw error;
      setData((response ?? emptyBootstrap) as ProductionBootstrap);
    } catch (error) {
      setMessage({ kind: "error", text: errorText(error) });
    } finally {
      setLoading(false);
    }
  }, [sessionToken, supabase]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  async function saveOrder(payload: OrderSavePayload): Promise<boolean> {
    if (!supabase) return false;
    setLoading(true);
    setMessage(null);

    try {
      const { error } = await supabase.rpc("portal_save_production_order", {
        p_token: sessionToken,
        p_order_id: payload.orderId,
        p_product_code: payload.productCode,
        p_target_bags: payload.targetBags,
        p_finished_erp_lot_number: payload.finishedErpLotNumber,
        p_line_code: payload.lineCode,
        p_planned_date: payload.plannedDate,
        p_shift: payload.shift,
        p_office_notes: payload.officeNotes || null,
      });

      if (error) throw error;

      setMessage({
        kind: "success",
        text: payload.orderId
          ? "Production Order updated."
          : "Production Order created and released to Production.",
      });
      await loadData();
      return true;
    } catch (error) {
      setMessage({ kind: "error", text: errorText(error) });
      return false;
    } finally {
      setLoading(false);
    }
  }

  async function cancelOrder(
    orderId: string,
    comment: string,
  ): Promise<boolean> {
    if (!supabase) return false;
    setLoading(true);
    setMessage(null);

    try {
      const { error } = await supabase.rpc("portal_cancel_production_order", {
        p_token: sessionToken,
        p_order_id: orderId,
        p_comment: comment || null,
      });

      if (error) throw error;
      setMessage({ kind: "success", text: "Production Order cancelled." });
      await loadData();
      return true;
    } catch (error) {
      setMessage({ kind: "error", text: errorText(error) });
      return false;
    } finally {
      setLoading(false);
    }
  }

  async function saveRun(payload: RunSavePayload): Promise<boolean> {
    if (!supabase) return false;
    setLoading(true);
    setMessage(null);

    try {
      const { error } = await supabase.rpc("portal_save_production_run", {
        p_token: sessionToken,
        p_order_id: payload.orderId,
        p_actual_bags: payload.actualBags,
        p_rejected_bags: payload.rejectedBags,
        p_start_time: payload.startTime,
        p_end_time: payload.endTime,
        p_notes: payload.notes || null,
        p_employee_ids: payload.employeeIds,
        p_raw_lots: payload.rawLots,
        p_breakdowns: payload.breakdowns,
        p_submit: payload.submit,
      });

      if (error) throw error;
      setMessage({
        kind: "success",
        text: payload.submit
          ? "Production result submitted for Manager validation."
          : "Production run saved.",
      });
      await loadData();
      return true;
    } catch (error) {
      setMessage({ kind: "error", text: errorText(error) });
      return false;
    } finally {
      setLoading(false);
    }
  }

  async function decideOrder(
    orderId: string,
    decision: "VALIDATE" | "RETURN" | "CANCEL",
    comment: string,
  ): Promise<boolean> {
    if (!supabase) return false;
    setLoading(true);
    setMessage(null);

    try {
      const { error } = await supabase.rpc(
        "portal_decide_production_order",
        {
          p_token: sessionToken,
          p_order_id: orderId,
          p_decision: decision,
          p_comment: comment || null,
        },
      );

      if (error) throw error;
      setMessage({
        kind: "success",
        text:
          decision === "VALIDATE"
            ? "Production validated, raw lots updated and finished stock created."
            : decision === "RETURN"
              ? "Production returned to the Supervisor."
              : "Production Order cancelled.",
      });
      await loadData();
      return true;
    } catch (error) {
      setMessage({ kind: "error", text: errorText(error) });
      return false;
    } finally {
      setLoading(false);
    }
  }

  function openRun(orderId?: string) {
    setRequestedRunOrderId(orderId ?? null);
    setSection("run");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const pendingCount = data.orders.filter(
    (order) => order.status === "SUBMITTED",
  ).length;
  const openCount = data.orders.filter((order) =>
    ["PLANNED", "IN_PROGRESS"].includes(order.status),
  ).length;

  const sectionItems: Array<{
    id: ProductionSection;
    label: string;
  }> = [
    { id: "control", label: "Control room" },
    { id: "orders", label: `Production orders${openCount ? ` (${openCount})` : ""}` },
    {
      id: "product-sheets",
      label: `Product sheets (${productionProductSheets.length} ready)`,
    },
    { id: "run", label: "Production run" },
    { id: "history", label: `Production history${pendingCount ? ` (${pendingCount})` : ""}` },
    { id: "raw-stock", label: "Raw material lots" },
    { id: "finished-stock", label: "Finished product stock" },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border border-[#cfc4b7] bg-white p-3">
        <div className="flex flex-wrap gap-2">
          {sectionItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setRequestedRunOrderId(null);
                setSection(item.id);
              }}
              className={`px-4 py-2.5 text-xs font-black uppercase tracking-[0.08em] transition ${
                section === item.id
                  ? "bg-[#171310] text-white"
                  : "border border-[#d8cec3] bg-[#f6f2ed] text-[#5f5147] hover:border-[#b86c2c]"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => void loadData()}
          disabled={loading}
          className="inline-flex h-10 items-center gap-2 border border-[#6f6156] bg-white px-4 text-xs font-black uppercase disabled:opacity-50"
        >
          <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {message && (
        <div
          className={`border px-4 py-3 text-sm font-bold ${
            message.kind === "success"
              ? "border-emerald-300 bg-emerald-50 text-emerald-800"
              : "border-red-300 bg-red-50 text-red-800"
          }`}
        >
          {message.text}
        </div>
      )}

      {section === "control" && (
        <ProductionControlRoom
          profile={profile}
          data={data}
          loading={loading}
          onOpenOrders={() => setSection("orders")}
          onOpenRun={openRun}
          onOpenHistory={() => setSection("history")}
          onDecision={decideOrder}
        />
      )}

      {section === "orders" && (
        <ProductionOrders
          profile={profile}
          data={data}
          loading={loading}
          onSave={saveOrder}
          onCancel={cancelOrder}
          onOpenRun={openRun}
        />
      )}

      {section === "product-sheets" && (
        <ProductionProductSheets products={data.products} />
      )}

      {section === "run" && (
        <ProductionRunForm
          data={data}
          loading={loading}
          requestedOrderId={requestedRunOrderId}
          onSave={saveRun}
          onSubmitted={() => {
            setRequestedRunOrderId(null);
            setSection("history");
          }}
        />
      )}

      {section === "history" && (
        <ProductionHistory
          profile={profile}
          data={data}
          loading={loading}
          onOpenRun={openRun}
          onDecision={decideOrder}
        />
      )}

      {section === "raw-stock" && <RawMaterialStock data={data} />}

      {section === "finished-stock" && <FinishedProductStock data={data} />}
    </div>
  );
}

function ProductionControlRoom({
  profile,
  data,
  loading,
  onOpenOrders,
  onOpenRun,
  onOpenHistory,
  onDecision,
}: {
  profile: ProductionFactoryProfile;
  data: ProductionBootstrap;
  loading: boolean;
  onOpenOrders: () => void;
  onOpenRun: (orderId?: string) => void;
  onOpenHistory: () => void;
  onDecision: (
    orderId: string,
    decision: "VALIDATE" | "RETURN" | "CANCEL",
    comment: string,
  ) => Promise<boolean>;
}) {
  const today = isoDate(new Date());
  const planned = data.orders.filter((order) => order.status === "PLANNED");
  const inProgress = data.orders.filter(
    (order) => order.status === "IN_PROGRESS",
  );
  const pending = data.orders.filter((order) => order.status === "SUBMITTED");
  const validatedToday = data.orders.filter(
    (order) =>
      order.status === "VALIDATED" &&
      (order.validatedAt ?? "").slice(0, 10) === today,
  );
  const actualBagsToday = validatedToday.reduce(
    (sum, order) => sum + Number(order.actualBags || 0),
    0,
  );
  const activeOrders = [...inProgress, ...planned].slice(0, 6);

  return (
    <div className="space-y-6">
      <section className="overflow-hidden border border-[#2f2823] bg-[#171310] text-white">
        <div className="grid gap-8 p-6 lg:grid-cols-[1fr_auto] lg:items-end lg:p-8">
          <div>
            <p className="font-mono text-xs font-black uppercase tracking-[0.18em] text-[#d78a46]">
              Production control room
            </p>
            <h1 className="mt-2 text-4xl font-black uppercase tracking-tight sm:text-5xl">
              {formatDate(today)}
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-[#a89c92]">
              Office releases the order. Production selects the raw lots,
              records the team and submits the actual result for validation.
            </p>
          </div>

          <button
            type="button"
            onClick={() => onOpenRun()}
            className="inline-flex h-14 items-center justify-center gap-3 bg-[#d78a46] px-6 text-sm font-black uppercase text-[#171310] transition hover:bg-[#e49b58]"
          >
            <Play size={21} />
            Open production run
            <ChevronRight size={18} />
          </button>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {[
          {
            label: "Planned orders",
            value: planned.length,
            detail: "Ready for Production",
            icon: ClipboardCheck,
          },
          {
            label: "In progress",
            value: inProgress.length,
            detail: "Draft execution saved",
            icon: Play,
          },
          {
            label: "Pending validation",
            value: pending.length,
            detail:
              profile.role === "manager"
                ? "Manager action required"
                : "Awaiting Management",
            icon: Clock3,
          },
          {
            label: "Validated today",
            value: validatedToday.length,
            detail: `${formatNumber(actualBagsToday)} finished bags`,
            icon: PackageCheck,
          },
          {
            label: "Finished stock",
            value: data.finishedStock.reduce(
              (sum, lot) => sum + Number(lot.availableBags || 0),
              0,
            ),
            detail: `${data.finishedStock.length} finished ERP lots`,
            icon: Warehouse,
          },
        ].map(({ label, value, detail, icon: Icon }) => (
          <div key={label} className="border border-[#cfc4b7] bg-white p-5">
            <div className="flex items-start justify-between gap-3">
              <p className="text-[11px] font-black uppercase tracking-[0.12em] text-[#76695f]">
                {label}
              </p>
              <Icon size={19} className="text-[#b86c2c]" />
            </div>
            <p className="mt-4 font-mono text-2xl font-black text-[#171310]">
              {value}
            </p>
            <p className="mt-2 text-xs font-semibold text-slate-500">{detail}</p>
          </div>
        ))}
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="border border-[#cfc4b7] bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#d8cec3] px-5 py-4">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.14em] text-[#b86c2c]">
                Active work
              </p>
              <h2 className="mt-1 text-2xl font-black uppercase">
                Open Production Orders
              </h2>
            </div>
            <button
              type="button"
              onClick={onOpenOrders}
              className="text-xs font-black uppercase text-[#8a4e22] underline underline-offset-4"
            >
              Full order board
            </button>
          </div>

          {activeOrders.length === 0 ? (
            <EmptyState
              icon={Gauge}
              title="No open Production Orders"
              text="Management creates the order before the Supervisor starts production."
            />
          ) : (
            <div className="divide-y divide-[#e3dbd2]">
              {activeOrders.map((order) => (
                <div key={order.id} className="p-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-mono text-lg font-black">
                          {order.productCode}
                        </h3>
                        <StatusBadge status={order.status} />
                        <RawTypeBadge type={order.rawMaterialType} />
                      </div>
                      <p className="mt-2 max-w-2xl text-sm font-bold text-slate-700">
                        {order.productDescription}
                      </p>
                      <p className="mt-1 text-xs font-semibold text-slate-500">
                        {order.lineName} · {formatDate(order.plannedDate)} ·{" "}
                        {order.shift} · Finished lot {order.finishedErpLotNumber}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-mono text-xl font-black">
                        {formatNumber(order.targetBags)}
                      </p>
                      <p className="text-xs font-bold uppercase text-slate-500">
                        target bags
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onOpenRun(order.id)}
                    className="mt-4 inline-flex items-center gap-2 bg-[#171310] px-4 py-2.5 text-xs font-black uppercase text-white hover:bg-[#2a231f]"
                  >
                    <Play size={15} />
                    {order.status === "IN_PROGRESS" ? "Continue run" : "Start run"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div className="border border-[#2f2823] bg-[#201a16] p-5 text-white">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.14em] text-[#d78a46]">
                  Validation queue
                </p>
                <h2 className="mt-1 text-2xl font-black uppercase">
                  {pending.length} pending
                </h2>
              </div>
              <FileCheck2 size={25} className="text-[#d78a46]" />
            </div>

            {pending.length === 0 ? (
              <p className="mt-6 border border-[#43382f] bg-[#171310] p-4 text-sm text-[#91857b]">
                Nothing waiting for validation.
              </p>
            ) : (
              <div className="mt-5 space-y-3">
                {pending.slice(0, 4).map((order) => (
                  <div
                    key={order.id}
                    className="border border-[#43382f] bg-[#171310] p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-mono text-sm font-black">
                          {order.productCode}
                        </p>
                        <p className="mt-1 text-xs text-[#82766d]">
                          {formatNumber(order.actualBags)} bags · {order.lineName}
                        </p>
                      </div>
                      <p
                        className={`font-mono text-sm font-black ${
                          order.varianceBags >= 0
                            ? "text-emerald-400"
                            : "text-[#d78a46]"
                        }`}
                      >
                        {order.varianceBags >= 0 ? "+" : ""}
                        {formatNumber(order.varianceBags)}
                      </p>
                    </div>
                    {profile.role === "manager" && (
                      <button
                        type="button"
                        disabled={loading}
                        onClick={() =>
                          void onDecision(order.id, "VALIDATE", "")
                        }
                        className="mt-3 inline-flex w-full items-center justify-center gap-2 bg-emerald-700 px-3 py-2 text-xs font-black uppercase text-white hover:bg-emerald-800 disabled:opacity-50"
                      >
                        <PackageCheck size={15} />
                        Validate production
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={onOpenHistory}
              className="mt-4 inline-flex items-center gap-2 text-xs font-black uppercase text-[#d78a46] underline underline-offset-4"
            >
              Open full history
              <ArrowRight size={14} />
            </button>
          </div>

          {profile.role === "manager" && (
            <button
              type="button"
              onClick={onOpenOrders}
              className="flex w-full items-center justify-between border border-[#cfc4b7] bg-white p-5 text-left transition hover:border-[#b86c2c]"
            >
              <span>
                <span className="block text-[11px] font-black uppercase tracking-[0.14em] text-[#b86c2c]">
                  Office planning
                </span>
                <span className="mt-1 block text-xl font-black uppercase">
                  Create Production Order
                </span>
              </span>
              <ChevronRight size={22} />
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

function YesNoBadge({ value }: { value: boolean }) {
  return (
    <span
      className={`inline-flex border px-2 py-1 text-[10px] font-black uppercase ${
        value
          ? "border-emerald-300 bg-emerald-50 text-emerald-800"
          : "border-slate-300 bg-slate-100 text-slate-600"
      }`}
    >
      {value ? "Yes" : "No"}
    </span>
  );
}

function ProductSheetOperationalCard({
  productCode,
  compact = false,
}: {
  productCode: string;
  compact?: boolean;
}) {
  const sheet = getProductionProductSheet(productCode);

  if (!sheet) {
    return (
      <div className="border border-amber-300 bg-amber-50 p-4 text-amber-950">
        <div className="flex items-start gap-3">
          <CircleAlert size={20} className="mt-0.5 shrink-0 text-amber-700" />
          <div>
            <p className="text-xs font-black uppercase tracking-[0.12em]">
              Product sheet incomplete
            </p>
            <p className="mt-1 text-sm font-semibold leading-6">
              This product remains selectable. Global line defaults apply and no
              consumables will be deducted automatically until its sheet and BOM
              are completed.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="border border-emerald-300 bg-emerald-50">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-emerald-200 px-4 py-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.14em] text-emerald-800">
            Active product sheet · {sheet.validation}
          </p>
          <p className="mt-1 font-mono text-sm font-black text-emerald-950">
            {sheet.productCode}
          </p>
        </div>
        <span className="bg-emerald-700 px-2.5 py-1 text-[10px] font-black uppercase text-white">
          Ready
        </span>
      </div>

      <div
        className={`grid gap-3 p-4 ${
          compact ? "sm:grid-cols-3" : "sm:grid-cols-2 xl:grid-cols-4"
        }`}
      >
        <SummaryCell
          label="Palletization"
          value={`${sheet.bagsPerLayer} bags × ${sheet.layersPerPallet} layers = ${sheet.bagsPerPallet}`}
          dark={false}
        />
        <SummaryCell
          label="Pallet"
          value={`${sheet.palletType} ${sheet.palletLengthMm} × ${sheet.palletWidthMm} mm · max ${sheet.maxPalletHeightMm} mm`}
          dark={false}
        />
        <SummaryCell
          label="Container"
          value={`${formatNumber(sheet.palletsPerContainer)} pallets · ${formatNumber(sheet.bagsPerContainer)} bags`}
          dark={false}
        />
        {!compact && (
          <SummaryCell
            label="Target net / pallet"
            value={formatKg(sheet.targetNetWeightKg)}
            dark={false}
          />
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-emerald-200 px-4 py-3 text-xs font-bold text-emerald-950">
        <span>
          Effective line override: {sheet.compatibleLineNumbers.map((line) => `Line ${line}`).join(", ")}
        </span>
        <span>
          Lot number: {sheet.lotNumberPosition} · FSC {sheet.fscRequired ? "required" : "not required"}
        </span>
      </div>

      {!sheet.consumablesConfigured && (
        <div className="border-t border-amber-300 bg-amber-50 px-4 py-3 text-xs font-black uppercase text-amber-900">
          Consumables not configured — no automatic stock deduction yet
        </div>
      )}
    </div>
  );
}

function ProductionProductSheets({
  products,
}: {
  products: ProductionProduct[];
}) {
  const readyCode = productionProductSheets[0]?.productCode ?? "";
  const [selectedCode, setSelectedCode] = useState(readyCode);
  const [search, setSearch] = useState("");

  const productOptions = useMemo(() => {
    const existing = new Map(
      products.map((product) => [product.code.toUpperCase(), product]),
    );
    for (const sheet of productionProductSheets) {
      if (!existing.has(sheet.productCode.toUpperCase())) {
        existing.set(sheet.productCode.toUpperCase(), {
          code: sheet.productCode,
          description: sheet.description,
          bagWeightKg: sheet.bagWeightKg,
          rawMaterialType: "STANDARD",
          active: true,
        });
      }
    }
    return [...existing.values()].sort((a, b) => {
      const aReady = getProductionProductSheet(a.code) ? 0 : 1;
      const bReady = getProductionProductSheet(b.code) ? 0 : 1;
      return aReady - bReady || a.code.localeCompare(b.code);
    });
  }, [products]);

  const filteredProducts = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return productOptions;
    return productOptions.filter((product) =>
      `${product.code} ${product.description}`.toLowerCase().includes(query),
    );
  }, [productOptions, search]);

  const selectedProduct =
    productOptions.find((product) => product.code === selectedCode) ??
    productOptions[0] ??
    null;
  const selectedSheet = getProductionProductSheet(selectedProduct?.code);
  const incompleteCount = productOptions.filter(
    (product) => !getProductionProductSheet(product.code),
  ).length;

  return (
    <div className="space-y-6">
      <section className="border border-[#2f2823] bg-[#171310] p-6 text-white">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-xs font-black uppercase tracking-[0.18em] text-[#d78a46]">
              Supervisor reference
            </p>
            <h1 className="mt-2 text-4xl font-black uppercase tracking-tight">
              Product Sheets
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-[#a89c92]">
              Palletization, line overrides, markings and special requirements
              for every finished product.
            </p>
          </div>
          <div className="flex gap-2">
            <span className="bg-emerald-600 px-3 py-2 text-xs font-black uppercase">
              {productionProductSheets.length} ready
            </span>
            <span className="border border-amber-500 px-3 py-2 text-xs font-black uppercase text-amber-300">
              {incompleteCount} incomplete
            </span>
          </div>
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[340px_minmax(0,1fr)]">
        <section className="border border-[#cfc4b7] bg-white">
          <div className="border-b border-[#d8cec3] bg-[#f4efe9] p-4">
            <Field label="Search product">
              <div className="relative">
                <Search
                  size={17}
                  className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Code or description"
                  className={`${inputClass} pl-11`}
                />
              </div>
            </Field>
          </div>
          <div className="max-h-[650px] divide-y divide-[#e1d8cf] overflow-y-auto">
            {filteredProducts.map((product) => {
              const ready = Boolean(getProductionProductSheet(product.code));
              return (
                <button
                  key={product.code}
                  type="button"
                  onClick={() => setSelectedCode(product.code)}
                  className={`w-full p-4 text-left transition ${
                    selectedProduct?.code === product.code
                      ? "bg-[#201a16] text-white"
                      : "bg-white hover:bg-[#faf8f5]"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-mono text-xs font-black">{product.code}</p>
                      <p className={`mt-1 text-xs font-semibold leading-5 ${
                        selectedProduct?.code === product.code
                          ? "text-[#c8beb5]"
                          : "text-slate-500"
                      }`}>
                        {product.description}
                      </p>
                    </div>
                    <span className={`shrink-0 px-2 py-1 text-[9px] font-black uppercase ${
                      ready
                        ? "bg-emerald-600 text-white"
                        : "bg-amber-100 text-amber-900"
                    }`}>
                      {ready ? "Ready" : "Incomplete"}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <section className="space-y-5">
          {selectedProduct && (
            <>
              <div className="border border-[#cfc4b7] bg-white p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-mono text-sm font-black text-[#b86c2c]">
                      {selectedProduct.code}
                    </p>
                    <h2 className="mt-2 text-2xl font-black uppercase text-[#171310]">
                      {selectedProduct.description}
                    </h2>
                  </div>
                  <span className={`px-3 py-2 text-xs font-black uppercase ${
                    selectedSheet
                      ? "bg-emerald-700 text-white"
                      : "bg-amber-100 text-amber-900"
                  }`}>
                    {selectedSheet ? "Management validated" : "To complete"}
                  </span>
                </div>
              </div>

              <ProductSheetOperationalCard productCode={selectedProduct.code} />

              {selectedSheet && <ProductSheetFullDetails sheet={selectedSheet} />}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function ProductSheetFullDetails({ sheet }: { sheet: ProductionProductSheet }) {
  const requirements = [
    ["Sleeve", sheet.sleeveRequired],
    ["Slip sheet", sheet.slipSheetRequired],
    ["Stretch film", sheet.stretchFilmRequired],
    ["Strapping", sheet.strappingRequired],
    ["Corner protectors", sheet.cornerProtectorsRequired],
    ["FSC", sheet.fscRequired],
    ["5M2", sheet.packing5M2Required],
  ] as const;

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <section className="border border-[#cfc4b7] bg-white p-5">
        <p className="text-[11px] font-black uppercase tracking-[0.14em] text-[#b86c2c]">
          Product and packaging
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <DetailCell label="Customer / brand" value={sheet.customerBrand} />
          <DetailCell label="Product family" value={sheet.productFamily} />
          <DetailCell label="Bag weight" value={formatKg(sheet.bagWeightKg)} />
          <DetailCell label="Bag material" value={sheet.bagMaterial} />
          <DetailCell label="Lot number position" value={sheet.lotNumberPosition} />
          <DetailCell label="Target net / pallet" value={formatKg(sheet.targetNetWeightKg)} />
        </div>
      </section>

      <section className="border border-[#cfc4b7] bg-white p-5">
        <p className="text-[11px] font-black uppercase tracking-[0.14em] text-[#b86c2c]">
          Finishing and certifications
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {requirements.map(([label, value]) => (
            <div
              key={label}
              className="flex min-h-12 items-center justify-between gap-3 border border-[#e1d8cf] bg-[#faf8f5] px-3"
            >
              <span className="text-xs font-bold text-slate-600">{label}</span>
              <YesNoBadge value={value} />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function DetailCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-[#e1d8cf] bg-[#faf8f5] p-3">
      <p className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-500">
        {label}
      </p>
      <p className="mt-2 text-sm font-black text-[#171310]">{value}</p>
    </div>
  );
}

function ProductionOrders({
  profile,
  data,
  loading,
  onSave,
  onCancel,
  onOpenRun,
}: {
  profile: ProductionFactoryProfile;
  data: ProductionBootstrap;
  loading: boolean;
  onSave: (payload: OrderSavePayload) => Promise<boolean>;
  onCancel: (orderId: string, comment: string) => Promise<boolean>;
  onOpenRun: (orderId: string) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [productSearch, setProductSearch] = useState("");
  const [productCode, setProductCode] = useState("");
  const [targetBags, setTargetBags] = useState("");
  const [finishedLot, setFinishedLot] = useState("");
  const [lineCode, setLineCode] = useState("");
  const [plannedDate, setPlannedDate] = useState(isoDate(new Date()));
  const [shift, setShift] = useState<Shift>("DAY");
  const [officeNotes, setOfficeNotes] = useState("");
  const [listSearch, setListSearch] = useState("");

  const selectedProduct =
    data.products.find((product) => product.code === productCode) ?? null;

  const filteredProducts = useMemo(() => {
    const query = productSearch.trim().toLowerCase();
    if (!query) return data.products;
    return data.products.filter((product) =>
      `${product.code} ${product.description} ${product.rawMaterialType}`
        .toLowerCase()
        .includes(query),
    );
  }, [data.products, productSearch]);

  const compatibleLines = useMemo(
    () =>
      selectedProduct
        ? data.lines.filter((line) => isLineCompatible(line, selectedProduct))
        : data.lines,
    [data.lines, selectedProduct],
  );

  const visibleOrders = useMemo(() => {
    const query = listSearch.trim().toLowerCase();
    return data.orders.filter((order) => {
      if (!query) return true;
      return `${order.productCode} ${order.productDescription} ${order.finishedErpLotNumber} ${order.lineName}`
        .toLowerCase()
        .includes(query);
    });
  }, [data.orders, listSearch]);

  useEffect(() => {
    if (
      selectedProduct &&
      lineCode &&
      !compatibleLines.some((line) => line.code === lineCode)
    ) {
      setLineCode("");
    }
  }, [compatibleLines, lineCode, selectedProduct]);

  function resetForm() {
    setEditingId(null);
    setProductSearch("");
    setProductCode("");
    setTargetBags("");
    setFinishedLot("");
    setLineCode("");
    setPlannedDate(isoDate(new Date()));
    setShift("DAY");
    setOfficeNotes("");
  }

  function editOrder(order: ProductionOrder) {
    if (order.status !== "PLANNED") return;
    setEditingId(order.id);
    setProductCode(order.productCode);
    setProductSearch(order.productCode);
    setTargetBags(String(order.targetBags));
    setFinishedLot(order.finishedErpLotNumber);
    setLineCode(order.lineCode);
    setPlannedDate(order.plannedDate);
    setShift(order.shift);
    setOfficeNotes(order.officeNotes);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function submitOrder() {
    const success = await onSave({
      orderId: editingId,
      productCode,
      targetBags: Number(targetBags || 0),
      finishedErpLotNumber: finishedLot.trim().toUpperCase(),
      lineCode,
      plannedDate,
      shift,
      officeNotes: officeNotes.trim(),
    });

    if (success) resetForm();
  }

  async function cancelOrder(order: ProductionOrder) {
    const comment = window.prompt(
      `Reason for cancelling ${order.productCode} / ${order.finishedErpLotNumber}:`,
    );
    if (comment === null) return;
    await onCancel(order.id, comment.trim());
  }

  return (
    <div className="space-y-6">
      <section className="border border-[#2f2823] bg-[#171310] p-6 text-white">
        <p className="font-mono text-xs font-black uppercase tracking-[0.18em] text-[#d78a46]">
          Office planning
        </p>
        <h1 className="mt-2 text-4xl font-black uppercase tracking-tight">
          Production Orders
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-[#a89c92]">
          Office defines the product, target, finished ERP lot, line, date and
          shift. Production chooses the raw-material lots during execution.
        </p>
      </section>

      {profile.role === "manager" && (
        <section className="border border-[#cfc4b7] bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#d8cec3] bg-[#f4efe9] px-5 py-4">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.14em] text-[#b86c2c]">
                {editingId ? "Edit planned order" : "New Production Order"}
              </p>
              <p className="mt-1 text-sm font-semibold text-slate-600">
                Raw-material lots are deliberately not selected by Office.
              </p>
            </div>
            {editingId && (
              <button
                type="button"
                onClick={resetForm}
                className="text-xs font-black uppercase text-[#8a4e22] underline underline-offset-4"
              >
                Stop editing
              </button>
            )}
          </div>

          <div className="grid gap-4 p-5 xl:grid-cols-4">
            <div className="xl:col-span-2">
              <Field label="Search finished product">
                <div className="relative">
                  <Search
                    size={17}
                    className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
                  />
                  <input
                    value={productSearch}
                    onChange={(event) => setProductSearch(event.target.value)}
                    placeholder="Product code or description"
                    className={`${inputClass} pl-11`}
                  />
                </div>
              </Field>
            </div>

            <div className="xl:col-span-2">
              <Field label="Product code">
                <select
                  value={productCode}
                  onChange={(event) => setProductCode(event.target.value)}
                  className={inputClass}
                  required
                >
                  <option value="">Select product</option>
                  {filteredProducts.map((product) => (
                    <option key={product.code} value={product.code}>
                      {product.code} · {product.bagWeightKg} kg · {product.description}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            {selectedProduct && (
              <>
                <div className="xl:col-span-4 grid gap-3 border border-[#3a3029] bg-[#201a16] p-4 text-white sm:grid-cols-3">
                  <SummaryCell label="Description" value={selectedProduct.description} />
                  <SummaryCell
                    label="Bag weight"
                    value={`${selectedProduct.bagWeightKg} kg`}
                  />
                  <SummaryCell
                    label="Raw material"
                    value={selectedProduct.rawMaterialType}
                  />
                </div>
                <div className="xl:col-span-4">
                  <ProductSheetOperationalCard
                    productCode={selectedProduct.code}
                    compact
                  />
                </div>
              </>
            )}

            <Field label="Target number of bags">
              <input
                type="number"
                min="1"
                step="1"
                value={targetBags}
                onChange={(event) => setTargetBags(event.target.value)}
                placeholder="0"
                className={inputClass}
                required
              />
            </Field>

            <Field label="Finished product ERP lot">
              <input
                value={finishedLot}
                onChange={(event) =>
                  setFinishedLot(event.target.value.toUpperCase())
                }
                placeholder="Finished ERP lot"
                className={inputClass}
                required
              />
            </Field>

            <Field label="Production line">
              <select
                value={lineCode}
                onChange={(event) => setLineCode(event.target.value)}
                className={inputClass}
                disabled={!selectedProduct}
                required
              >
                <option value="">Select compatible line</option>
                {compatibleLines.map((line) => (
                  <option key={line.code} value={line.code}>
                    {line.label} · {line.minBagWeightKg}–{line.maxBagWeightKg} kg
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Planned production date">
              <input
                type="date"
                value={plannedDate}
                onChange={(event) => setPlannedDate(event.target.value)}
                className={inputClass}
                required
              />
            </Field>

            <Field label="Shift">
              <select
                value={shift}
                onChange={(event) => setShift(event.target.value as Shift)}
                className={inputClass}
              >
                <option value="DAY">Day shift</option>
                <option value="NIGHT">Night shift</option>
              </select>
            </Field>

            <div className="xl:col-span-2">
              <Field label="Office notes">
                <input
                  value={officeNotes}
                  onChange={(event) => setOfficeNotes(event.target.value)}
                  placeholder="Optional planning instructions"
                  className={inputClass}
                />
              </Field>
            </div>

            <div className="flex items-end">
              <button
                type="button"
                disabled={
                  loading ||
                  !productCode ||
                  !lineCode ||
                  !finishedLot.trim() ||
                  Number(targetBags || 0) <= 0
                }
                onClick={() => void submitOrder()}
                className="inline-flex h-12 w-full items-center justify-center gap-2 bg-[#d78a46] px-5 text-sm font-black uppercase text-[#171310] hover:bg-[#e49b58] disabled:opacity-50"
              >
                {loading ? (
                  <LoaderCircle size={18} className="animate-spin" />
                ) : editingId ? (
                  <Save size={18} />
                ) : (
                  <Plus size={18} />
                )}
                {editingId ? "Save order changes" : "Create order"}
              </button>
            </div>
          </div>
        </section>
      )}

      <section className="border border-[#cfc4b7] bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#d8cec3] px-5 py-4">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.14em] text-[#b86c2c]">
              Order board
            </p>
            <h2 className="mt-1 text-2xl font-black uppercase">
              {data.orders.length} Production Orders
            </h2>
          </div>
          <div className="relative w-full max-w-md">
            <Search
              size={17}
              className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              value={listSearch}
              onChange={(event) => setListSearch(event.target.value)}
              placeholder="Search product, finished lot or line"
              className={`${inputClass} pl-11`}
            />
          </div>
        </div>

        {visibleOrders.length === 0 ? (
          <EmptyState
            icon={ClipboardCheck}
            title="No Production Orders found"
            text="Create the first order from the Office form above."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-[#201a16] text-white">
                <tr className="text-left text-[10px] font-black uppercase tracking-[0.08em]">
                  <th className="px-4 py-4">Product</th>
                  <th className="px-4 py-4">Finished lot</th>
                  <th className="px-4 py-4">Line / Plan</th>
                  <th className="px-4 py-4 text-right">Target</th>
                  <th className="px-4 py-4">Status</th>
                  <th className="px-4 py-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {visibleOrders.map((order) => (
                  <tr key={order.id} className="border-b border-[#e4dcd3]">
                    <td className="px-4 py-4">
                      <p className="font-mono text-xs font-black">
                        {order.productCode}
                      </p>
                      <p className="mt-1 max-w-xl text-xs text-slate-500">
                        {order.productDescription}
                      </p>
                      <div className="mt-2 flex gap-2">
                        <RawTypeBadge type={order.rawMaterialType} />
                        <span className="border border-slate-300 bg-slate-50 px-2 py-1 text-[10px] font-black uppercase text-slate-700">
                          {order.bagWeightKg} kg
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-4 font-mono text-xs font-black">
                      {order.finishedErpLotNumber}
                    </td>
                    <td className="px-4 py-4">
                      <p className="font-black">{order.lineName}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {formatDate(order.plannedDate)} · {order.shift}
                      </p>
                    </td>
                    <td className="px-4 py-4 text-right font-mono font-black">
                      {formatNumber(order.targetBags)}
                    </td>
                    <td className="px-4 py-4">
                      <StatusBadge status={order.status} />
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex justify-end gap-2">
                        {["PLANNED", "IN_PROGRESS"].includes(order.status) && (
                          <button
                            type="button"
                            onClick={() => onOpenRun(order.id)}
                            className="inline-flex h-9 items-center gap-2 border border-[#2f2823] bg-[#171310] px-3 text-xs font-black uppercase text-white"
                          >
                            <Play size={14} />
                            Run
                          </button>
                        )}
                        {profile.role === "manager" &&
                          order.status === "PLANNED" && (
                            <>
                              <button
                                type="button"
                                onClick={() => editOrder(order)}
                                className="grid h-9 w-9 place-items-center border border-[#817267] bg-white hover:border-[#b86c2c]"
                                title="Edit order"
                              >
                                <Pencil size={15} />
                              </button>
                              <button
                                type="button"
                                disabled={loading}
                                onClick={() => void cancelOrder(order)}
                                className="grid h-9 w-9 place-items-center border border-red-400 bg-red-50 text-red-700 disabled:opacity-50"
                                title="Cancel order"
                              >
                                <X size={15} />
                              </button>
                            </>
                          )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function ProductionRunForm({
  data,
  loading,
  requestedOrderId,
  onSave,
  onSubmitted,
}: {
  data: ProductionBootstrap;
  loading: boolean;
  requestedOrderId: string | null;
  onSave: (payload: RunSavePayload) => Promise<boolean>;
  onSubmitted: () => void;
}) {
  const openOrders = data.orders.filter((order) =>
    ["PLANNED", "IN_PROGRESS"].includes(order.status),
  );
  const [orderId, setOrderId] = useState("");
  const [actualBags, setActualBags] = useState("");
  const [rejectedBags, setRejectedBags] = useState("0");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [notes, setNotes] = useState("");
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<string[]>([]);
  const [rawLotSelect, setRawLotSelect] = useState("");
  const [selectedRawLots, setSelectedRawLots] = useState<
    RunRawLotPayload[]
  >([]);
  const [breakdowns, setBreakdowns] = useState<BreakdownDraft[]>([]);

  const selectedOrder =
    data.orders.find((order) => order.id === orderId) ?? null;

  useEffect(() => {
    if (
      requestedOrderId &&
      data.orders.some(
        (order) =>
          order.id === requestedOrderId &&
          ["PLANNED", "IN_PROGRESS"].includes(order.status),
      )
    ) {
      setOrderId(requestedOrderId);
    }
  }, [data.orders, requestedOrderId]);

  useEffect(() => {
    if (!selectedOrder) {
      setActualBags("");
      setRejectedBags("0");
      setStartTime("");
      setEndTime("");
      setNotes("");
      setSelectedEmployeeIds([]);
      setSelectedRawLots([]);
      setBreakdowns([]);
      setRawLotSelect("");
      return;
    }

    setActualBags(
      selectedOrder.status === "IN_PROGRESS"
        ? String(selectedOrder.actualBags)
        : "",
    );
    setRejectedBags(String(selectedOrder.rejectedBags || 0));
    setStartTime(selectedOrder.startTime?.slice(0, 5) ?? "");
    setEndTime(selectedOrder.endTime?.slice(0, 5) ?? "");
    setNotes(selectedOrder.productionNotes ?? "");
    setSelectedEmployeeIds(
      selectedOrder.employees.map((employee) => employee.id),
    );
    setSelectedRawLots(
      selectedOrder.rawLots.map((lot) => ({
        sourceModule: lot.sourceModule,
        sourceLotId: lot.sourceLotId,
        lotFinished: lot.lotFinished,
      })),
    );
    setBreakdowns(
      (selectedOrder.breakdowns ?? []).map((breakdown) => ({
        clientId: breakdown.id,
        category: breakdown.category,
        equipment: breakdown.equipment,
        startTime: breakdown.startTime?.slice(0, 5) ?? "",
        endTime: breakdown.endTime?.slice(0, 5) ?? "",
        productionStopped: breakdown.productionStopped,
        maintenanceNotified: breakdown.maintenanceNotified,
        description: breakdown.description,
        actionTaken: breakdown.actionTaken,
      })),
    );
    setRawLotSelect("");
  }, [selectedOrder]);

  const filteredEmployees = useMemo(() => {
    const query = employeeSearch.trim().toLowerCase();
    if (!query) return data.employees;
    return data.employees.filter((employee) =>
      `${employee.employeeCode} ${employee.employeeName} ${employee.department} ${employee.position}`
        .toLowerCase()
        .includes(query),
    );
  }, [data.employees, employeeSearch]);

  const compatibleRawLots = useMemo(() => {
    if (!selectedOrder) return [];
    return data.rawLots.filter(
      (lot) =>
        lot.rawMaterialType === selectedOrder.rawMaterialType &&
        (!lot.reservedByOrderId || lot.reservedByOrderId === selectedOrder.id),
    );
  }, [data.rawLots, selectedOrder]);

  const actual = Number(actualBags || 0);
  const rejected = Number(rejectedBags || 0);
  const variance = selectedOrder ? actual - selectedOrder.targetBags : 0;
  const achievement =
    selectedOrder && selectedOrder.targetBags > 0
      ? (actual / selectedOrder.targetBags) * 100
      : 0;
  const packedWeight = selectedOrder
    ? actual * selectedOrder.bagWeightKg
    : 0;
  const runDuration = durationHours(startTime, endTime);
  const totalDowntimeMinutes = breakdowns.reduce(
    (sum, breakdown) =>
      sum +
      (breakdown.productionStopped
        ? durationMinutes(breakdown.startTime, breakdown.endTime)
        : 0),
    0,
  );
  const breakdownsValid = breakdowns.every(
    (breakdown) =>
      breakdown.category &&
      breakdown.equipment.trim() &&
      breakdown.startTime &&
      breakdown.endTime &&
      durationMinutes(breakdown.startTime, breakdown.endTime) > 0 &&
      breakdown.description.trim(),
  );

  function resetForm() {
    setOrderId("");
    setActualBags("");
    setRejectedBags("0");
    setStartTime("");
    setEndTime("");
    setNotes("");
    setEmployeeSearch("");
    setSelectedEmployeeIds([]);
    setRawLotSelect("");
    setSelectedRawLots([]);
    setBreakdowns([]);
  }

  function toggleEmployee(employeeId: string) {
    setSelectedEmployeeIds((current) =>
      current.includes(employeeId)
        ? current.filter((id) => id !== employeeId)
        : [...current, employeeId],
    );
  }

  function addRawLot() {
    if (!rawLotSelect) return;
    if (selectedRawLots.some((lot) => lot.sourceLotId === rawLotSelect)) return;
    setSelectedRawLots((current) => [
      ...current,
      {
        sourceModule: "SCREENING",
        sourceLotId: rawLotSelect,
        lotFinished: false,
      },
    ]);
    setRawLotSelect("");
  }

  function updateRawLotFinished(sourceLotId: string, lotFinished: boolean) {
    setSelectedRawLots((current) =>
      current.map((lot) =>
        lot.sourceLotId === sourceLotId ? { ...lot, lotFinished } : lot,
      ),
    );
  }

  function removeRawLot(sourceLotId: string) {
    setSelectedRawLots((current) =>
      current.filter((lot) => lot.sourceLotId !== sourceLotId),
    );
  }

  function addBreakdown() {
    setBreakdowns((current) => [
      ...current,
      {
        clientId: crypto.randomUUID(),
        category: "MECHANICAL",
        equipment: selectedOrder?.lineName ?? "",
        startTime: "",
        endTime: "",
        productionStopped: true,
        maintenanceNotified: false,
        description: "",
        actionTaken: "",
      },
    ]);
  }

  function updateBreakdown(
    clientId: string,
    patch: Partial<BreakdownDraft>,
  ) {
    setBreakdowns((current) =>
      current.map((breakdown) =>
        breakdown.clientId === clientId
          ? { ...breakdown, ...patch }
          : breakdown,
      ),
    );
  }

  function removeBreakdown(clientId: string) {
    setBreakdowns((current) =>
      current.filter((breakdown) => breakdown.clientId !== clientId),
    );
  }

  function rawLotDetails(sourceLotId: string) {
    const live = data.rawLots.find((lot) => lot.id === sourceLotId);
    if (live) return live;
    const saved = selectedOrder?.rawLots.find(
      (lot) => lot.sourceLotId === sourceLotId,
    );
    if (!saved) return null;
    return {
      sourceModule: saved.sourceModule,
      id: saved.sourceLotId,
      rawMaterialType: saved.rawMaterialType,
      erpLotNumber: saved.erpLotNumber,
      sourceReference: saved.sourceReference,
      stockStatus: saved.currentStockStatus,
      quantityKnown: saved.quantityKnown,
      availableWeightKg: saved.availableWeightKg,
      availableBigBags: saved.availableBigBags,
      lastUsedAt: null,
      reservedByOrderId: selectedOrder?.id ?? null,
    } satisfies ProductionRawLot;
  }

  async function submitRun(submit: boolean) {
    if (!selectedOrder) return;
    const success = await onSave({
      orderId: selectedOrder.id,
      actualBags: actual,
      rejectedBags: rejected,
      startTime: startTime || null,
      endTime: endTime || null,
      notes: notes.trim(),
      employeeIds: selectedEmployeeIds,
      rawLots: selectedRawLots,
      breakdowns: breakdowns.map(
        ({ clientId: _clientId, ...breakdown }) => breakdown,
      ),
      submit,
    });

    if (success && submit) {
      resetForm();
      onSubmitted();
    }
  }

  return (
    <div className="space-y-6">
      <section className="border border-[#2f2823] bg-[#171310] p-6 text-white">
        <p className="font-mono text-xs font-black uppercase tracking-[0.18em] text-[#d78a46]">
          Supervisor execution
        </p>
        <h1 className="mt-2 text-4xl font-black uppercase tracking-tight">
          Production Run
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-[#a89c92]">
          Select an Office order, record the team and raw lots used, then enter
          actual output. Producing above target is allowed.
        </p>
      </section>

      <section className="border border-[#cfc4b7] bg-white">
        <div className="border-b border-[#d8cec3] bg-[#f4efe9] px-5 py-4">
          <p className="text-[11px] font-black uppercase tracking-[0.14em] text-[#b86c2c]">
            01 · Select Production Order
          </p>
        </div>
        <div className="p-5">
          <Field label="Open Production Order">
            <select
              value={orderId}
              onChange={(event) => setOrderId(event.target.value)}
              className={inputClass}
            >
              <option value="">Select planned or in-progress order</option>
              {openOrders.map((order) => (
                <option key={order.id} value={order.id}>
                  {order.productCode} · {order.finishedErpLotNumber} · {order.lineName} · {formatNumber(order.targetBags)} bags
                </option>
              ))}
            </select>
          </Field>
        </div>

        {selectedOrder && (
          <div className="grid gap-3 border-t border-[#d8cec3] bg-[#201a16] p-5 text-white sm:grid-cols-2 xl:grid-cols-6">
            <SummaryCell label="Product" value={selectedOrder.productCode} />
            <SummaryCell
              label="Bag weight"
              value={`${selectedOrder.bagWeightKg} kg`}
            />
            <SummaryCell label="Raw material" value={selectedOrder.rawMaterialType} />
            <SummaryCell label="Target" value={`${formatNumber(selectedOrder.targetBags)} bags`} />
            <SummaryCell label="Line" value={selectedOrder.lineName} />
            <SummaryCell label="Finished lot" value={selectedOrder.finishedErpLotNumber} />
          </div>
        )}

        {selectedOrder && (
          <div className="border-t border-[#d8cec3] p-5">
            <ProductSheetOperationalCard
              productCode={selectedOrder.productCode}
            />
          </div>
        )}

        {selectedOrder?.officeNotes && (
          <div className="border-t border-amber-300 bg-amber-50 px-5 py-4 text-sm font-bold text-amber-900">
            Office notes: {selectedOrder.officeNotes}
          </div>
        )}

        {selectedOrder?.returnComment && (
          <div className="border-t border-red-300 bg-red-50 px-5 py-4 text-sm font-bold text-red-800">
            Returned by Management: {selectedOrder.returnComment}
          </div>
        )}
      </section>

      {selectedOrder && (
        <>
          <section className="border border-[#cfc4b7] bg-white">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#d8cec3] bg-[#f4efe9] px-5 py-4">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.14em] text-[#b86c2c]">
                  02 · Production team
                </p>
                <p className="mt-1 text-sm font-semibold text-slate-600">
                  Select all employees who worked on this Production Order.
                </p>
              </div>
              <span className="bg-[#171310] px-3 py-1.5 text-xs font-black uppercase text-white">
                {selectedEmployeeIds.length} selected
              </span>
            </div>

            <div className="p-5">
              <div className="relative">
                <Search
                  size={17}
                  className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <input
                  value={employeeSearch}
                  onChange={(event) => setEmployeeSearch(event.target.value)}
                  placeholder="Search GCN code, name, department or position"
                  className={`${inputClass} pl-11`}
                />
              </div>

              <div className="mt-4 grid max-h-80 gap-2 overflow-y-auto border border-[#ddd4cb] bg-[#f6f2ed] p-3 md:grid-cols-2 xl:grid-cols-3">
                {filteredEmployees.map((employee) => {
                  const selected = selectedEmployeeIds.includes(employee.id);
                  return (
                    <button
                      key={employee.id}
                      type="button"
                      onClick={() => toggleEmployee(employee.id)}
                      className={`flex items-start gap-3 border p-3 text-left transition ${
                        selected
                          ? "border-[#b86c2c] bg-[#fff1e3]"
                          : "border-[#ddd4cb] bg-white hover:border-[#b86c2c]"
                      }`}
                    >
                      <span
                        className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center border ${
                          selected
                            ? "border-[#b86c2c] bg-[#b86c2c] text-white"
                            : "border-slate-300"
                        }`}
                      >
                        {selected && <Check size={13} />}
                      </span>
                      <span>
                        <span className="block text-sm font-black">
                          {employee.employeeCode} · {employee.employeeName}
                        </span>
                        <span className="mt-1 block text-xs text-slate-500">
                          {employee.department}
                          {employee.position ? ` · ${employee.position}` : ""}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </section>

          <section className="border border-[#cfc4b7] bg-white">
            <div className="border-b border-[#d8cec3] bg-[#f4efe9] px-5 py-4">
              <p className="text-[11px] font-black uppercase tracking-[0.14em] text-[#b86c2c]">
                03 · Raw-material lots used
              </p>
              <p className="mt-1 text-sm font-semibold text-slate-600">
                Multiple lots are allowed. Only indicate whether each lot was
                finished; no consumed kilograms are required.
              </p>
            </div>

            {selectedOrder.rawMaterialType === "BRIQUETTE" ? (
              <div className="border-b border-amber-300 bg-amber-50 p-5 text-sm font-bold text-amber-900">
                Briquette raw-material lots will become selectable when the
                Briquettes module is connected. The Production Order can already
                be created, but it cannot yet be submitted.
              </div>
            ) : (
              <div className="grid gap-3 p-5 md:grid-cols-[1fr_auto]">
                <Field label={`Available ${selectedOrder.rawMaterialType.toLowerCase()} lots`}>
                  <select
                    value={rawLotSelect}
                    onChange={(event) => setRawLotSelect(event.target.value)}
                    className={inputClass}
                  >
                    <option value="">Select raw-material ERP lot</option>
                    {compatibleRawLots
                      .filter(
                        (lot) =>
                          !selectedRawLots.some(
                            (selected) => selected.sourceLotId === lot.id,
                          ),
                      )
                      .map((lot) => (
                        <option key={lot.id} value={lot.id}>
                          {lot.erpLotNumber} · farmer lot {lot.sourceReference} · {lot.quantityKnown ? formatKg(lot.availableWeightKg) : "open quantity not measured"}
                        </option>
                      ))}
                  </select>
                </Field>
                <div className="flex items-end">
                  <button
                    type="button"
                    disabled={!rawLotSelect}
                    onClick={addRawLot}
                    className="inline-flex h-12 items-center gap-2 bg-[#171310] px-5 text-sm font-black uppercase text-white disabled:opacity-50"
                  >
                    <Plus size={17} />
                    Add lot
                  </button>
                </div>
              </div>
            )}

            <div className="border-t border-[#e1d8cf] p-5">
              {selectedRawLots.length === 0 ? (
                <div className="border border-dashed border-[#cfc4b7] bg-[#faf8f5] p-6 text-center text-sm font-bold text-slate-500">
                  No raw-material lot selected yet.
                </div>
              ) : (
                <div className="space-y-3">
                  {selectedRawLots.map((selected) => {
                    const lot = rawLotDetails(selected.sourceLotId);
                    if (!lot) return null;
                    return (
                      <div
                        key={selected.sourceLotId}
                        className="grid gap-4 border border-[#d8cec3] bg-[#faf8f5] p-4 lg:grid-cols-[1fr_auto_auto] lg:items-center"
                      >
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-mono text-sm font-black">
                              {lot.erpLotNumber}
                            </p>
                            <RawTypeBadge type={lot.rawMaterialType} />
                          </div>
                          <p className="mt-1 text-xs font-semibold text-slate-500">
                            Farmer lot: {lot.sourceReference}
                          </p>
                          <p className="mt-2 text-xs font-black uppercase text-[#8a4e22]">
                            {lot.quantityKnown
                              ? `${formatKg(lot.availableWeightKg)} · ${lot.availableBigBags} big bags recorded`
                              : "Open lot — remaining quantity not measured"}
                          </p>
                        </div>

                        <Field label="Lot finished?">
                          <select
                            value={selected.lotFinished ? "YES" : "NO"}
                            onChange={(event) =>
                              updateRawLotFinished(
                                selected.sourceLotId,
                                event.target.value === "YES",
                              )
                            }
                            className={`${inputClass} min-w-44`}
                          >
                            <option value="NO">No — keep available</option>
                            <option value="YES">Yes — close the lot</option>
                          </select>
                        </Field>

                        <button
                          type="button"
                          onClick={() => removeRawLot(selected.sourceLotId)}
                          className="grid h-11 w-11 place-items-center border border-red-400 bg-red-50 text-red-700"
                          title="Remove lot from this run"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>

          <section className="border border-[#cfc4b7] bg-white">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#d8cec3] bg-[#f4efe9] px-5 py-4">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.14em] text-[#b86c2c]">
                  04 · Breakdowns and downtime
                </p>
                <p className="mt-1 text-sm font-semibold text-slate-600">
                  Add one record for every machine stoppage or technical breakdown.
                  Leave this section empty when no breakdown occurred.
                </p>
              </div>
              <button
                type="button"
                onClick={addBreakdown}
                className="inline-flex h-10 items-center gap-2 bg-[#171310] px-4 text-xs font-black uppercase text-white"
              >
                <Plus size={16} />
                Add breakdown
              </button>
            </div>

            {breakdowns.length === 0 ? (
              <div className="grid min-h-40 place-items-center p-6 text-center">
                <div>
                  <Wrench size={32} className="mx-auto text-[#b9ada2]" />
                  <p className="mt-3 font-black uppercase text-slate-700">
                    No breakdown recorded
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    The Production Run can be submitted without a breakdown.
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-4 p-5">
                {breakdowns.map((breakdown, index) => {
                  const downtime = durationMinutes(
                    breakdown.startTime,
                    breakdown.endTime,
                  );

                  return (
                    <article
                      key={breakdown.clientId}
                      className="border border-[#d8cec3] bg-[#faf8f5]"
                    >
                      <div className="flex items-center justify-between gap-3 border-b border-[#ded5cb] bg-[#201a16] px-4 py-3 text-white">
                        <div className="flex items-center gap-3">
                          <CircleAlert size={18} className="text-[#d78a46]" />
                          <h3 className="font-black uppercase">
                            Breakdown {index + 1}
                          </h3>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="font-mono text-xs font-black text-[#d78a46]">
                            {formatDowntime(downtime)}
                          </span>
                          <button
                            type="button"
                            onClick={() => removeBreakdown(breakdown.clientId)}
                            className="grid h-8 w-8 place-items-center border border-[#5b4b40] text-red-300 hover:border-red-400"
                            title="Remove breakdown"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </div>

                      <div className="grid gap-4 p-4 md:grid-cols-2 xl:grid-cols-4">
                        <Field label="Breakdown category">
                          <select
                            value={breakdown.category}
                            onChange={(event) =>
                              updateBreakdown(breakdown.clientId, {
                                category: event.target
                                  .value as BreakdownCategory,
                              })
                            }
                            className={inputClass}
                          >
                            {breakdownCategories.map((category) => (
                              <option key={category} value={category}>
                                {breakdownCategoryLabels[category]}
                              </option>
                            ))}
                          </select>
                        </Field>

                        <Field label="Equipment / machine affected">
                          <input
                            value={breakdown.equipment}
                            onChange={(event) =>
                              updateBreakdown(breakdown.clientId, {
                                equipment: event.target.value,
                              })
                            }
                            placeholder="Bagging machine, conveyor, printer..."
                            className={inputClass}
                          />
                        </Field>

                        <Field label="Breakdown start">
                          <input
                            type="time"
                            value={breakdown.startTime}
                            onChange={(event) =>
                              updateBreakdown(breakdown.clientId, {
                                startTime: event.target.value,
                              })
                            }
                            className={inputClass}
                          />
                        </Field>

                        <Field label="Breakdown end">
                          <input
                            type="time"
                            value={breakdown.endTime}
                            onChange={(event) =>
                              updateBreakdown(breakdown.clientId, {
                                endTime: event.target.value,
                              })
                            }
                            className={inputClass}
                          />
                        </Field>

                        <Field label="Production stopped">
                          <select
                            value={
                              breakdown.productionStopped ? "YES" : "NO"
                            }
                            onChange={(event) =>
                              updateBreakdown(breakdown.clientId, {
                                productionStopped:
                                  event.target.value === "YES",
                              })
                            }
                            className={inputClass}
                          >
                            <option value="YES">Yes</option>
                            <option value="NO">No</option>
                          </select>
                        </Field>

                        <Field label="Maintenance notified">
                          <select
                            value={
                              breakdown.maintenanceNotified ? "YES" : "NO"
                            }
                            onChange={(event) =>
                              updateBreakdown(breakdown.clientId, {
                                maintenanceNotified:
                                  event.target.value === "YES",
                              })
                            }
                            className={inputClass}
                          >
                            <option value="NO">No</option>
                            <option value="YES">Yes</option>
                          </select>
                        </Field>

                        <div className="md:col-span-2">
                          <Field label="Breakdown description">
                            <input
                              value={breakdown.description}
                              onChange={(event) =>
                                updateBreakdown(breakdown.clientId, {
                                  description: event.target.value,
                                })
                              }
                              placeholder="What happened?"
                              className={inputClass}
                            />
                          </Field>
                        </div>

                        <div className="md:col-span-2 xl:col-span-4">
                          <Field label="Action taken">
                            <input
                              value={breakdown.actionTaken}
                              onChange={(event) =>
                                updateBreakdown(breakdown.clientId, {
                                  actionTaken: event.target.value,
                                })
                              }
                              placeholder="Temporary fix, maintenance action or parts changed"
                              className={inputClass}
                            />
                          </Field>
                        </div>
                      </div>

                      {(!breakdown.startTime ||
                        !breakdown.endTime ||
                        downtime <= 0 ||
                        !breakdown.equipment.trim() ||
                        !breakdown.description.trim()) && (
                        <div className="border-t border-amber-300 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-900">
                          Start time, end time, equipment and description are
                          required before submission.
                        </div>
                      )}
                    </article>
                  );
                })}

                <div className="flex items-center justify-between border border-[#2f2823] bg-[#171310] p-4 text-white">
                  <span className="text-xs font-black uppercase tracking-[0.12em] text-[#a89c92]">
                    Total recorded downtime
                  </span>
                  <span className="font-mono text-xl font-black text-[#d78a46]">
                    {formatDowntime(totalDowntimeMinutes)}
                  </span>
                </div>
              </div>
            )}
          </section>

          <section className="border border-[#cfc4b7] bg-white">
            <div className="border-b border-[#d8cec3] bg-[#f4efe9] px-5 py-4">
              <p className="text-[11px] font-black uppercase tracking-[0.14em] text-[#b86c2c]">
                05 · Actual production result
              </p>
            </div>
            <div className="grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-4">
              <Field label="Actual good bags produced">
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={actualBags}
                  onChange={(event) => setActualBags(event.target.value)}
                  className={inputClass}
                />
              </Field>

              <Field label="Rejected / damaged bags">
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={rejectedBags}
                  onChange={(event) => setRejectedBags(event.target.value)}
                  className={inputClass}
                />
              </Field>

              <Field label="Start time">
                <input
                  type="time"
                  value={startTime}
                  onChange={(event) => setStartTime(event.target.value)}
                  className={inputClass}
                />
              </Field>

              <Field label="End time">
                <input
                  type="time"
                  value={endTime}
                  onChange={(event) => setEndTime(event.target.value)}
                  className={inputClass}
                />
              </Field>

              <div className="md:col-span-2 xl:col-span-4">
                <Field label="Production notes / other incidents">
                  <input
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    placeholder="Optional production notes or non-breakdown incidents"
                    className={inputClass}
                  />
                </Field>
              </div>
            </div>
          </section>

          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-7">
            {[
              ["Target bags", formatNumber(selectedOrder.targetBags)],
              ["Actual bags", formatNumber(actual)],
              [
                "Variance",
                `${variance >= 0 ? "+" : ""}${formatNumber(variance)}`,
              ],
              ["Achievement", `${achievement.toFixed(1)}%`],
              ["Net packed", formatKg(packedWeight)],
              ["Breakdowns", formatNumber(breakdowns.length)],
              ["Downtime", formatDowntime(totalDowntimeMinutes)],
            ].map(([label, value]) => (
              <div
                key={label}
                className="border border-[#2f2823] bg-[#171310] p-5 text-white"
              >
                <p className="text-[11px] font-black uppercase tracking-[0.12em] text-[#8e8379]">
                  {label}
                </p>
                <p
                  className={`mt-3 font-mono text-2xl font-black ${
                    label === "Variance" && variance >= 0
                      ? "text-emerald-400"
                      : "text-[#d78a46]"
                  }`}
                >
                  {value}
                </p>
              </div>
            ))}
          </section>

          <div className="flex flex-wrap items-center justify-between gap-3 border border-[#cfc4b7] bg-white p-4">
            <p className="text-sm font-bold text-slate-600">
              Duration: {runDuration > 0 ? `${runDuration.toFixed(2)} hours` : "—"}
              {actual > selectedOrder.targetBags && (
                <span className="ml-3 text-emerald-700">
                  Above target production is accepted.
                </span>
              )}
            </p>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={resetForm}
                className="inline-flex h-12 items-center gap-2 border border-[#6f6156] bg-white px-5 text-sm font-black uppercase"
              >
                <RotateCcw size={17} />
                Clear
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={() => void submitRun(false)}
                className="inline-flex h-12 items-center gap-2 border border-[#2f2823] bg-white px-5 text-sm font-black uppercase disabled:opacity-50"
              >
                {loading ? (
                  <LoaderCircle size={17} className="animate-spin" />
                ) : (
                  <Save size={17} />
                )}
                Save run
              </button>
              <button
                type="button"
                disabled={
                  loading ||
                  selectedEmployeeIds.length === 0 ||
                  selectedRawLots.length === 0 ||
                  !startTime ||
                  !endTime ||
                  !breakdownsValid
                }
                onClick={() => void submitRun(true)}
                className="inline-flex h-12 items-center gap-2 bg-[#d78a46] px-6 text-sm font-black uppercase text-[#171310] hover:bg-[#e49b58] disabled:opacity-50"
              >
                {loading ? (
                  <LoaderCircle size={17} className="animate-spin" />
                ) : (
                  <FileCheck2 size={18} />
                )}
                Submit for validation
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function ProductionHistory({
  profile,
  data,
  loading,
  onOpenRun,
  onDecision,
}: {
  profile: ProductionFactoryProfile;
  data: ProductionBootstrap;
  loading: boolean;
  onOpenRun: (orderId: string) => void;
  onDecision: (
    orderId: string,
    decision: "VALIDATE" | "RETURN" | "CANCEL",
    comment: string,
  ) => Promise<boolean>;
}) {
  const [statusFilter, setStatusFilter] = useState<"ALL" | ProductionStatus>(
    "ALL",
  );
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return data.orders.filter((order) => {
      const statusMatches =
        statusFilter === "ALL" || order.status === statusFilter;
      const searchMatches =
        !query ||
        `${order.productCode} ${order.productDescription} ${order.finishedErpLotNumber} ${order.lineName}`
          .toLowerCase()
          .includes(query);
      return statusMatches && searchMatches;
    });
  }, [data.orders, search, statusFilter]);

  async function decide(
    order: ProductionOrder,
    decision: "VALIDATE" | "RETURN" | "CANCEL",
  ) {
    let comment = "";

    if (decision === "RETURN") {
      const entered = window.prompt("Reason for returning this production:");
      if (entered === null) return;
      comment = entered.trim();
      if (!comment) return;
    }

    if (
      decision === "CANCEL" &&
      !window.confirm(`Cancel Production Order ${order.finishedErpLotNumber}?`)
    ) {
      return;
    }

    await onDecision(order.id, decision, comment);
  }

  return (
    <div className="space-y-6">
      <section className="border border-[#2f2823] bg-[#171310] p-6 text-white">
        <p className="font-mono text-xs font-black uppercase tracking-[0.18em] text-[#d78a46]">
          Traceability
        </p>
        <h1 className="mt-2 text-4xl font-black uppercase tracking-tight">
          Production History
        </h1>
      </section>

      <section className="border border-[#cfc4b7] bg-white p-4">
        <div className="grid gap-3 md:grid-cols-[1fr_auto]">
          <div className="relative">
            <Search
              size={17}
              className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search product, finished ERP lot or line"
              className={`${inputClass} pl-11`}
            />
          </div>
          <select
            value={statusFilter}
            onChange={(event) =>
              setStatusFilter(event.target.value as "ALL" | ProductionStatus)
            }
            className={`${inputClass} min-w-52`}
          >
            <option value="ALL">All statuses</option>
            <option value="PLANNED">Planned</option>
            <option value="IN_PROGRESS">In progress</option>
            <option value="SUBMITTED">Submitted</option>
            <option value="VALIDATED">Validated</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
        </div>
      </section>

      {filtered.length === 0 ? (
        <EmptyState
          icon={History}
          title="No Production Orders found"
          text="The Production history will appear here."
        />
      ) : (
        <div className="space-y-4">
          {filtered.map((order) => (
            <article key={order.id} className="border border-[#cfc4b7] bg-white">
              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#d8cec3] bg-[#f6f2ed] p-5">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-mono text-xl font-black uppercase">
                      {order.productCode}
                    </h2>
                    <StatusBadge status={order.status} />
                    <RawTypeBadge type={order.rawMaterialType} />
                  </div>
                  <p className="mt-2 max-w-3xl text-sm font-bold text-slate-700">
                    {order.productDescription}
                  </p>
                  <p className="mt-2 text-xs font-semibold text-slate-500">
                    {order.lineName} · {formatDate(order.plannedDate)} · {order.shift}
                    {order.startedBy ? ` · Started by ${order.startedBy}` : ""}
                  </p>
                  <p className="mt-2 text-sm font-black text-[#8a4e22]">
                    Finished ERP lot: {order.finishedErpLotNumber}
                  </p>
                </div>

                <div className="grid grid-cols-3 gap-5 text-right">
                  <Metric label="Target" value={formatNumber(order.targetBags)} />
                  <Metric label="Actual" value={formatNumber(order.actualBags)} />
                  <Metric
                    label="Variance"
                    value={`${order.varianceBags >= 0 ? "+" : ""}${formatNumber(order.varianceBags)}`}
                    positive={order.varianceBags >= 0}
                  />
                </div>
              </div>

              {order.returnComment && (
                <div className="border-b border-red-300 bg-red-50 px-5 py-3 text-sm font-bold text-red-800">
                  Returned to Production: {order.returnComment}
                </div>
              )}

              <div className="grid gap-5 p-5 xl:grid-cols-2">
                <div>
                  <p className="text-[11px] font-black uppercase tracking-[0.12em] text-[#b86c2c]">
                    Raw-material traceability
                  </p>
                  {order.rawLots.length === 0 ? (
                    <p className="mt-3 text-sm font-semibold text-slate-400">
                      No raw lots recorded.
                    </p>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {order.rawLots.map((lot) => (
                        <div
                          key={`${lot.sourceModule}-${lot.sourceLotId}`}
                          className="flex flex-wrap items-center justify-between gap-3 border border-[#ddd4cb] bg-[#faf8f5] p-3"
                        >
                          <div>
                            <p className="font-mono text-xs font-black">
                              {lot.erpLotNumber}
                            </p>
                            <p className="mt-1 text-xs text-slate-500">
                              Farmer lot {lot.sourceReference}
                            </p>
                          </div>
                          <span
                            className={`border px-2 py-1 text-[10px] font-black uppercase ${
                              lot.lotFinished
                                ? "border-red-300 bg-red-50 text-red-800"
                                : "border-emerald-300 bg-emerald-50 text-emerald-800"
                            }`}
                          >
                            {lot.lotFinished ? "Finished" : "Open"}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <p className="text-[11px] font-black uppercase tracking-[0.12em] text-[#b86c2c]">
                    Production result
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
                    <InfoBox label="Good bags" value={formatNumber(order.actualBags)} />
                    <InfoBox label="Rejected" value={formatNumber(order.rejectedBags)} />
                    <InfoBox label="Achievement" value={`${Number(order.achievementPercent || 0).toFixed(1)}%`} />
                    <InfoBox label="Net packed" value={formatKg(order.netPackedWeightKg)} />
                    <InfoBox
                      label="Breakdowns"
                      value={formatNumber(order.breakdowns?.length ?? 0)}
                    />
                    <InfoBox
                      label="Downtime"
                      value={formatDowntime(order.totalDowntimeMinutes)}
                    />
                  </div>
                  <p className="mt-3 text-xs font-semibold text-slate-500">
                    Time: {order.startTime || "—"} → {order.endTime || "—"} ·{" "}
                    {order.employees.length} employees
                  </p>
                  {order.productionNotes && (
                    <p className="mt-3 border border-[#ddd4cb] bg-[#faf8f5] p-3 text-sm text-slate-700">
                      {order.productionNotes}
                    </p>
                  )}

                  {(order.breakdowns?.length ?? 0) > 0 && (
                    <div className="mt-4 space-y-2">
                      <p className="text-[11px] font-black uppercase tracking-[0.12em] text-[#b86c2c]">
                        Breakdown detail
                      </p>
                      {(order.breakdowns ?? []).map((breakdown, index) => (
                        <div
                          key={breakdown.id}
                          className="border border-red-200 bg-red-50 p-3"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-black text-red-900">
                                {index + 1}.{" "}
                                {breakdownCategoryLabels[breakdown.category]} ·{" "}
                                {breakdown.equipment}
                              </p>
                              <p className="mt-1 text-xs font-semibold text-red-700">
                                {breakdown.startTime} → {breakdown.endTime} ·{" "}
                                {formatDowntime(breakdown.durationMinutes)}
                              </p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <span className="border border-red-300 bg-white px-2 py-1 text-[10px] font-black uppercase text-red-800">
                                {breakdown.productionStopped
                                  ? "Production stopped"
                                  : "Production continued"}
                              </span>
                              <span className="border border-slate-300 bg-white px-2 py-1 text-[10px] font-black uppercase text-slate-700">
                                Maintenance{" "}
                                {breakdown.maintenanceNotified
                                  ? "notified"
                                  : "not notified"}
                              </span>
                            </div>
                          </div>
                          <p className="mt-2 text-sm text-red-900">
                            {breakdown.description}
                          </p>
                          {breakdown.actionTaken && (
                            <p className="mt-2 text-xs font-semibold text-red-700">
                              Action taken: {breakdown.actionTaken}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#d8cec3] bg-[#faf8f5] px-5 py-4">
                <div className="text-xs font-semibold text-slate-500">
                  Submitted: {formatDateTime(order.submittedAt)}
                  {order.validatedAt && (
                    <> · Validated: {formatDateTime(order.validatedAt)}</>
                  )}
                </div>

                <div className="flex flex-wrap gap-2">
                  {["PLANNED", "IN_PROGRESS"].includes(order.status) && (
                    <button
                      type="button"
                      onClick={() => onOpenRun(order.id)}
                      className="inline-flex items-center gap-2 border border-[#6f6156] bg-white px-3 py-2 text-xs font-black uppercase"
                    >
                      <Play size={15} />
                      {order.status === "PLANNED" ? "Start run" : "Continue run"}
                    </button>
                  )}

                  {profile.role === "manager" && order.status === "SUBMITTED" && (
                    <>
                      <button
                        type="button"
                        disabled={loading}
                        onClick={() => void decide(order, "RETURN")}
                        className="inline-flex items-center gap-2 border border-amber-400 bg-amber-50 px-3 py-2 text-xs font-black uppercase text-amber-900 disabled:opacity-50"
                      >
                        <RotateCcw size={15} />
                        Return
                      </button>
                      <button
                        type="button"
                        disabled={loading}
                        onClick={() => void decide(order, "CANCEL")}
                        className="inline-flex items-center gap-2 border border-red-400 bg-red-50 px-3 py-2 text-xs font-black uppercase text-red-800 disabled:opacity-50"
                      >
                        <X size={15} />
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={loading}
                        onClick={() => void decide(order, "VALIDATE")}
                        className="inline-flex items-center gap-2 bg-emerald-700 px-3 py-2 text-xs font-black uppercase text-white disabled:opacity-50"
                      >
                        <PackageCheck size={15} />
                        Validate & create stock
                      </button>
                    </>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function RawMaterialStock({ data }: { data: ProductionBootstrap }) {
  const [typeFilter, setTypeFilter] = useState<"ALL" | "STANDARD" | "RESTAURANT">(
    "ALL",
  );
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return data.rawLots.filter((lot) => {
      const typeMatches =
        typeFilter === "ALL" || lot.rawMaterialType === typeFilter;
      const searchMatches =
        !query ||
        `${lot.erpLotNumber} ${lot.sourceReference}`
          .toLowerCase()
          .includes(query);
      return typeMatches && searchMatches;
    });
  }, [data.rawLots, search, typeFilter]);

  return (
    <div className="space-y-6">
      <section className="border border-[#2f2823] bg-[#171310] p-6 text-white">
        <p className="font-mono text-xs font-black uppercase tracking-[0.18em] text-[#d78a46]">
          Screening stock connection
        </p>
        <h1 className="mt-2 text-4xl font-black uppercase tracking-tight">
          Raw Material Lots
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-[#a89c92]">
          Standard and Restaurant lots validated by Screening. Once a lot is
          opened in Production, its remaining quantity is intentionally shown as
          unmeasured.
        </p>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {(["STANDARD", "RESTAURANT"] as const).map((type) => {
          const lots = data.rawLots.filter((lot) => lot.rawMaterialType === type);
          return (
            <div key={type} className="border border-[#cfc4b7] bg-white p-5">
              <RawTypeBadge type={type} />
              <p className="mt-4 font-mono text-3xl font-black">{lots.length}</p>
              <p className="mt-1 text-xs font-bold uppercase text-slate-500">
                available ERP lots
              </p>
              <p className="mt-3 text-xs font-semibold text-slate-500">
                {lots.filter((lot) => !lot.quantityKnown).length} open lots with
                unmeasured balance
              </p>
            </div>
          );
        })}
        <div className="border border-amber-300 bg-amber-50 p-5">
          <RawTypeBadge type="BRIQUETTE" />
          <p className="mt-4 text-xl font-black uppercase text-amber-900">
            Pending Briquettes module
          </p>
          <p className="mt-2 text-sm font-semibold text-amber-800">
            Briquette raw lots will be connected here later.
          </p>
        </div>
      </section>

      <section className="border border-[#cfc4b7] bg-white p-4">
        <div className="grid gap-3 md:grid-cols-[1fr_auto]">
          <div className="relative">
            <Search
              size={17}
              className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search ERP lot or farmer lot"
              className={`${inputClass} pl-11`}
            />
          </div>
          <select
            value={typeFilter}
            onChange={(event) =>
              setTypeFilter(
                event.target.value as "ALL" | "STANDARD" | "RESTAURANT",
              )
            }
            className={`${inputClass} min-w-56`}
          >
            <option value="ALL">All raw-material types</option>
            <option value="STANDARD">Standard</option>
            <option value="RESTAURANT">Restaurant</option>
          </select>
        </div>
      </section>

      <section className="border border-[#cfc4b7] bg-white">
        {filtered.length === 0 ? (
          <EmptyState
            icon={Layers3}
            title="No compatible Screening lots"
            text="Validate Screening loads to create Standard and Restaurant stock."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-[#201a16] text-white">
                <tr className="text-left text-[10px] font-black uppercase tracking-[0.08em]">
                  <th className="px-4 py-4">ERP lot</th>
                  <th className="px-4 py-4">Type</th>
                  <th className="px-4 py-4">Farmer lot source</th>
                  <th className="px-4 py-4">Remaining quantity</th>
                  <th className="px-4 py-4">Availability</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((lot) => (
                  <tr key={lot.id} className="border-b border-[#e4dcd3]">
                    <td className="px-4 py-4 font-mono text-xs font-black">
                      {lot.erpLotNumber}
                    </td>
                    <td className="px-4 py-4">
                      <RawTypeBadge type={lot.rawMaterialType} />
                    </td>
                    <td className="px-4 py-4 font-bold">
                      {lot.sourceReference}
                    </td>
                    <td className="px-4 py-4">
                      {lot.quantityKnown ? (
                        <>
                          <p className="font-mono font-black">
                            {formatKg(lot.availableWeightKg)}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            {lot.availableBigBags} big bags recorded
                          </p>
                        </>
                      ) : (
                        <span className="border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-black uppercase text-amber-900">
                          Open lot — not measured
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-4">
                      {lot.reservedByOrderId ? (
                        <span className="border border-violet-300 bg-violet-50 px-2 py-1 text-xs font-black uppercase text-violet-900">
                          Reserved in active order
                        </span>
                      ) : (
                        <span className="border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs font-black uppercase text-emerald-800">
                          Available
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function FinishedProductStock({ data }: { data: ProductionBootstrap }) {
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return data.finishedStock;
    return data.finishedStock.filter((lot) =>
      `${lot.productCode} ${lot.productDescription} ${lot.erpLotNumber}`
        .toLowerCase()
        .includes(query),
    );
  }, [data.finishedStock, search]);

  const totalBags = data.finishedStock.reduce(
    (sum, lot) => sum + Number(lot.availableBags || 0),
    0,
  );
  const totalWeight = data.finishedStock.reduce(
    (sum, lot) => sum + Number(lot.availableWeightKg || 0),
    0,
  );

  return (
    <div className="space-y-6">
      <section className="border border-[#2f2823] bg-[#171310] p-6 text-white">
        <p className="font-mono text-xs font-black uppercase tracking-[0.18em] text-[#d78a46]">
          Validated production inventory
        </p>
        <h1 className="mt-2 text-4xl font-black uppercase tracking-tight">
          Finished Product Stock
        </h1>
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Finished ERP lots" value={data.finishedStock.length} />
        <StatCard label="Available bags" value={formatNumber(totalBags)} />
        <StatCard label="Net packed weight" value={formatKg(totalWeight)} />
      </section>

      <section className="border border-[#cfc4b7] bg-white p-4">
        <div className="relative">
          <Search
            size={17}
            className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search product code, description or finished ERP lot"
            className={`${inputClass} pl-11`}
          />
        </div>
      </section>

      <section className="border border-[#cfc4b7] bg-white">
        {filtered.length === 0 ? (
          <EmptyState
            icon={Boxes}
            title="No finished product stock yet"
            text="Manager validation creates the finished ERP lot here."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-[#201a16] text-white">
                <tr className="text-left text-[10px] font-black uppercase tracking-[0.08em]">
                  <th className="px-4 py-4">Finished ERP lot</th>
                  <th className="px-4 py-4">Product</th>
                  <th className="px-4 py-4 text-right">Bag weight</th>
                  <th className="px-4 py-4 text-right">Available bags</th>
                  <th className="px-4 py-4 text-right">Net weight</th>
                  <th className="px-4 py-4">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((lot) => (
                  <tr key={lot.id} className="border-b border-[#e4dcd3]">
                    <td className="px-4 py-4 font-mono text-xs font-black">
                      {lot.erpLotNumber}
                    </td>
                    <td className="px-4 py-4">
                      <p className="font-mono text-xs font-black">
                        {lot.productCode}
                      </p>
                      <p className="mt-1 max-w-xl text-xs text-slate-500">
                        {lot.productDescription}
                      </p>
                    </td>
                    <td className="px-4 py-4 text-right font-mono font-black">
                      {lot.bagWeightKg} kg
                    </td>
                    <td className="px-4 py-4 text-right font-mono font-black">
                      {formatNumber(lot.availableBags)}
                    </td>
                    <td className="px-4 py-4 text-right font-mono font-black">
                      {formatKg(lot.availableWeightKg)}
                    </td>
                    <td className="px-4 py-4">
                      <span className="border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs font-black uppercase text-emerald-800">
                        {lot.stockStatus}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-[11px] font-black uppercase tracking-[0.1em] text-[#66594f]">
        {label}
      </span>
      {children}
    </label>
  );
}

function StatusBadge({ status }: { status: ProductionStatus }) {
  return (
    <span
      className={`border px-2 py-1 text-[10px] font-black uppercase ${statusStyle(status)}`}
    >
      {status.replaceAll("_", " ")}
    </span>
  );
}

function RawTypeBadge({ type }: { type: RawMaterialType }) {
  return (
    <span
      className={`border px-2 py-1 text-[10px] font-black uppercase ${rawTypeStyle(type)}`}
    >
      {type}
    </span>
  );
}

function SummaryCell({
  label,
  value,
  dark = true,
}: {
  label: string;
  value: string;
  dark?: boolean;
}) {
  return (
    <div
      className={`border p-3 ${
        dark
          ? "border-[#43382f] bg-[#171310]"
          : "border-emerald-200 bg-white/70"
      }`}
    >
      <p
        className={`text-[10px] font-black uppercase tracking-[0.1em] ${
          dark ? "text-[#81766d]" : "text-emerald-700"
        }`}
      >
        {label}
      </p>
      <p
        className={`mt-2 text-sm font-black ${
          dark ? "text-[#e0d7cf]" : "text-emerald-950"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function Metric({
  label,
  value,
  positive,
}: {
  label: string;
  value: string;
  positive?: boolean;
}) {
  return (
    <div>
      <p className="text-[10px] font-black uppercase text-slate-400">{label}</p>
      <p
        className={`mt-1 font-mono text-sm font-black ${
          positive ? "text-emerald-700" : ""
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function InfoBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-[#ddd4cb] bg-[#faf8f5] p-3">
      <p className="text-[10px] font-black uppercase text-slate-400">{label}</p>
      <p className="mt-2 font-mono text-sm font-black">{value}</p>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="border border-[#cfc4b7] bg-white p-5">
      <p className="text-[11px] font-black uppercase tracking-[0.12em] text-[#76695f]">
        {label}
      </p>
      <p className="mt-4 font-mono text-2xl font-black text-[#171310]">
        {value}
      </p>
    </div>
  );
}

function EmptyState({
  icon: Icon,
  title,
  text,
}: {
  icon: typeof Factory;
  title: string;
  text: string;
}) {
  return (
    <div className="grid min-h-56 place-items-center p-8 text-center">
      <div>
        <Icon size={38} className="mx-auto text-[#b9ada2]" />
        <p className="mt-4 font-black uppercase text-slate-700">{title}</p>
        <p className="mt-2 text-sm text-slate-500">{text}</p>
      </div>
    </div>
  );
}
