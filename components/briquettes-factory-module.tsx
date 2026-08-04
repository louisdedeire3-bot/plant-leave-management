"use client";

import {
  AlertTriangle,
  Boxes,
  Check,
  CheckCircle2,
  Circle,
  ClipboardList,
  Factory,
  FlaskConical,
  History,
  LoaderCircle,
  Map as MapIcon,
  PackageCheck,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Scale,
  Timer,
  Trash2,
  Users,
  Wrench,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase";

type PortalRole = "employee" | "supervisor" | "manager";
type AppSection = "yard" | "production" | "collection" | "lots" | "history";
type Shift = "DAY" | "NIGHT";
type LotClassification = "PENDING" | "DIN" | "NON_DIN";
type SheetOperationalStatus =
  | "AVAILABLE"
  | "DRYING"
  | "TURN_1_DUE"
  | "TURN_2_DUE"
  | "READY"
  | "PARTIAL";

export interface BriquettesFactoryProfile {
  accountId: string;
  loginId: string;
  employeeId: string | null;
  displayName: string;
  role: PortalRole;
  department: string;
  expiresAt: string;
}

interface EmployeeOption {
  id: string;
  employeeCode: string;
  employeeName: string;
  department: string;
  position: string;
}

interface FinesLotOption {
  id: string;
  erpLotNumber: string;
  sourceReference: string;
  stockStatus: string;
  quantityKnown: boolean;
  availableWeightKg: number;
  availableBigBags: number;
  lastUsedAt: string | null;
}

interface BriquetteLotRow {
  id: string;
  erpLotNumber: string;
  classification: LotClassification;
  laboratoryNotes: string;
  classifiedAt: string | null;
  createdAt: string;
  totalCages: number;
  theoreticalDryWeightKg: number;
  collectedBigBags: number;
  collectedWeightKg: number;
  activeSheets: number;
}

interface BlackSheetRow {
  cycleId?: string;
  sheetNumber: number;
  lotId?: string;
  erpLotNumber?: string;
  classification?: LotClassification;
  cycleStatus: "AVAILABLE" | "ACTIVE" | "PARTIAL";
  operationalStatus: SheetOperationalStatus;
  startedAt?: string;
  latestDepositAt?: string;
  dryingRound?: number;
  turnCount?: number;
  lastTurnAt?: string | null;
  nextActionAt?: string | null;
  totalCages: number;
  theoreticalDryWeightKg?: number;
  collectedBigBags: number;
  collectedWeightKg: number;
  collectionCount?: number;
}

interface ProductionFinesRow {
  sourceLotId: string;
  erpLotNumber: string;
  sourceReference: string;
  lotFinished: boolean;
}

interface SheetAllocationRow {
  sheetNumber: number;
  cages: number;
}

interface ProductionEmployeeRow {
  id: string;
  employeeCode: string;
  employeeName: string;
}

interface BreakdownRow {
  id: string;
  category: string;
  equipment: string;
  startTime: string;
  endTime: string;
  durationMinutes: number | null;
  description: string;
}

interface ProductionEntryRow {
  id: string;
  productionDate: string;
  shift: Shift;
  depositedAt: string;
  lotId: string;
  erpLotNumber: string;
  totalCages: number;
  theoreticalDryWeightKg: number;
  theoreticalFinesKg: number;
  theoreticalStarchKg: number;
  notes: string;
  createdAt: string;
  createdBy: string;
  finesLots: ProductionFinesRow[];
  allocations: SheetAllocationRow[];
  employees: ProductionEmployeeRow[];
  breakdowns: BreakdownRow[];
}

interface CollectionBagRow {
  bagNumber: number;
  weightKg: number;
}

interface CollectionRow {
  id: string;
  cycleId: string;
  sheetNumber: number;
  lotId: string;
  erpLotNumber: string;
  collectionDate: string;
  isComplete: boolean;
  notes: string;
  createdAt: string;
  recordedBy: string;
  employees: ProductionEmployeeRow[];
  bigBags: CollectionBagRow[];
  totalWeightKg: number;
}

interface BriquettesBootstrap {
  employees: EmployeeOption[];
  finesLots: FinesLotOption[];
  lots: BriquetteLotRow[];
  sheets: BlackSheetRow[];
  productionEntries: ProductionEntryRow[];
  collections: CollectionRow[];
}

interface FinesSelection {
  sourceLotId: string;
  lotFinished: boolean;
}

interface SheetAllocationInput {
  sheetNumber: string;
  cages: string;
}

interface BreakdownInput {
  category: string;
  equipment: string;
  startTime: string;
  endTime: string;
  description: string;
}

const EMPTY_DATA: BriquettesBootstrap = {
  employees: [],
  finesLots: [],
  lots: [],
  sheets: Array.from({ length: 20 }, (_, index) => ({
    sheetNumber: index + 1,
    cycleStatus: "AVAILABLE",
    operationalStatus: "AVAILABLE",
    totalCages: 0,
    collectedBigBags: 0,
    collectedWeightKg: 0,
  })),
  productionEntries: [],
  collections: [],
};

const BREAKDOWN_CATEGORIES = [
  ["MECHANICAL", "Mechanical"],
  ["ELECTRICAL", "Electrical"],
  ["MIXER", "Mixer"],
  ["PRESS", "Press"],
  ["CONVEYOR", "Conveyor"],
  ["POWER", "Power supply"],
  ["OTHER", "Other"],
] as const;

const sectionDefinitions: Array<{
  id: AppSection;
  label: string;
  icon: typeof MapIcon;
}> = [
  { id: "yard", label: "Drying yard", icon: MapIcon },
  { id: "production", label: "Record production", icon: Factory },
  { id: "collection", label: "Collection", icon: Scale },
  { id: "lots", label: "ERP lots & Lab", icon: FlaskConical },
  { id: "history", label: "History", icon: History },
];

const statusLabels: Record<SheetOperationalStatus, string> = {
  AVAILABLE: "Available",
  DRYING: "Drying",
  TURN_1_DUE: "Turn 1 required",
  TURN_2_DUE: "Turn 2 required",
  READY: "Ready for collection",
  PARTIAL: "Partially collected",
};

const statusClasses: Record<SheetOperationalStatus, string> = {
  AVAILABLE: "border-slate-300 bg-slate-100 text-slate-700",
  DRYING: "border-sky-600 bg-sky-100 text-sky-950",
  TURN_1_DUE: "border-orange-600 bg-orange-100 text-orange-950",
  TURN_2_DUE: "border-red-600 bg-red-100 text-red-950",
  READY: "border-emerald-600 bg-emerald-100 text-emerald-950",
  PARTIAL: "border-violet-600 bg-violet-100 text-violet-950",
};

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return "Unknown database error";
}

function localDate(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function localDateTime(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 16);
}

function numberValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatKg(value: number): string {
  return `${numberValue(value).toLocaleString("en-US", {
    maximumFractionDigits: 1,
  })} kg`;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function elapsedLabel(target: string | null | undefined, now: number): string {
  if (!target) return "";
  const difference = new Date(target).getTime() - now;
  const absoluteMinutes = Math.max(0, Math.round(Math.abs(difference) / 60_000));
  const hours = Math.floor(absoluteMinutes / 60);
  const minutes = absoluteMinutes % 60;
  const duration = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  return difference >= 0 ? `in ${duration}` : `${duration} overdue`;
}

function liveSheetStatus(sheet: BlackSheetRow, now: number): SheetOperationalStatus {
  if (!sheet.cycleId || sheet.cycleStatus === "AVAILABLE") return "AVAILABLE";
  if (sheet.cycleStatus === "PARTIAL") return "PARTIAL";

  const turnCount = numberValue(sheet.turnCount);
  const reference = turnCount === 0 ? sheet.latestDepositAt : sheet.lastTurnAt;
  if (!reference) return "DRYING";

  const due = new Date(reference).getTime() + 24 * 60 * 60 * 1000;
  if (now < due) return "DRYING";
  if (turnCount === 0) return "TURN_1_DUE";
  if (turnCount === 1) return "TURN_2_DUE";
  return "READY";
}

function nextActionAt(sheet: BlackSheetRow): string | null {
  if (!sheet.cycleId || sheet.cycleStatus === "PARTIAL") return null;
  const reference = numberValue(sheet.turnCount) === 0
    ? sheet.latestDepositAt
    : sheet.lastTurnAt;
  if (!reference) return null;
  return new Date(new Date(reference).getTime() + 24 * 60 * 60 * 1000).toISOString();
}

function classificationLabel(value: LotClassification): string {
  if (value === "NON_DIN") return "Non-DIN";
  if (value === "DIN") return "DIN";
  return "Pending lab";
}

function classificationClass(value: LotClassification): string {
  if (value === "DIN") return "bg-emerald-100 text-emerald-900";
  if (value === "NON_DIN") return "bg-amber-100 text-amber-950";
  return "bg-slate-100 text-slate-700";
}

export function BriquettesFactoryModule({
  profile,
  sessionToken,
}: {
  profile: BriquettesFactoryProfile;
  sessionToken: string;
}) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [section, setSection] = useState<AppSection>("yard");
  const [data, setData] = useState<BriquettesBootstrap>(EMPTY_DATA);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [selectedSheetNumber, setSelectedSheetNumber] = useState(1);

  const loadData = useCallback(async () => {
    if (!supabase) {
      setError("Missing Supabase environment variables.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { data: response, error: rpcError } = await supabase.rpc(
        "portal_briquettes_bootstrap",
        { p_token: sessionToken, p_limit: 300 },
      );
      if (rpcError) throw rpcError;

      const next = (response ?? EMPTY_DATA) as BriquettesBootstrap;
      setData({
        employees: next.employees ?? [],
        finesLots: next.finesLots ?? [],
        lots: next.lots ?? [],
        sheets: next.sheets?.length ? next.sheets : EMPTY_DATA.sheets,
        productionEntries: next.productionEntries ?? [],
        collections: next.collections ?? [],
      });
    } catch (loadError) {
      setError(errorText(loadError));
    } finally {
      setLoading(false);
    }
  }, [sessionToken, supabase]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const selectedSheet = data.sheets.find(
    (sheet) => sheet.sheetNumber === selectedSheetNumber,
  ) ?? data.sheets[0];

  async function confirmTurning(sheet: BlackSheetRow) {
    if (!supabase || !sheet.cycleId) return;

    const turnNumber = numberValue(sheet.turnCount) + 1;
    if (!window.confirm(`Confirm turning ${turnNumber} for Black Sheet ${sheet.sheetNumber}?`)) {
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const { error: rpcError } = await supabase.rpc(
        "portal_turn_briquette_sheet",
        {
          p_token: sessionToken,
          p_cycle_id: sheet.cycleId,
          p_turned_at: new Date().toISOString(),
        },
      );
      if (rpcError) throw rpcError;
      setSuccess(`Turning ${turnNumber} recorded for Black Sheet ${sheet.sheetNumber}.`);
      await loadData();
    } catch (turnError) {
      setError(errorText(turnError));
    } finally {
      setSaving(false);
    }
  }

  function openCollection(sheet: BlackSheetRow) {
    setSelectedSheetNumber(sheet.sheetNumber);
    setSection("collection");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (loading && data === EMPTY_DATA) {
    return (
      <div className="grid min-h-[560px] place-items-center border border-[#cfc4b7] bg-white">
        <div className="text-center">
          <LoaderCircle size={34} className="mx-auto animate-spin text-[#b86c2c]" />
          <p className="mt-4 text-xs font-black uppercase tracking-[0.16em] text-slate-500">
            Loading briquettes yard
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <section className="overflow-hidden border border-[#2f2823] bg-[#171310] p-6 text-white lg:p-8">
        <div className="flex flex-col justify-between gap-6 xl:flex-row xl:items-end">
          <div>
            <p className="font-mono text-xs font-black uppercase tracking-[0.18em] text-[#d78a46]">
              Briquette operations
            </p>
            <h1 className="mt-2 text-4xl font-black uppercase tracking-tight sm:text-5xl">
              Production & Drying Yard
            </h1>
            <p className="mt-4 max-w-3xl text-sm leading-6 text-[#a89c92]">
              Track cages from fines lots through numbered black sheets, drying,
              collection and final ERP-lot classification.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-2 sm:min-w-[430px]">
            <HeaderMetric
              label="Active sheets"
              value={data.sheets.filter((sheet) => sheet.cycleId).length}
            />
            <HeaderMetric
              label="Actions due"
              value={data.sheets.filter((sheet) => {
                const status = liveSheetStatus(sheet, now);
                return status === "TURN_1_DUE" || status === "TURN_2_DUE";
              }).length}
              highlight
            />
            <HeaderMetric
              label="Ready"
              value={data.sheets.filter((sheet) => {
                const status = liveSheetStatus(sheet, now);
                return status === "READY" || status === "PARTIAL";
              }).length}
            />
          </div>
        </div>
      </section>

      <nav className="grid grid-cols-2 gap-2 border border-[#cfc4b7] bg-white p-2 md:grid-cols-5">
        {sectionDefinitions.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setSection(id)}
            className={`inline-flex min-h-12 items-center justify-center gap-2 px-3 text-xs font-black uppercase transition ${
              section === id
                ? "bg-[#201a16] text-[#d78a46]"
                : "bg-[#f5f1ec] text-[#685d54] hover:bg-[#e8dfd6]"
            }`}
          >
            <Icon size={17} />
            {label}
          </button>
        ))}
      </nav>

      {(error || success) && (
        <div
          className={`flex items-start justify-between gap-3 border px-4 py-3 text-sm font-bold ${
            error
              ? "border-red-300 bg-red-50 text-red-900"
              : "border-emerald-300 bg-emerald-50 text-emerald-900"
          }`}
        >
          <span className="flex items-start gap-2">
            {error ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
            {error ?? success}
          </span>
          <button
            type="button"
            onClick={() => {
              setError(null);
              setSuccess(null);
            }}
            className="text-xs font-black uppercase"
          >
            Close
          </button>
        </div>
      )}

      {section === "yard" && (
        <DryingYard
          sheets={data.sheets}
          now={now}
          selectedSheet={selectedSheet}
          saving={saving}
          loading={loading}
          onSelect={setSelectedSheetNumber}
          onTurn={(sheet) => void confirmTurning(sheet)}
          onCollect={openCollection}
          onRefresh={() => void loadData()}
          onRecordProduction={() => setSection("production")}
        />
      )}

      {section === "production" && (
        <ProductionForm
          data={data}
          sessionToken={sessionToken}
          saving={saving}
          setSaving={setSaving}
          setError={setError}
          setSuccess={setSuccess}
          onSaved={async () => {
            await loadData();
            setSection("yard");
          }}
        />
      )}

      {section === "collection" && (
        <CollectionForm
          sheets={data.sheets}
          employees={data.employees}
          collections={data.collections}
          initialSheetNumber={selectedSheetNumber}
          sessionToken={sessionToken}
          saving={saving}
          setSaving={setSaving}
          setError={setError}
          setSuccess={setSuccess}
          onSaved={async () => {
            await loadData();
            setSection("yard");
          }}
        />
      )}

      {section === "lots" && (
        <LotsWorkspace
          lots={data.lots}
          profile={profile}
          sessionToken={sessionToken}
          saving={saving}
          setSaving={setSaving}
          setError={setError}
          setSuccess={setSuccess}
          onSaved={loadData}
        />
      )}

      {section === "history" && (
        <HistoryWorkspace
          productionEntries={data.productionEntries}
          collections={data.collections}
        />
      )}
    </div>
  );
}

function HeaderMetric({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: number;
  highlight?: boolean;
}) {
  return (
    <div className={`border p-3 ${highlight ? "border-[#d78a46] bg-[#2a1e16]" : "border-[#40362f] bg-[#211b17]"}`}>
      <p className="text-[9px] font-black uppercase tracking-[0.12em] text-[#8e8177]">
        {label}
      </p>
      <p className={`mt-1 font-mono text-2xl font-black ${highlight ? "text-[#d78a46]" : "text-white"}`}>
        {value}
      </p>
    </div>
  );
}

function DryingYard({
  sheets,
  now,
  selectedSheet,
  saving,
  loading,
  onSelect,
  onTurn,
  onCollect,
  onRefresh,
  onRecordProduction,
}: {
  sheets: BlackSheetRow[];
  now: number;
  selectedSheet: BlackSheetRow;
  saving: boolean;
  loading: boolean;
  onSelect: (sheetNumber: number) => void;
  onTurn: (sheet: BlackSheetRow) => void;
  onCollect: (sheet: BlackSheetRow) => void;
  onRefresh: () => void;
  onRecordProduction: () => void;
}) {
  const selectedStatus = liveSheetStatus(selectedSheet, now);
  const target = nextActionAt(selectedSheet);

  return (
    <div className="space-y-5">
      <section className="border border-[#cfc4b7] bg-white">
        <div className="flex flex-col justify-between gap-4 border-b border-[#ded5ca] p-5 sm:flex-row sm:items-center">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.15em] text-[#b86c2c]">
              Physical layout · Black Sheets 1–20
            </p>
            <h2 className="mt-1 text-2xl font-black uppercase">Drying yard map</h2>
            <p className="mt-1 text-xs text-slate-500">
              Scroll horizontally and select a black sheet for its live details.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onRefresh}
              disabled={loading}
              className="inline-flex h-11 items-center gap-2 border border-[#bdb1a5] px-4 text-xs font-black uppercase text-[#574c43] hover:bg-[#f4eee8] disabled:opacity-50"
            >
              <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
              Refresh
            </button>
            <button
              type="button"
              onClick={onRecordProduction}
              className="inline-flex h-11 items-center gap-2 bg-[#d78a46] px-4 text-xs font-black uppercase text-[#171310] hover:bg-[#e49b58]"
            >
              <Plus size={17} />
              Add cages
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-2 border-b border-[#ded5ca] bg-[#faf8f5] px-5 py-3">
          {([
            ["AVAILABLE", "Available"],
            ["DRYING", "Drying"],
            ["TURN_1_DUE", "Turn required"],
            ["READY", "Ready"],
            ["PARTIAL", "Partial"],
          ] as Array<[SheetOperationalStatus, string]>).map(([status, label]) => (
            <span key={status} className="inline-flex items-center gap-2 text-[10px] font-black uppercase text-slate-600">
              <span className={`h-3 w-3 border ${statusClasses[status]}`} />
              {label}
            </span>
          ))}
        </div>

        <div className="overflow-x-auto p-5 pb-7">
          <div className="flex min-w-max items-stretch gap-3">
            {sheets.map((sheet) => {
              const status = liveSheetStatus(sheet, now);
              const selected = selectedSheet.sheetNumber === sheet.sheetNumber;
              const dueAt = nextActionAt(sheet);

              return (
                <button
                  key={sheet.sheetNumber}
                  type="button"
                  onClick={() => onSelect(sheet.sheetNumber)}
                  className={`relative flex min-h-60 w-[190px] shrink-0 flex-col border-2 p-4 text-left transition hover:-translate-y-0.5 hover:shadow-md ${statusClasses[status]} ${
                    selected ? "ring-4 ring-[#d78a46]/35" : ""
                  }`}
                >
                  <span className="flex items-start justify-between gap-2">
                    <span>
                      <span className="block text-[9px] font-black uppercase tracking-[0.16em] opacity-65">
                        Black sheet
                      </span>
                      <span className="mt-1 block font-mono text-4xl font-black leading-none">
                        {String(sheet.sheetNumber).padStart(2, "0")}
                      </span>
                    </span>
                    {status === "AVAILABLE" ? <Circle size={20} /> : status === "READY" ? <CheckCircle2 size={20} /> : status === "PARTIAL" ? <PackageCheck size={20} /> : <Timer size={20} />}
                  </span>

                  <span className="mt-5 block min-h-10 break-words font-mono text-sm font-black">
                    {sheet.erpLotNumber ?? "No active lot"}
                  </span>

                  <span className="mt-auto block border-t border-current/20 pt-3">
                    <span className="block text-xs font-black uppercase">
                      {statusLabels[status]}
                    </span>
                    {sheet.cycleId && (
                      <>
                        <span className="mt-2 block text-xs font-bold">
                          {sheet.totalCages} cages · {formatKg(sheet.theoreticalDryWeightKg ?? sheet.totalCages * 350)}
                        </span>
                        <span className="mt-1 block text-[10px] font-bold opacity-70">
                          {status === "PARTIAL"
                            ? `${sheet.collectedBigBags} bags · ${formatKg(sheet.collectedWeightKg)}`
                            : elapsedLabel(dueAt, now)}
                        </span>
                      </>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <section className="grid gap-5 border border-[#cfc4b7] bg-white p-5 lg:grid-cols-[1.1fr_0.9fr] lg:p-6">
        <div>
          <div className="flex items-center gap-3">
            <span className={`grid h-14 w-14 place-items-center border-2 font-mono text-xl font-black ${statusClasses[selectedStatus]}`}>
              {String(selectedSheet.sheetNumber).padStart(2, "0")}
            </span>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.14em] text-[#b86c2c]">
                Selected black sheet
              </p>
              <h3 className="text-2xl font-black uppercase">
                {statusLabels[selectedStatus]}
              </h3>
            </div>
          </div>

          {!selectedSheet.cycleId ? (
            <div className="mt-6 border border-dashed border-slate-300 bg-slate-50 p-5">
              <p className="text-sm font-bold text-slate-700">
                This black sheet is empty and available for a new ERP briquette lot.
              </p>
              <button
                type="button"
                onClick={onRecordProduction}
                className="mt-4 inline-flex items-center gap-2 bg-[#201a16] px-4 py-3 text-xs font-black uppercase text-white"
              >
                <Plus size={16} />
                Allocate cages here
              </button>
            </div>
          ) : (
            <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <DetailMetric label="ERP lot" value={selectedSheet.erpLotNumber ?? "—"} />
              <DetailMetric label="Cages" value={selectedSheet.totalCages} />
              <DetailMetric label="Dry theoretical" value={formatKg(selectedSheet.theoreticalDryWeightKg ?? selectedSheet.totalCages * 350)} />
              <DetailMetric label="Turnings" value={`${selectedSheet.turnCount ?? 0} / 2`} />
              <DetailMetric label="Last deposit" value={formatDateTime(selectedSheet.latestDepositAt)} />
              <DetailMetric label="Next action" value={selectedStatus === "PARTIAL" ? "Continue collection" : `${statusLabels[selectedStatus]} ${elapsedLabel(target, now)}`} />
              <DetailMetric label="Collected bags" value={selectedSheet.collectedBigBags} />
              <DetailMetric label="Collected weight" value={formatKg(selectedSheet.collectedWeightKg)} />
            </div>
          )}
        </div>

        <div className="border border-[#ded5ca] bg-[#f7f3ef] p-5">
          <p className="text-[10px] font-black uppercase tracking-[0.14em] text-[#77695f]">
            Required action
          </p>
          <h3 className="mt-2 text-xl font-black uppercase">
            {selectedSheet.cycleId ? statusLabels[selectedStatus] : "Sheet available"}
          </h3>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            {selectedStatus === "AVAILABLE" && "Allocate cages from the production entry screen."}
            {selectedStatus === "DRYING" && `The next drying action becomes due ${elapsedLabel(target, now)}.`}
            {selectedStatus === "TURN_1_DUE" && "Confirm the first turning. The next 24-hour drying period starts from confirmation."}
            {selectedStatus === "TURN_2_DUE" && "Confirm the second turning. The sheet will become ready after another 24 hours."}
            {selectedStatus === "READY" && "The briquettes are indicated as ready for collection."}
            {selectedStatus === "PARTIAL" && "A partial collection is recorded. Keep entering big-bag weights until the sheet is completely collected."}
          </p>

          {(selectedStatus === "TURN_1_DUE" || selectedStatus === "TURN_2_DUE") && (
            <button
              type="button"
              disabled={saving}
              onClick={() => onTurn(selectedSheet)}
              className="mt-5 inline-flex h-12 w-full items-center justify-center gap-2 bg-[#d78a46] px-4 text-xs font-black uppercase text-[#171310] disabled:opacity-50"
            >
              {saving ? <LoaderCircle size={17} className="animate-spin" /> : <RotateCcw size={17} />}
              Confirm turning {(selectedSheet.turnCount ?? 0) + 1}
            </button>
          )}

          {(selectedStatus === "READY" || selectedStatus === "PARTIAL") && (
            <button
              type="button"
              onClick={() => onCollect(selectedSheet)}
              className="mt-5 inline-flex h-12 w-full items-center justify-center gap-2 bg-emerald-700 px-4 text-xs font-black uppercase text-white"
            >
              <Scale size={17} />
              Record collection
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

function DetailMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="border border-[#ded5ca] bg-[#faf8f5] p-3">
      <p className="text-[9px] font-black uppercase tracking-[0.12em] text-slate-500">{label}</p>
      <p className="mt-2 break-words font-mono text-sm font-black text-[#201a16]">{value}</p>
    </div>
  );
}

function ProductionForm({
  data,
  sessionToken,
  saving,
  setSaving,
  setError,
  setSuccess,
  onSaved,
}: {
  data: BriquettesBootstrap;
  sessionToken: string;
  saving: boolean;
  setSaving: (value: boolean) => void;
  setError: (value: string | null) => void;
  setSuccess: (value: string | null) => void;
  onSaved: () => Promise<void>;
}) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [productionDate, setProductionDate] = useState(localDate());
  const [shift, setShift] = useState<Shift>("DAY");
  const [depositedAt, setDepositedAt] = useState(localDateTime());
  const [erpLotNumber, setErpLotNumber] = useState("");
  const [totalCages, setTotalCages] = useState("");
  const [finesSelections, setFinesSelections] = useState<FinesSelection[]>([]);
  const [allocations, setAllocations] = useState<SheetAllocationInput[]>([
    { sheetNumber: "", cages: "" },
  ]);
  const [employeeIds, setEmployeeIds] = useState<string[]>([]);
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [breakdowns, setBreakdowns] = useState<BreakdownInput[]>([]);
  const [notes, setNotes] = useState("");

  const totalCagesNumber = Math.max(0, Math.trunc(numberValue(totalCages)));
  const allocatedCages = allocations.reduce(
    (total, allocation) => total + Math.max(0, Math.trunc(numberValue(allocation.cages))),
    0,
  );
  const existingLot = data.lots.find(
    (lot) => lot.erpLotNumber.toUpperCase() === erpLotNumber.trim().toUpperCase(),
  );
  const normalizedLot = erpLotNumber.trim().toUpperCase();

  const filteredEmployees = data.employees.filter((employee) => {
    const search = employeeSearch.trim().toLowerCase();
    if (!search) return true;
    return `${employee.employeeCode} ${employee.employeeName} ${employee.department} ${employee.position}`
      .toLowerCase()
      .includes(search);
  });

  function toggleFinesLot(lotId: string) {
    setFinesSelections((current) =>
      current.some((selection) => selection.sourceLotId === lotId)
        ? current.filter((selection) => selection.sourceLotId !== lotId)
        : [...current, { sourceLotId: lotId, lotFinished: false }],
    );
  }

  function updateAllocation(index: number, patch: Partial<SheetAllocationInput>) {
    setAllocations((current) =>
      current.map((allocation, allocationIndex) =>
        allocationIndex === index ? { ...allocation, ...patch } : allocation,
      ),
    );
  }

  function sheetAvailableForLot(sheet: BlackSheetRow): boolean {
    return !sheet.cycleId || (!!normalizedLot && sheet.erpLotNumber?.toUpperCase() === normalizedLot);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;

    setError(null);
    setSuccess(null);

    if (!normalizedLot) {
      setError("Enter the ERP briquette lot number.");
      return;
    }
    if (totalCagesNumber <= 0) {
      setError("Enter a number of cages greater than zero.");
      return;
    }
    if (finesSelections.length === 0) {
      setError("Select at least one fines lot.");
      return;
    }
    if (allocatedCages !== totalCagesNumber) {
      setError(`Allocate all cages: ${allocatedCages} allocated out of ${totalCagesNumber}.`);
      return;
    }
    if (allocations.some((allocation) => !allocation.sheetNumber || numberValue(allocation.cages) <= 0)) {
      setError("Every black-sheet allocation requires a sheet number and a positive cage count.");
      return;
    }

    const selectedSheetNumbers = allocations.map((allocation) => allocation.sheetNumber);
    if (new Set(selectedSheetNumbers).size !== selectedSheetNumbers.length) {
      setError("The same black sheet cannot appear twice in one production record.");
      return;
    }

    setSaving(true);

    try {
      const { error: rpcError } = await supabase.rpc(
        "portal_save_briquette_production",
        {
          p_token: sessionToken,
          p_production_date: productionDate,
          p_shift: shift,
          p_deposited_at: new Date(depositedAt).toISOString(),
          p_erp_lot_number: normalizedLot,
          p_total_cages: totalCagesNumber,
          p_fines_lots: finesSelections,
          p_allocations: allocations.map((allocation) => ({
            sheetNumber: Number(allocation.sheetNumber),
            cages: Math.trunc(numberValue(allocation.cages)),
          })),
          p_employee_ids: employeeIds,
          p_breakdowns: breakdowns,
          p_notes: notes,
        },
      );
      if (rpcError) throw rpcError;

      setSuccess(`${totalCagesNumber} cages recorded for ERP lot ${normalizedLot}.`);
      await onSaved();
    } catch (saveError) {
      setError(errorText(saveError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <section className="border border-[#cfc4b7] bg-white p-5 lg:p-6">
        <SectionHeading
          eyebrow="Step 1"
          title="Daily briquette production"
          description="Record the ERP lot and the total cages produced before allocating them to the drying yard."
          icon={Factory}
        />

        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <Field label="Production date">
            <input type="date" required value={productionDate} onChange={(event) => setProductionDate(event.target.value)} className="field-control" />
          </Field>
          <Field label="Shift">
            <select value={shift} onChange={(event) => setShift(event.target.value as Shift)} className="field-control">
              <option value="DAY">Day</option>
              <option value="NIGHT">Night</option>
            </select>
          </Field>
          <Field label="Cages placed at">
            <input type="datetime-local" required value={depositedAt} onChange={(event) => setDepositedAt(event.target.value)} className="field-control" />
          </Field>
          <Field label="ERP briquette lot">
            <input list="briquette-lot-options" required value={erpLotNumber} onChange={(event) => setErpLotNumber(event.target.value.toUpperCase())} placeholder="BRQ-..." className="field-control font-mono" />
            <datalist id="briquette-lot-options">
              {data.lots.map((lot) => <option key={lot.id} value={lot.erpLotNumber} />)}
            </datalist>
          </Field>
          <Field label="Total cages produced">
            <input type="number" min="1" step="1" required value={totalCages} onChange={(event) => setTotalCages(event.target.value)} placeholder="0" className="field-control font-mono text-lg font-black" />
          </Field>
        </div>

        {existingLot && (
          <div className="mt-4 border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
            Existing lot selected: {existingLot.totalCages} cages already recorded across {existingLot.activeSheets} active black sheets.
          </div>
        )}

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <FormulaMetric label="Dry theoretical" value={formatKg(totalCagesNumber * 350)} formula="350 kg per cage" />
          <FormulaMetric label="Fines theoretical" value={formatKg(totalCagesNumber * 350 * 0.92)} formula="92% of dry weight" />
          <FormulaMetric label="Starch theoretical" value={formatKg(totalCagesNumber * 350 * 0.08)} formula="8% of dry weight" />
        </div>
      </section>

      <section className="border border-[#cfc4b7] bg-white p-5 lg:p-6">
        <SectionHeading
          eyebrow="Raw material"
          title="Fines lots used"
          description="Select every fines lot used. No consumed weight is required; only indicate whether the lot is finished."
          icon={Boxes}
        />

        {data.finesLots.length === 0 ? (
          <div className="mt-6 border border-amber-300 bg-amber-50 p-4 text-sm font-bold text-amber-950">
            No available fines lots were found. A FINES ERP lot must first be created and validated in Screening.
          </div>
        ) : (
          <div className="mt-6 grid gap-3 lg:grid-cols-2">
            {data.finesLots.map((lot) => {
              const selection = finesSelections.find((item) => item.sourceLotId === lot.id);
              return (
                <div key={lot.id} className={`border p-4 ${selection ? "border-[#d78a46] bg-[#fff8f0]" : "border-[#ded5ca] bg-[#faf8f5]"}`}>
                  <button type="button" onClick={() => toggleFinesLot(lot.id)} className="flex w-full items-start gap-3 text-left">
                    <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center border ${selection ? "border-[#b86c2c] bg-[#d78a46] text-[#171310]" : "border-slate-400 bg-white"}`}>
                      {selection && <Check size={14} />}
                    </span>
                    <span className="min-w-0">
                      <span className="block break-words font-mono text-sm font-black">{lot.erpLotNumber}</span>
                      <span className="mt-1 block text-xs text-slate-500">Source truck: {lot.sourceReference}</span>
                    </span>
                  </button>

                  {selection && (
                    <label className="mt-4 flex cursor-pointer items-center gap-3 border-t border-[#ead7c5] pt-3 text-xs font-black uppercase text-[#6d4a2f]">
                      <input
                        type="checkbox"
                        checked={selection.lotFinished}
                        onChange={(event) => setFinesSelections((current) => current.map((item) => item.sourceLotId === lot.id ? { ...item, lotFinished: event.target.checked } : item))}
                        className="h-4 w-4"
                      />
                      This fines lot is finished
                    </label>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="border border-[#cfc4b7] bg-white p-5 lg:p-6">
        <SectionHeading
          eyebrow="Step 2"
          title="Allocate cages to black sheets"
          description="Six cages is a guideline only. The total allocated must equal the total cages produced."
          icon={MapIcon}
        />

        <div className="mt-6 space-y-3">
          {allocations.map((allocation, index) => (
            <div key={index} className="grid gap-3 border border-[#ded5ca] bg-[#faf8f5] p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <Field label={`Black sheet ${index + 1}`}>
                <select required value={allocation.sheetNumber} onChange={(event) => updateAllocation(index, { sheetNumber: event.target.value })} className="field-control">
                  <option value="">Select black sheet</option>
                  {data.sheets.map((sheet) => {
                    const available = sheetAvailableForLot(sheet);
                    return (
                      <option key={sheet.sheetNumber} value={sheet.sheetNumber} disabled={!available}>
                        Black Sheet {String(sheet.sheetNumber).padStart(2, "0")} — {sheet.cycleId ? `${sheet.erpLotNumber} · ${sheet.totalCages} cages` : "Available"}
                      </option>
                    );
                  })}
                </select>
              </Field>
              <Field label="Cages placed">
                <input type="number" min="1" step="1" required value={allocation.cages} onChange={(event) => updateAllocation(index, { cages: event.target.value })} placeholder="Approx. 6" className="field-control font-mono font-black" />
              </Field>
              <button type="button" disabled={allocations.length === 1} onClick={() => setAllocations((current) => current.filter((_, allocationIndex) => allocationIndex !== index))} className="grid h-12 w-12 place-items-center border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-25" aria-label="Remove allocation">
                <Trash2 size={17} />
              </button>
            </div>
          ))}
        </div>

        <div className="mt-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <button type="button" onClick={() => setAllocations((current) => [...current, { sheetNumber: "", cages: "" }])} className="inline-flex h-11 items-center justify-center gap-2 border border-[#9d8c7f] px-4 text-xs font-black uppercase text-[#574c43] hover:bg-[#f4eee8]">
            <Plus size={16} />
            Add another black sheet
          </button>
          <div className={`border px-4 py-3 text-sm font-black ${allocatedCages === totalCagesNumber && totalCagesNumber > 0 ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-amber-300 bg-amber-50 text-amber-950"}`}>
            {allocatedCages} / {totalCagesNumber} cages allocated
          </div>
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-2">
        <div className="border border-[#cfc4b7] bg-white p-5 lg:p-6">
          <SectionHeading eyebrow="Team" title="Employees present" description="Select the employees who worked on this production entry." icon={Users} compact />
          <input value={employeeSearch} onChange={(event) => setEmployeeSearch(event.target.value)} placeholder="Search employee, department or position" className="field-control mt-5" />
          <div className="mt-3 max-h-72 space-y-2 overflow-y-auto border border-[#ded5ca] p-3">
            {filteredEmployees.map((employee) => {
              const selected = employeeIds.includes(employee.id);
              return (
                <label key={employee.id} className={`flex cursor-pointer items-start gap-3 border p-3 ${selected ? "border-[#d78a46] bg-[#fff8f0]" : "border-transparent bg-[#faf8f5]"}`}>
                  <input type="checkbox" checked={selected} onChange={() => setEmployeeIds((current) => selected ? current.filter((id) => id !== employee.id) : [...current, employee.id])} className="mt-1 h-4 w-4" />
                  <span>
                    <span className="block text-sm font-black">{employee.employeeName}</span>
                    <span className="mt-1 block text-[10px] font-bold uppercase text-slate-500">{employee.employeeCode} · {employee.department} · {employee.position}</span>
                  </span>
                </label>
              );
            })}
          </div>
          <p className="mt-3 text-xs font-bold text-slate-500">{employeeIds.length} employees selected</p>
        </div>

        <div className="border border-[#cfc4b7] bg-white p-5 lg:p-6">
          <SectionHeading eyebrow="Optional" title="Breakdowns" description="Record downtime only when a breakdown occurred." icon={Wrench} compact />
          <div className="mt-5 space-y-3">
            {breakdowns.map((breakdown, index) => (
              <div key={index} className="space-y-3 border border-[#ded5ca] bg-[#faf8f5] p-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-black uppercase">Breakdown {index + 1}</p>
                  <button type="button" onClick={() => setBreakdowns((current) => current.filter((_, breakdownIndex) => breakdownIndex !== index))} className="text-red-700"><Trash2 size={16} /></button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <select value={breakdown.category} onChange={(event) => setBreakdowns((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, category: event.target.value } : item))} className="field-control">
                    {BREAKDOWN_CATEGORIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                  <input value={breakdown.equipment} onChange={(event) => setBreakdowns((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, equipment: event.target.value } : item))} placeholder="Equipment" className="field-control" />
                  <input type="time" value={breakdown.startTime} onChange={(event) => setBreakdowns((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, startTime: event.target.value } : item))} className="field-control" />
                  <input type="time" value={breakdown.endTime} onChange={(event) => setBreakdowns((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, endTime: event.target.value } : item))} className="field-control" />
                </div>
                <textarea required value={breakdown.description} onChange={(event) => setBreakdowns((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, description: event.target.value } : item))} placeholder="What happened?" rows={2} className="field-control resize-y" />
              </div>
            ))}
          </div>
          <button type="button" onClick={() => setBreakdowns((current) => [...current, { category: "MECHANICAL", equipment: "", startTime: "", endTime: "", description: "" }])} className="mt-4 inline-flex h-11 items-center gap-2 border border-[#9d8c7f] px-4 text-xs font-black uppercase text-[#574c43] hover:bg-[#f4eee8]">
            <Plus size={16} />
            Add breakdown
          </button>
        </div>
      </section>

      <section className="border border-[#cfc4b7] bg-white p-5 lg:p-6">
        <Field label="Production notes (optional)">
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} placeholder="Any useful information for Management..." className="field-control resize-y" />
        </Field>
        <button type="submit" disabled={saving || data.finesLots.length === 0} className="mt-5 inline-flex h-14 w-full items-center justify-center gap-3 bg-[#d78a46] px-6 text-sm font-black uppercase text-[#171310] hover:bg-[#e49b58] disabled:opacity-50">
          {saving ? <LoaderCircle size={19} className="animate-spin" /> : <Save size={19} />}
          Save production and update drying yard
        </button>
      </section>
    </form>
  );
}

function FormulaMetric({ label, value, formula }: { label: string; value: string; formula: string }) {
  return (
    <div className="border border-[#ded5ca] bg-[#201a16] p-4 text-white">
      <p className="text-[10px] font-black uppercase tracking-[0.12em] text-[#a99c91]">{label}</p>
      <p className="mt-2 font-mono text-2xl font-black text-[#d78a46]">{value}</p>
      <p className="mt-1 text-[10px] font-bold uppercase text-[#756b63]">{formula}</p>
    </div>
  );
}

function CollectionForm({
  sheets,
  employees,
  collections,
  initialSheetNumber,
  sessionToken,
  saving,
  setSaving,
  setError,
  setSuccess,
  onSaved,
}: {
  sheets: BlackSheetRow[];
  employees: EmployeeOption[];
  collections: CollectionRow[];
  initialSheetNumber: number;
  sessionToken: string;
  saving: boolean;
  setSaving: (value: boolean) => void;
  setError: (value: string | null) => void;
  setSuccess: (value: string | null) => void;
  onSaved: () => Promise<void>;
}) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const activeSheets = sheets.filter((sheet) => sheet.cycleId);
  const initialSheet = activeSheets.some((sheet) => sheet.sheetNumber === initialSheetNumber)
    ? String(initialSheetNumber)
    : activeSheets[0]
      ? String(activeSheets[0].sheetNumber)
      : "";
  const [sheetNumber, setSheetNumber] = useState(initialSheet);
  const [collectionDate, setCollectionDate] = useState(localDate());
  const [weights, setWeights] = useState<string[]>([""]);
  const [isComplete, setIsComplete] = useState(false);
  const [employeeIds, setEmployeeIds] = useState<string[]>([]);
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (activeSheets.some((sheet) => sheet.sheetNumber === initialSheetNumber)) {
      setSheetNumber(String(initialSheetNumber));
    }
  }, [initialSheetNumber]);

  const selectedSheet = activeSheets.find((sheet) => String(sheet.sheetNumber) === sheetNumber);
  const currentTotal = weights.reduce((total, weight) => total + numberValue(weight), 0);
  const cumulativeWeight = numberValue(selectedSheet?.collectedWeightKg) + currentTotal;
  const cumulativeBags = numberValue(selectedSheet?.collectedBigBags) + weights.filter((weight) => numberValue(weight) > 0).length;
  const filteredEmployees = employees.filter((employee) => {
    const search = employeeSearch.trim().toLowerCase();
    if (!search) return true;
    return `${employee.employeeCode} ${employee.employeeName} ${employee.department} ${employee.position}`
      .toLowerCase()
      .includes(search);
  });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !selectedSheet?.cycleId) return;

    setError(null);
    setSuccess(null);

    const parsedWeights = weights.map(numberValue);
    if (parsedWeights.some((weight) => weight <= 0)) {
      setError("Enter a positive weight for every big bag.");
      return;
    }

    if (employeeIds.length === 0) {
      setError("Select at least one employee for the collection team.");
      return;
    }

    if (isComplete && !window.confirm(`Confirm that Black Sheet ${selectedSheet.sheetNumber} is completely collected? It will become available for another ERP lot.`)) {
      return;
    }

    setSaving(true);

    try {
      const { error: rpcError } = await supabase.rpc(
        "portal_collect_briquette_sheet",
        {
          p_token: sessionToken,
          p_cycle_id: selectedSheet.cycleId,
          p_collection_date: collectionDate,
          p_big_bag_weights: parsedWeights,
          p_is_complete: isComplete,
          p_employee_ids: employeeIds,
          p_notes: notes,
        },
      );
      if (rpcError) throw rpcError;

      setSuccess(`${parsedWeights.length} big bags (${formatKg(currentTotal)}) recorded from Black Sheet ${selectedSheet.sheetNumber}.`);
      await onSaved();
    } catch (saveError) {
      setError(errorText(saveError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <form onSubmit={submit} className="border border-[#cfc4b7] bg-white p-5 lg:p-6">
        <SectionHeading eyebrow="Collection" title="Weigh dry briquettes" description="Select the black sheet and enter every big-bag weight separately. The app calculates the total automatically." icon={Scale} />

        {activeSheets.length === 0 ? (
          <div className="mt-6 border border-slate-300 bg-slate-50 p-5 text-sm font-bold text-slate-700">
            There are no active black sheets to collect.
          </div>
        ) : (
          <>
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <Field label="Black sheet">
                <select required value={sheetNumber} onChange={(event) => setSheetNumber(event.target.value)} className="field-control">
                  {activeSheets.map((sheet) => (
                    <option key={sheet.sheetNumber} value={sheet.sheetNumber}>
                      Black Sheet {String(sheet.sheetNumber).padStart(2, "0")} — {sheet.erpLotNumber} — {statusLabels[liveSheetStatus(sheet, Date.now())]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Collection date">
                <input type="date" required value={collectionDate} onChange={(event) => setCollectionDate(event.target.value)} className="field-control" />
              </Field>
            </div>

            {selectedSheet && (
              <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <DetailMetric label="ERP lot" value={selectedSheet.erpLotNumber ?? "—"} />
                <DetailMetric label="Cages deposited" value={selectedSheet.totalCages} />
                <DetailMetric label="Previously collected" value={`${selectedSheet.collectedBigBags} bags · ${formatKg(selectedSheet.collectedWeightKg)}`} />
                <DetailMetric label="Dry theoretical" value={formatKg(selectedSheet.theoreticalDryWeightKg ?? selectedSheet.totalCages * 350)} />
              </div>
            )}

            <div className="mt-6 border border-[#ded5ca] bg-[#faf8f5] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-black uppercase">Big-bag weights</p>
                  <p className="mt-1 text-xs text-slate-500">One line per big bag, in kilograms.</p>
                </div>
                <button type="button" onClick={() => setWeights((current) => [...current, ""])} className="inline-flex h-10 items-center gap-2 bg-[#201a16] px-3 text-[10px] font-black uppercase text-white">
                  <Plus size={15} /> Add big bag
                </button>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {weights.map((weight, index) => (
                  <div key={index} className="flex items-end gap-2 border border-[#ded5ca] bg-white p-3">
                    <Field label={`Big bag ${index + 1}`}>
                      <div className="relative">
                        <input type="number" min="0.001" step="0.001" required value={weight} onChange={(event) => setWeights((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} placeholder="0.000" className="field-control pr-12 font-mono font-black" />
                        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-black text-slate-500">kg</span>
                      </div>
                    </Field>
                    <button type="button" disabled={weights.length === 1} onClick={() => setWeights((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="grid h-12 w-12 shrink-0 place-items-center border border-red-200 text-red-700 disabled:opacity-25"><Trash2 size={16} /></button>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <FormulaMetric label="This collection" value={formatKg(currentTotal)} formula={`${weights.length} big bags`} />
              <FormulaMetric label="Cumulative collected" value={formatKg(cumulativeWeight)} formula={`${cumulativeBags} big bags`} />
              <FormulaMetric label="Sheet theoretical" value={formatKg(selectedSheet?.theoreticalDryWeightKg ?? numberValue(selectedSheet?.totalCages) * 350)} formula="Final comparison when complete" />
            </div>

            <div className="mt-5 border border-[#ded5ca] bg-white p-4">
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
                <div>
                  <p className="text-xs font-black uppercase">Collection employees</p>
                  <p className="mt-1 text-xs text-slate-500">
                    Select the employees who collected and filled these big bags.
                  </p>
                </div>
                <p className="text-xs font-black text-[#b86c2c]">
                  {employeeIds.length} selected
                </p>
              </div>
              <input
                value={employeeSearch}
                onChange={(event) => setEmployeeSearch(event.target.value)}
                placeholder="Search collection employee"
                className="field-control mt-4"
              />
              <div className="mt-3 grid max-h-72 gap-2 overflow-y-auto border border-[#ded5ca] p-3 md:grid-cols-2 xl:grid-cols-3">
                {filteredEmployees.map((employee) => {
                  const selected = employeeIds.includes(employee.id);
                  return (
                    <label
                      key={employee.id}
                      className={`flex cursor-pointer items-start gap-3 border p-3 ${
                        selected
                          ? "border-[#d78a46] bg-[#fff8f0]"
                          : "border-transparent bg-[#faf8f5]"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() =>
                          setEmployeeIds((current) =>
                            selected
                              ? current.filter((id) => id !== employee.id)
                              : [...current, employee.id],
                          )
                        }
                        className="mt-1 h-4 w-4"
                      />
                      <span>
                        <span className="block text-sm font-black">
                          {employee.employeeName}
                        </span>
                        <span className="mt-1 block text-[9px] font-bold uppercase text-slate-500">
                          {employee.employeeCode} · {employee.department}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
              <Field label="Collection notes (optional)">
                <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} className="field-control resize-y" />
              </Field>
              <label className={`flex min-h-[74px] cursor-pointer items-center gap-3 border-2 px-5 ${isComplete ? "border-emerald-600 bg-emerald-50 text-emerald-900" : "border-violet-300 bg-violet-50 text-violet-950"}`}>
                <input type="checkbox" checked={isComplete} onChange={(event) => setIsComplete(event.target.checked)} className="h-5 w-5" />
                <span>
                  <span className="block text-xs font-black uppercase">Black sheet completely collected</span>
                  <span className="mt-1 block text-[10px]">Leave unchecked for a partial collection.</span>
                </span>
              </label>
            </div>

            <button type="submit" disabled={saving} className="mt-5 inline-flex h-14 w-full items-center justify-center gap-3 bg-emerald-700 px-6 text-sm font-black uppercase text-white hover:bg-emerald-800 disabled:opacity-50">
              {saving ? <LoaderCircle size={19} className="animate-spin" /> : <Scale size={19} />}
              Record {isComplete ? "complete" : "partial"} collection
            </button>
          </>
        )}
      </form>

      <section className="border border-[#cfc4b7] bg-white p-5 lg:p-6">
        <h2 className="text-xl font-black uppercase">Recent collections</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-[#201a16] text-[10px] font-black uppercase text-[#d78a46]">
              <tr><th className="px-4 py-3">Date</th><th className="px-4 py-3">Sheet</th><th className="px-4 py-3">ERP lot</th><th className="px-4 py-3">Employees</th><th className="px-4 py-3">Big bags</th><th className="px-4 py-3">Weight</th><th className="px-4 py-3">Status</th></tr>
            </thead>
            <tbody>
              {collections.slice(0, 12).map((collection) => (
                <tr key={collection.id} className="border-b border-[#e6ded5]">
                  <td className="px-4 py-3 font-bold">{formatDate(collection.collectionDate)}</td>
                  <td className="px-4 py-3 font-mono font-black">{String(collection.sheetNumber).padStart(2, "0")}</td>
                  <td className="px-4 py-3 font-mono text-xs font-black">{collection.erpLotNumber}</td>
                  <td className="px-4 py-3">{collection.employees.length}</td>
                  <td className="px-4 py-3">{collection.bigBags.length}</td>
                  <td className="px-4 py-3 font-mono font-black">{formatKg(collection.totalWeightKg)}</td>
                  <td className="px-4 py-3"><span className={`px-2 py-1 text-[9px] font-black uppercase ${collection.isComplete ? "bg-emerald-100 text-emerald-900" : "bg-violet-100 text-violet-900"}`}>{collection.isComplete ? "Complete" : "Partial"}</span></td>
                </tr>
              ))}
              {collections.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500">No collection recorded yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function LotsWorkspace({
  lots,
  profile,
  sessionToken,
  saving,
  setSaving,
  setError,
  setSuccess,
  onSaved,
}: {
  lots: BriquetteLotRow[];
  profile: BriquettesFactoryProfile;
  sessionToken: string;
  saving: boolean;
  setSaving: (value: boolean) => void;
  setError: (value: string | null) => void;
  setSuccess: (value: string | null) => void;
  onSaved: () => Promise<void>;
}) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [selectedLotId, setSelectedLotId] = useState(lots[0]?.id ?? "");
  const selectedLot = lots.find((lot) => lot.id === selectedLotId) ?? lots[0];
  const [classification, setClassification] = useState<LotClassification>(selectedLot?.classification ?? "PENDING");
  const [laboratoryNotes, setLaboratoryNotes] = useState(selectedLot?.laboratoryNotes ?? "");

  useEffect(() => {
    if (selectedLot) {
      setClassification(selectedLot.classification);
      setLaboratoryNotes(selectedLot.laboratoryNotes);
    }
  }, [selectedLot?.id, selectedLot?.classification, selectedLot?.laboratoryNotes]);

  async function saveClassification() {
    if (!supabase || !selectedLot) return;
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const { error: rpcError } = await supabase.rpc(
        "portal_classify_briquette_lot",
        {
          p_token: sessionToken,
          p_lot_id: selectedLot.id,
          p_classification: classification,
          p_laboratory_notes: laboratoryNotes,
        },
      );
      if (rpcError) throw rpcError;
      setSuccess(`Laboratory classification updated for ${selectedLot.erpLotNumber}.`);
      await onSaved();
    } catch (saveError) {
      setError(errorText(saveError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
      <section className="border border-[#cfc4b7] bg-white p-5 lg:p-6">
        <SectionHeading eyebrow="Traceability" title="ERP briquette lots" description="Production, drying and collected weight stay grouped under the final ERP lot." icon={ClipboardList} />
        <div className="mt-6 space-y-3">
          {lots.map((lot) => {
            const selected = selectedLot?.id === lot.id;
            const complete = lot.activeSheets === 0 && lot.totalCages > 0;
            const variance = lot.collectedWeightKg - lot.theoreticalDryWeightKg;
            const yieldPercent = lot.theoreticalDryWeightKg > 0 ? lot.collectedWeightKg / lot.theoreticalDryWeightKg * 100 : 0;
            return (
              <button key={lot.id} type="button" onClick={() => setSelectedLotId(lot.id)} className={`w-full border p-4 text-left transition ${selected ? "border-[#d78a46] bg-[#fff8f0]" : "border-[#ded5ca] bg-[#faf8f5] hover:border-[#b99b83]"}`}>
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                  <div>
                    <p className="break-words font-mono text-base font-black">{lot.erpLotNumber}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <span className={`px-2 py-1 text-[9px] font-black uppercase ${classificationClass(lot.classification)}`}>{classificationLabel(lot.classification)}</span>
                      <span className={`px-2 py-1 text-[9px] font-black uppercase ${complete ? "bg-emerald-100 text-emerald-900" : "bg-sky-100 text-sky-900"}`}>{complete ? "Drying complete" : `${lot.activeSheets} active sheets`}</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-right">
                    <MiniMetric label="Cages" value={lot.totalCages} />
                    <MiniMetric label="Big bags" value={lot.collectedBigBags} />
                    <MiniMetric label="Actual" value={formatKg(lot.collectedWeightKg)} />
                  </div>
                </div>
                {complete && lot.collectedWeightKg > 0 && (
                  <div className="mt-4 grid gap-2 border-t border-[#e5d6c8] pt-3 sm:grid-cols-3">
                    <span className="text-xs font-bold text-slate-600">Theoretical: {formatKg(lot.theoreticalDryWeightKg)}</span>
                    <span className="text-xs font-bold text-slate-600">Difference: {formatKg(variance)}</span>
                    <span className="text-xs font-black text-slate-800">Yield: {yieldPercent.toFixed(1)}%</span>
                  </div>
                )}
              </button>
            );
          })}
          {lots.length === 0 && <div className="border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">No ERP briquette lot recorded yet.</div>}
        </div>
      </section>

      <section className="h-fit border border-[#cfc4b7] bg-white p-5 lg:p-6 xl:sticky xl:top-28">
        <SectionHeading eyebrow="Laboratory" title="DIN classification" description="The final classification applies to the complete ERP briquette lot, not to individual black sheets or big bags." icon={FlaskConical} compact />
        {!selectedLot ? (
          <p className="mt-6 text-sm text-slate-500">Select an ERP lot to view its laboratory status.</p>
        ) : (
          <>
            <div className="mt-6 border border-[#ded5ca] bg-[#201a16] p-4 text-white">
              <p className="text-[9px] font-black uppercase tracking-[0.14em] text-[#9f9288]">Selected ERP lot</p>
              <p className="mt-2 break-words font-mono text-lg font-black text-[#d78a46]">{selectedLot.erpLotNumber}</p>
              <p className="mt-3 text-xs text-[#a99c91]">{selectedLot.totalCages} cages · {selectedLot.collectedBigBags} collected big bags · {formatKg(selectedLot.collectedWeightKg)}</p>
            </div>

            {profile.role === "manager" ? (
              <div className="mt-5 space-y-4">
                <Field label="Final classification">
                  <select value={classification} onChange={(event) => setClassification(event.target.value as LotClassification)} className="field-control">
                    <option value="PENDING">Pending laboratory result</option>
                    <option value="DIN">DIN</option>
                    <option value="NON_DIN">Non-DIN</option>
                  </select>
                </Field>
                <Field label="Laboratory notes (optional)">
                  <textarea rows={5} value={laboratoryNotes} onChange={(event) => setLaboratoryNotes(event.target.value)} className="field-control resize-y" />
                </Field>
                <button type="button" disabled={saving} onClick={() => void saveClassification()} className="inline-flex h-12 w-full items-center justify-center gap-2 bg-[#d78a46] px-4 text-xs font-black uppercase text-[#171310] disabled:opacity-50">
                  {saving ? <LoaderCircle size={17} className="animate-spin" /> : <Save size={17} />}
                  Save laboratory result
                </button>
              </div>
            ) : (
              <div className="mt-5 border border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
                Laboratory classification is visible here. Management records the final DIN or non-DIN result.
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <span>
      <span className="block text-[8px] font-black uppercase text-slate-400">{label}</span>
      <span className="mt-1 block font-mono text-xs font-black text-[#201a16]">{value}</span>
    </span>
  );
}

function HistoryWorkspace({ productionEntries, collections }: { productionEntries: ProductionEntryRow[]; collections: CollectionRow[] }) {
  return (
    <div className="space-y-5">
      <section className="border border-[#cfc4b7] bg-white p-5 lg:p-6">
        <SectionHeading eyebrow="Production history" title="Cages and black-sheet allocations" description="Every saved production entry keeps its fines lots, employees and drying-yard allocation." icon={History} />
        <div className="mt-6 space-y-3">
          {productionEntries.map((entry) => (
            <details key={entry.id} className="group border border-[#ded5ca] bg-[#faf8f5]">
              <summary className="grid cursor-pointer list-none gap-3 p-4 sm:grid-cols-[130px_1fr_auto_auto] sm:items-center">
                <span className="text-sm font-black">{formatDate(entry.productionDate)}<span className="mt-1 block text-[9px] uppercase text-slate-500">{entry.shift} shift</span></span>
                <span className="font-mono text-sm font-black">{entry.erpLotNumber}</span>
                <span className="font-mono text-lg font-black text-[#b86c2c]">{entry.totalCages} cages</span>
                <span className="text-xs font-bold text-slate-500">{entry.allocations.map((allocation) => `BS${allocation.sheetNumber}: ${allocation.cages}`).join(" · ")}</span>
              </summary>
              <div className="grid gap-4 border-t border-[#ded5ca] bg-white p-4 lg:grid-cols-3">
                <div><p className="text-[9px] font-black uppercase text-slate-400">Theoretical recipe</p><p className="mt-2 text-sm font-bold">Dry: {formatKg(entry.theoreticalDryWeightKg)}</p><p className="mt-1 text-sm">Fines: {formatKg(entry.theoreticalFinesKg)}</p><p className="mt-1 text-sm">Starch: {formatKg(entry.theoreticalStarchKg)}</p></div>
                <div><p className="text-[9px] font-black uppercase text-slate-400">Fines lots</p>{entry.finesLots.map((lot) => <p key={lot.sourceLotId} className="mt-2 font-mono text-xs font-bold">{lot.erpLotNumber} {lot.lotFinished ? "· FINISHED" : ""}</p>)}</div>
                <div><p className="text-[9px] font-black uppercase text-slate-400">Team & notes</p><p className="mt-2 text-sm">{entry.employees.length} employees · {entry.breakdowns.length} breakdowns</p><p className="mt-2 text-xs text-slate-500">{entry.notes || "No notes"}</p></div>
              </div>
            </details>
          ))}
          {productionEntries.length === 0 && <div className="border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">No briquette production recorded yet.</div>}
        </div>
      </section>

      <section className="border border-[#cfc4b7] bg-white p-5 lg:p-6">
        <h2 className="text-xl font-black uppercase">Collection history</h2>
        <div className="mt-4 space-y-3">
          {collections.map((collection) => (
            <div key={collection.id} className="grid gap-3 border border-[#ded5ca] bg-[#faf8f5] p-4 sm:grid-cols-[110px_80px_1fr_auto] sm:items-center">
              <span className="text-sm font-black">{formatDate(collection.collectionDate)}</span>
              <span className="font-mono text-lg font-black">BS {String(collection.sheetNumber).padStart(2, "0")}</span>
              <span><span className="block font-mono text-sm font-black">{collection.erpLotNumber}</span><span className="mt-1 block text-xs text-slate-500">Team: {collection.employees.map((employee) => employee.employeeName).join(", ")}</span><span className="mt-1 block text-xs text-slate-500">{collection.bigBags.map((bag) => `${numberValue(bag.weightKg).toLocaleString("en-US", { maximumFractionDigits: 1 })} kg`).join(" · ")}</span></span>
              <span className="text-right"><span className="block font-mono text-lg font-black text-[#b86c2c]">{formatKg(collection.totalWeightKg)}</span><span className={`mt-1 inline-block px-2 py-1 text-[9px] font-black uppercase ${collection.isComplete ? "bg-emerald-100 text-emerald-900" : "bg-violet-100 text-violet-900"}`}>{collection.isComplete ? "Complete" : "Partial"}</span></span>
            </div>
          ))}
          {collections.length === 0 && <div className="border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">No collection recorded yet.</div>}
        </div>
      </section>
    </div>
  );
}

function SectionHeading({
  eyebrow,
  title,
  description,
  icon: Icon,
  compact = false,
}: {
  eyebrow: string;
  title: string;
  description: string;
  icon: typeof MapIcon;
  compact?: boolean;
}) {
  return (
    <div className="flex items-start gap-4">
      <span className={`grid shrink-0 place-items-center bg-[#201a16] text-[#d78a46] ${compact ? "h-11 w-11" : "h-14 w-14"}`}>
        <Icon size={compact ? 20 : 25} />
      </span>
      <div>
        <p className="text-[10px] font-black uppercase tracking-[0.14em] text-[#b86c2c]">{eyebrow}</p>
        <h2 className={`${compact ? "text-xl" : "text-2xl"} mt-1 font-black uppercase`}>{title}</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">{description}</p>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="mb-2 block text-[10px] font-black uppercase tracking-[0.11em] text-[#6f6258]">{label}</span>
      {children}
    </label>
  );
}
