export type Language = "en" | "oshi";

export type RoleView = "employee" | "calendar" | "supervisor" | "manager";
export type EmployeeModule = "leave" | "overtime";

export type RequestStatus =
  | "pending_supervisor"
  | "pending_manager"
  | "approved"
  | "rejected"
  | "cancelled";

export type LeaveStatus = RequestStatus;
export type OvertimeStatus = RequestStatus;

export interface Employee {
  id: string;
  employeeCode: string;
  firstName: string;
  surname: string;
  nickname: string;
  department: string;
  supervisor: string;
  manager: string;
  balance: number;
  earned: number;
  used: number;
}

export interface LeaveRequest {
  id: string;
  employeeId: string;
  startDate: string;
  endDate: string;
  days: number;
  comment: string;
  status: LeaveStatus;
  createdAt: string;
}

export interface OvertimeRequest {
  id: string;
  employeeId: string;
  overtimeDate: string;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  totalHours: number;
  reason: string;
  status: OvertimeStatus;
  createdAt: string;
}
