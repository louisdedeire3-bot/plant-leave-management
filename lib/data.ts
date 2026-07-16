// Legacy demo data file kept only so browser uploads cleanly overwrite the previous version.
// The application now loads all employees and requests from Supabase.
import type { Employee, LeaveRequest } from "@/lib/types";

export const employees: Employee[] = [];
export const initialRequests: LeaveRequest[] = [];
