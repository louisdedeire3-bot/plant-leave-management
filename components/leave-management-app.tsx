"use client";

import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Factory,
  Languages,
  LayoutDashboard,
  LoaderCircle,
  RefreshCw,
  Search,
  ShieldCheck,
  TimerReset,
  UserRound,
  UsersRound,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Fragment, FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  calculateLeaveDays,
  calculateOvertimeHours,
  formatDate,
  formatShortDate,
  isoDate,
  requestStatusOnDate,
  startOfWeek,
} from "@/lib/date";
import { copy } from "@/lib/i18n";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import type {
  Employee,
  EmployeeModule,
  Language,
  LeaveRequest,
  OvertimeRequest,
  RequestStatus,
  RoleView,
} from "@/lib/types";

const viewOptions: Array<{ id: RoleView; icon: LucideIcon }> = [
  { id: "employee", icon: UserRound },
  { id: "calendar", icon: CalendarDays },
  { id: "supervisor", icon: UsersRound },
  { id: "manager", icon: ShieldCheck },
];

const statusStyles: Record<RequestStatus | "working", string> = {
  working: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  approved: "bg-blue-50 text-blue-700 ring-blue-200",
  pending_supervisor: "bg-amber-50 text-amber-700 ring-amber-200",
  pending_manager: "bg-violet-50 text-violet-700 ring-violet-200",
  rejected: "bg-red-50 text-red-700 ring-red-200",
  cancelled: "bg-slate-100 text-slate-500 ring-slate-200",
};

const statusCode = {
  working: "W",
  approved: "AL",
  pending_supervisor: "PS",
  pending_manager: "PM",
} as const;

interface EmployeeRow {
  id: string;
  employee_code: string;
  first_name: string;
  surname: string;
  nickname: string | null;
  department: string | null;
  supervisor: string | null;
  manager: string | null;
  earned: number | string | null;
  used: number | string | null;
  balance: number | string | null;
}

interface LeaveRow {
  id: string;
  employee_id: string;
  start_date: string;
  end_date: string;
  requested_days: number | string;
  comment: string | null;
  status: string;
  created_at: string;
}

interface OvertimeRow {
  id: string;
  employee_id: string;
  overtime_date: string;
  start_time: string;
  end_time: string;
  break_minutes: number | string;
  total_hours: number | string;
  reason: string | null;
  status: string;
  created_at: string;
}

function asNumber(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeStatus(value: string): RequestStatus {
  if (
    value === "pending_supervisor" ||
    value === "pending_manager" ||
    value === "approved" ||
    value === "rejected" ||
    value === "cancelled"
  ) {
    return value;
  }
  return "pending_supervisor";
}

function mapEmployee(row: EmployeeRow): Employee {
  return {
    id: row.id,
    employeeCode: row.employee_code,
    firstName: row.first_name,
    surname: row.surname,
    nickname: row.nickname ?? "",
    department: row.department ?? "Unassigned",
    supervisor: row.supervisor ?? "Not assigned",
    manager: row.manager ?? "Not assigned",
    earned: asNumber(row.earned),
    used: asNumber(row.used),
    balance: asNumber(row.balance),
  };
}

function mapLeave(row: LeaveRow): LeaveRequest {
  return {
    id: row.id,
    employeeId: row.employee_id,
    startDate: row.start_date,
    endDate: row.end_date,
    days: asNumber(row.requested_days),
    comment: row.comment ?? "",
    status: normalizeStatus(row.status),
    createdAt: row.created_at,
  };
}

function mapOvertime(row: OvertimeRow): OvertimeRequest {
  return {
    id: row.id,
    employeeId: row.employee_id,
    overtimeDate: row.overtime_date,
    startTime: row.start_time.slice(0, 5),
    endTime: row.end_time.slice(0, 5),
    breakMinutes: asNumber(row.break_minutes),
    totalHours: asNumber(row.total_hours),
    reason: row.reason ?? "",
    status: normalizeStatus(row.status),
    createdAt: row.created_at,
  };
}

function employeeName(employee: Employee): string {
  return `${employee.firstName} ${employee.surname}`;
}

function initials(employee: Employee): string {
  return `${employee.firstName[0] ?? ""}${employee.surname[0] ?? ""}`.toUpperCase();
}

function statusLabel(status: RequestStatus, language: Language): string {
  const t = copy[language];
  return {
    approved: t.approvedLeave,
    pending_supervisor: t.pendingSupervisor,
    pending_manager: t.pendingManager,
    rejected: t.rejected,
    cancelled: t.cancelled,
  }[status];
}

function isTodayWithin(request: LeaveRequest): boolean {
  const today = isoDate(new Date());
  return request.status === "approved" && today >= request.startDate && today <= request.endDate;
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return "Unknown database error";
}

export function LeaveManagementApp() {
  const [language, setLanguage] = useState<Language>("en");
  const [view, setView] = useState<RoleView>("employee");
  const [module, setModule] = useState<EmployeeModule>("leave");
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [overtimeRequests, setOvertimeRequests] = useState<OvertimeRequest[]>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [department, setDepartment] = useState("all");
  const [weekAnchor, setWeekAnchor] = useState(isoDate(new Date()));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [databaseError, setDatabaseError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [comment, setComment] = useState("");

  const [overtimeDate, setOvertimeDate] = useState(isoDate(new Date()));
  const [overtimeStart, setOvertimeStart] = useState("");
  const [overtimeEnd, setOvertimeEnd] = useState("");
  const [breakMinutes, setBreakMinutes] = useState(0);
  const [overtimeReason, setOvertimeReason] = useState("");

  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const t = copy[language];

  const loadData = useCallback(async () => {
    setLoading(true);
    setDatabaseError(null);

    if (!supabase) {
      setDatabaseError(
        "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in Vercel.",
      );
      setLoading(false);
      return;
    }

    try {
      const [employeeResult, leaveResult, overtimeResult] = await Promise.all([
        supabase.rpc("kiosk_employees"),
        supabase.rpc("kiosk_leave_requests"),
        supabase.rpc("kiosk_overtime_requests"),
      ]);

      if (employeeResult.error) throw employeeResult.error;
      if (leaveResult.error) throw leaveResult.error;
      if (overtimeResult.error) throw overtimeResult.error;

      setEmployees(((employeeResult.data ?? []) as EmployeeRow[]).map(mapEmployee));
      setRequests(((leaveResult.data ?? []) as LeaveRow[]).map(mapLeave));
      setOvertimeRequests(((overtimeResult.data ?? []) as OvertimeRow[]).map(mapOvertime));
    } catch (error) {
      setDatabaseError(errorText(error));
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const selectedEmployee = useMemo(
    () => employees.find((employee) => employee.id === selectedEmployeeId) ?? null,
    [employees, selectedEmployeeId],
  );

  const searchResults = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const source = query ? employees : employees.slice(0, 40);
    if (!query) return source;

    return source.filter((employee) =>
      [
        employee.employeeCode,
        employee.firstName,
        employee.surname,
        employee.nickname,
        employeeName(employee),
      ]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [employees, searchQuery]);

  const requestedDays = useMemo(
    () => Math.max(0, calculateLeaveDays(startDate, endDate)),
    [startDate, endDate],
  );

  const calculatedOvertime = useMemo(
    () => calculateOvertimeHours(overtimeStart, overtimeEnd, breakMinutes),
    [overtimeStart, overtimeEnd, breakMinutes],
  );

  const employeeRequests = useMemo(
    () => requests.filter((request) => request.employeeId === selectedEmployeeId),
    [requests, selectedEmployeeId],
  );

  const employeeOvertime = useMemo(
    () => overtimeRequests.filter((request) => request.employeeId === selectedEmployeeId),
    [overtimeRequests, selectedEmployeeId],
  );

  const supervisorLeavePending = requests.filter((request) => request.status === "pending_supervisor");
  const supervisorOvertimePending = overtimeRequests.filter(
    (request) => request.status === "pending_supervisor",
  );
  const managerLeavePending = requests.filter((request) => request.status === "pending_manager");
  const managerOvertimePending = overtimeRequests.filter((request) => request.status === "pending_manager");
  const onLeaveToday = requests.filter(isTodayWithin);
  const approvedThisMonth = requests.filter((request) => {
    const date = new Date(`${request.startDate}T00:00:00`);
    const now = new Date();
    return (
      request.status === "approved" &&
      date.getMonth() === now.getMonth() &&
      date.getFullYear() === now.getFullYear()
    );
  });

  function selectEmployee(id: string) {
    setSelectedEmployeeId(id);
    setSearchQuery("");
    setMessage(null);
    setModule("leave");
  }

  function clearEmployee() {
    setSelectedEmployeeId(null);
    setMessage(null);
    setStartDate("");
    setEndDate("");
    setComment("");
    setOvertimeStart("");
    setOvertimeEnd("");
    setBreakMinutes(0);
    setOvertimeReason("");
  }

  async function submitLeave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedEmployee || !supabase) return;

    const days = calculateLeaveDays(startDate, endDate);
    if (days <= 0) {
      setMessage({ kind: "error", text: t.invalidDates });
      return;
    }
    if (days > selectedEmployee.balance) {
      setMessage({ kind: "error", text: t.insufficientBalance });
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      const { error } = await supabase.rpc("kiosk_submit_leave", {
        p_employee_id: selectedEmployee.id,
        p_start_date: startDate,
        p_end_date: endDate,
        p_comment: comment.trim() || null,
      });
      if (error) throw error;

      setStartDate("");
      setEndDate("");
      setComment("");
      setMessage({ kind: "success", text: t.submitted });
      await loadData();
    } catch (error) {
      setMessage({ kind: "error", text: errorText(error) });
    } finally {
      setSaving(false);
    }
  }

  async function submitOvertime(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedEmployee || !supabase) return;

    if (!overtimeDate || calculatedOvertime <= 0) {
      setMessage({ kind: "error", text: t.invalidOvertime });
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      const { error } = await supabase.rpc("kiosk_submit_overtime", {
        p_employee_id: selectedEmployee.id,
        p_overtime_date: overtimeDate,
        p_start_time: overtimeStart,
        p_end_time: overtimeEnd,
        p_break_minutes: breakMinutes,
        p_reason: overtimeReason.trim() || null,
      });
      if (error) throw error;

      setOvertimeStart("");
      setOvertimeEnd("");
      setBreakMinutes(0);
      setOvertimeReason("");
      setMessage({ kind: "success", text: t.overtimeSubmitted });
      await loadData();
    } catch (error) {
      setMessage({ kind: "error", text: errorText(error) });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <LoadingScreen text={t.loading} />;
  }

  if (databaseError) {
    return <DatabaseErrorScreen title={t.databaseError} error={databaseError} retry={loadData} t={t} />;
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/90 backdrop-blur-xl">
        <div className="mx-auto flex min-h-20 max-w-[1500px] items-center justify-between gap-5 px-4 py-3 sm:px-6 lg:px-8">
          <button className="flex items-center gap-3 text-left" onClick={() => setView("employee")}>
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-blue-600 to-sky-500 text-white shadow-lg shadow-blue-500/25">
              <Factory size={23} />
            </span>
            <span>
              <span className="block text-[15px] font-black tracking-tight text-slate-950 sm:text-lg">
                Plant Leave Management
              </span>
              <span className="hidden text-xs text-slate-500 sm:block">{t.annualLeave}</span>
            </span>
          </button>

          <div className="flex items-center gap-2">
            <span className="hidden items-center gap-2 rounded-full bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-700 ring-1 ring-emerald-200 sm:inline-flex">
              <span className="h-2 w-2 rounded-full bg-emerald-500" /> Supabase connected
            </span>
            <button
              onClick={() => void loadData()}
              className="grid h-10 w-10 place-items-center rounded-xl border border-slate-200 bg-white text-slate-500 transition hover:text-blue-600"
              title={t.refresh}
            >
              <RefreshCw size={17} />
            </button>
            <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600">
              <Languages size={16} />
              <select
                className="bg-transparent outline-none"
                value={language}
                onChange={(event) => setLanguage(event.target.value as Language)}
              >
                <option value="en">English</option>
                <option value="oshi">Oshiwambo</option>
              </select>
            </label>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1500px] grid-cols-1 gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[240px_minmax(0,1fr)] lg:px-8">
        <aside className="h-fit rounded-3xl border border-slate-200 bg-slate-950 p-3 text-white shadow-soft lg:sticky lg:top-28">
          <div className="mb-3 px-3 pb-3 pt-2">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Workspace</p>
          </div>
          <nav className="grid grid-cols-2 gap-2 lg:grid-cols-1">
            {viewOptions.map(({ id, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setView(id)}
                className={`flex items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm font-bold transition ${
                  view === id
                    ? "bg-blue-600 text-white shadow-lg shadow-blue-900/30"
                    : "text-slate-300 hover:bg-white/10 hover:text-white"
                }`}
              >
                <Icon size={18} />
                <span>{t[id]}</span>
              </button>
            ))}
          </nav>

          <div className="mt-4 hidden rounded-2xl bg-white/5 p-4 lg:block">
            <p className="text-xs font-semibold text-slate-400">{t.liveDatabase}</p>
            <p className="mt-1 text-2xl font-black">{employees.length}</p>
            <p className="text-xs text-slate-500">employees loaded</p>
          </div>
        </aside>

        <main className="min-w-0">
          {view === "employee" && (
            <EmployeeView
              language={language}
              t={t}
              employees={employees}
              selectedEmployee={selectedEmployee}
              searchQuery={searchQuery}
              searchResults={searchResults}
              setSearchQuery={setSearchQuery}
              selectEmployee={selectEmployee}
              clearEmployee={clearEmployee}
              module={module}
              setModule={(value) => {
                setModule(value);
                setMessage(null);
              }}
              startDate={startDate}
              endDate={endDate}
              comment={comment}
              setStartDate={setStartDate}
              setEndDate={setEndDate}
              setComment={setComment}
              requestedDays={requestedDays}
              submitLeave={submitLeave}
              overtimeDate={overtimeDate}
              overtimeStart={overtimeStart}
              overtimeEnd={overtimeEnd}
              breakMinutes={breakMinutes}
              overtimeReason={overtimeReason}
              setOvertimeDate={setOvertimeDate}
              setOvertimeStart={setOvertimeStart}
              setOvertimeEnd={setOvertimeEnd}
              setBreakMinutes={setBreakMinutes}
              setOvertimeReason={setOvertimeReason}
              calculatedOvertime={calculatedOvertime}
              submitOvertime={submitOvertime}
              saving={saving}
              message={message}
              employeeRequests={employeeRequests}
              employeeOvertime={employeeOvertime}
            />
          )}

          {view === "calendar" && (
            <CalendarView
              t={t}
              employees={employees}
              requests={requests}
              department={department}
              setDepartment={setDepartment}
              weekAnchor={weekAnchor}
              setWeekAnchor={setWeekAnchor}
            />
          )}

          {view === "supervisor" && (
            <ApprovalDashboard
              eyebrow={t.firstApproval}
              title="Supervisor overview"
              stats={[
                { label: t.teamSize, value: employees.length, icon: UsersRound },
                { label: t.onLeaveToday, value: onLeaveToday.length, icon: CalendarDays },
                {
                  label: t.pendingRequests,
                  value: supervisorLeavePending.length + supervisorOvertimePending.length,
                  icon: Clock3,
                },
              ]}
              employees={employees}
              leaveRequests={supervisorLeavePending}
              overtimeRequests={supervisorOvertimePending}
              language={language}
              t={t}
            />
          )}

          {view === "manager" && (
            <ApprovalDashboard
              eyebrow={t.finalApproval}
              title="Plant overview"
              stats={[
                { label: t.totalEmployees, value: employees.length, icon: UsersRound },
                { label: t.onLeaveToday, value: onLeaveToday.length, icon: CalendarDays },
                {
                  label: t.pendingManager,
                  value: managerLeavePending.length + managerOvertimePending.length,
                  icon: Clock3,
                },
                { label: t.approvedThisMonth, value: approvedThisMonth.length, icon: CalendarDays },
              ]}
              employees={employees}
              leaveRequests={managerLeavePending}
              overtimeRequests={managerOvertimePending}
              language={language}
              t={t}
            />
          )}
        </main>
      </div>
    </div>
  );
}

interface EmployeeViewProps {
  language: Language;
  t: (typeof copy)[Language];
  employees: Employee[];
  selectedEmployee: Employee | null;
  searchQuery: string;
  searchResults: Employee[];
  setSearchQuery: (value: string) => void;
  selectEmployee: (id: string) => void;
  clearEmployee: () => void;
  module: EmployeeModule;
  setModule: (value: EmployeeModule) => void;
  startDate: string;
  endDate: string;
  comment: string;
  setStartDate: (value: string) => void;
  setEndDate: (value: string) => void;
  setComment: (value: string) => void;
  requestedDays: number;
  submitLeave: (event: FormEvent<HTMLFormElement>) => void;
  overtimeDate: string;
  overtimeStart: string;
  overtimeEnd: string;
  breakMinutes: number;
  overtimeReason: string;
  setOvertimeDate: (value: string) => void;
  setOvertimeStart: (value: string) => void;
  setOvertimeEnd: (value: string) => void;
  setBreakMinutes: (value: number) => void;
  setOvertimeReason: (value: string) => void;
  calculatedOvertime: number;
  submitOvertime: (event: FormEvent<HTMLFormElement>) => void;
  saving: boolean;
  message: { kind: "success" | "error"; text: string } | null;
  employeeRequests: LeaveRequest[];
  employeeOvertime: OvertimeRequest[];
}

function EmployeeView(props: EmployeeViewProps) {
  const {
    language,
    t,
    employees,
    selectedEmployee,
    searchQuery,
    searchResults,
    setSearchQuery,
    selectEmployee,
    clearEmployee,
    module,
    setModule,
    startDate,
    endDate,
    comment,
    setStartDate,
    setEndDate,
    setComment,
    requestedDays,
    submitLeave,
    overtimeDate,
    overtimeStart,
    overtimeEnd,
    breakMinutes,
    overtimeReason,
    setOvertimeDate,
    setOvertimeStart,
    setOvertimeEnd,
    setBreakMinutes,
    setOvertimeReason,
    calculatedOvertime,
    submitOvertime,
    saving,
    message,
    employeeRequests,
    employeeOvertime,
  } = props;

  if (!selectedEmployee) {
    return (
      <div className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-soft">
        <div className="grid min-h-[680px] lg:grid-cols-[0.9fr_1.1fr]">
          <section className="relative overflow-hidden bg-gradient-to-br from-blue-700 via-blue-600 to-sky-500 p-8 text-white sm:p-12">
            <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full border border-white/15" />
            <div className="relative flex h-full flex-col justify-between">
              <div>
                <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.16em]">
                  <LayoutDashboard size={14} /> Employee kiosk
                </span>
                <h1 className="mt-8 max-w-md text-4xl font-black tracking-tight sm:text-5xl">{t.welcome}</h1>
                <p className="mt-4 max-w-md text-lg leading-8 text-blue-100">{t.employeeIntro}</p>
              </div>
              <div className="mt-12 grid grid-cols-2 gap-3">
                <InfoTile value="2" label="leave days earned monthly" />
                <InfoTile value="Leave + OT" label="employee self-service" />
              </div>
            </div>
          </section>

          <section className="p-6 sm:p-10 lg:p-12">
            <div className="mx-auto max-w-2xl">
              <p className="text-sm font-black uppercase tracking-[0.16em] text-blue-600">{t.searchEmployee}</p>
              <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-950">{t.selectEmployee}</h2>

              <label className="mt-8 flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 transition focus-within:border-blue-400 focus-within:bg-white focus-within:ring-4 focus-within:ring-blue-100">
                <Search className="text-slate-400" size={21} />
                <input
                  autoFocus
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder={t.searchPlaceholder}
                  className="min-w-0 flex-1 bg-transparent text-base font-semibold text-slate-950 outline-none placeholder:font-normal placeholder:text-slate-400"
                />
              </label>

              <div className="mt-6 flex items-center justify-between">
                <p className="text-sm font-bold text-slate-700">{t.recentEmployees}</p>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-500">
                  {searchResults.length} / {employees.length}
                </span>
              </div>

              <div className="mt-3 max-h-[420px] space-y-2 overflow-y-auto pr-1">
                {searchResults.map((employee) => (
                  <button
                    key={employee.id}
                    onClick={() => selectEmployee(employee.id)}
                    className="group flex w-full items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-lg hover:shadow-blue-100"
                  >
                    <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-slate-900 text-sm font-black text-white transition group-hover:bg-blue-600">
                      {initials(employee)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-black text-slate-950">
                        {employeeName(employee)}
                        {employee.nickname && (
                          <span className="font-semibold text-slate-400"> ({employee.nickname})</span>
                        )}
                      </span>
                      <span className="mt-1 block truncate text-sm text-slate-500">
                        {employee.employeeCode} · {employee.department}
                      </span>
                    </span>
                    <ChevronRight className="text-slate-300 transition group-hover:translate-x-1 group-hover:text-blue-600" />
                  </button>
                ))}
              </div>
            </div>
          </section>
        </div>
      </div>
    );
  }

  const balanceAfter = selectedEmployee.balance - requestedDays;

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-soft">
        <div className="flex flex-col justify-between gap-5 border-b border-slate-100 bg-gradient-to-r from-white to-blue-50/60 p-6 sm:flex-row sm:items-center sm:p-8">
          <div className="flex items-center gap-4">
            <span className="grid h-16 w-16 place-items-center rounded-3xl bg-slate-950 text-lg font-black text-white">
              {initials(selectedEmployee)}
            </span>
            <div>
              <p className="text-sm font-bold text-blue-600">
                {selectedEmployee.employeeCode} · {selectedEmployee.department}
              </p>
              <h1 className="mt-1 text-2xl font-black tracking-tight sm:text-3xl">
                {employeeName(selectedEmployee)}
                {selectedEmployee.nickname && (
                  <span className="ml-2 text-lg font-semibold text-slate-400">
                    ({selectedEmployee.nickname})
                  </span>
                )}
              </h1>
              <p className="mt-1 text-sm text-slate-500">Supervisor: {selectedEmployee.supervisor}</p>
            </div>
          </div>
          <button
            onClick={clearEmployee}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-600 transition hover:border-slate-300 hover:text-slate-950"
          >
            {t.changeEmployee}
          </button>
        </div>

        <div className="grid gap-px bg-slate-200 sm:grid-cols-2 xl:grid-cols-4">
          <StatStrip label={t.availableBalance} value={`${selectedEmployee.balance} ${t.days}`} accent="text-emerald-600" />
          <StatStrip label={t.earnedThisYear} value={`${selectedEmployee.earned} ${t.days}`} />
          <StatStrip label={t.usedThisYear} value={`${selectedEmployee.used} ${t.days}`} accent="text-rose-600" />
          <StatStrip label={t.department} value={selectedEmployee.department} />
        </div>
      </section>

      <div className="inline-flex rounded-2xl border border-slate-200 bg-white p-1 shadow-sm">
        <ModuleButton active={module === "leave"} onClick={() => setModule("leave")} icon={CalendarDays}>
          {t.annualLeaveTab}
        </ModuleButton>
        <ModuleButton active={module === "overtime"} onClick={() => setModule("overtime")} icon={TimerReset}>
          {t.overtimeTab}
        </ModuleButton>
      </div>

      {module === "leave" ? (
        <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
          <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-soft sm:p-8">
            <SectionHeader eyebrow={t.annualLeaveTab} title={t.requestLeave} icon={CalendarDays} />
            <form onSubmit={submitLeave} className="mt-7 space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t.startDate}>
                  <input required type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className={inputClass} />
                </Field>
                <Field label={t.endDate}>
                  <input required type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className={inputClass} />
                </Field>
              </div>
              <Field label={t.comment}>
                <textarea rows={4} value={comment} onChange={(event) => setComment(event.target.value)} placeholder={t.commentPlaceholder} className={`${inputClass} resize-none`} />
              </Field>
              <div className="grid gap-3 rounded-3xl border border-blue-100 bg-blue-50/70 p-4 sm:grid-cols-2">
                <CalculationTile label={t.requestedDays} value={`${requestedDays} ${t.days}`} />
                <CalculationTile label={t.balanceAfter} value={`${balanceAfter} ${t.days}`} danger={balanceAfter < 0} />
              </div>
              <InfoNote text={t.leaveRule} />
              <FormMessage message={message} />
              <SubmitButton saving={saving} label={t.submitRequest} />
            </form>
          </section>

          <HistoryCard title={t.myRequests} icon={CalendarDays} emptyText={t.noRequests}>
            {employeeRequests.map((request) => (
              <article key={request.id} className="rounded-2xl border border-slate-200 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-black text-slate-950">
                      {formatDate(request.startDate)} → {formatDate(request.endDate)}
                    </p>
                    <p className="mt-1 text-sm text-slate-500">{request.days} {t.days}{request.comment ? ` · ${request.comment}` : ""}</p>
                  </div>
                  <StatusBadge status={request.status} language={language} />
                </div>
              </article>
            ))}
          </HistoryCard>
        </div>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
          <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-soft sm:p-8">
            <SectionHeader eyebrow={t.overtimeTab} title={t.requestOvertime} icon={TimerReset} />
            <form onSubmit={submitOvertime} className="mt-7 space-y-5">
              <Field label={t.overtimeDate}>
                <input required type="date" value={overtimeDate} onChange={(event) => setOvertimeDate(event.target.value)} className={inputClass} />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t.startTime}>
                  <input required type="time" value={overtimeStart} onChange={(event) => setOvertimeStart(event.target.value)} className={inputClass} />
                </Field>
                <Field label={t.endTime}>
                  <input required type="time" value={overtimeEnd} onChange={(event) => setOvertimeEnd(event.target.value)} className={inputClass} />
                </Field>
              </div>
              <Field label={t.breakMinutes}>
                <input min="0" max="1440" type="number" value={breakMinutes} onChange={(event) => setBreakMinutes(Number(event.target.value))} className={inputClass} />
              </Field>
              <Field label={t.reason}>
                <textarea rows={4} value={overtimeReason} onChange={(event) => setOvertimeReason(event.target.value)} placeholder={t.reasonPlaceholder} className={`${inputClass} resize-none`} />
              </Field>
              <div className="rounded-3xl border border-violet-100 bg-violet-50/70 p-4">
                <CalculationTile label={t.totalHours} value={`${calculatedOvertime} ${t.hours}`} />
              </div>
              <InfoNote text={t.overtimeRule} />
              <FormMessage message={message} />
              <SubmitButton saving={saving} label={t.submitOvertime} />
            </form>
          </section>

          <HistoryCard title={t.myOvertime} icon={TimerReset} emptyText={t.noOvertime}>
            {employeeOvertime.map((request) => (
              <article key={request.id} className="rounded-2xl border border-slate-200 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-black text-slate-950">
                      {formatDate(request.overtimeDate)} · {request.startTime} → {request.endTime}
                    </p>
                    <p className="mt-1 text-sm text-slate-500">
                      {request.totalHours} {t.hours} · break {request.breakMinutes} min
                      {request.reason ? ` · ${request.reason}` : ""}
                    </p>
                  </div>
                  <StatusBadge status={request.status} language={language} />
                </div>
              </article>
            ))}
          </HistoryCard>
        </div>
      )}
    </div>
  );
}

interface CalendarViewProps {
  t: (typeof copy)[Language];
  employees: Employee[];
  requests: LeaveRequest[];
  department: string;
  setDepartment: (value: string) => void;
  weekAnchor: string;
  setWeekAnchor: (value: string) => void;
}

function CalendarView({ t, employees, requests, department, setDepartment, weekAnchor, setWeekAnchor }: CalendarViewProps) {
  const departments = useMemo(
    () => Array.from(new Set(employees.map((employee) => employee.department))).sort(),
    [employees],
  );
  const weekStart = startOfWeek(new Date(`${weekAnchor}T00:00:00`));
  const weekDays = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(weekStart);
    date.setDate(weekStart.getDate() + index);
    return date;
  });
  const visibleEmployees = employees.filter(
    (employee) => department === "all" || employee.department === department,
  );
  const groupedEmployees = visibleEmployees.reduce<Record<string, Employee[]>>((groups, employee) => {
    const key = employee.department || "Unassigned";
    groups[key] = [...(groups[key] ?? []), employee];
    return groups;
  }, {});
  const departmentEntries = Object.entries(groupedEmployees).sort(([a], [b]) => a.localeCompare(b));
  const approvedCount = visibleEmployees.filter((employee) =>
    weekDays.some((date) => requestStatusOnDate(employee.id, isoDate(date), requests) === "approved"),
  ).length;
  const pendingCount = visibleEmployees.filter((employee) =>
    weekDays.some((date) => {
      const status = requestStatusOnDate(employee.id, isoDate(date), requests);
      return status === "pending_supervisor" || status === "pending_manager";
    }),
  ).length;

  function shiftWeek(offset: number) {
    const next = new Date(weekStart);
    next.setDate(next.getDate() + offset * 7);
    setWeekAnchor(isoDate(next));
  }

  function statusCellClass(status: keyof typeof statusCode) {
    return {
      working: "border-emerald-300 bg-emerald-100 text-emerald-900",
      approved: "border-blue-400 bg-blue-600 text-white",
      pending_supervisor: "border-amber-400 bg-amber-300 text-amber-950",
      pending_manager: "border-violet-400 bg-violet-600 text-white",
    }[status];
  }

  return (
    <div className="space-y-4">
      <section className="overflow-hidden border border-slate-700 bg-slate-950 text-white shadow-2xl">
        <div className="grid gap-0 xl:grid-cols-[1fr_auto]">
          <div className="border-b border-slate-700 p-5 xl:border-b-0 xl:border-r">
            <div className="flex items-start gap-4">
              <span className="grid h-12 w-12 place-items-center border border-slate-600 bg-slate-900 text-amber-400">
                <Factory size={24} />
              </span>
              <div>
                <p className="font-mono text-xs font-black uppercase tracking-[0.24em] text-amber-400">Factory manpower board</p>
                <h1 className="mt-1 text-2xl font-black uppercase tracking-tight sm:text-3xl">Leave & attendance planning</h1>
                <p className="mt-2 text-sm text-slate-400">Operational weekly view by department</p>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 p-4">
            <select value={department} onChange={(event) => setDepartment(event.target.value)} className="h-11 border border-slate-600 bg-slate-900 px-3 text-sm font-black uppercase text-white outline-none">
              <option value="all">{t.allDepartments}</option>
              {departments.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
            <button onClick={() => shiftWeek(-1)} className="grid h-11 w-11 place-items-center border border-slate-600 bg-slate-900 text-white hover:bg-slate-800"><ChevronLeft size={18} /></button>
            <input type="date" value={weekAnchor} onChange={(event) => setWeekAnchor(event.target.value)} className="h-11 border border-slate-600 bg-slate-900 px-3 text-sm font-bold text-white outline-none" />
            <button onClick={() => shiftWeek(1)} className="grid h-11 w-11 place-items-center border border-slate-600 bg-slate-900 text-white hover:bg-slate-800"><ChevronRight size={18} /></button>
          </div>
        </div>

        <div className="grid grid-cols-2 border-t border-slate-700 sm:grid-cols-4">
          <div className="border-r border-slate-700 p-4"><p className="font-mono text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">Employees shown</p><p className="mt-1 text-3xl font-black">{visibleEmployees.length}</p></div>
          <div className="border-r border-slate-700 p-4"><p className="font-mono text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">Departments</p><p className="mt-1 text-3xl font-black">{departmentEntries.length}</p></div>
          <div className="border-r border-slate-700 p-4"><p className="font-mono text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">Approved leave</p><p className="mt-1 text-3xl font-black text-sky-400">{approvedCount}</p></div>
          <div className="p-4"><p className="font-mono text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">Pending</p><p className="mt-1 text-3xl font-black text-amber-400">{pendingCount}</p></div>
        </div>
      </section>

      <section className="border border-slate-400 bg-white shadow-xl">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-slate-300 bg-slate-200 px-4 py-3 font-mono text-[11px] font-black uppercase tracking-[0.12em] text-slate-700">
          <span className="flex items-center gap-2"><span className="h-4 w-7 border border-emerald-300 bg-emerald-100" /> W — Working</span>
          <span className="flex items-center gap-2"><span className="h-4 w-7 border border-blue-400 bg-blue-600" /> AL — Approved leave</span>
          <span className="flex items-center gap-2"><span className="h-4 w-7 border border-amber-400 bg-amber-300" /> PS — Pending supervisor</span>
          <span className="flex items-center gap-2"><span className="h-4 w-7 border border-violet-400 bg-violet-600" /> PM — Pending manager</span>
          <span className="flex items-center gap-2"><span className="h-4 w-7 border border-slate-500 bg-slate-700" /> OFF — Sunday</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1180px] border-collapse text-sm">
            <thead>
              <tr className="bg-slate-900 text-white">
                <th className="sticky left-0 z-20 min-w-[300px] border-r border-slate-600 bg-slate-900 px-4 py-3 text-left font-mono text-xs font-black uppercase tracking-[0.12em]">Employee / Department</th>
                {weekDays.map((date) => {
                  const away = visibleEmployees.filter((employee) => requestStatusOnDate(employee.id, isoDate(date), requests) !== "working").length;
                  const isSaturday = date.getDay() === 6;
                  const isSunday = date.getDay() === 0;
                  return (
                    <th key={isoDate(date)} className={`min-w-[118px] border-r border-slate-700 px-2 py-3 text-center ${isSaturday ? "bg-amber-950" : isSunday ? "bg-slate-800" : ""}`}>
                      <p className="font-mono text-[11px] font-black uppercase tracking-[0.14em] text-slate-400">{new Intl.DateTimeFormat("en-GB", { weekday: "short" }).format(date)}</p>
                      <p className="mt-1 text-xl font-black">{new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short" }).format(date)}</p>
                      <p className="mt-1 font-mono text-[10px] font-black uppercase text-amber-400">{away} away</p>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {departmentEntries.map(([departmentName, departmentEmployees]) => (
                <Fragment key={departmentName}>
                  <tr className="bg-slate-300">
                    <td colSpan={8} className="border-y border-slate-500 px-4 py-2 font-mono text-xs font-black uppercase tracking-[0.16em] text-slate-900">
                      <div className="flex items-center justify-between">
                        <span>{departmentName}</span>
                        <span>{departmentEmployees.length} employees</span>
                      </div>
                    </td>
                  </tr>
                  {departmentEmployees.map((employee, employeeIndex) => (
                    <tr key={employee.id} className={employeeIndex % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                      <td className="sticky left-0 z-10 border-b border-r border-slate-300 bg-inherit px-4 py-3">
                        <div className="flex items-center gap-3">
                          <span className="grid h-9 w-9 shrink-0 place-items-center border border-slate-500 bg-slate-800 font-mono text-xs font-black text-white">{initials(employee)}</span>
                          <div className="min-w-0">
                            <p className="truncate font-black uppercase text-slate-950">{employeeName(employee)}</p>
                            <p className="font-mono text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500">{employee.employeeCode}</p>
                          </div>
                        </div>
                      </td>
                      {weekDays.map((date) => {
                        if (date.getDay() === 0) {
                          return <td key={isoDate(date)} className="border-b border-r border-slate-300 bg-slate-200 p-2 text-center"><span className="grid h-12 w-full place-items-center border border-slate-500 bg-slate-700 font-mono text-xs font-black text-white">OFF</span></td>;
                        }
                        const status = requestStatusOnDate(employee.id, isoDate(date), requests);
                        return <td key={isoDate(date)} className={`border-b border-r border-slate-300 p-2 text-center ${date.getDay() === 6 ? "bg-amber-50" : ""}`}><span className={`grid h-12 w-full place-items-center border-2 font-mono text-sm font-black tracking-[0.08em] ${statusCellClass(status)}`}>{statusCode[status]}</span></td>;
                      })}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

interface ApprovalDashboardProps {
  eyebrow: string;
  title: string;
  stats: Array<{ label: string; value: number; icon: LucideIcon }>;
  employees: Employee[];
  leaveRequests: LeaveRequest[];
  overtimeRequests: OvertimeRequest[];
  language: Language;
  t: (typeof copy)[Language];
}

function ApprovalDashboard({ eyebrow, title, stats, employees, leaveRequests, overtimeRequests, language, t }: ApprovalDashboardProps) {
  return (
    <div className="space-y-6">
      <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-soft sm:p-8">
        <SectionHeader eyebrow={eyebrow} title={title} icon={LayoutDashboard} />
        <div className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {stats.map(({ label, value, icon: Icon }) => (
            <article key={label} className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
              <div className="flex items-center justify-between"><span className="grid h-10 w-10 place-items-center rounded-2xl bg-white text-blue-600 shadow-sm"><Icon size={19} /></span><span className="text-3xl font-black tracking-tight text-slate-950">{value}</span></div>
              <p className="mt-5 text-sm font-bold text-slate-500">{label}</p>
            </article>
          ))}
        </div>
        <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-800">{t.secureApproval}</div>
      </section>

      <RequestTable title={t.annualLeaveTab} icon={CalendarDays} employees={employees} requests={leaveRequests} language={language} t={t} />
      <OvertimeTable title={t.overtimeTab} employees={employees} requests={overtimeRequests} language={language} t={t} />
    </div>
  );
}

function RequestTable({ title, icon, employees, requests, language, t }: { title: string; icon: LucideIcon; employees: Employee[]; requests: LeaveRequest[]; language: Language; t: (typeof copy)[Language] }) {
  return (
    <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-soft">
      <div className="border-b border-slate-100 p-6 sm:p-8"><SectionHeader eyebrow={t.pendingRequests} title={title} icon={icon} /></div>
      {requests.length === 0 ? <div className="p-8"><EmptyState text={t.noPending} /></div> : (
        <div className="overflow-x-auto"><table className="w-full min-w-[850px] border-collapse"><thead><tr className="bg-slate-50 text-left text-xs font-black uppercase tracking-[0.12em] text-slate-500"><th className="px-6 py-4">{t.employee}</th><th className="px-6 py-4">{t.department}</th><th className="px-6 py-4">{t.period}</th><th className="px-6 py-4">{t.days}</th><th className="px-6 py-4">{t.status}</th></tr></thead><tbody>
          {requests.map((request) => { const employee = employees.find((item) => item.id === request.employeeId); if (!employee) return null; return <tr key={request.id} className="border-t border-slate-100 hover:bg-slate-50/70"><td className="px-6 py-4"><EmployeeCell employee={employee} /></td><td className="px-6 py-4 text-sm font-semibold text-slate-600">{employee.department}</td><td className="px-6 py-4 text-sm font-semibold text-slate-600">{formatDate(request.startDate)} → {formatDate(request.endDate)}</td><td className="px-6 py-4 font-black text-slate-950">{request.days}</td><td className="px-6 py-4"><StatusBadge status={request.status} language={language} /></td></tr>; })}
        </tbody></table></div>
      )}
    </section>
  );
}

function OvertimeTable({ title, employees, requests, language, t }: { title: string; employees: Employee[]; requests: OvertimeRequest[]; language: Language; t: (typeof copy)[Language] }) {
  return (
    <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-soft">
      <div className="border-b border-slate-100 p-6 sm:p-8"><SectionHeader eyebrow={t.pendingRequests} title={title} icon={TimerReset} /></div>
      {requests.length === 0 ? <div className="p-8"><EmptyState text={t.noPending} /></div> : (
        <div className="overflow-x-auto"><table className="w-full min-w-[900px] border-collapse"><thead><tr className="bg-slate-50 text-left text-xs font-black uppercase tracking-[0.12em] text-slate-500"><th className="px-6 py-4">{t.employee}</th><th className="px-6 py-4">{t.department}</th><th className="px-6 py-4">{t.overtimeDate}</th><th className="px-6 py-4">{t.period}</th><th className="px-6 py-4">{t.hours}</th><th className="px-6 py-4">{t.status}</th></tr></thead><tbody>
          {requests.map((request) => { const employee = employees.find((item) => item.id === request.employeeId); if (!employee) return null; return <tr key={request.id} className="border-t border-slate-100 hover:bg-slate-50/70"><td className="px-6 py-4"><EmployeeCell employee={employee} /></td><td className="px-6 py-4 text-sm font-semibold text-slate-600">{employee.department}</td><td className="px-6 py-4 text-sm font-semibold text-slate-600">{formatDate(request.overtimeDate)}</td><td className="px-6 py-4 text-sm font-semibold text-slate-600">{request.startTime} → {request.endTime}</td><td className="px-6 py-4 font-black text-slate-950">{request.totalHours}</td><td className="px-6 py-4"><StatusBadge status={request.status} language={language} /></td></tr>; })}
        </tbody></table></div>
      )}
    </section>
  );
}

const inputClass = "w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3.5 font-semibold text-slate-900 transition focus:border-blue-400 focus:bg-white focus:outline-none focus:ring-4 focus:ring-blue-100";
const controlClass = "rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-700";
const squareButtonClass = "grid h-11 w-11 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:border-blue-300 hover:text-blue-600";

function LoadingScreen({ text }: { text: string }) {
  return <div className="grid min-h-screen place-items-center"><div className="text-center"><LoaderCircle className="mx-auto animate-spin text-blue-600" size={38} /><p className="mt-4 font-bold text-slate-600">{text}</p></div></div>;
}

function DatabaseErrorScreen({ title, error, retry, t }: { title: string; error: string; retry: () => Promise<void>; t: (typeof copy)[Language] }) {
  return <div className="grid min-h-screen place-items-center p-5"><div className="max-w-xl rounded-[28px] border border-red-200 bg-white p-8 shadow-soft"><h1 className="text-2xl font-black text-slate-950">{title}</h1><p className="mt-3 rounded-2xl bg-red-50 p-4 font-mono text-sm text-red-700">{error}</p><p className="mt-4 text-sm text-slate-600">Run <strong>supabase/04_kiosk_api.sql</strong> in the Supabase SQL Editor, then retry.</p><button onClick={() => void retry()} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-3 font-black text-white"><RefreshCw size={17} /> {t.retry}</button></div></div>;
}

function SectionHeader({ eyebrow, title, icon: Icon }: { eyebrow: string; title: string; icon: LucideIcon }) {
  return <div className="flex items-center gap-4"><span className="grid h-12 w-12 place-items-center rounded-2xl bg-blue-50 text-blue-600 ring-1 ring-blue-100"><Icon size={22} /></span><div><p className="text-xs font-black uppercase tracking-[0.16em] text-blue-600">{eyebrow}</p><h1 className="mt-1 text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">{title}</h1></div></div>;
}

function ModuleButton({ active, onClick, icon: Icon, children }: { active: boolean; onClick: () => void; icon: LucideIcon; children: React.ReactNode }) {
  return <button onClick={onClick} className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-black transition ${active ? "bg-blue-600 text-white" : "text-slate-500 hover:bg-slate-50 hover:text-slate-950"}`}><Icon size={17} />{children}</button>;
}

function InfoTile({ value, label }: { value: string; label: string }) {
  return <div className="rounded-2xl border border-white/20 bg-white/10 p-4 backdrop-blur"><p className="text-2xl font-black">{value}</p><p className="mt-1 text-xs leading-5 text-blue-100">{label}</p></div>;
}

function StatStrip({ label, value, accent = "text-slate-950" }: { label: string; value: string; accent?: string }) {
  return <div className="bg-white p-5 sm:p-6"><p className="text-sm font-bold text-slate-500">{label}</p><p className={`mt-2 text-2xl font-black tracking-tight ${accent}`}>{value}</p></div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-2 block text-sm font-black text-slate-700">{label}</span>{children}</label>;
}

function CalculationTile({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  return <div className="rounded-2xl bg-white p-4 ring-1 ring-blue-100"><p className="text-sm font-bold text-slate-500">{label}</p><p className={`mt-2 text-2xl font-black ${danger ? "text-red-600" : "text-slate-950"}`}>{value}</p></div>;
}

function InfoNote({ text }: { text: string }) {
  return <div className="flex items-start gap-3 rounded-2xl bg-slate-50 p-4 text-sm text-slate-600"><Clock3 className="mt-0.5 shrink-0 text-blue-600" size={18} /><p>{text}</p></div>;
}

function FormMessage({ message }: { message: { kind: "success" | "error"; text: string } | null }) {
  if (!message) return null;
  return <div className={`rounded-2xl px-4 py-3 text-sm font-bold ${message.kind === "success" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>{message.text}</div>;
}

function SubmitButton({ saving, label }: { saving: boolean; label: string }) {
  return <button disabled={saving} type="submit" className="inline-flex min-w-44 items-center justify-center gap-2 rounded-2xl bg-blue-600 px-5 py-3.5 font-black text-white shadow-lg shadow-blue-200 transition hover:bg-blue-700 disabled:cursor-wait disabled:opacity-60">{saving && <LoaderCircle className="animate-spin" size={18} />}{label}</button>;
}

function HistoryCard({ title, icon, emptyText, children }: { title: string; icon: LucideIcon; emptyText: string; children: React.ReactNode }) {
  const items = Array.isArray(children) ? children.filter(Boolean) : children;
  const isEmpty = Array.isArray(items) ? items.length === 0 : !items;
  return <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-soft sm:p-8"><SectionHeader eyebrow="History" title={title} icon={icon} /><div className="mt-7 space-y-3">{isEmpty ? <EmptyState text={emptyText} /> : items}</div></section>;
}

function StatusBadge({ status, language }: { status: RequestStatus; language: Language }) {
  return <span className={`inline-flex rounded-full px-3 py-1.5 text-xs font-black ring-1 ${statusStyles[status]}`}>{statusLabel(status, language)}</span>;
}

function LegendPill({ label, status }: { label: string; status: RequestStatus | "working" }) {
  return <span className={`inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs font-black ring-1 ${statusStyles[status]}`}><span className="h-2 w-2 rounded-full bg-current" />{label}</span>;
}

function EmployeeCell({ employee }: { employee: Employee }) {
  return <div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-slate-900 text-xs font-black text-white">{initials(employee)}</span><div><p className="font-black text-slate-950">{employeeName(employee)}</p><p className="text-xs text-slate-500">{employee.employeeCode}</p></div></div>;
}

function EmptyState({ text }: { text: string }) {
  return <div className="grid min-h-40 place-items-center rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-6 text-center"><div><span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-white text-slate-400 shadow-sm"><Clock3 size={22} /></span><p className="mt-3 font-bold text-slate-500">{text}</p></div></div>;
}
