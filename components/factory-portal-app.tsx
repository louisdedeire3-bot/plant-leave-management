"use client";

// GCN FACTORY PORTAL V2 — PRODUCTION MODULE LIVE

import {
  ArrowRight,
  BarChart3,
  Boxes,
  ClipboardCheck,
  Factory,
  FlaskConical,
  Gauge,
  Hammer,
  LayoutDashboard,
  LoaderCircle,
  LogIn,
  LogOut,
  PackageCheck,
  Settings,
  Truck,
  UserCog,
  UsersRound,
  Warehouse,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import {
  ScreeningFactoryModule,
  type ScreeningFactoryProfile,
} from "@/components/screening-factory-module";
import {
  ProductionFactoryModule,
  type ProductionFactoryProfile,
} from "@/components/production-factory-module";

type PortalRole = "employee" | "supervisor" | "manager";
type FactoryModuleId =
  | "dashboard"
  | "leave"
  | "screening"
  | "production"
  | "briquettes"
  | "laboratory"
  | "loading"
  | "maintenance"
  | "employees"
  | "reports"
  | "settings";

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

interface FactoryModuleDefinition {
  id: FactoryModuleId;
  label: string;
  description: string;
  icon: LucideIcon;
  state: "LIVE" | "NEXT" | "PLANNED";
  managerOnly?: boolean;
}

const modules: FactoryModuleDefinition[] = [
  {
    id: "dashboard",
    label: "Factory dashboard",
    description: "All plant modules and operational priorities",
    icon: LayoutDashboard,
    state: "LIVE",
  },
  {
    id: "leave",
    label: "Leave management",
    description: "Leave, attendance, overtime and manpower",
    icon: ClipboardCheck,
    state: "LIVE",
  },
  {
    id: "screening",
    label: "Screening",
    description: "Incoming loads, screening results, ERP lots and stock",
    icon: Factory,
    state: "LIVE",
  },
  {
    id: "production",
    label: "Production",
    description: "Office orders, production runs, raw lots and finished stock",
    icon: Gauge,
    state: "LIVE",
  },
  {
    id: "briquettes",
    label: "Briquettes",
    description: "Briquette production, shifts and raw materials",
    icon: Boxes,
    state: "PLANNED",
  },
  {
    id: "laboratory",
    label: "Laboratory",
    description: "Sizing, fixed carbon, moisture and lot release",
    icon: FlaskConical,
    state: "PLANNED",
  },
  {
    id: "loading",
    label: "Loading",
    description: "Container teams, pallets and completed loading",
    icon: Truck,
    state: "PLANNED",
  },
  {
    id: "maintenance",
    label: "Maintenance",
    description: "Breakdowns, work orders and spare parts",
    icon: Hammer,
    state: "PLANNED",
  },
  {
    id: "employees",
    label: "Employees",
    description: "Shared employee, role and skill master",
    icon: UsersRound,
    state: "PLANNED",
    managerOnly: true,
  },
  {
    id: "reports",
    label: "Reports",
    description: "Cross-department production and workforce reporting",
    icon: BarChart3,
    state: "PLANNED",
    managerOnly: true,
  },
  {
    id: "settings",
    label: "Settings",
    description: "Departments, permissions and operating rules",
    icon: Settings,
    state: "PLANNED",
    managerOnly: true,
  },
];

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return "Unknown database error";
}

function mapProfile(row: LoginRow | ProfileRow): PortalProfile {
  return {
    accountId: row.account_id,
    loginId: row.login_id,
    employeeId: row.employee_id,
    displayName: row.display_name,
    role: row.account_role as PortalRole,
    department: row.department,
    expiresAt: row.expires_at,
  };
}

function moduleFromUrl(): FactoryModuleId {
  if (typeof window === "undefined") return "dashboard";
  const requested = new URLSearchParams(window.location.search).get("module");
  return modules.some((module) => module.id === requested)
    ? (requested as FactoryModuleId)
    : "dashboard";
}

function supervisorOperationalModule(
  profile: PortalProfile,
): FactoryModuleId | null {
  const scope = `${profile.department} ${profile.loginId}`.toLowerCase();

  // The temporary shared SUPERVISOR account is currently the Screening account.
  if (profile.loginId.toUpperCase() === "SUPERVISOR") return "screening";
  if (scope.includes("screen")) return "screening";
  if (scope.includes("production") || scope.includes("bagging")) {
    return "production";
  }
  if (scope.includes("briquette")) return "briquettes";
  if (scope.includes("laboratory") || scope.includes("labo")) {
    return "laboratory";
  }
  if (scope.includes("loading") || scope.includes("logistic")) {
    return "loading";
  }
  if (scope.includes("maintenance")) return "maintenance";

  return null;
}

function allowedModuleIdsForProfile(
  profile: PortalProfile,
): FactoryModuleId[] {
  if (profile.role === "manager") {
    return modules.map((module) => module.id);
  }

  if (profile.role === "supervisor") {
    const operationalModule = supervisorOperationalModule(profile);
    return [
      "dashboard",
      "leave",
      ...(operationalModule ? [operationalModule] : []),
    ];
  }

  return ["leave"];
}

function safeInitialModule(profile: PortalProfile): FactoryModuleId {
  const allowed = allowedModuleIdsForProfile(profile);
  const requested = moduleFromUrl();

  if (allowed.includes(requested)) return requested;

  const operationalModule = supervisorOperationalModule(profile);
  return operationalModule && allowed.includes(operationalModule)
    ? operationalModule
    : allowed[0] ?? "dashboard";
}

export function FactoryPortalApp() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [profile, setProfile] = useState<PortalProfile | null>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [activeModule, setActiveModule] =
    useState<FactoryModuleId>("dashboard");
  const [booting, setBooting] = useState(true);
  const [loading, setLoading] = useState(false);

  const clearSession = useCallback(() => {
    sessionStorage.removeItem("plant_portal_token");
    setProfile(null);
    setSessionToken(null);
    setActiveModule("dashboard");
  }, []);

  useEffect(() => {
    async function restoreSession() {
      const token = sessionStorage.getItem("plant_portal_token");
      if (!token || !supabase) {
        setBooting(false);
        return;
      }

      try {
        const { data, error } = await supabase.rpc("portal_me", {
          p_token: token,
        });
        if (error) throw error;

        const row = ((data ?? []) as ProfileRow[])[0];
        if (!row) {
          clearSession();
          return;
        }

        const nextProfile = mapProfile(row);
        if (nextProfile.role === "employee") {
          window.location.assign("/");
          return;
        }

        setProfile(nextProfile);
        setSessionToken(token);
        setActiveModule(safeInitialModule(nextProfile));
      } catch {
        clearSession();
      } finally {
        setBooting(false);
      }
    }

    void restoreSession();
  }, [clearSession, supabase]);

  useEffect(() => {
    if (!profile || !sessionToken) return;

    const inactivityMs = 30 * 60 * 1000;
    let timer: ReturnType<typeof setTimeout>;

    const expire = () => clearSession();
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(expire, inactivityMs);
    };

    const events: Array<keyof WindowEventMap> = [
      "click",
      "keydown",
      "mousemove",
      "touchstart",
    ];

    events.forEach((event) =>
      window.addEventListener(event, reset, { passive: true }),
    );
    reset();

    return () => {
      clearTimeout(timer);
      events.forEach((event) => window.removeEventListener(event, reset));
    };
  }, [clearSession, profile, sessionToken]);

  function selectModule(moduleId: FactoryModuleId) {
    if (profile && !allowedModuleIdsForProfile(profile).includes(moduleId)) {
      return;
    }

    setActiveModule(moduleId);
    const url = new URL(window.location.href);
    url.searchParams.set("module", moduleId);
    window.history.replaceState({}, "", url);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function login(
    loginId: string,
    accessCode: string,
  ): Promise<string | null> {
    if (!supabase) return "Missing Supabase environment variables.";

    setLoading(true);

    try {
      const { data, error } = await supabase.rpc("portal_login", {
        p_login_id: loginId.trim().toUpperCase(),
        p_access_code: accessCode.trim().toUpperCase(),
      });
      if (error) throw error;

      const row = ((data ?? []) as LoginRow[])[0];
      if (!row) return "Invalid login ID or password.";

      const nextProfile = mapProfile(row);
      sessionStorage.setItem("plant_portal_token", row.session_token);

      if (nextProfile.role === "employee") {
        window.location.assign("/");
        return null;
      }

      setProfile(nextProfile);
      setSessionToken(row.session_token);
      setActiveModule(safeInitialModule(nextProfile));
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

    if (token && supabase) {
      await supabase.rpc("portal_logout", { p_token: token });
    }
  }

  if (booting) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#12100e] text-white">
        <div className="text-center">
          <LoaderCircle
            size={36}
            className="mx-auto animate-spin text-[#d78a46]"
          />
          <p className="mt-4 text-xs font-black uppercase tracking-[0.2em] text-[#a99d93]">
            Starting factory portal
          </p>
        </div>
      </div>
    );
  }

  if (!profile || !sessionToken) {
    return <FactoryPortalLogin loading={loading} onLogin={login} />;
  }

  const allowedModuleIds = allowedModuleIdsForProfile(profile);
  const allowedModules = modules.filter((module) =>
    allowedModuleIds.includes(module.id),
  );

  return (
    <div className="min-h-screen bg-[#ece7e1] text-[#171310]">
      <header className="sticky top-0 z-40 border-b border-[#3d332c] bg-[#171310] text-white">
        <div className="mx-auto flex min-h-20 max-w-[1850px] items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <button
            type="button"
            onClick={() => selectModule("dashboard")}
            className="flex items-center gap-3 text-left"
          >
            <span className="h-12 w-12 shrink-0 overflow-hidden">
              <img
                src="/green-charcoal-namibia-logo.png"
                alt="Green Charcoal Namibia"
                className="h-12 w-auto max-w-none drop-shadow-[0_0_12px_rgba(46,179,85,0.22)]"
              />
            </span>
            <span>
              <span className="block text-lg font-black uppercase tracking-tight">
                Factory Portal
              </span>
              <span className="hidden text-[10px] font-black uppercase tracking-[0.16em] text-[#54b95f] sm:block">
                Green Charcoal Namibia
              </span>
            </span>
          </button>

          <div className="flex items-center gap-2">
            <div className="hidden border border-[#40362f] bg-[#211b17] px-4 py-2 text-right sm:block">
              <p className="text-sm font-black">{profile.displayName}</p>
              <p className="text-[10px] font-black uppercase tracking-[0.12em] text-[#d78a46]">
                {profile.role} · {profile.loginId}
              </p>
            </div>

            <button
              type="button"
              onClick={() => void logout()}
              className="inline-flex h-11 items-center gap-2 bg-[#d78a46] px-4 text-xs font-black uppercase text-[#171310] transition hover:bg-[#e49b58]"
            >
              <LogOut size={16} />
              <span className="hidden sm:inline">Log out</span>
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1850px] grid-cols-1 lg:grid-cols-[290px_minmax(0,1fr)]">
        <aside className="border-r border-[#2f2823] bg-[#201a16] p-4 text-white lg:min-h-[calc(100vh-81px)] lg:p-5">
          <p className="px-3 pb-3 pt-1 text-[10px] font-black uppercase tracking-[0.2em] text-[#756b63]">
            Plant modules
          </p>

          <nav className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-1">
            {allowedModules.map(
              ({ id, label, description, icon: Icon, state }) => {
                const active = activeModule === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => selectModule(id)}
                    className={`flex min-h-20 items-center gap-3 border px-4 py-3 text-left transition ${
                      active
                        ? "border-[#d78a46] bg-[#d78a46] text-[#171310]"
                        : "border-[#3f352e] bg-[#171310] text-[#d1c5bb] hover:border-[#7d5c43]"
                    }`}
                  >
                    <Icon size={21} className="shrink-0" />
                    <span className="min-w-0">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-black uppercase">
                          {label}
                        </span>
                        {state !== "LIVE" && (
                          <span
                            className={`shrink-0 px-1.5 py-0.5 text-[8px] font-black uppercase ${
                              active
                                ? "bg-[#171310] text-[#d78a46]"
                                : "bg-[#302822] text-[#9d9188]"
                            }`}
                          >
                            {state}
                          </span>
                        )}
                      </span>
                      <span
                        className={`mt-1 hidden text-xs leading-4 lg:block ${
                          active ? "text-[#4a3020]" : "text-[#756b63]"
                        }`}
                      >
                        {description}
                      </span>
                    </span>
                  </button>
                );
              },
            )}
          </nav>

          <div className="mt-5 hidden border border-[#3f352e] bg-[#171310] p-4 lg:block">
            <p className="text-[10px] font-black uppercase tracking-[0.14em] text-[#756b63]">
              Connected profile
            </p>
            <p className="mt-2 text-sm font-black">{profile.department}</p>
            <p className="mt-3 text-xs leading-5 text-[#756b63]">
              {profile.role === "manager"
                ? "Management has access to every plant module from one portal."
                : `Supervisor access is limited to Leave Management and ${
                    modules.find(
                      (module) =>
                        module.id === supervisorOperationalModule(profile),
                    )?.label ?? "the assigned department"
                  }.`}
            </p>
          </div>
        </aside>

        <main className="min-w-0 p-4 sm:p-6 lg:p-8">
          {activeModule === "dashboard" && (
            <FactoryDashboard
              profile={profile}
              modules={allowedModules}
              onSelect={selectModule}
            />
          )}

          {activeModule === "leave" && <LeaveModuleGateway />}

          {activeModule === "screening" && (
            <ScreeningFactoryModule
              profile={profile as ScreeningFactoryProfile}
              sessionToken={sessionToken}
            />
          )}

          {activeModule === "production" && (
            <ProductionFactoryModule
              profile={profile as ProductionFactoryProfile}
              sessionToken={sessionToken}
            />
          )}

          {!["dashboard", "leave", "screening", "production"].includes(activeModule) && (
            <PlannedModule
              module={
                modules.find((module) => module.id === activeModule) ??
                modules[0]
              }
            />
          )}
        </main>
      </div>
    </div>
  );
}

function FactoryPortalLogin({
  loading,
  onLogin,
}: {
  loading: boolean;
  onLogin: (loginId: string, password: string) => Promise<string | null>;
}) {
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const result = await onLogin(loginId, password);
    if (result) setError(result);
  }

  return (
    <div className="min-h-screen bg-[#12100e] text-white">
      <div className="mx-auto grid min-h-screen max-w-[1500px] lg:grid-cols-[1.12fr_0.88fr]">
        <section className="relative hidden overflow-hidden border-r border-[#3c332d] bg-[#171310] p-12 lg:flex lg:flex-col lg:justify-between">
          <div className="absolute inset-0 opacity-20">
            <div className="absolute -left-16 top-24 h-72 w-72 rounded-full bg-[#d78a46] blur-[110px]" />
            <div className="absolute bottom-16 right-10 h-80 w-80 rounded-full bg-[#34513d] blur-[130px]" />
          </div>

          <div className="relative w-fit">
            <img
              src="/green-charcoal-namibia-logo.png"
              alt="Green Charcoal Namibia"
              className="h-auto w-80 drop-shadow-[0_12px_28px_rgba(0,0,0,0.35)]"
            />
          </div>

          <div className="relative max-w-3xl">
            <p className="font-mono text-sm font-black uppercase tracking-[0.2em] text-[#d78a46]">
              One plant · one portal
            </p>
            <h1 className="mt-4 text-6xl font-black uppercase leading-[0.94] tracking-[-0.04em]">
              Factory
              <br />
              Operations
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-[#bdb1a7]">
              Leave Management, Screening, Production, Briquettes, Laboratory,
              Loading and Maintenance under one Management profile.
            </p>
          </div>

          <div className="relative grid grid-cols-3 gap-3">
            {[
              ["1 login", "shared access"],
              ["All modules", "one navigation"],
              ["Full traceability", "plant-wide"],
            ].map(([value, label]) => (
              <div key={value} className="border border-[#3c332d] bg-[#1c1714] p-4">
                <p className="font-mono text-xl font-black text-[#d78a46]">
                  {value}
                </p>
                <p className="mt-1 text-xs font-bold uppercase text-[#82766d]">
                  {label}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="flex items-center justify-center px-5 py-12 sm:px-10">
          <form
            onSubmit={submit}
            className="w-full max-w-lg border border-[#463b33] bg-[#1b1714] p-6 shadow-2xl sm:p-9"
          >
            <div className="w-full max-w-[280px]">
              <img
                src="/green-charcoal-namibia-logo.png"
                alt="Green Charcoal Namibia"
                className="h-auto w-full drop-shadow-[0_10px_24px_rgba(0,0,0,0.4)]"
              />
            </div>

            <p className="mt-8 text-xs font-black uppercase tracking-[0.18em] text-[#d78a46]">
              Factory portal
            </p>
            <h2 className="mt-2 text-3xl font-black uppercase">
              Supervisor / Management access
            </h2>
            <p className="mt-3 text-sm leading-6 text-[#9f9389]">
              Use the same Manager or Supervisor credentials as the Workforce
              application.
            </p>

            <div className="mt-8 space-y-5">
              <label className="block">
                <span className="mb-2 block text-xs font-black uppercase tracking-[0.12em] text-[#bdb1a7]">
                  Login ID
                </span>
                <input
                  value={loginId}
                  onChange={(event) => setLoginId(event.target.value.toUpperCase())}
                  placeholder="MANAGER or GCN code"
                  className="w-full border border-[#55473d] bg-[#12100e] px-4 py-3 text-sm font-bold text-white outline-none placeholder:text-[#6f655d] focus:border-[#d78a46]"
                  autoComplete="username"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-xs font-black uppercase tracking-[0.12em] text-[#bdb1a7]">
                  Password
                </span>
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="DDMMYY or management code"
                  className="w-full border border-[#55473d] bg-[#12100e] px-4 py-3 text-sm font-bold text-white outline-none placeholder:text-[#6f655d] focus:border-[#d78a46]"
                  autoComplete="current-password"
                />
              </label>
            </div>

            {error && (
              <div className="mt-5 border border-red-700 bg-red-950/40 px-4 py-3 text-sm font-bold text-red-200">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="mt-7 inline-flex h-12 w-full items-center justify-center gap-2 bg-[#d78a46] px-5 text-sm font-black uppercase text-[#171310] transition hover:bg-[#e49b58] disabled:opacity-60"
            >
              {loading ? (
                <LoaderCircle size={18} className="animate-spin" />
              ) : (
                <LogIn size={18} />
              )}
              Open Factory Portal
            </button>

            <a
              href="/"
              className="mt-4 inline-flex w-full items-center justify-center gap-2 border border-[#51443a] px-5 py-3 text-sm font-black uppercase text-[#bdb1a7] transition hover:text-white"
            >
              Employee Leave Portal
            </a>
          </form>
        </section>
      </div>
    </div>
  );
}

function FactoryDashboard({
  profile,
  modules: visibleModules,
  onSelect,
}: {
  profile: PortalProfile;
  modules: FactoryModuleDefinition[];
  onSelect: (moduleId: FactoryModuleId) => void;
}) {
  const liveCount = visibleModules.filter(
    (module) => module.state === "LIVE" && module.id !== "dashboard",
  ).length;

  return (
    <div className="space-y-6">
      <section className="overflow-hidden border border-[#2f2823] bg-[#171310] p-6 text-white lg:p-8">
        <p className="font-mono text-xs font-black uppercase tracking-[0.18em] text-[#d78a46]">
          Factory command centre
        </p>
        <h1 className="mt-2 text-4xl font-black uppercase tracking-tight sm:text-5xl">
          Welcome, {profile.displayName}
        </h1>
        <p className="mt-4 max-w-3xl text-sm leading-6 text-[#a89c92]">
          Select the department you want to manage. The same session and employee
          database are shared across the whole factory.
        </p>
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        {[
          ["Live modules", liveCount],
          ["Next module", "Production"],
          ["Management access", "All departments"],
        ].map(([label, value]) => (
          <div key={label} className="border border-[#cfc4b7] bg-white p-5">
            <p className="text-[11px] font-black uppercase tracking-[0.12em] text-[#76695f]">
              {label}
            </p>
            <p className="mt-3 font-mono text-2xl font-black text-[#171310]">
              {value}
            </p>
          </div>
        ))}
      </section>

      <section>
        <div className="mb-4 flex items-end justify-between gap-3">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.14em] text-[#b86c2c]">
              Plant departments
            </p>
            <h2 className="mt-1 text-3xl font-black uppercase">
              Select a module
            </h2>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visibleModules
            .filter((module) => module.id !== "dashboard")
            .map(({ id, label, description, icon: Icon, state }) => (
              <button
                key={id}
                type="button"
                onClick={() => onSelect(id)}
                className="group flex min-h-56 flex-col justify-between border border-[#cfc4b7] bg-white p-5 text-left transition hover:-translate-y-0.5 hover:border-[#b86c2c] hover:shadow-lg"
              >
                <div className="flex items-start justify-between gap-4">
                  <span className="grid h-12 w-12 place-items-center bg-[#201a16] text-[#d78a46]">
                    <Icon size={24} />
                  </span>
                  <span
                    className={`px-2 py-1 text-[9px] font-black uppercase ${
                      state === "LIVE"
                        ? "bg-emerald-100 text-emerald-900"
                        : state === "NEXT"
                          ? "bg-amber-100 text-amber-900"
                          : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {state}
                  </span>
                </div>

                <div className="mt-8">
                  <h3 className="text-2xl font-black uppercase">{label}</h3>
                  <p className="mt-3 text-sm leading-6 text-slate-500">
                    {description}
                  </p>
                </div>

                <span className="mt-5 inline-flex items-center gap-2 text-xs font-black uppercase text-[#8a4e22]">
                  Open module
                  <ArrowRight
                    size={16}
                    className="transition group-hover:translate-x-1"
                  />
                </span>
              </button>
            ))}
        </div>
      </section>
    </div>
  );
}

function LeaveModuleGateway() {
  return (
    <div className="space-y-6">
      <section className="border border-[#2f2823] bg-[#171310] p-6 text-white lg:p-8">
        <p className="font-mono text-xs font-black uppercase tracking-[0.18em] text-[#d78a46]">
          Workforce operations
        </p>
        <h1 className="mt-2 text-4xl font-black uppercase tracking-tight">
          Leave Management
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-[#a89c92]">
          Leave, attendance, overtime, manpower, employees, calendar and reports.
        </p>
      </section>

      <section className="grid gap-6 border border-[#cfc4b7] bg-white p-6 lg:grid-cols-[1fr_auto] lg:items-center">
        <div>
          <div className="grid h-14 w-14 place-items-center bg-[#201a16] text-[#d78a46]">
            <ClipboardCheck size={27} />
          </div>
          <h2 className="mt-5 text-3xl font-black uppercase">
            Workforce module is already live
          </h2>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-500">
            Open the existing Leave Management application. Your Factory Portal
            session is shared, so Management should not need to log in again.
          </p>
        </div>

        <a
          href="/"
          className="inline-flex h-14 items-center justify-center gap-3 bg-[#d78a46] px-6 text-sm font-black uppercase text-[#171310] hover:bg-[#e49b58]"
        >
          Open Leave Management
          <ArrowRight size={18} />
        </a>
      </section>
    </div>
  );
}

function PlannedModule({
  module,
}: {
  module: FactoryModuleDefinition;
}) {
  const Icon = module.icon;

  return (
    <div className="space-y-6">
      <section className="border border-[#2f2823] bg-[#171310] p-6 text-white lg:p-8">
        <p className="font-mono text-xs font-black uppercase tracking-[0.18em] text-[#d78a46]">
          Factory module
        </p>
        <h1 className="mt-2 text-4xl font-black uppercase tracking-tight">
          {module.label}
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-[#a89c92]">
          {module.description}
        </p>
      </section>

      <section className="grid min-h-[430px] place-items-center border border-[#cfc4b7] bg-white p-8 text-center">
        <div className="max-w-xl">
          <span className="mx-auto grid h-20 w-20 place-items-center bg-[#201a16] text-[#d78a46]">
            <Icon size={36} />
          </span>
          <p className="mt-6 text-xs font-black uppercase tracking-[0.16em] text-[#b86c2c]">
            {module.state === "NEXT" ? "Next department" : "Planned module"}
          </p>
          <h2 className="mt-2 text-3xl font-black uppercase">
            Structure ready
          </h2>
          <p className="mt-4 text-sm leading-6 text-slate-500">
            This tab is already reserved in the central Factory Portal. Its
            workflow will be added department by department without rebuilding the
            navigation or the Manager login.
          </p>
        </div>
      </section>
    </div>
  );
}
