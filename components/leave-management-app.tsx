"use client";

import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Eye,
  EyeOff,
  Factory,
  KeyRound,
  Languages,
  LayoutDashboard,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  RefreshCw,
  ShieldCheck,
  TimerReset,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Fragment, FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  calculateLeaveDays,
  calculateOvertimeHours,
  formatDate,
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

type PortalRole = "employee" | "supervisor" | "manager";
type ManpowerStatus = "GREEN" | "ORANGE" | "RED" | "NOT_ASSESSED";
type CalendarScale = "day" | "week" | "month";
type Decision = "approve" | "reject";

interface PortalProfile {
  accountId: string;
  loginId: string;
  employeeId: string | null;
  displayName: string;
  role: PortalRole;
  department: string;
  expiresAt: string;
}

interface LoginRow {
  session_token: string;
  account_id: string;
  login_id: string;
  employee_id: string | null;
  display_name: string;
  account_role: string;
  department: string;
  expires_at: string;
}

interface ProfileRow {
  account_id: string;
  login_id: string;
  employee_id: string | null;
  display_name: string;
  account_role: string;
  department: string;
  expires_at: string;
}

interface EmployeeRow {
  id: string;
  employee_code: string;
  first_name: string;
  surname: string;
  nickname: string | null;
  department: string | null;
  position_title: string | null;
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
  leave_type?: string | null;
  manpower_status?: ManpowerStatus | null;
  manpower_details?: any;
  assessed_at?: string | null;
}

type LeaveWithManpower = LeaveRequest & {
  leaveType: string;
  manpowerStatus: ManpowerStatus;
  manpowerDetails: any;
  assessedAt: string | null;
};

interface FactoryModeRow {
  low_season_mode: boolean;
  active_mode: "LOW" | "HIGH";
  updated_at: string;
}

type AbsenceClassification = "UNJUSTIFIED" | "SICK" | "ANNUAL" | "COMPASSIONATE";

interface AbsenceRow {
  id: string;
  employee_id: string;
  employee_code: string;
  employee_name: string;
  department: string;
  absence_date: string;
  classification: AbsenceClassification;
  manager_comment: string | null;
  created_at: string;
  updated_at: string;
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

const authCopy = {
  en: {
    securePortal: "Secure employee portal",
    loginTitle: "Identify yourself",
    loginText: "Enter your Employee ID and your confidential 5-character access code.",
    loginId: "Employee ID / account",
    code: "Access code",
    signIn: "Sign in",
    invalidLogin: "Invalid ID or access code. The account locks for 15 minutes after 5 failed attempts.",
    confidential: "Your balance, leave and overtime are visible only after login.",
    logout: "Log out",
    sessionExpired: "Your session expired. Please sign in again.",
    day: "Day",
    week: "Week",
    month: "Month",
    approve: "Approve",
    reject: "Reject",
    rejectionReason: "Reason for rejection",
    decisionSaved: "Decision saved.",
    actions: "Actions",
    autoLogout: "Automatic logout protects the shared factory computer.",
  },
  oshi: {
    securePortal: "Oshipangelo shomunambelewa sha amenwa",
    loginTitle: "Nyola omauyelele goye",
    loginText: "Nyola Employee ID nokode yoye yomauyelele 5.",
    loginId: "Employee ID / account",
    code: "Access code",
    signIn: "Tameka",
    invalidLogin: "Employee ID ile access code inayi puka. Account otayi lockwa konima yomatateko 5.",
    confidential: "Balance, leave no overtime yoye otayi monika ashike konima yologin.",
    logout: "Pitika mo",
    sessionExpired: "Session yoye ya pwa. Login vali.",
    day: "Efiku",
    week: "Oshivike",
    month: "Omwedhi",
    approve: "Pititha",
    reject: "Tinda",
    rejectionReason: "Omolwa shike wa tinda",
    decisionSaved: "Epitiko lya tulwa mo.",
    actions: "Omalongitho",
    autoLogout: "App otayi logout yo yene oku amena ocomputer yofactory.",
  },
} satisfies Record<Language, Record<string, string>>;

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

function normalizeRole(value: string): PortalRole {
  if (value === "supervisor" || value === "manager") return value;
  return "employee";
}

function mapProfile(row: ProfileRow | LoginRow): PortalProfile {
  return {
    accountId: row.account_id,
    loginId: row.login_id,
    employeeId: row.employee_id,
    displayName: row.display_name,
    role: normalizeRole(row.account_role),
    department: row.department,
    expiresAt: row.expires_at,
  };
}

function mapEmployee(row: EmployeeRow): Employee {
  return {
    id: row.id,
    employeeCode: row.employee_code,
    firstName: row.first_name,
    surname: row.surname,
    nickname: row.nickname ?? "",
    department: row.department ?? "Unassigned",
    positionTitle: row.position_title ?? "Not assigned",
    supervisor: row.supervisor ?? "Not assigned",
    manager: row.manager ?? "Not assigned",
    earned: asNumber(row.earned),
    used: asNumber(row.used),
    balance: asNumber(row.balance),
  };
}

function mapLeave(row: LeaveRow): LeaveWithManpower {
  return {
    id: row.id,
    employeeId: row.employee_id,
    startDate: row.start_date,
    endDate: row.end_date,
    days: asNumber(row.requested_days),
    comment: row.comment ?? "",
    status: normalizeStatus(row.status),
    createdAt: row.created_at,
    leaveType: row.leave_type ?? "ANNUAL",
    manpowerStatus: row.manpower_status ?? "NOT_ASSESSED",
    manpowerDetails: row.manpower_details ?? null,
    assessedAt: row.assessed_at ?? null,
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

function viewOptionsFor(profile: PortalProfile): Array<{ id: RoleView; icon: LucideIcon }> {
  if (profile.role === "employee") return [{ id: "employee", icon: UserRound }];
  if (profile.role === "supervisor") {
    const options: Array<{ id: RoleView; icon: LucideIcon }> = [
      { id: "supervisor", icon: UsersRound },
      { id: "calendar", icon: CalendarDays },
    ];
    if (profile.employeeId) options.unshift({ id: "employee", icon: UserRound });
    return options;
  }
  return [
    { id: "manager", icon: ShieldCheck },
    { id: "calendar", icon: CalendarDays },
  ];
}

export function LeaveManagementApp() {
  const [language, setLanguage] = useState<Language>("en");
  const [profile, setProfile] = useState<PortalProfile | null>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [view, setView] = useState<RoleView>("employee");
  const [module, setModule] = useState<EmployeeModule>("leave");
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [requests, setRequests] = useState<LeaveWithManpower[]>([]);
  const [factoryMode, setFactoryMode] = useState<FactoryModeRow | null>(null);
  const [absences, setAbsences] = useState<AbsenceRow[]>([]);
  const [absenceEmployeeId, setAbsenceEmployeeId] = useState("");
  const [absenceDate, setAbsenceDate] = useState(isoDate(new Date()));
  const [absenceBusy, setAbsenceBusy] = useState<string | null>(null);
  const [overtimeRequests, setOvertimeRequests] = useState<OvertimeRequest[]>([]);
  const [department, setDepartment] = useState("all");
  const [calendarAnchor, setCalendarAnchor] = useState(isoDate(new Date()));
  const [booting, setBooting] = useState(true);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingRequestId, setSavingRequestId] = useState<string | null>(null);
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
  const a = authCopy[language];

  const clearSession = useCallback(() => {
    sessionStorage.removeItem("plant_portal_token");
    setSessionToken(null);
    setProfile(null);
    setEmployees([]);
    setRequests([]);
    setOvertimeRequests([]);
    setMessage(null);
    setDatabaseError(null);
    setView("employee");
  }, []);

  const loadData = useCallback(
    async (token: string) => {
      if (!supabase) throw new Error("Missing Supabase environment variables in Vercel.");
      setLoading(true);
      setDatabaseError(null);
      try {
        const [employeeResult, leaveResult, overtimeResult, factoryResult, absenceResult] = await Promise.all([
          supabase.rpc("portal_employees_v2", { p_token: token }),
          supabase.rpc("portal_leave_requests", { p_token: token }),
          supabase.rpc("portal_overtime_requests", { p_token: token }),
          supabase.rpc("portal_factory_mode", { p_token: token }),
          supabase.rpc("portal_absences", {
            p_token: token,
            p_date_from: isoDate(new Date(new Date().getFullYear(), new Date().getMonth(), 1)),
            p_date_to: isoDate(new Date(new Date().getFullYear(), new Date().getMonth() + 2, 0)),
          }),
        ]);
        if (employeeResult.error) throw employeeResult.error;
        if (leaveResult.error) throw leaveResult.error;
        if (overtimeResult.error) throw overtimeResult.error;
        setEmployees(((employeeResult.data ?? []) as EmployeeRow[]).map(mapEmployee));
        setRequests(((leaveResult.data ?? []) as LeaveRow[]).map(mapLeave));
        setOvertimeRequests(((overtimeResult.data ?? []) as OvertimeRow[]).map(mapOvertime));
        if (!factoryResult.error) setFactoryMode((((factoryResult.data ?? []) as FactoryModeRow[])[0]) ?? null);
        if (!absenceResult.error) setAbsences((absenceResult.data ?? []) as AbsenceRow[]);
      } catch (error) {
        const text = errorText(error);
        if (text.toLowerCase().includes("session") || text.toLowerCase().includes("token")) {
          clearSession();
        } else {
          setDatabaseError(text);
        }
      } finally {
        setLoading(false);
      }
    },
    [clearSession, supabase],
  );

  useEffect(() => {
    async function restoreSession() {
      const token = sessionStorage.getItem("plant_portal_token");
      if (!token || !supabase) {
        setBooting(false);
        return;
      }
      try {
        const { data, error } = await supabase.rpc("portal_me", { p_token: token });
        if (error) throw error;
        const row = ((data ?? []) as ProfileRow[])[0];
        if (!row) {
          clearSession();
          return;
        }
        const restored = mapProfile(row);
        setSessionToken(token);
        setProfile(restored);
        setView(restored.role === "employee" ? "employee" : restored.role === "supervisor" ? "supervisor" : "manager");
        await loadData(token);
      } catch {
        clearSession();
      } finally {
        setBooting(false);
      }
    }
    void restoreSession();
  }, [clearSession, loadData, supabase]);

  useEffect(() => {
    if (!sessionToken || !profile) return;
    const inactivityMs = profile.role === "employee" ? 5 * 60 * 1000 : 30 * 60 * 1000;
    let timer: ReturnType<typeof setTimeout>;
    const expire = () => clearSession();
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(expire, inactivityMs);
    };
    const events: Array<keyof WindowEventMap> = ["click", "keydown", "mousemove", "touchstart"];
    events.forEach((event) => window.addEventListener(event, reset, { passive: true }));
    reset();
    return () => {
      clearTimeout(timer);
      events.forEach((event) => window.removeEventListener(event, reset));
    };
  }, [clearSession, profile, sessionToken]);

  const currentEmployee = useMemo(
    () => employees.find((employee) => employee.id === profile?.employeeId) ?? null,
    [employees, profile?.employeeId],
  );

  const employeeRequests = useMemo(
    () => requests.filter((request) => request.employeeId === profile?.employeeId),
    [profile?.employeeId, requests],
  );

  const employeeOvertime = useMemo(
    () => overtimeRequests.filter((request) => request.employeeId === profile?.employeeId),
    [overtimeRequests, profile?.employeeId],
  );

  const requestedDays = useMemo(
    () => Math.max(0, calculateLeaveDays(startDate, endDate)),
    [startDate, endDate],
  );

  const calculatedOvertime = useMemo(
    () => calculateOvertimeHours(overtimeStart, overtimeEnd, breakMinutes),
    [breakMinutes, overtimeEnd, overtimeStart],
  );

  const supervisorLeavePending = requests.filter((request) => request.status === "pending_supervisor");
  const supervisorOvertimePending = overtimeRequests.filter((request) => request.status === "pending_supervisor");
  const managerLeavePending = requests.filter((request) => request.status === "pending_manager");
  const managerOvertimePending = overtimeRequests.filter((request) => request.status === "pending_manager");
  const onLeaveToday = requests.filter(isTodayWithin);
  const approvedThisMonth = requests.filter((request) => {
    const date = new Date(`${request.startDate}T00:00:00`);
    const now = new Date();
    return request.status === "approved" && date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
  });

  async function login(loginId: string, accessCode: string): Promise<string | null> {
    if (!supabase) return "Missing Supabase environment variables in Vercel.";
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc("portal_login", {
        p_login_id: loginId.trim().toUpperCase(),
        p_access_code: accessCode.trim().toUpperCase(),
      });
      if (error) throw error;
      const row = ((data ?? []) as LoginRow[])[0];
      if (!row) return a.invalidLogin;
      const nextProfile = mapProfile(row);
      sessionStorage.setItem("plant_portal_token", row.session_token);
      setSessionToken(row.session_token);
      setProfile(nextProfile);
      setView(nextProfile.role === "employee" ? "employee" : nextProfile.role === "supervisor" ? "supervisor" : "manager");
      await loadData(row.session_token);
      return null;
    } catch (error) {
      return errorText(error);
    } finally {
      setLoading(false);
    }
  }

  async function logout() {
    const token = sessionToken;
    clearSession();
    if (token && supabase) await supabase.rpc("portal_logout", { p_token: token });
  }

  async function submitLeave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!sessionToken || !supabase || !currentEmployee) return;
    const days = calculateLeaveDays(startDate, endDate);
    if (days <= 0) {
      setMessage({ kind: "error", text: t.invalidDates });
      return;
    }
    if (days > currentEmployee.balance) {
      setMessage({ kind: "error", text: t.insufficientBalance });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const { error } = await supabase.rpc("portal_submit_leave", {
        p_token: sessionToken,
        p_start_date: startDate,
        p_end_date: endDate,
        p_comment: comment.trim() || null,
      });
      if (error) throw error;
      setStartDate("");
      setEndDate("");
      setComment("");
      setMessage({ kind: "success", text: t.submitted });
      await loadData(sessionToken);
    } catch (error) {
      setMessage({ kind: "error", text: errorText(error) });
    } finally {
      setSaving(false);
    }
  }

  async function submitOvertime(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!sessionToken || !supabase || !currentEmployee) return;
    if (!overtimeDate || calculatedOvertime <= 0) {
      setMessage({ kind: "error", text: t.invalidOvertime });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const { error } = await supabase.rpc("portal_submit_overtime", {
        p_token: sessionToken,
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
      await loadData(sessionToken);
    } catch (error) {
      setMessage({ kind: "error", text: errorText(error) });
    } finally {
      setSaving(false);
    }
  }

  async function reassessLeave(requestId: string) {
    if (!sessionToken || !supabase) return;
    setSavingRequestId(requestId);
    try {
      const { error } = await supabase.rpc("portal_assess_leave", { p_token: sessionToken, p_request_id: requestId });
      if (error) throw error;
      await loadData(sessionToken);
    } catch (error) { setMessage({ kind: "error", text: errorText(error) }); }
    finally { setSavingRequestId(null); }
  }

  async function toggleLowSeason(enabled: boolean) {
    if (!sessionToken || !supabase) return;
    try {
      const { error } = await supabase.rpc("portal_set_low_season_mode", { p_token: sessionToken, p_low_season_mode: enabled });
      if (error) throw error;
      await loadData(sessionToken);
    } catch (error) { setMessage({ kind: "error", text: errorText(error) }); }
  }

  async function markAbsent() {
    if (!sessionToken || !supabase || !absenceEmployeeId || !absenceDate) return;
    setAbsenceBusy("new");
    setMessage(null);
    try {
      const { error } = await supabase.rpc("portal_mark_absent", {
        p_token: sessionToken,
        p_employee_id: absenceEmployeeId,
        p_absence_date: absenceDate,
      });
      if (error) throw error;
      setAbsenceEmployeeId("");
      setMessage({ kind: "success", text: "Absence recorded." });
      await loadData(sessionToken);
    } catch (error) {
      setMessage({ kind: "error", text: errorText(error) });
    } finally {
      setAbsenceBusy(null);
    }
  }

  async function reclassifyAbsence(absenceId: string, classification: AbsenceClassification) {
    if (!sessionToken || !supabase) return;
    setAbsenceBusy(absenceId);
    setMessage(null);
    try {
      const { error } = await supabase.rpc("portal_reclassify_absence", {
        p_token: sessionToken,
        p_absence_id: absenceId,
        p_classification: classification,
        p_manager_comment: null,
      });
      if (error) throw error;
      await loadData(sessionToken);
    } catch (error) {
      setMessage({ kind: "error", text: errorText(error) });
    } finally {
      setAbsenceBusy(null);
    }
  }

  async function decide(kind: "leave" | "overtime", requestId: string, decision: Decision) {
    if (!sessionToken || !supabase) return;
    let comment = "";
    if (decision === "reject") {
      const entered = window.prompt(a.rejectionReason);
      if (entered === null) return;
      comment = entered.trim();
    }
    setSavingRequestId(requestId);
    setMessage(null);
    try {
      const functionName = kind === "leave" ? "portal_decide_leave" : "portal_decide_overtime";
      const { error } = await supabase.rpc(functionName, {
        p_token: sessionToken,
        p_request_id: requestId,
        p_decision: decision,
        p_comment: comment || null,
      });
      if (error) throw error;
      setMessage({ kind: "success", text: a.decisionSaved });
      await loadData(sessionToken);
    } catch (error) {
      setMessage({ kind: "error", text: errorText(error) });
    } finally {
      setSavingRequestId(null);
    }
  }

  if (booting) return <LoadingScreen text={t.loading} />;

  if (!profile || !sessionToken) {
    return <LoginScreen language={language} setLanguage={setLanguage} login={login} loading={loading} />;
  }

  const viewOptions = viewOptionsFor(profile);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/95 backdrop-blur-xl">
        <div className="mx-auto flex min-h-20 max-w-[1680px] items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
          <button className="flex items-center gap-3 text-left" onClick={() => setView(viewOptions[0].id)}>
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-blue-700 to-sky-500 text-white shadow-lg shadow-blue-500/25">
              <Factory size={23} />
            </span>
            <span>
              <span className="block text-[15px] font-black tracking-tight text-slate-950 sm:text-lg">Plant Leave Management</span>
              <span className="hidden text-xs text-slate-500 sm:block">Secure leave & overtime portal</span>
            </span>
          </button>

          <div className="flex items-center gap-2">
            <div className="hidden rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-right sm:block">
              <p className="text-sm font-black text-slate-950">{profile.displayName}</p>
              <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-blue-600">{profile.role} · {profile.loginId}</p>
            </div>
            <button
              onClick={() => sessionToken && void loadData(sessionToken)}
              className="grid h-10 w-10 place-items-center rounded-xl border border-slate-200 bg-white text-slate-500 transition hover:text-blue-600"
              title={t.refresh}
            >
              <RefreshCw size={17} />
            </button>
            <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600">
              <Languages size={16} />
              <select className="bg-transparent outline-none" value={language} onChange={(event) => setLanguage(event.target.value as Language)}>
                <option value="en">English</option>
                <option value="oshi">Oshiwambo</option>
              </select>
            </label>
            <button onClick={() => void logout()} className="inline-flex h-10 items-center gap-2 rounded-xl bg-slate-950 px-3 text-sm font-black text-white hover:bg-red-700">
              <LogOut size={16} /><span className="hidden sm:inline">{a.logout}</span>
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1680px] grid-cols-1 gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[240px_minmax(0,1fr)] lg:px-8">
        <aside className="h-fit rounded-3xl border border-slate-800 bg-slate-950 p-3 text-white shadow-2xl lg:sticky lg:top-28">
          <div className="mb-3 px-3 pb-3 pt-2">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Workspace</p>
          </div>
          <nav className="grid grid-cols-2 gap-2 lg:grid-cols-1">
            {viewOptions.map(({ id, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setView(id)}
                className={`flex items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm font-bold transition ${
                  view === id ? "bg-blue-600 text-white shadow-lg shadow-blue-900/30" : "text-slate-300 hover:bg-white/10 hover:text-white"
                }`}
              >
                <Icon size={18} />
                <span>{t[id]}</span>
              </button>
            ))}
          </nav>
          <div className="mt-4 hidden rounded-2xl bg-white/5 p-4 lg:block">
            <p className="text-xs font-semibold text-slate-400">Access scope</p>
            <p className="mt-1 text-sm font-black text-white">{profile.department}</p>
            <p className="mt-3 text-xs leading-5 text-slate-500">{a.autoLogout}</p>
          </div>
        </aside>

        <main className="min-w-0">
          {loading && <div className="mb-4 flex items-center gap-2 rounded-xl bg-blue-50 px-4 py-3 text-sm font-bold text-blue-700"><LoaderCircle className="animate-spin" size={17} /> {t.loading}</div>}
          {databaseError && <InlineError text={databaseError} />}
          {message && <div className={`mb-4 rounded-xl px-4 py-3 text-sm font-bold ${message.kind === "success" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>{message.text}</div>}

          {view === "employee" && currentEmployee && (
            <EmployeeView
              language={language}
              t={t}
              employee={currentEmployee}
              module={module}
              setModule={(value) => { setModule(value); setMessage(null); }}
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
              employeeRequests={employeeRequests}
              employeeOvertime={employeeOvertime}
            />
          )}

          {view === "calendar" && profile.role !== "employee" && (
            <CalendarView
              t={t}
              language={language}
              employees={employees}
              requests={requests}
              department={department}
              setDepartment={setDepartment}
              anchor={calendarAnchor}
              setAnchor={setCalendarAnchor}
            />
          )}

          {view === "supervisor" && profile.role === "supervisor" && (
            <div className="space-y-6">
              <AttendanceBoard
                title="Today / Attendance"
                employees={employees}
                absences={absences}
                requests={requests}
                selectedEmployeeId={absenceEmployeeId}
                absenceDate={absenceDate}
                busyId={absenceBusy}
                isManager={false}
                onEmployeeChange={setAbsenceEmployeeId}
                onDateChange={setAbsenceDate}
                onMarkAbsent={() => void markAbsent()}
                onReclassify={() => {}}
              />
            <ApprovalDashboard
              eyebrow={t.firstApproval}
              title="Supervisor control board"
              stats={[
                { label: t.teamSize, value: employees.length, icon: UsersRound },
                { label: t.onLeaveToday, value: onLeaveToday.length, icon: CalendarDays },
                { label: t.pendingRequests, value: supervisorLeavePending.length + supervisorOvertimePending.length, icon: Clock3 },
              ]}
              employees={employees}
              leaveRequests={supervisorLeavePending}
              overtimeRequests={supervisorOvertimePending}
              language={language}
              t={t}
              savingRequestId={savingRequestId}
              onLeaveDecision={(id, decision) => void decide("leave", id, decision)}
              onOvertimeDecision={(id, decision) => void decide("overtime", id, decision)}
              onReassess={(id) => void reassessLeave(id)}
            />
            </div>
          )}

          {view === "manager" && profile.role === "manager" && (
            <div className="space-y-6">
              <section className="border border-slate-700 bg-slate-950 p-5 text-white shadow-xl">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div><p className="font-mono text-xs font-black uppercase tracking-[0.18em] text-amber-400">Factory mode</p><h2 className="mt-1 text-2xl font-black">{factoryMode?.low_season_mode !== false ? "LOW SEASON" : "HIGH SEASON"}</h2><p className="mt-1 text-sm text-slate-400">{factoryMode?.low_season_mode !== false ? "1 shift · Production 3 lines · Loading 1 container" : "2 shifts · Production 4 lines · Loading 2 containers"}</p></div>
                  <label className="flex items-center gap-3 border border-slate-700 bg-slate-900 px-4 py-3"><span className="text-sm font-black">LOW SEASON MODE</span><input type="checkbox" checked={factoryMode?.low_season_mode !== false} onChange={(e) => void toggleLowSeason(e.target.checked)} className="h-5 w-5" /></label>
                </div>
              </section>
              <AttendanceBoard
                title="Today / Attendance"
                employees={employees}
                absences={absences}
                requests={requests}
                selectedEmployeeId={absenceEmployeeId}
                absenceDate={absenceDate}
                busyId={absenceBusy}
                isManager={true}
                onEmployeeChange={setAbsenceEmployeeId}
                onDateChange={setAbsenceDate}
                onMarkAbsent={() => void markAbsent()}
                onReclassify={(id, classification) => void reclassifyAbsence(id, classification)}
              />
            <ApprovalDashboard
              eyebrow={t.finalApproval}
              title="Plant manager control board"
              stats={[
                { label: t.totalEmployees, value: employees.length, icon: UsersRound },
                { label: t.onLeaveToday, value: onLeaveToday.length, icon: CalendarDays },
                { label: t.pendingManager, value: managerLeavePending.length + managerOvertimePending.length, icon: Clock3 },
                { label: t.approvedThisMonth, value: approvedThisMonth.length, icon: CalendarDays },
              ]}
              employees={employees}
              leaveRequests={managerLeavePending}
              overtimeRequests={managerOvertimePending}
              language={language}
              t={t}
              savingRequestId={savingRequestId}
              onLeaveDecision={(id, decision) => void decide("leave", id, decision)}
              onOvertimeDecision={(id, decision) => void decide("overtime", id, decision)}
              onReassess={(id) => void reassessLeave(id)}
            />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function LoginScreen({ language, setLanguage, login, loading }: { language: Language; setLanguage: (language: Language) => void; login: (loginId: string, code: string) => Promise<string | null>; loading: boolean }) {
  const [loginId, setLoginId] = useState("");
  const [code, setCode] = useState("");
  const [showCode, setShowCode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const a = authCopy[language];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const result = await login(loginId, code);
    if (result) setError(result);
  }

  return (
    <div className="min-h-screen bg-slate-950 p-4 sm:p-8">
      <div className="mx-auto flex max-w-6xl justify-end pb-4">
        <label className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-bold text-slate-200">
          <Languages size={16} />
          <select className="bg-transparent outline-none" value={language} onChange={(event) => setLanguage(event.target.value as Language)}>
            <option value="en">English</option>
            <option value="oshi">Oshiwambo</option>
          </select>
        </label>
      </div>
      <div className="mx-auto grid min-h-[760px] max-w-6xl overflow-hidden border border-slate-700 bg-white shadow-2xl lg:grid-cols-[1fr_0.9fr]">
        <section className="relative overflow-hidden bg-gradient-to-br from-blue-800 via-blue-700 to-sky-500 p-8 text-white sm:p-12">
          <div className="absolute -right-28 -top-28 h-80 w-80 rounded-full border border-white/15" />
          <div className="relative flex h-full flex-col justify-between">
            <div>
              <span className="inline-flex items-center gap-2 border border-white/20 bg-white/10 px-3 py-2 font-mono text-xs font-black uppercase tracking-[0.18em]">
                <Factory size={15} /> Plant workforce system
              </span>
              <h1 className="mt-10 max-w-xl text-4xl font-black uppercase tracking-tight sm:text-6xl">Leave & overtime control</h1>
              <p className="mt-5 max-w-lg text-lg leading-8 text-blue-100">{a.confidential}</p>
            </div>
            <div className="mt-12 grid gap-3 sm:grid-cols-2">
              <InfoTile value="5 CHAR" label="individual confidential access code" />
              <InfoTile value="2 LEVELS" label="supervisor then manager approval" />
            </div>
          </div>
        </section>

        <section className="flex items-center p-6 sm:p-10 lg:p-12">
          <form onSubmit={submit} className="mx-auto w-full max-w-md">
            <span className="grid h-14 w-14 place-items-center rounded-2xl bg-slate-950 text-white"><LockKeyhole size={26} /></span>
            <p className="mt-7 font-mono text-xs font-black uppercase tracking-[0.2em] text-blue-600">{a.securePortal}</p>
            <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-950">{a.loginTitle}</h2>
            <p className="mt-3 leading-7 text-slate-500">{a.loginText}</p>

            <div className="mt-8 space-y-5">
              <Field label={a.loginId}>
                <input
                  required
                  autoFocus
                  autoComplete="off"
                  value={loginId}
                  onChange={(event) => setLoginId(event.target.value.toUpperCase())}
                  placeholder="GCN001 / SUPERVISOR / MANAGER"
                  className={inputClass}
                />
              </Field>
              <Field label={a.code}>
                <div className="relative">
                  <input
                    required
                    minLength={5}
                    maxLength={5}
                    autoComplete="off"
                    type={showCode ? "text" : "password"}
                    value={code}
                    onChange={(event) => setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5))}
                    placeholder="•••••"
                    className={`${inputClass} pr-12 font-mono text-xl tracking-[0.35em]`}
                  />
                  <button type="button" onClick={() => setShowCode((value) => !value)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-900">
                    {showCode ? <EyeOff size={19} /> : <Eye size={19} />}
                  </button>
                </div>
              </Field>
            </div>

            {error && <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">{error}</div>}
            <button disabled={loading} type="submit" className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 px-5 py-4 font-black text-white shadow-lg shadow-blue-200 transition hover:bg-blue-700 disabled:opacity-60">
              {loading ? <LoaderCircle className="animate-spin" size={19} /> : <KeyRound size={19} />} {a.signIn}
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}

interface EmployeeViewProps {
  language: Language;
  t: (typeof copy)[Language];
  employee: Employee;
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
  employeeRequests: LeaveRequest[];
  employeeOvertime: OvertimeRequest[];
}

function EmployeeView(props: EmployeeViewProps) {
  const { language, t, employee, module, setModule, startDate, endDate, comment, setStartDate, setEndDate, setComment, requestedDays, submitLeave, overtimeDate, overtimeStart, overtimeEnd, breakMinutes, overtimeReason, setOvertimeDate, setOvertimeStart, setOvertimeEnd, setBreakMinutes, setOvertimeReason, calculatedOvertime, submitOvertime, saving, employeeRequests, employeeOvertime } = props;
  const balanceAfter = employee.balance - requestedDays;

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-soft">
        <div className="flex items-center gap-4 border-b border-slate-100 bg-gradient-to-r from-white to-blue-50/60 p-6 sm:p-8">
          <span className="grid h-16 w-16 place-items-center rounded-3xl bg-slate-950 text-lg font-black text-white">{initials(employee)}</span>
          <div>
            <p className="text-sm font-bold text-blue-600">{employee.employeeCode} · {employee.department}</p>
            <h1 className="mt-1 text-2xl font-black tracking-tight sm:text-3xl">{employeeName(employee)}</h1>
            <p className="mt-1 text-sm font-semibold text-slate-700">{employee.positionTitle}</p>
            <p className="mt-1 text-sm text-slate-500">Supervisor: {employee.supervisor}</p>
          </div>
        </div>
        <div className="grid gap-px bg-slate-200 sm:grid-cols-2 xl:grid-cols-4">
          <StatStrip label={t.availableBalance} value={`${employee.balance} ${t.days}`} accent="text-emerald-600" />
          <StatStrip label={t.earnedThisYear} value={`${employee.earned} ${t.days}`} />
          <StatStrip label={t.usedThisYear} value={`${employee.used} ${t.days}`} accent="text-rose-600" />
          <StatStrip label={t.department} value={employee.department} />
        </div>
      </section>

      <div className="inline-flex rounded-2xl border border-slate-200 bg-white p-1 shadow-sm">
        <ModuleButton active={module === "leave"} onClick={() => setModule("leave")} icon={CalendarDays}>{t.annualLeaveTab}</ModuleButton>
        <ModuleButton active={module === "overtime"} onClick={() => setModule("overtime")} icon={TimerReset}>{t.overtimeTab}</ModuleButton>
      </div>

      {module === "leave" ? (
        <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
          <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-soft sm:p-8">
            <SectionHeader eyebrow={t.annualLeaveTab} title={t.requestLeave} icon={CalendarDays} />
            <form onSubmit={submitLeave} className="mt-7 space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t.startDate}><input required type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className={inputClass} /></Field>
                <Field label={t.endDate}><input required type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className={inputClass} /></Field>
              </div>
              <Field label={t.comment}><textarea rows={4} value={comment} onChange={(event) => setComment(event.target.value)} placeholder={t.commentPlaceholder} className={`${inputClass} resize-none`} /></Field>
              <div className="grid gap-3 rounded-3xl border border-blue-100 bg-blue-50/70 p-4 sm:grid-cols-2">
                <CalculationTile label={t.requestedDays} value={`${requestedDays} ${t.days}`} />
                <CalculationTile label={t.balanceAfter} value={`${balanceAfter} ${t.days}`} danger={balanceAfter < 0} />
              </div>
              <InfoNote text={t.leaveRule} />
              <SubmitButton saving={saving} label={t.submitRequest} />
            </form>
          </section>
          <HistoryCard title={t.myRequests} icon={CalendarDays} emptyText={t.noRequests}>
            {employeeRequests.map((request) => (
              <article key={request.id} className="rounded-2xl border border-slate-200 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div><p className="font-black text-slate-950">{formatDate(request.startDate)} → {formatDate(request.endDate)}</p><p className="mt-1 text-sm text-slate-500">{request.days} {t.days}{request.comment ? ` · ${request.comment}` : ""}</p></div>
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
              <Field label={t.overtimeDate}><input required type="date" value={overtimeDate} onChange={(event) => setOvertimeDate(event.target.value)} className={inputClass} /></Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t.startTime}><input required type="time" value={overtimeStart} onChange={(event) => setOvertimeStart(event.target.value)} className={inputClass} /></Field>
                <Field label={t.endTime}><input required type="time" value={overtimeEnd} onChange={(event) => setOvertimeEnd(event.target.value)} className={inputClass} /></Field>
              </div>
              <Field label={t.breakMinutes}><input min={0} type="number" value={breakMinutes} onChange={(event) => setBreakMinutes(Number(event.target.value))} className={inputClass} /></Field>
              <Field label={t.reason}><textarea rows={4} value={overtimeReason} onChange={(event) => setOvertimeReason(event.target.value)} placeholder={t.reasonPlaceholder} className={`${inputClass} resize-none`} /></Field>
              <CalculationTile label={t.totalHours} value={`${calculatedOvertime} ${t.hours}`} />
              <InfoNote text={t.overtimeRule} />
              <SubmitButton saving={saving} label={t.submitOvertime} />
            </form>
          </section>
          <HistoryCard title={t.myOvertime} icon={TimerReset} emptyText={t.noOvertime}>
            {employeeOvertime.map((request) => (
              <article key={request.id} className="rounded-2xl border border-slate-200 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div><p className="font-black text-slate-950">{formatDate(request.overtimeDate)} · {request.startTime} → {request.endTime}</p><p className="mt-1 text-sm text-slate-500">{request.totalHours} {t.hours} · break {request.breakMinutes} min{request.reason ? ` · ${request.reason}` : ""}</p></div>
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

function CalendarView({ t, language, employees, requests, department, setDepartment, anchor, setAnchor }: { t: (typeof copy)[Language]; language: Language; employees: Employee[]; requests: LeaveRequest[]; department: string; setDepartment: (value: string) => void; anchor: string; setAnchor: (value: string) => void }) {
  const [scale, setScale] = useState<CalendarScale>("week");
  const a = authCopy[language];
  const departments = useMemo(() => Array.from(new Set(employees.map((employee) => employee.department))).sort(), [employees]);
  const anchorDate = new Date(`${anchor}T00:00:00`);
  const rangeDates = useMemo(() => {
    if (scale === "day") return [anchorDate];
    if (scale === "week") {
      const start = startOfWeek(anchorDate);
      return Array.from({ length: 7 }, (_, index) => { const date = new Date(start); date.setDate(start.getDate() + index); return date; });
    }
    const first = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1);
    const days = new Date(anchorDate.getFullYear(), anchorDate.getMonth() + 1, 0).getDate();
    return Array.from({ length: days }, (_, index) => new Date(first.getFullYear(), first.getMonth(), index + 1));
  }, [anchor, scale]);
  const visibleEmployees = employees.filter((employee) => department === "all" || employee.department === department);
  const groupedEmployees = visibleEmployees.reduce<Record<string, Employee[]>>((groups, employee) => {
    const key = employee.department || "Unassigned";
    groups[key] = [...(groups[key] ?? []), employee];
    return groups;
  }, {});
  const departmentEntries = Object.entries(groupedEmployees).sort(([left], [right]) => left.localeCompare(right));
  const approvedCount = visibleEmployees.filter((employee) => rangeDates.some((date) => requestStatusOnDate(employee.id, isoDate(date), requests) === "approved")).length;
  const pendingCount = visibleEmployees.filter((employee) => rangeDates.some((date) => { const status = requestStatusOnDate(employee.id, isoDate(date), requests); return status === "pending_supervisor" || status === "pending_manager"; })).length;
  const cellWidth = scale === "day" ? 280 : scale === "week" ? 118 : 54;
  const minWidth = 300 + rangeDates.length * cellWidth;

  function shift(offset: number) {
    const next = new Date(anchorDate);
    if (scale === "day") next.setDate(next.getDate() + offset);
    if (scale === "week") next.setDate(next.getDate() + offset * 7);
    if (scale === "month") next.setMonth(next.getMonth() + offset, 1);
    setAnchor(isoDate(next));
  }

  function title() {
    if (scale === "day") return new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "2-digit", month: "long", year: "numeric" }).format(rangeDates[0]);
    if (scale === "week") return `${new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short" }).format(rangeDates[0])} — ${new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(rangeDates[rangeDates.length - 1])}`;
    return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" }).format(anchorDate);
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
        <div className="grid xl:grid-cols-[1fr_auto]">
          <div className="border-b border-slate-700 p-5 xl:border-b-0 xl:border-r">
            <div className="flex items-start gap-4">
              <span className="grid h-12 w-12 place-items-center border border-slate-600 bg-slate-900 text-amber-400"><Factory size={24} /></span>
              <div><p className="font-mono text-xs font-black uppercase tracking-[0.24em] text-amber-400">Factory manpower board</p><h1 className="mt-1 text-2xl font-black uppercase tracking-tight sm:text-3xl">{title()}</h1><p className="mt-2 text-sm text-slate-400">Day / week / month operational planning</p></div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 p-4">
            <select value={department} onChange={(event) => setDepartment(event.target.value)} className="h-11 border border-slate-600 bg-slate-900 px-3 text-sm font-black uppercase text-white outline-none">
              <option value="all">{t.allDepartments}</option>{departments.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
            <div className="flex border border-slate-600 bg-slate-900 p-1">
              {(["day", "week", "month"] as CalendarScale[]).map((item) => <button key={item} onClick={() => setScale(item)} className={`px-3 py-2 font-mono text-xs font-black uppercase ${scale === item ? "bg-amber-400 text-slate-950" : "text-slate-300 hover:bg-slate-800"}`}>{a[item]}</button>)}
            </div>
            <button onClick={() => shift(-1)} className="grid h-11 w-11 place-items-center border border-slate-600 bg-slate-900 hover:bg-slate-800"><ChevronLeft size={18} /></button>
            <input type="date" value={anchor} onChange={(event) => setAnchor(event.target.value)} className="h-11 border border-slate-600 bg-slate-900 px-3 text-sm font-bold text-white outline-none" />
            <button onClick={() => shift(1)} className="grid h-11 w-11 place-items-center border border-slate-600 bg-slate-900 hover:bg-slate-800"><ChevronRight size={18} /></button>
          </div>
        </div>
        <div className="grid grid-cols-2 border-t border-slate-700 sm:grid-cols-4">
          <BoardStat label="Employees shown" value={visibleEmployees.length} />
          <BoardStat label="Departments" value={departmentEntries.length} />
          <BoardStat label="Approved leave" value={approvedCount} accent="text-sky-400" />
          <BoardStat label="Pending" value={pendingCount} accent="text-amber-400" last />
        </div>
      </section>

      <section className="border border-slate-400 bg-white shadow-xl">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-slate-300 bg-slate-200 px-4 py-3 font-mono text-[11px] font-black uppercase tracking-[0.12em] text-slate-700">
          <LegendBox className="border-emerald-300 bg-emerald-100" label="W — Working" />
          <LegendBox className="border-blue-400 bg-blue-600" label="AL — Approved leave" />
          <LegendBox className="border-amber-400 bg-amber-300" label="PS — Pending supervisor" />
          <LegendBox className="border-violet-400 bg-violet-600" label="PM — Pending manager" />
          <LegendBox className="border-slate-500 bg-slate-700" label="OFF — Sunday" />
        </div>
        <div className="max-h-[72vh] overflow-auto">
          <table className="border-collapse text-sm" style={{ minWidth, width: "100%" }}>
            <thead className="sticky top-0 z-30">
              <tr className="bg-slate-900 text-white">
                <th className="sticky left-0 z-40 min-w-[300px] border-r border-slate-600 bg-slate-900 px-4 py-3 text-left font-mono text-xs font-black uppercase tracking-[0.12em]">Employee / Department</th>
                {rangeDates.map((date) => {
                  const away = visibleEmployees.filter((employee) => requestStatusOnDate(employee.id, isoDate(date), requests) !== "working").length;
                  const saturday = date.getDay() === 6;
                  const sunday = date.getDay() === 0;
                  return <th key={isoDate(date)} style={{ minWidth: cellWidth }} className={`border-r border-slate-700 px-1 py-2 text-center ${saturday ? "bg-amber-950" : sunday ? "bg-slate-800" : ""}`}><p className="font-mono text-[10px] font-black uppercase text-slate-400">{new Intl.DateTimeFormat("en-GB", { weekday: scale === "month" ? "narrow" : "short" }).format(date)}</p><p className={`${scale === "month" ? "text-base" : "text-xl"} mt-0.5 font-black`}>{new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: scale === "month" ? undefined : "short" }).format(date)}</p><p className="mt-0.5 font-mono text-[9px] font-black uppercase text-amber-400">{away} away</p></th>;
                })}
              </tr>
            </thead>
            <tbody>
              {departmentEntries.map(([departmentName, departmentEmployees]) => (
                <Fragment key={departmentName}>
                  <tr className="bg-slate-300"><td colSpan={rangeDates.length + 1} className="border-y border-slate-500 px-4 py-2 font-mono text-xs font-black uppercase tracking-[0.16em] text-slate-900"><div className="flex items-center justify-between"><span>{departmentName}</span><span>{departmentEmployees.length} employees</span></div></td></tr>
                  {departmentEmployees.map((employee, employeeIndex) => (
                    <tr key={employee.id} className={employeeIndex % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                      <td className="sticky left-0 z-10 border-b border-r border-slate-300 bg-inherit px-4 py-2"><div className="flex items-center gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center border border-slate-500 bg-slate-800 font-mono text-xs font-black text-white">{initials(employee)}</span><div className="min-w-0"><p className="truncate font-black uppercase text-slate-950">{employeeName(employee)}</p><p className="font-mono text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500">{employee.employeeCode}</p><p className="max-w-[230px] truncate text-[11px] font-semibold text-slate-600">{employee.positionTitle}</p></div></div></td>
                      {rangeDates.map((date) => {
                        if (date.getDay() === 0) return <td key={isoDate(date)} className="border-b border-r border-slate-300 bg-slate-200 p-1 text-center"><span className={`grid w-full place-items-center border border-slate-500 bg-slate-700 font-mono text-[10px] font-black text-white ${scale === "month" ? "h-8" : "h-12"}`}>OFF</span></td>;
                        const status = requestStatusOnDate(employee.id, isoDate(date), requests);
                        return <td key={isoDate(date)} className={`border-b border-r border-slate-300 p-1 text-center ${date.getDay() === 6 ? "bg-amber-50" : ""}`}><span className={`grid w-full place-items-center border-2 font-mono font-black tracking-[0.06em] ${scale === "month" ? "h-8 text-[10px]" : "h-12 text-sm"} ${statusCellClass(status)}`}>{statusCode[status]}</span></td>;
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
  leaveRequests: LeaveWithManpower[];
  overtimeRequests: OvertimeRequest[];
  language: Language;
  t: (typeof copy)[Language];
  savingRequestId: string | null;
  onLeaveDecision: (id: string, decision: Decision) => void;
  onOvertimeDecision: (id: string, decision: Decision) => void;
  onReassess: (id: string) => void;
}


function AttendanceBoard({
  title,
  employees,
  absences,
  requests,
  selectedEmployeeId,
  absenceDate,
  busyId,
  isManager,
  onEmployeeChange,
  onDateChange,
  onMarkAbsent,
  onReclassify,
}: {
  title: string;
  employees: Employee[];
  absences: AbsenceRow[];
  requests: LeaveWithManpower[];
  selectedEmployeeId: string;
  absenceDate: string;
  busyId: string | null;
  isManager: boolean;
  onEmployeeChange: (value: string) => void;
  onDateChange: (value: string) => void;
  onMarkAbsent: () => void;
  onReclassify: (id: string, classification: AbsenceClassification) => void;
}) {
  const today = isoDate(new Date());
  const todayAbsences = absences.filter((item) => item.absence_date === today);
  const todayLeave = requests.filter((request) => request.status === "approved" && today >= request.startDate && today <= request.endDate);

  const classificationStyle: Record<AbsenceClassification, string> = {
    UNJUSTIFIED: "bg-red-100 text-red-800 ring-red-200",
    SICK: "bg-violet-100 text-violet-800 ring-violet-200",
    ANNUAL: "bg-blue-100 text-blue-800 ring-blue-200",
    COMPASSIONATE: "bg-amber-100 text-amber-900 ring-amber-200",
  };

  return (
    <section className="border border-slate-300 bg-white shadow-xl">
      <div className="border-b border-slate-300 bg-slate-950 p-5 text-white">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="font-mono text-xs font-black uppercase tracking-[0.18em] text-amber-400">Attendance control</p>
            <h2 className="mt-1 text-2xl font-black uppercase">{title}</h2>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="border border-slate-700 bg-slate-900 px-4 py-2"><p className="text-xl font-black">{employees.length}</p><p className="text-[10px] font-black uppercase text-slate-400">Team</p></div>
            <div className="border border-slate-700 bg-slate-900 px-4 py-2"><p className="text-xl font-black text-amber-400">{todayLeave.length}</p><p className="text-[10px] font-black uppercase text-slate-400">On leave</p></div>
            <div className="border border-slate-700 bg-slate-900 px-4 py-2"><p className="text-xl font-black text-red-400">{todayAbsences.length}</p><p className="text-[10px] font-black uppercase text-slate-400">Absent</p></div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 border-b border-slate-200 bg-slate-50 p-5 lg:grid-cols-[1fr_220px_auto]">
        <label>
          <span className="mb-2 block text-xs font-black uppercase tracking-[0.12em] text-slate-500">Employee</span>
          <select value={selectedEmployeeId} onChange={(e) => onEmployeeChange(e.target.value)} className={inputClass}>
            <option value="">Select employee</option>
            {employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.employeeCode} — {employeeName(employee)} — {employee.department}</option>)}
          </select>
        </label>
        <label>
          <span className="mb-2 block text-xs font-black uppercase tracking-[0.12em] text-slate-500">Absence date</span>
          <input type="date" value={absenceDate} onChange={(e) => onDateChange(e.target.value)} className={inputClass} />
        </label>
        <div className="flex items-end">
          <button type="button" disabled={!selectedEmployeeId || !absenceDate || busyId === "new"} onClick={onMarkAbsent} className="h-[52px] w-full bg-red-600 px-5 font-black uppercase text-white hover:bg-red-700 disabled:opacity-50 lg:w-auto">
            {busyId === "new" ? "Saving..." : "Mark Absent"}
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] border-collapse">
          <thead><tr className="bg-slate-200 text-left font-mono text-xs font-black uppercase tracking-[0.12em] text-slate-600"><th className="px-5 py-3">Employee</th><th className="px-5 py-3">Department</th><th className="px-5 py-3">Date</th><th className="px-5 py-3">Classification</th>{isManager && <th className="px-5 py-3">Manager action</th>}</tr></thead>
          <tbody>
            {absences.length === 0 ? <tr><td colSpan={isManager ? 5 : 4} className="px-5 py-8 text-center font-bold text-slate-400">No absences recorded in this period.</td></tr> :
              absences.slice(0, 30).map((absence) => (
                <tr key={absence.id} className="border-t border-slate-200">
                  <td className="px-5 py-4"><p className="font-black text-slate-950">{absence.employee_name}</p><p className="font-mono text-xs text-slate-500">{absence.employee_code}</p></td>
                  <td className="px-5 py-4 font-semibold text-slate-600">{absence.department}</td>
                  <td className="px-5 py-4 font-semibold">{formatDate(absence.absence_date)}</td>
                  <td className="px-5 py-4"><span className={`inline-flex px-3 py-1.5 text-xs font-black ring-1 ${classificationStyle[absence.classification]}`}>{absence.classification.replace("_"," ")}</span></td>
                  {isManager && <td className="px-5 py-4"><select disabled={busyId === absence.id} value={absence.classification} onChange={(e) => onReclassify(absence.id, e.target.value as AbsenceClassification)} className="border border-slate-300 bg-white px-3 py-2 text-sm font-black"><option value="UNJUSTIFIED">Unjustified</option><option value="SICK">Sick Leave</option><option value="ANNUAL">Annual Leave</option><option value="COMPASSIONATE">Compassionate Leave</option></select></td>}
                </tr>
              ))
            }
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ApprovalDashboard({ eyebrow, title, stats, employees, leaveRequests, overtimeRequests, language, t, savingRequestId, onLeaveDecision, onOvertimeDecision, onReassess }: ApprovalDashboardProps) {
  return <div className="space-y-6"><section className="border border-slate-700 bg-slate-950 p-6 text-white shadow-2xl sm:p-8"><SectionHeaderDark eyebrow={eyebrow} title={title} icon={LayoutDashboard} /><div className="mt-7 grid gap-px bg-slate-700 sm:grid-cols-2 xl:grid-cols-4">{stats.map(({ label, value, icon: Icon }) => <article key={label} className="bg-slate-900 p-5"><div className="flex items-center justify-between"><span className="grid h-10 w-10 place-items-center border border-slate-700 bg-slate-950 text-amber-400"><Icon size={19} /></span><span className="text-3xl font-black">{value}</span></div><p className="mt-5 font-mono text-xs font-black uppercase tracking-[0.12em] text-slate-400">{label}</p></article>)}</div></section><RequestTable title={t.annualLeaveTab} employees={employees} requests={leaveRequests} language={language} t={t} savingRequestId={savingRequestId} onDecision={onLeaveDecision} onReassess={onReassess} /><OvertimeTable title={t.overtimeTab} employees={employees} requests={overtimeRequests} language={language} t={t} savingRequestId={savingRequestId} onDecision={onOvertimeDecision} /></div>;
}

function RequestTable({ title, employees, requests, language, t, savingRequestId, onDecision, onReassess }: { title: string; employees: Employee[]; requests: LeaveWithManpower[]; language: Language; t: (typeof copy)[Language]; savingRequestId: string | null; onDecision: (id: string, decision: Decision) => void; onReassess: (id: string) => void }) {
  const a = authCopy[language];
  const style: Record<ManpowerStatus,string> = { GREEN:"border-emerald-300 bg-emerald-50 text-emerald-800", ORANGE:"border-amber-300 bg-amber-50 text-amber-900", RED:"border-red-300 bg-red-50 text-red-800", NOT_ASSESSED:"border-slate-300 bg-slate-50 text-slate-700" };
  return <section className="overflow-hidden border border-slate-400 bg-white shadow-xl"><div className="border-b border-slate-300 bg-slate-200 p-5"><p className="font-mono text-xs font-black uppercase tracking-[0.18em] text-blue-700">{t.pendingRequests}</p><h2 className="mt-1 text-2xl font-black uppercase text-slate-950">{title}</h2></div>{requests.length===0?<div className="p-8"><EmptyState text={t.noPending}/></div>:<div className="divide-y divide-slate-200">{requests.map(request=>{const employee=employees.find(x=>x.id===request.employeeId);if(!employee)return null;const rawReasons=(request.manpowerDetails?.days??[]).flatMap((d:any)=>(d.reasons??[]).map((r:any)=>({date:d.date,...r})));const reasons=Array.from(rawReasons.reduce((m:any,r:any)=>{const k=`${r.type??""}|${r.area??""}|${r.skill??""}|${r.message??""}`;if(!m.has(k))m.set(k,{...r,dates:[r.date]});else m.get(k).dates.push(r.date);return m;},new Map()).values()).slice(0,4);return <article key={request.id} className="p-5"><div className="grid gap-4 xl:grid-cols-[1fr_0.9fr]"><div><EmployeeCell employee={employee}/><p className="mt-3 text-sm font-semibold text-slate-600">{employee.department} · {formatDate(request.startDate)} → {formatDate(request.endDate)} · {request.days} days</p><div className="mt-3"><StatusBadge status={request.status} language={language}/></div></div><div className={`border-2 p-4 ${style[request.manpowerStatus]}`}><div className="flex justify-between gap-3"><div><p className="font-mono text-xs font-black">MANPOWER · {request.manpowerDetails?.mode??"—"} SEASON</p><p className="mt-1 text-lg font-black">{request.manpowerStatus}</p></div><button disabled={savingRequestId===request.id} onClick={()=>onReassess(request.id)} className="border border-current px-3 py-2 text-xs font-black"><RefreshCw size={14} className="inline mr-1"/>RE-ASSESS</button></div>{reasons.map((r:any,i:number)=><p key={i} className="mt-2 bg-white/70 p-2 text-xs font-semibold">{r.message??`${r.area??""} ${r.skill??""} below minimum`}</p>)}</div></div><div className="mt-4 flex justify-end"><DecisionButtons busy={savingRequestId===request.id} approve={()=>onDecision(request.id,"approve")} reject={()=>onDecision(request.id,"reject")} language={language}/></div></article>})}</div>}</section>;
}

function OvertimeTable({ title, employees, requests, language, t, savingRequestId, onDecision }: { title: string; employees: Employee[]; requests: OvertimeRequest[]; language: Language; t: (typeof copy)[Language]; savingRequestId: string | null; onDecision: (id: string, decision: Decision) => void }) {
  const a = authCopy[language];
  return <section className="overflow-hidden border border-slate-400 bg-white shadow-xl"><div className="border-b border-slate-300 bg-slate-200 p-5"><p className="font-mono text-xs font-black uppercase tracking-[0.18em] text-blue-700">{t.pendingRequests}</p><h2 className="mt-1 text-2xl font-black uppercase text-slate-950">{title}</h2></div>{requests.length === 0 ? <div className="p-8"><EmptyState text={t.noPending} /></div> : <div className="overflow-x-auto"><table className="w-full min-w-[1100px] border-collapse"><thead><tr className="bg-slate-900 text-left font-mono text-xs font-black uppercase tracking-[0.12em] text-slate-300"><th className="px-5 py-4">{t.employee}</th><th className="px-5 py-4">{t.department}</th><th className="px-5 py-4">{t.overtimeDate}</th><th className="px-5 py-4">{t.period}</th><th className="px-5 py-4">{t.hours}</th><th className="px-5 py-4">{t.status}</th><th className="px-5 py-4">{a.actions}</th></tr></thead><tbody>{requests.map((request) => { const employee = employees.find((item) => item.id === request.employeeId); if (!employee) return null; return <tr key={request.id} className="border-t border-slate-200 hover:bg-slate-50"><td className="px-5 py-4"><EmployeeCell employee={employee} /></td><td className="px-5 py-4 font-semibold text-slate-600">{employee.department}</td><td className="px-5 py-4 font-semibold text-slate-600">{formatDate(request.overtimeDate)}</td><td className="px-5 py-4 font-semibold text-slate-600">{request.startTime} → {request.endTime}</td><td className="px-5 py-4 font-black">{request.totalHours}</td><td className="px-5 py-4"><StatusBadge status={request.status} language={language} /></td><td className="px-5 py-4"><DecisionButtons busy={savingRequestId === request.id} approve={() => onDecision(request.id, "approve")} reject={() => onDecision(request.id, "reject")} language={language} /></td></tr>; })}</tbody></table></div>}</section>;
}

const inputClass = "w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3.5 font-semibold text-slate-900 transition focus:border-blue-400 focus:bg-white focus:outline-none focus:ring-4 focus:ring-blue-100";

function LoadingScreen({ text }: { text: string }) { return <div className="grid min-h-screen place-items-center bg-slate-950"><div className="text-center"><LoaderCircle className="mx-auto animate-spin text-amber-400" size={42} /><p className="mt-4 font-mono font-black uppercase tracking-[0.14em] text-slate-300">{text}</p></div></div>; }
function InlineError({ text }: { text: string }) { return <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 font-mono text-sm font-bold text-red-700">{text}</div>; }
function SectionHeader({ eyebrow, title, icon: Icon }: { eyebrow: string; title: string; icon: LucideIcon }) { return <div className="flex items-center gap-4"><span className="grid h-12 w-12 place-items-center rounded-2xl bg-blue-50 text-blue-600 ring-1 ring-blue-100"><Icon size={22} /></span><div><p className="text-xs font-black uppercase tracking-[0.16em] text-blue-600">{eyebrow}</p><h1 className="mt-1 text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">{title}</h1></div></div>; }
function SectionHeaderDark({ eyebrow, title, icon: Icon }: { eyebrow: string; title: string; icon: LucideIcon }) { return <div className="flex items-center gap-4"><span className="grid h-12 w-12 place-items-center border border-slate-700 bg-slate-900 text-amber-400"><Icon size={22} /></span><div><p className="font-mono text-xs font-black uppercase tracking-[0.18em] text-amber-400">{eyebrow}</p><h1 className="mt-1 text-2xl font-black uppercase tracking-tight text-white sm:text-3xl">{title}</h1></div></div>; }
function ModuleButton({ active, onClick, icon: Icon, children }: { active: boolean; onClick: () => void; icon: LucideIcon; children: React.ReactNode }) { return <button onClick={onClick} className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-black transition ${active ? "bg-blue-600 text-white" : "text-slate-500 hover:bg-slate-50 hover:text-slate-950"}`}><Icon size={17} />{children}</button>; }
function InfoTile({ value, label }: { value: string; label: string }) { return <div className="border border-white/20 bg-white/10 p-4 backdrop-blur"><p className="font-mono text-2xl font-black">{value}</p><p className="mt-1 text-xs leading-5 text-blue-100">{label}</p></div>; }
function StatStrip({ label, value, accent = "text-slate-950" }: { label: string; value: string; accent?: string }) { return <div className="bg-white p-5 sm:p-6"><p className="text-sm font-bold text-slate-500">{label}</p><p className={`mt-2 text-2xl font-black tracking-tight ${accent}`}>{value}</p></div>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block"><span className="mb-2 block text-sm font-black text-slate-700">{label}</span>{children}</label>; }
function CalculationTile({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) { return <div className="rounded-2xl bg-white p-4 ring-1 ring-blue-100"><p className="text-sm font-bold text-slate-500">{label}</p><p className={`mt-2 text-2xl font-black ${danger ? "text-red-600" : "text-slate-950"}`}>{value}</p></div>; }
function InfoNote({ text }: { text: string }) { return <div className="flex items-start gap-3 rounded-2xl bg-slate-50 p-4 text-sm text-slate-600"><Clock3 className="mt-0.5 shrink-0 text-blue-600" size={18} /><p>{text}</p></div>; }
function SubmitButton({ saving, label }: { saving: boolean; label: string }) { return <button disabled={saving} type="submit" className="inline-flex min-w-44 items-center justify-center gap-2 rounded-2xl bg-blue-600 px-5 py-3.5 font-black text-white shadow-lg shadow-blue-200 transition hover:bg-blue-700 disabled:cursor-wait disabled:opacity-60">{saving && <LoaderCircle className="animate-spin" size={18} />}{label}</button>; }
function HistoryCard({ title, icon, emptyText, children }: { title: string; icon: LucideIcon; emptyText: string; children: React.ReactNode }) { const items = Array.isArray(children) ? children.filter(Boolean) : children; const empty = Array.isArray(items) ? items.length === 0 : !items; return <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-soft sm:p-8"><SectionHeader eyebrow="History" title={title} icon={icon} /><div className="mt-7 space-y-3">{empty ? <EmptyState text={emptyText} /> : items}</div></section>; }
function StatusBadge({ status, language }: { status: RequestStatus; language: Language }) { return <span className={`inline-flex rounded-full px-3 py-1.5 text-xs font-black ring-1 ${statusStyles[status]}`}>{statusLabel(status, language)}</span>; }
function EmployeeCell({ employee }: { employee: Employee }) { return <div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center border border-slate-700 bg-slate-900 text-xs font-black text-white">{initials(employee)}</span><div><p className="font-black text-slate-950">{employeeName(employee)}</p><p className="font-mono text-xs text-slate-500">{employee.employeeCode}</p><p className="max-w-[260px] truncate text-xs font-semibold text-slate-600">{employee.positionTitle}</p></div></div>; }
function EmptyState({ text }: { text: string }) { return <div className="grid min-h-40 place-items-center border border-dashed border-slate-300 bg-slate-50 px-6 text-center"><div><span className="mx-auto grid h-12 w-12 place-items-center bg-white text-slate-400 shadow-sm"><Clock3 size={22} /></span><p className="mt-3 font-bold text-slate-500">{text}</p></div></div>; }
function BoardStat({ label, value, accent = "text-white", last = false }: { label: string; value: number; accent?: string; last?: boolean }) { return <div className={`${last ? "" : "border-r"} border-slate-700 p-4`}><p className="font-mono text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">{label}</p><p className={`mt-1 text-3xl font-black ${accent}`}>{value}</p></div>; }
function LegendBox({ className, label }: { className: string; label: string }) { return <span className="flex items-center gap-2"><span className={`h-4 w-7 border ${className}`} />{label}</span>; }
function DecisionButtons({ busy, approve, reject, language }: { busy: boolean; approve: () => void; reject: () => void; language: Language }) { const a = authCopy[language]; return <div className="flex gap-2">{busy ? <span className="grid h-9 w-24 place-items-center border border-slate-300 bg-slate-100"><LoaderCircle className="animate-spin" size={17} /></span> : <><button onClick={approve} className="inline-flex h-9 items-center gap-1 border border-emerald-600 bg-emerald-600 px-3 text-xs font-black uppercase text-white hover:bg-emerald-700"><Check size={15} />{a.approve}</button><button onClick={reject} className="inline-flex h-9 items-center gap-1 border border-red-600 bg-white px-3 text-xs font-black uppercase text-red-700 hover:bg-red-50"><X size={15} />{a.reject}</button></>}</div>; }
