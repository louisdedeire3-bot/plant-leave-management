"use client";

import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Factory,
  Languages,
  LayoutDashboard,
  Search,
  ShieldCheck,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { employees, initialRequests } from "@/lib/data";
import {
  calculateLeaveDays,
  formatDate,
  formatShortDate,
  isoDate,
  requestStatusOnDate,
  startOfWeek,
} from "@/lib/date";
import { copy } from "@/lib/i18n";
import type {
  Department,
  Employee,
  Language,
  LeaveRequest,
  LeaveStatus,
  RoleView,
} from "@/lib/types";

const STORAGE_KEY = "plant-leave-management:v1";

const viewOptions: Array<{ id: RoleView; icon: typeof UserRound }> = [
  { id: "employee", icon: UserRound },
  { id: "calendar", icon: CalendarDays },
  { id: "supervisor", icon: UsersRound },
  { id: "manager", icon: ShieldCheck },
];

const statusStyles: Record<LeaveStatus | "working", string> = {
  working: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  approved: "bg-blue-50 text-blue-700 ring-blue-200",
  pending_supervisor: "bg-amber-50 text-amber-700 ring-amber-200",
  pending_manager: "bg-violet-50 text-violet-700 ring-violet-200",
  rejected: "bg-red-50 text-red-700 ring-red-200",
};

const statusCode: Record<Exclude<LeaveStatus | "working", "rejected">, string> = {
  working: "W",
  approved: "AL",
  pending_supervisor: "PS",
  pending_manager: "PM",
};

function employeeName(employee: Employee) {
  return `${employee.firstName} ${employee.surname}`;
}

function initials(employee: Employee) {
  return `${employee.firstName[0] ?? ""}${employee.surname[0] ?? ""}`.toUpperCase();
}

function statusLabel(status: LeaveStatus, language: Language) {
  const t = copy[language];
  return {
    approved: t.approvedLeave,
    pending_supervisor: t.pendingSupervisor,
    pending_manager: t.pendingManager,
    rejected: t.rejected,
  }[status];
}

function isTodayWithin(request: LeaveRequest) {
  const today = isoDate(new Date());
  return request.status === "approved" && today >= request.startDate && today <= request.endDate;
}

export function LeaveManagementApp() {
  const [language, setLanguage] = useState<Language>("en");
  const [view, setView] = useState<RoleView>("employee");
  const [requests, setRequests] = useState<LeaveRequest[]>(initialRequests);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [comment, setComment] = useState("");
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [department, setDepartment] = useState<Department | "all">("all");
  const [weekAnchor, setWeekAnchor] = useState(isoDate(new Date()));
  const [loaded, setLoaded] = useState(false);

  const t = copy[language];

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) setRequests(JSON.parse(stored) as LeaveRequest[]);
    } catch {
      setRequests(initialRequests);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!loaded) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(requests));
  }, [loaded, requests]);

  const selectedEmployee = useMemo(
    () => employees.find((employee) => employee.id === selectedEmployeeId) ?? null,
    [selectedEmployeeId],
  );

  const searchResults = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return employees;

    return employees.filter((employee) =>
      [employee.id, employee.firstName, employee.surname, employee.nickname, employeeName(employee)]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [searchQuery]);

  const requestedDays = useMemo(
    () => Math.max(0, calculateLeaveDays(startDate, endDate)),
    [startDate, endDate],
  );

  const employeeRequests = useMemo(
    () =>
      requests
        .filter((request) => request.employeeId === selectedEmployeeId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [requests, selectedEmployeeId],
  );

  const productionEmployees = employees.filter((employee) => employee.department === "Production");
  const supervisorPending = requests.filter((request) => {
    const employee = employees.find((item) => item.id === request.employeeId);
    return employee?.department === "Production" && request.status === "pending_supervisor";
  });
  const managerPending = requests.filter((request) => request.status === "pending_manager");
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
    setStartDate("");
    setEndDate("");
    setComment("");
  }

  function submitRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedEmployee) return;

    const days = calculateLeaveDays(startDate, endDate);
    if (days <= 0) {
      setMessage({ kind: "error", text: t.invalidDates });
      return;
    }

    if (days > selectedEmployee.balance) {
      setMessage({ kind: "error", text: t.insufficientBalance });
      return;
    }

    const nextRequest: LeaveRequest = {
      id: `REQ-${Date.now()}`,
      employeeId: selectedEmployee.id,
      startDate,
      endDate,
      days,
      comment: comment.trim(),
      status: "pending_supervisor",
      createdAt: new Date().toISOString(),
    };

    setRequests((current) => [nextRequest, ...current]);
    setStartDate("");
    setEndDate("");
    setComment("");
    setMessage({ kind: "success", text: t.submitted });
  }

  function updateRequest(id: string, status: LeaveStatus) {
    setRequests((current) =>
      current.map((request) => (request.id === id ? { ...request, status } : request)),
    );
  }

  function resetDemo() {
    setRequests(initialRequests);
    setSelectedEmployeeId(null);
    setMessage(null);
    window.localStorage.removeItem(STORAGE_KEY);
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
            <label className="hidden items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 md:flex">
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

            <button
              onClick={resetDemo}
              className="hidden rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-600 transition hover:border-slate-300 hover:text-slate-950 lg:block"
            >
              {t.resetDemo}
            </button>
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
            <p className="text-xs font-semibold text-slate-400">Demo database</p>
            <p className="mt-1 text-2xl font-black">{employees.length}</p>
            <p className="text-xs text-slate-500">employees loaded</p>
          </div>
        </aside>

        <main className="min-w-0">
          {view === "employee" && (
            <EmployeeView
              language={language}
              t={t}
              selectedEmployee={selectedEmployee}
              searchQuery={searchQuery}
              searchResults={searchResults}
              setSearchQuery={setSearchQuery}
              selectEmployee={selectEmployee}
              clearEmployee={() => setSelectedEmployeeId(null)}
              startDate={startDate}
              endDate={endDate}
              comment={comment}
              setStartDate={setStartDate}
              setEndDate={setEndDate}
              setComment={setComment}
              requestedDays={requestedDays}
              submitRequest={submitRequest}
              message={message}
              employeeRequests={employeeRequests}
            />
          )}

          {view === "calendar" && (
            <CalendarView
              t={t}
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
              title="Production Department"
              stats={[
                { label: t.teamSize, value: productionEmployees.length, icon: UsersRound },
                {
                  label: t.onLeaveToday,
                  value: onLeaveToday.filter((request) =>
                    productionEmployees.some((employee) => employee.id === request.employeeId),
                  ).length,
                  icon: CalendarDays,
                },
                { label: t.pendingRequests, value: supervisorPending.length, icon: Clock3 },
              ]}
              requests={supervisorPending}
              language={language}
              t={t}
              onApprove={(id) => updateRequest(id, "pending_manager")}
              onReject={(id) => updateRequest(id, "rejected")}
            />
          )}

          {view === "manager" && (
            <ApprovalDashboard
              eyebrow={t.finalApproval}
              title="Plant overview"
              stats={[
                { label: t.totalEmployees, value: employees.length, icon: UsersRound },
                { label: t.onLeaveToday, value: onLeaveToday.length, icon: CalendarDays },
                { label: t.pendingManager, value: managerPending.length, icon: Clock3 },
                { label: t.approvedThisMonth, value: approvedThisMonth.length, icon: Check },
              ]}
              requests={managerPending}
              language={language}
              t={t}
              onApprove={(id) => updateRequest(id, "approved")}
              onReject={(id) => updateRequest(id, "rejected")}
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
  selectedEmployee: Employee | null;
  searchQuery: string;
  searchResults: Employee[];
  setSearchQuery: (value: string) => void;
  selectEmployee: (id: string) => void;
  clearEmployee: () => void;
  startDate: string;
  endDate: string;
  comment: string;
  setStartDate: (value: string) => void;
  setEndDate: (value: string) => void;
  setComment: (value: string) => void;
  requestedDays: number;
  submitRequest: (event: FormEvent<HTMLFormElement>) => void;
  message: { kind: "success" | "error"; text: string } | null;
  employeeRequests: LeaveRequest[];
}

function EmployeeView({
  language,
  t,
  selectedEmployee,
  searchQuery,
  searchResults,
  setSearchQuery,
  selectEmployee,
  clearEmployee,
  startDate,
  endDate,
  comment,
  setStartDate,
  setEndDate,
  setComment,
  requestedDays,
  submitRequest,
  message,
  employeeRequests,
}: EmployeeViewProps) {
  if (!selectedEmployee) {
    return (
      <div className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-soft">
        <div className="grid min-h-[680px] lg:grid-cols-[0.9fr_1.1fr]">
          <section className="relative overflow-hidden bg-gradient-to-br from-blue-700 via-blue-600 to-sky-500 p-8 text-white sm:p-12">
            <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full border border-white/15" />
            <div className="absolute -right-8 -top-8 h-40 w-40 rounded-full border border-white/15" />
            <div className="relative flex h-full flex-col justify-between">
              <div>
                <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.16em]">
                  <LayoutDashboard size={14} /> Employee portal
                </span>
                <h1 className="mt-8 max-w-md text-4xl font-black tracking-tight sm:text-5xl">{t.welcome}</h1>
                <p className="mt-4 max-w-md text-lg leading-8 text-blue-100">{t.employeeIntro}</p>
              </div>

              <div className="mt-12 grid grid-cols-2 gap-3">
                <InfoTile value="2" label="leave days earned monthly" />
                <InfoTile value="2-step" label="approval workflow" />
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
                  {searchResults.length} results
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
                        {employeeName(employee)} <span className="font-semibold text-slate-400">({employee.nickname})</span>
                      </span>
                      <span className="mt-1 block truncate text-sm text-slate-500">
                        {employee.id} · {employee.department}
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
              <p className="text-sm font-bold text-blue-600">{selectedEmployee.id} · {selectedEmployee.department}</p>
              <h1 className="mt-1 text-2xl font-black tracking-tight sm:text-3xl">
                {employeeName(selectedEmployee)}
                <span className="ml-2 text-lg font-semibold text-slate-400">({selectedEmployee.nickname})</span>
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

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-soft sm:p-8">
          <SectionHeader eyebrow="Annual leave" title={t.requestLeave} icon={CalendarDays} />

          <form onSubmit={submitRequest} className="mt-7 space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t.startDate}>
                <input
                  required
                  type="date"
                  value={startDate}
                  onChange={(event) => setStartDate(event.target.value)}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3.5 font-semibold text-slate-900 transition focus:border-blue-400 focus:bg-white focus:outline-none focus:ring-4 focus:ring-blue-100"
                />
              </Field>
              <Field label={t.endDate}>
                <input
                  required
                  type="date"
                  value={endDate}
                  onChange={(event) => setEndDate(event.target.value)}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3.5 font-semibold text-slate-900 transition focus:border-blue-400 focus:bg-white focus:outline-none focus:ring-4 focus:ring-blue-100"
                />
              </Field>
            </div>

            <Field label={t.comment}>
              <textarea
                rows={4}
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                placeholder={t.commentPlaceholder}
                className="w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-slate-900 transition focus:border-blue-400 focus:bg-white focus:outline-none focus:ring-4 focus:ring-blue-100"
              />
            </Field>

            <div className="grid gap-3 rounded-3xl border border-blue-100 bg-blue-50/70 p-4 sm:grid-cols-2">
              <CalculationTile label={t.requestedDays} value={`${requestedDays} ${t.days}`} />
              <CalculationTile
                label={t.balanceAfter}
                value={`${balanceAfter} ${t.days}`}
                danger={balanceAfter < 0}
              />
            </div>

            <div className="flex items-start gap-3 rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">
              <Clock3 className="mt-0.5 shrink-0 text-blue-600" size={18} />
              <p>{t.leaveRule}</p>
            </div>

            {message && (
              <div
                className={`rounded-2xl px-4 py-3 text-sm font-bold ${
                  message.kind === "success"
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-red-50 text-red-700"
                }`}
              >
                {message.text}
              </div>
            )}

            <button className="flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 px-5 py-4 font-black text-white shadow-lg shadow-blue-500/25 transition hover:-translate-y-0.5 hover:bg-blue-700">
              <CalendarDays size={19} />
              {t.submitRequest}
            </button>
          </form>
        </section>

        <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-soft sm:p-8">
          <SectionHeader eyebrow="History" title={t.myRequests} icon={Clock3} />
          <div className="mt-7 space-y-3">
            {employeeRequests.length === 0 ? (
              <EmptyState text={t.noRequests} />
            ) : (
              employeeRequests.map((request) => (
                <article key={request.id} className="rounded-2xl border border-slate-200 p-4 transition hover:border-slate-300">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-black text-slate-950">
                        {formatDate(request.startDate)} → {formatDate(request.endDate)}
                      </p>
                      <p className="mt-1 text-sm text-slate-500">
                        {request.days} {t.days}{request.comment ? ` · ${request.comment}` : ""}
                      </p>
                    </div>
                    <StatusBadge status={request.status} language={language} />
                  </div>
                </article>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

interface CalendarViewProps {
  t: (typeof copy)[Language];
  requests: LeaveRequest[];
  department: Department | "all";
  setDepartment: (value: Department | "all") => void;
  weekAnchor: string;
  setWeekAnchor: (value: string) => void;
}

function CalendarView({
  t,
  requests,
  department,
  setDepartment,
  weekAnchor,
  setWeekAnchor,
}: CalendarViewProps) {
  const monday = startOfWeek(new Date(`${weekAnchor}T00:00:00`));
  const weekDays = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + index);
    return date;
  });

  const departments = Array.from(new Set(employees.map((employee) => employee.department)));
  const visibleEmployees = employees.filter(
    (employee) => department === "all" || employee.department === department,
  );

  function moveWeek(direction: number) {
    const next = new Date(monday);
    next.setDate(next.getDate() + direction * 7);
    setWeekAnchor(isoDate(next));
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-soft sm:p-8">
        <div className="flex flex-col justify-between gap-5 xl:flex-row xl:items-end">
          <SectionHeader eyebrow="Plant availability" title={t.leaveCalendar} icon={CalendarDays} />
          <div className="flex flex-col gap-3 sm:flex-row">
            <select
              value={department}
              onChange={(event) => setDepartment(event.target.value as Department | "all")}
              className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
            >
              <option value="all">{t.allDepartments}</option>
              {departments.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
            <div className="flex items-center rounded-2xl border border-slate-200 bg-slate-50 p-1">
              <button onClick={() => moveWeek(-1)} className="rounded-xl p-2.5 text-slate-500 hover:bg-white hover:text-slate-950">
                <ChevronLeft size={18} />
              </button>
              <input
                type="date"
                value={weekAnchor}
                onChange={(event) => setWeekAnchor(event.target.value)}
                className="min-w-0 border-0 bg-transparent px-2 text-sm font-bold text-slate-700 outline-none"
              />
              <button onClick={() => moveWeek(1)} className="rounded-xl p-2.5 text-slate-500 hover:bg-white hover:text-slate-950">
                <ChevronRight size={18} />
              </button>
            </div>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          <LegendPill label={t.working} status="working" />
          <LegendPill label={t.approvedLeave} status="approved" />
          <LegendPill label={t.pendingSupervisor} status="pending_supervisor" />
          <LegendPill label={t.pendingManager} status="pending_manager" />
        </div>
      </section>

      <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-soft">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] border-collapse">
            <thead>
              <tr className="bg-slate-50">
                <th className="sticky left-0 z-10 min-w-64 border-b border-r border-slate-200 bg-slate-50 px-5 py-4 text-left text-xs font-black uppercase tracking-[0.14em] text-slate-500">
                  {t.employee}
                </th>
                {weekDays.map((date) => (
                  <th key={isoDate(date)} className="min-w-24 border-b border-slate-200 px-4 py-4 text-center text-xs font-black uppercase tracking-[0.12em] text-slate-500">
                    {formatShortDate(date)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleEmployees.map((employee) => (
                <tr key={employee.id} className="group hover:bg-slate-50/60">
                  <td className="sticky left-0 z-10 border-b border-r border-slate-100 bg-white px-5 py-4 group-hover:bg-slate-50">
                    <div className="flex items-center gap-3">
                      <span className="grid h-10 w-10 place-items-center rounded-xl bg-slate-900 text-xs font-black text-white">
                        {initials(employee)}
                      </span>
                      <div>
                        <p className="font-black text-slate-950">{employeeName(employee)}</p>
                        <p className="text-xs text-slate-500">{employee.department}</p>
                      </div>
                    </div>
                  </td>
                  {weekDays.map((date) => {
                    if (date.getDay() === 0) {
                      return (
                        <td key={isoDate(date)} className="border-b border-slate-100 px-3 py-4 text-center">
                          <span className="inline-grid h-10 w-14 place-items-center rounded-xl bg-slate-100 text-sm font-black text-slate-400">—</span>
                        </td>
                      );
                    }

                    const status = requestStatusOnDate(employee.id, isoDate(date), requests);
                    return (
                      <td key={isoDate(date)} className="border-b border-slate-100 px-3 py-4 text-center">
                        <span className={`inline-grid h-10 w-14 place-items-center rounded-xl text-sm font-black ring-1 ${statusStyles[status]}`}>
                          {statusCode[status as Exclude<typeof status, "rejected">]}
                        </span>
                      </td>
                    );
                  })}
                </tr>
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
  stats: Array<{ label: string; value: number; icon: typeof UsersRound }>;
  requests: LeaveRequest[];
  language: Language;
  t: (typeof copy)[Language];
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}

function ApprovalDashboard({
  eyebrow,
  title,
  stats,
  requests,
  language,
  t,
  onApprove,
  onReject,
}: ApprovalDashboardProps) {
  return (
    <div className="space-y-6">
      <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-soft sm:p-8">
        <SectionHeader eyebrow={eyebrow} title={title} icon={LayoutDashboard} />
        <div className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {stats.map(({ label, value, icon: Icon }) => (
            <article key={label} className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
              <div className="flex items-center justify-between">
                <span className="grid h-10 w-10 place-items-center rounded-2xl bg-white text-blue-600 shadow-sm">
                  <Icon size={19} />
                </span>
                <span className="text-3xl font-black tracking-tight text-slate-950">{value}</span>
              </div>
              <p className="mt-5 text-sm font-bold text-slate-500">{label}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-soft">
        <div className="border-b border-slate-100 p-6 sm:p-8">
          <SectionHeader eyebrow={eyebrow} title={t.pendingRequests} icon={Clock3} />
        </div>

        {requests.length === 0 ? (
          <div className="p-8">
            <EmptyState text={t.noPending} />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] border-collapse">
              <thead>
                <tr className="bg-slate-50 text-left text-xs font-black uppercase tracking-[0.12em] text-slate-500">
                  <th className="px-6 py-4">{t.employee}</th>
                  <th className="px-6 py-4">{t.department}</th>
                  <th className="px-6 py-4">{t.period}</th>
                  <th className="px-6 py-4">{t.days}</th>
                  <th className="px-6 py-4">{t.status}</th>
                  <th className="px-6 py-4 text-right">{t.action}</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((request) => {
                  const employee = employees.find((item) => item.id === request.employeeId);
                  if (!employee) return null;

                  return (
                    <tr key={request.id} className="border-t border-slate-100 hover:bg-slate-50/70">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <span className="grid h-10 w-10 place-items-center rounded-xl bg-slate-900 text-xs font-black text-white">
                            {initials(employee)}
                          </span>
                          <div>
                            <p className="font-black text-slate-950">{employeeName(employee)}</p>
                            <p className="text-xs text-slate-500">{employee.id}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm font-semibold text-slate-600">{employee.department}</td>
                      <td className="px-6 py-4 text-sm font-semibold text-slate-600">
                        {formatDate(request.startDate)} → {formatDate(request.endDate)}
                      </td>
                      <td className="px-6 py-4 font-black text-slate-950">{request.days}</td>
                      <td className="px-6 py-4">
                        <StatusBadge status={request.status} language={language} />
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => onApprove(request.id)}
                            className="inline-flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-sm font-black text-emerald-700 ring-1 ring-emerald-200 transition hover:bg-emerald-100"
                          >
                            <Check size={16} /> {t.approve}
                          </button>
                          <button
                            onClick={() => onReject(request.id)}
                            className="inline-flex items-center gap-2 rounded-xl bg-red-50 px-3 py-2 text-sm font-black text-red-700 ring-1 ring-red-200 transition hover:bg-red-100"
                          >
                            <X size={16} /> {t.reject}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function SectionHeader({
  eyebrow,
  title,
  icon: Icon,
}: {
  eyebrow: string;
  title: string;
  icon: typeof CalendarDays;
}) {
  return (
    <div className="flex items-center gap-4">
      <span className="grid h-12 w-12 place-items-center rounded-2xl bg-blue-50 text-blue-600 ring-1 ring-blue-100">
        <Icon size={22} />
      </span>
      <div>
        <p className="text-xs font-black uppercase tracking-[0.16em] text-blue-600">{eyebrow}</p>
        <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">{title}</h1>
      </div>
    </div>
  );
}

function InfoTile({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-2xl border border-white/20 bg-white/10 p-4 backdrop-blur">
      <p className="text-2xl font-black">{value}</p>
      <p className="mt-1 text-xs leading-5 text-blue-100">{label}</p>
    </div>
  );
}

function StatStrip({ label, value, accent = "text-slate-950" }: { label: string; value: string; accent?: string }) {
  return (
    <div className="bg-white p-5 sm:p-6">
      <p className="text-sm font-bold text-slate-500">{label}</p>
      <p className={`mt-2 text-2xl font-black tracking-tight ${accent}`}>{value}</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-black text-slate-700">{label}</span>
      {children}
    </label>
  );
}

function CalculationTile({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="rounded-2xl bg-white p-4 ring-1 ring-blue-100">
      <p className="text-sm font-bold text-slate-500">{label}</p>
      <p className={`mt-2 text-2xl font-black ${danger ? "text-red-600" : "text-slate-950"}`}>{value}</p>
    </div>
  );
}

function StatusBadge({ status, language }: { status: LeaveStatus; language: Language }) {
  return (
    <span className={`inline-flex rounded-full px-3 py-1.5 text-xs font-black ring-1 ${statusStyles[status]}`}>
      {statusLabel(status, language)}
    </span>
  );
}

function LegendPill({ label, status }: { label: string; status: LeaveStatus | "working" }) {
  return (
    <span className={`inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs font-black ring-1 ${statusStyles[status]}`}>
      <span className="h-2 w-2 rounded-full bg-current" />
      {label}
    </span>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="grid min-h-40 place-items-center rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-6 text-center">
      <div>
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-white text-slate-400 shadow-sm">
          <Clock3 size={22} />
        </span>
        <p className="mt-3 font-bold text-slate-500">{text}</p>
      </div>
    </div>
  );
}
