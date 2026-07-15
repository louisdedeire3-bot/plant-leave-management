export type Language = "en" | "oshi";

export type RoleView = "employee" | "calendar" | "supervisor" | "manager";

export type LeaveStatus =
  | "pending_supervisor"
  | "pending_manager"
  | "approved"
  | "rejected";

export type Department =
  | "Production"
  | "Laboratory"
  | "Maintenance"
  | "Logistics"
  | "Warehouse";

export interface Employee {
  id: string;
  firstName: string;
  surname: string;
  nickname: string;
  department: Department;
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
