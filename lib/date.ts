import type { LeaveRequest } from "@/lib/types";

export function calculateLeaveDays(startDate: string, endDate: string): number {
  if (!startDate || !endDate) return 0;

  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
    return -1;
  }

  let days = 0;
  const cursor = new Date(start);

  while (cursor <= end) {
    if (cursor.getDay() !== 0) days += 1;
    cursor.setDate(cursor.getDate() + 1);
  }

  return days;
}

export function calculateOvertimeHours(
  startTime: string,
  endTime: string,
  breakMinutes: number,
): number {
  if (!startTime || !endTime) return 0;

  const [startHour, startMinute] = startTime.split(":").map(Number);
  const [endHour, endMinute] = endTime.split(":").map(Number);
  if ([startHour, startMinute, endHour, endMinute].some(Number.isNaN)) return 0;

  let totalMinutes = endHour * 60 + endMinute - (startHour * 60 + startMinute);
  if (totalMinutes <= 0) totalMinutes += 24 * 60;
  totalMinutes -= Math.max(0, breakMinutes || 0);

  return totalMinutes > 0 ? Math.round((totalMinutes / 60) * 100) / 100 : 0;
}

export function formatDate(date: string, locale = "en-GB"): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(`${date}T00:00:00`));
}

export function formatShortDate(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "2-digit",
  }).format(date);
}

export function isoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function startOfWeek(date: Date): Date {
  const result = new Date(date);
  const day = result.getDay();
  const difference = day === 0 ? -6 : 1 - day;
  result.setDate(result.getDate() + difference);
  result.setHours(0, 0, 0, 0);
  return result;
}

export function requestStatusOnDate(
  employeeId: string,
  date: string,
  requests: LeaveRequest[],
): "approved" | "pending_supervisor" | "pending_manager" | "working" {
  const matches = requests.filter(
    (request) =>
      request.employeeId === employeeId &&
      request.status !== "rejected" &&
      request.status !== "cancelled" &&
      date >= request.startDate &&
      date <= request.endDate,
  );

  if (matches.some((request) => request.status === "approved")) return "approved";
  if (matches.some((request) => request.status === "pending_manager")) return "pending_manager";
  if (matches.some((request) => request.status === "pending_supervisor")) return "pending_supervisor";
  return "working";
}
