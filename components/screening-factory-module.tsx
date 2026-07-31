"use client";

// GCN SCREENING MODULE V44 FINAL
// Includes: Farmer/Farm master, Office-assigned ERP lots,
// Manager validation, Screening Reports, PDF export and Excel export.

import {
  Boxes,
  Check,
  ChevronRight,
  CircleAlert,
  ClipboardList,
  Clock3,
  Download,
  FileCheck2,
  Factory,
  FileSpreadsheet,
  FileText,
  History,
  LoaderCircle,
  PackageCheck,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Truck,
  Warehouse,
  X,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { createSupabaseBrowserClient } from "@/lib/supabase";

type PortalRole = "employee" | "supervisor" | "manager";
type AppSection = "dashboard" | "incoming" | "new" | "history" | "stock";
type ScreeningStatus = "DRAFT" | "SUBMITTED" | "VALIDATED" | "CANCELLED";
type IncomingLoadStatus =
  | "AVAILABLE"
  | "IN_SCREENING"
  | "PENDING_VALIDATION"
  | "SCREENED"
  | "CANCELLED";
type ScreeningProductType =
  | "STANDARD"
  | "RESTAURANT"
  | "FINES"
  | "SAND_ASH"
  | "UNBURNT";

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

interface ScreeningEmployeeOption {
  id: string;
  employeeCode: string;
  employeeName: string;
  department: string;
  position: string;
}

type IncomingErpLots = Record<ScreeningProductType, string>;
type ScreeningPriceMap = Record<ScreeningProductType, number>;

interface FarmOption {
  id: string;
  farmName: string;
}

interface FarmerOption {
  id: string;
  farmerName: string;
  farms: FarmOption[];
}

interface ScreeningReportSettings {
  fscCode: string;
  currency: string;
  prices: ScreeningPriceMap;
}

interface IncomingLoadRow {
  id: string;
  lotNumber: string;
  farmerId: string | null;
  farmId: string | null;
  farmerName: string;
  farmName: string;
  fscCode: string;
  prices: ScreeningPriceMap;
  receivedDate: string;
  receivedWeightKg: number;
  truckRegistration: string;
  transporterName: string;
  driverName: string;
  notes: string;
  erpLots: IncomingErpLots;
  status: IncomingLoadStatus;
  cancellationComment: string;
  createdAt: string;
  createdBy: string;
}

interface ScreeningProductRow {
  id?: string;
  productType: ScreeningProductType;
  erpLotNumber: string;
  bigBagCount: number;
  totalWeightKg: number;
  averageBagWeightKg?: number;
  yieldPercent?: number;
}

interface ScreeningLoadRow {
  id: string;
  incomingLoadId: string | null;
  screeningDate: string;
  shift: "DAY" | "NIGHT";
  rawLotNumber: string;
  rawWeightKg: number;
  farmerName: string;
  farmName: string;
  receivedDate: string | null;
  truckRegistration: string;
  transporterName: string;
  lineName: string;
  status: ScreeningStatus;
  notes: string;
  returnComment: string;
  createdAt: string;
  submittedAt: string | null;
  validatedAt: string | null;
  createdBy: string;
  validatedBy: string;
  totalOutputKg: number;
  differenceKg: number;
  yieldPercent: number;
  products: ScreeningProductRow[];
  employees: ScreeningEmployeeOption[];
}

interface ScreeningStockRow {
  id: string;
  productType: ScreeningProductType;
  erpLotNumber: string;
  sourceRawLotNumber: string;
  initialWeightKg: number;
  availableWeightKg: number;
  initialBigBags: number;
  availableBigBags: number;
  stockStatus: "AVAILABLE" | "HOLD" | "DEPLETED" | "CANCELLED";
  createdAt: string;
}

interface ScreeningBootstrap {
  incomingLoads: IncomingLoadRow[];
  farmers: FarmerOption[];
  settings: ScreeningReportSettings;
  employees: ScreeningEmployeeOption[];
  loads: ScreeningLoadRow[];
  stock: ScreeningStockRow[];
}

interface ScreeningSavePayload {
  loadId: string | null;
  incomingLoadId: string;
  screeningDate: string;
  shift: "DAY" | "NIGHT";
  lineName: string;
  notes: string;
  employeeIds: string[];
  products: ScreeningProductRow[];
  submit: boolean;
}

interface IncomingLoadSavePayload {
  loadId: string | null;
  lotNumber: string;
  farmerId: string;
  farmId: string;
  receivedDate: string;
  receivedWeightKg: number;
  truckRegistration: string;
  transporterName: string;
  driverName: string;
  notes: string;
  erpLots: IncomingErpLots;
}

interface ScreeningReportRow {
  productType: ScreeningProductType;
  qualityLabel: string;
  erpLotNumber: string;
  pricePerTon: number;
  tonnage: number;
  percentage: number;
  value: number;
}

interface ScreeningReportData {
  reportCode: string;
  deliveryNoteNumber: string;
  deliveryDate: string;
  farmerName: string;
  farmName: string;
  fscCode: string;
  currency: string;
  rows: ScreeningReportRow[];
  totalTonnage: number;
  totalValue: number;
  validatedAt: string | null;
}

const productOrder: ScreeningProductType[] = [
  "STANDARD",
  "RESTAURANT",
  "FINES",
  "SAND_ASH",
  "UNBURNT",
];

const productLabels: Record<ScreeningProductType, string> = {
  STANDARD: "Standard charcoal",
  RESTAURANT: "Restaurant charcoal",
  FINES: "Fines",
  SAND_ASH: "Sand / Ash",
  UNBURNT: "Unburnt",
};

const productShortLabels: Record<ScreeningProductType, string> = {
  STANDARD: "STD",
  RESTAURANT: "RST",
  FINES: "FNS",
  SAND_ASH: "ASH",
  UNBURNT: "UNB",
};

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

function blankIncomingErpLots(): IncomingErpLots {
  return {
    STANDARD: "",
    RESTAURANT: "",
    FINES: "",
    SAND_ASH: "",
    UNBURNT: "",
  };
}

function defaultScreeningSettings(): ScreeningReportSettings {
  return {
    fscCode: "SGSCH-FM/COC-011482",
    currency: "NAD",
    prices: {
      STANDARD: 3200,
      RESTAURANT: 4000,
      FINES: 1300,
      SAND_ASH: 0,
      UNBURNT: 0,
    },
  };
}

function emptyScreeningBootstrap(): ScreeningBootstrap {
  return {
    incomingLoads: [],
    farmers: [],
    settings: defaultScreeningSettings(),
    employees: [],
    loads: [],
    stock: [],
  };
}

function hasCompleteIncomingErpLots(load: IncomingLoadRow): boolean {
  return productOrder.every(
    (productType) => Boolean(load.erpLots?.[productType]?.trim()),
  );
}

function productsFromIncomingLoad(
  load: IncomingLoadRow | null,
): ScreeningProductRow[] {
  return productOrder.map((productType) => ({
    productType,
    erpLotNumber: load?.erpLots?.[productType] ?? "",
    bigBagCount: 0,
    totalWeightKg: 0,
  }));
}

function blankProducts(): ScreeningProductRow[] {
  return productsFromIncomingLoad(null);
}

const reportProductOrder: ScreeningProductType[] = [
  "UNBURNT",
  "SAND_ASH",
  "FINES",
  "STANDARD",
  "RESTAURANT",
];

const reportQualityLabels: Record<ScreeningProductType, string> = {
  UNBURNT: "Unburn",
  SAND_ASH: "Sand (0-5mm)",
  FINES: "Fines (5-20mm)",
  STANDARD: "Charcoal (20-50mm)",
  RESTAURANT: "Restaurant (50mm+)",
};

function buildScreeningReportData(
  load: ScreeningLoadRow,
  data: ScreeningBootstrap,
): ScreeningReportData {
  if (load.status !== "VALIDATED") {
    throw new Error("The Screening Report is available only after Manager validation.");
  }

  const incoming = data.incomingLoads.find(
    (item) => item.id === load.incomingLoadId,
  );

  const prices = incoming?.prices ?? data.settings.prices;
  const fscCode = incoming?.fscCode || data.settings.fscCode;
  const totalTonnage =
    reportProductOrder.reduce((sum, productType) => {
      const product = load.products.find(
        (item) => item.productType === productType,
      );
      return sum + Number(product?.totalWeightKg ?? 0) / 1000;
    }, 0);

  const rows = reportProductOrder.map((productType) => {
    const product = load.products.find(
      (item) => item.productType === productType,
    );
    const tonnage = Number(product?.totalWeightKg ?? 0) / 1000;
    const pricePerTon = Number(prices?.[productType] ?? 0);

    return {
      productType,
      qualityLabel: reportQualityLabels[productType],
      erpLotNumber: product?.erpLotNumber ?? "",
      pricePerTon,
      tonnage,
      percentage: totalTonnage > 0 ? tonnage / totalTonnage : 0,
      value: tonnage * pricePerTon,
    };
  });

  return {
    reportCode: load.rawLotNumber,
    deliveryNoteNumber: load.rawLotNumber,
    deliveryDate:
      incoming?.receivedDate || load.receivedDate || load.screeningDate,
    farmerName: incoming?.farmerName || load.farmerName,
    farmName: incoming?.farmName || load.farmName || "Farm not specified",
    fscCode,
    currency: data.settings.currency,
    rows,
    totalTonnage,
    totalValue: rows.reduce((sum, row) => sum + row.value, 0),
    validatedAt: load.validatedAt,
  };
}

function safeReportFilename(value: string): string {
  return (
    value
      .trim()
      .replace(/[^A-Za-z0-9._-]+/g, "_")
      .replace(/^_+|_+$/g, "") || "screening-report"
  );
}

function reportDate(value: string): string {
  if (!value) return "";
  const [year, month, day] = value.slice(0, 10).split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

function reportNumber(value: number, decimals = 2): string {
  return Number(value || 0).toLocaleString("en-NA", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function reportTonnage(value: number): string {
  return Number(value || 0).toLocaleString("en-NA", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });
}

function reportPercentage(value: number): string {
  return `${Math.round(Number(value || 0) * 100)}%`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadScreeningReportExcel(report: ScreeningReportData) {
  const rows: Array<Array<string | number | null>> = [
    [null, "Delivery Date:", reportDate(report.deliveryDate), null, "GREEN NAMIBIA CHARCOAL", null, null, null],
    [null, "Farm:", report.farmName, null, null, null, null, null],
    [null, "FSC Code:", report.fscCode, null, null, null, null, null],
    [null, "Report Code:", report.reportCode, null, null, null, null, null],
    [null, "Delivery Note Number:", report.deliveryNoteNumber, null, null, null, null, null],
    [],
    [],
    [],
    [],
    [null, "Quality", "C.Fix", "Humidity", "Price per Ton", "Tonnage", "Percentage", `Value (${report.currency})`],
    ...report.rows.map((row) => [
      null,
      row.qualityLabel,
      null,
      null,
      row.pricePerTon,
      row.tonnage,
      row.percentage,
      row.value,
    ]),
    [null, "Total", null, null, null, report.totalTonnage, 1, report.totalValue],
    [null, null, null, null, null, null, "VAT Exc", report.totalValue],
    [],
    [],
    [
      null,
      `Please invoice to the following address: Green Charcoal Namibia PTY, Portion 13 Townland 170, PO Box 04 and send the invoice to: purchase.invoice@greencharcoalnamibia.com with ${report.reportCode} as reference\n\nFor any grievances or complaints in regards to our operations, please contact info@greencharcoalnamibia.com or +264 81 34 74 116`,
      null,
      null,
      null,
      null,
      null,
      null,
    ],
  ];

  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  worksheet["!merges"] = [
    { s: { r: 0, c: 4 }, e: { r: 4, c: 7 } },
    { s: { r: 19, c: 1 }, e: { r: 19, c: 7 } },
  ];
  worksheet["!cols"] = [
    { wch: 3 },
    { wch: 28 },
    { wch: 23 },
    { wch: 15 },
    { wch: 18 },
    { wch: 16 },
    { wch: 15 },
    { wch: 18 },
  ];
  worksheet["!rows"] = Array.from({ length: 20 }, (_, index) => ({
    hpt: index === 19 ? 64 : index === 0 ? 26 : 20,
  }));

  for (let row = 11; row <= 15; row += 1) {
    const tonnageCell = worksheet[`F${row}`];
    const percentageCell = worksheet[`G${row}`];
    const valueCell = worksheet[`H${row}`];
    if (tonnageCell) tonnageCell.z = "0.000";
    if (percentageCell) percentageCell.z = "0%";
    if (valueCell) valueCell.z = '#,##0.00;[Red]-#,##0.00;"-"';
  }

  for (const row of [16]) {
    if (worksheet[`F${row}`]) worksheet[`F${row}`].z = "0.000";
    if (worksheet[`G${row}`]) worksheet[`G${row}`].z = "0%";
    if (worksheet[`H${row}`]) worksheet[`H${row}`].z = "#,##0.00";
  }
  if (worksheet.H17) worksheet.H17.z = "#,##0.00";

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Screening Report");
  XLSX.writeFile(
    workbook,
    `${safeReportFilename(report.reportCode)}.xlsx`,
    { compression: true },
  );
}

function pdfAscii(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, " ");
}

function pdfEscape(value: string): string {
  return pdfAscii(value)
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function pdfTextWidth(value: string, size: number): number {
  return pdfAscii(value).length * size * 0.52;
}

function pdfText(
  value: string,
  x: number,
  y: number,
  size: number,
  font: "F1" | "F2" | "F3" = "F1",
  align: "left" | "center" | "right" = "left",
): string {
  const width = pdfTextWidth(value, size);
  const drawX =
    align === "center" ? x - width / 2 : align === "right" ? x - width : x;
  return `BT /${font} ${size.toFixed(2)} Tf 1 0 0 1 ${drawX.toFixed(2)} ${y.toFixed(2)} Tm (${pdfEscape(value)}) Tj ET\n`;
}

function pdfLine(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  width = 0.7,
): string {
  return `${width.toFixed(2)} w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S\n`;
}

function pdfFillRect(
  x: number,
  y: number,
  width: number,
  height: number,
  rgb: [number, number, number],
): string {
  return `q ${rgb[0]} ${rgb[1]} ${rgb[2]} rg ${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re f Q\n`;
}

function pdfCirclePath(cx: number, cy: number, radius: number): string {
  const k = radius * 0.5522847498;
  return [
    `${(cx + radius).toFixed(2)} ${cy.toFixed(2)} m`,
    `${(cx + radius).toFixed(2)} ${(cy + k).toFixed(2)} ${(cx + k).toFixed(2)} ${(cy + radius).toFixed(2)} ${cx.toFixed(2)} ${(cy + radius).toFixed(2)} c`,
    `${(cx - k).toFixed(2)} ${(cy + radius).toFixed(2)} ${(cx - radius).toFixed(2)} ${(cy + k).toFixed(2)} ${(cx - radius).toFixed(2)} ${cy.toFixed(2)} c`,
    `${(cx - radius).toFixed(2)} ${(cy - k).toFixed(2)} ${(cx - k).toFixed(2)} ${(cy - radius).toFixed(2)} ${cx.toFixed(2)} ${(cy - radius).toFixed(2)} c`,
    `${(cx + k).toFixed(2)} ${(cy - radius).toFixed(2)} ${(cx + radius).toFixed(2)} ${(cy - k).toFixed(2)} ${(cx + radius).toFixed(2)} ${cy.toFixed(2)} c`,
  ].join(" ");
}

function createSimplePdf(content: string): Uint8Array {
  const encoder = new TextEncoder();
  const streamLength = encoder.encode(content).length;

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 4 0 R /F2 5 0 R /F3 6 0 R >> >> /Contents 7 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique >>",
    `<< /Length ${streamLength} >>\nstream\n${content}endstream`,
  ];

  let pdf = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets = [0];

  objects.forEach((object, index) => {
    offsets.push(encoder.encode(pdf).length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = encoder.encode(pdf).length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return encoder.encode(pdf);
}

function downloadScreeningReportPdf(report: ScreeningReportData) {
  let content = "";
  content += "0 G 0 g\n";

  const labelX = 62;
  const valueX = 182;
  const metaRows: Array<[string, string]> = [
    ["Delivery Date:", reportDate(report.deliveryDate)],
    ["Farm:", report.farmName],
    ["FSC Code:", report.fscCode],
    ["Report Code:", report.reportCode],
    ["Delivery Note Number:", report.deliveryNoteNumber],
  ];

  metaRows.forEach(([label, value], index) => {
    const y = 520 - index * 23;
    content += pdfText(label, labelX, y, 12, "F1");
    content += pdfText(value, valueX + 92, y, 12, "F1", "center");
    content += pdfLine(valueX, y - 5, valueX + 184, y - 5, 0.35);
  });
  content += pdfLine(valueX, 406, valueX, 535, 0.35);
  content += pdfLine(valueX + 184, 406, valueX + 184, 535, 0.35);

  content += "0 0.58 0.22 RG\n";
  [31, 24, 17, 10].forEach((radius) => {
    content += `2.2 w ${pdfCirclePath(438, 478, radius)} S\n`;
  });
  content += "0 0.58 0.22 rg\n";
  content += pdfText("GREEN", 485, 493, 24, "F1");
  content += pdfText("NAMIBIA", 575, 493, 11, "F1");
  content += pdfText("CHARCOAL", 485, 462, 24, "F1");
  content += "0 G 0 g\n";

  const columns = [55, 188, 310, 404, 500, 600, 690, 790];
  const centers = [
    (columns[0] + columns[1]) / 2,
    (columns[1] + columns[2]) / 2,
    (columns[2] + columns[3]) / 2,
    (columns[3] + columns[4]) / 2,
    (columns[4] + columns[5]) / 2,
    (columns[5] + columns[6]) / 2,
    (columns[6] + columns[7]) / 2,
  ];
  const headers = [
    "Quality",
    "C.Fix",
    "Humidity",
    "Price per Ton",
    "Tonnage",
    "Percentage",
    `Value (${report.currency})`,
  ];

  headers.forEach((header, index) => {
    content += pdfText(header, centers[index], 346, 11, "F2", "center");
  });
  content += pdfLine(columns[0], 339, columns[7], 339, 0.75);
  columns.slice(1).forEach((x) => {
    content += pdfLine(x, 202, x, 360, 0.45);
  });

  const rowY = [316, 290, 264, 238, 212];
  report.rows.forEach((row, index) => {
    const y = rowY[index];
    content += pdfText(row.qualityLabel, columns[1] - 7, y, 11, "F3", "right");
    content += pdfText(
      reportNumber(row.pricePerTon, 0),
      columns[4] - 12,
      y,
      11,
      "F1",
      "right",
    );
    content += pdfText(
      reportTonnage(row.tonnage),
      columns[5] - 12,
      y,
      11,
      "F1",
      "right",
    );
    content += pdfText(
      reportPercentage(row.percentage),
      columns[6] - 14,
      y,
      11,
      "F1",
      "right",
    );
    content += pdfText(
      row.value === 0 ? "-" : reportNumber(row.value, 2),
      columns[7] - 8,
      y,
      11,
      "F1",
      "right",
    );
  });

  content += pdfFillRect(
    columns[1],
    201,
    columns[3] - columns[1],
    25,
    [0.26, 0.33, 0.42],
  );
  content += pdfLine(columns[0], 201, columns[4], 201, 0.75);
  content += pdfText("Total", columns[1] - 7, 183, 11, "F2", "right");
  content += pdfText(
    reportTonnage(report.totalTonnage),
    columns[5] - 12,
    183,
    11,
    "F1",
    "right",
  );
  content += pdfText("100%", columns[6] - 14, 183, 11, "F1", "right");
  content += pdfText(
    reportNumber(report.totalValue, 2),
    columns[7] - 8,
    183,
    11,
    "F1",
    "right",
  );
  content += pdfLine(columns[5], 174, columns[7], 174, 0.55);
  content += pdfText("VAT Exc", columns[6] - 14, 158, 11, "F2", "right");
  content += pdfText(
    reportNumber(report.totalValue, 2),
    columns[7] - 8,
    158,
    11,
    "F2",
    "right",
  );

  content += pdfText(
    "Please invoice to the following address: Green Charcoal Namibia PTY, Portion 13 Townland 170, PO Box 04 and send the invoice to:",
    421,
    105,
    9.5,
    "F1",
    "center",
  );
  content += pdfText(
    `purchase.invoice@greencharcoalnamibia.com with ${report.reportCode} as reference`,
    421,
    88,
    9.5,
    "F1",
    "center",
  );
  content += pdfText(
    "For any grievances or complaints in regards to our operations, please contact info@greencharcoalnamibia.com or +264 81 34 74 116",
    421,
    54,
    9,
    "F1",
    "center",
  );

  const bytes = createSimplePdf(content);
  const pdfBuffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;

  downloadBlob(
    new Blob([pdfBuffer], { type: "application/pdf" }),
    `${safeReportFilename(report.reportCode)}.pdf`,
  );
}

function statusStyle(status: ScreeningStatus): string {
  return {
    DRAFT: "border-slate-300 bg-slate-100 text-slate-700",
    SUBMITTED: "border-amber-300 bg-amber-100 text-amber-900",
    VALIDATED: "border-emerald-300 bg-emerald-100 text-emerald-900",
    CANCELLED: "border-red-300 bg-red-100 text-red-800",
  }[status];
}

const inputClass =
  "h-12 w-full border border-[#cfc4b7] bg-white px-4 text-sm font-semibold text-[#171310] outline-none transition placeholder:text-slate-400 focus:border-[#b86c2c] focus:ring-2 focus:ring-[#b86c2c]/15";


export interface ScreeningFactoryProfile {
  accountId: string;
  loginId: string;
  employeeId: string | null;
  displayName: string;
  role: PortalRole;
  department: string;
  expiresAt: string;
}

type ScreeningModuleSection =
  | "control"
  | "incoming"
  | "new"
  | "history"
  | "reports"
  | "stock";

export function ScreeningFactoryModule({
  profile,
  sessionToken,
}: {
  profile: ScreeningFactoryProfile;
  sessionToken: string;
}) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [section, setSection] = useState<ScreeningModuleSection>("control");
  const [data, setData] = useState<ScreeningBootstrap>(
    emptyScreeningBootstrap(),
  );
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);

  const loadData = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    setMessage(null);

    try {
      const { data: response, error } = await supabase.rpc(
        "portal_screening_bootstrap",
        {
          p_token: sessionToken,
          p_limit: 500,
        },
      );

      if (error) throw error;

      const nextData = (response ?? {}) as Partial<ScreeningBootstrap>;
      setData({
        ...emptyScreeningBootstrap(),
        ...nextData,
        incomingLoads: nextData.incomingLoads ?? [],
        farmers: nextData.farmers ?? [],
        settings: nextData.settings ?? defaultScreeningSettings(),
        employees: nextData.employees ?? [],
        loads: nextData.loads ?? [],
        stock: nextData.stock ?? [],
      });
    } catch (error) {
      setMessage({ kind: "error", text: errorText(error) });
    } finally {
      setLoading(false);
    }
  }, [sessionToken, supabase]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  async function saveIncomingLoad(
    payload: IncomingLoadSavePayload,
  ): Promise<boolean> {
    if (!supabase) return false;
    setLoading(true);
    setMessage(null);

    try {
      const { error } = await supabase.rpc(
        "portal_save_incoming_charcoal_load",
        {
          p_token: sessionToken,
          p_load_id: payload.loadId,
          p_lot_number: payload.lotNumber,
          p_farmer_id: payload.farmerId,
          p_farm_id: payload.farmId,
          p_received_date: payload.receivedDate,
          p_received_weight_kg: payload.receivedWeightKg,
          p_truck_registration: payload.truckRegistration || null,
          p_transporter_name: payload.transporterName || null,
          p_driver_name: payload.driverName || null,
          p_notes: payload.notes || null,
          p_erp_lots: payload.erpLots,
        },
      );

      if (error) throw error;

      setMessage({
        kind: "success",
        text: payload.loadId
          ? "Incoming load updated."
          : "Incoming farmer load recorded and available for Screening.",
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

  async function cancelIncomingLoad(
    loadId: string,
    comment: string,
  ): Promise<boolean> {
    if (!supabase) return false;
    setLoading(true);
    setMessage(null);

    try {
      const { error } = await supabase.rpc(
        "portal_cancel_incoming_charcoal_load",
        {
          p_token: sessionToken,
          p_load_id: loadId,
          p_comment: comment || null,
        },
      );

      if (error) throw error;

      setMessage({ kind: "success", text: "Incoming load cancelled." });
      await loadData();
      return true;
    } catch (error) {
      setMessage({ kind: "error", text: errorText(error) });
      return false;
    } finally {
      setLoading(false);
    }
  }

  async function saveLoad(payload: ScreeningSavePayload): Promise<boolean> {
    if (!supabase) return false;
    setLoading(true);
    setMessage(null);

    try {
      const { error } = await supabase.rpc("portal_save_screening_load", {
        p_token: sessionToken,
        p_load_id: payload.loadId,
        p_incoming_load_id: payload.incomingLoadId,
        p_screening_date: payload.screeningDate,
        p_shift: payload.shift,
        p_line_name: payload.lineName || null,
        p_notes: payload.notes || null,
        p_employee_ids: payload.employeeIds,
        p_products: payload.products.map((product) => ({
          productType: product.productType,
          erpLotNumber: product.erpLotNumber,
          bigBagCount: product.bigBagCount,
          totalWeightKg: product.totalWeightKg,
        })),
        p_submit: payload.submit,
      });

      if (error) throw error;

      setMessage({
        kind: "success",
        text: payload.submit
          ? "Screening load submitted for Manager validation."
          : "Screening draft saved.",
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

  async function decideLoad(
    loadId: string,
    decision: "VALIDATE" | "RETURN" | "CANCEL",
    comment: string,
  ): Promise<boolean> {
    if (!supabase) return false;
    setLoading(true);
    setMessage(null);

    try {
      const { error } = await supabase.rpc("portal_decide_screening_load", {
        p_token: sessionToken,
        p_load_id: loadId,
        p_decision: decision,
        p_comment: comment || null,
      });

      if (error) throw error;

      setMessage({
        kind: "success",
        text:
          decision === "VALIDATE"
            ? "Load validated and product stock created."
            : decision === "RETURN"
              ? "Load returned to draft."
              : "Load cancelled.",
      });

      await loadData();
      if (decision === "VALIDATE") {
        setSection("reports");
      }
      return true;
    } catch (error) {
      setMessage({ kind: "error", text: errorText(error) });
      return false;
    } finally {
      setLoading(false);
    }
  }

  const pendingCount = data.loads.filter(
    (load) => load.status === "SUBMITTED",
  ).length;

  const sectionItems: Array<{
    id: ScreeningModuleSection;
    label: string;
    managerOnly?: boolean;
  }> = [
    { id: "control", label: "Control room" },
    { id: "incoming", label: "Incoming loads", managerOnly: true },
    { id: "new", label: "New screening load" },
    { id: "history", label: `Load history${pendingCount ? ` (${pendingCount})` : ""}` },
    {
      id: "reports",
      label: `Screening reports (${data.loads.filter((load) => load.status === "VALIDATED").length})`,
      managerOnly: true,
    },
    { id: "stock", label: "Product stock" },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border border-[#cfc4b7] bg-white p-3">
        <div className="flex flex-wrap gap-2">
          {sectionItems
            .filter((item) => !item.managerOnly || profile.role === "manager")
            .map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setSection(item.id)}
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
        <ControlRoom
          profile={profile}
          data={data}
          loading={loading}
          onOpenIncoming={() => setSection("incoming")}
          onOpenNew={() => setSection("new")}
          onOpenHistory={() => setSection("history")}
          onOpenReports={() => setSection("reports")}
          onOpenStock={() => setSection("stock")}
          onDecision={decideLoad}
        />
      )}

      {section === "incoming" && profile.role === "manager" && (
        <IncomingLoadsManagement
          data={data}
          loading={loading}
          onSave={saveIncomingLoad}
          onCancel={cancelIncomingLoad}
        />
      )}

      {section === "new" && (
        <ScreeningForm
          data={data}
          loading={loading}
          onSave={saveLoad}
          onOpenHistory={() => setSection("history")}
        />
      )}

      {section === "history" && (
        <ScreeningHistory
          role={profile.role}
          data={data}
          loading={loading}
          onEdit={() => setSection("new")}
          onDecision={decideLoad}
        />
      )}

      {section === "reports" && profile.role === "manager" && (
        <ScreeningReports data={data} />
      )}

      {section === "stock" && <ScreeningStock data={data} />}
    </div>
  );
}

function ControlRoom({
  profile,
  data,
  loading,
  onOpenIncoming,
  onOpenNew,
  onOpenHistory,
  onOpenReports,
  onOpenStock,
  onDecision,
}: {
  profile: PortalProfile;
  data: ScreeningBootstrap;
  loading: boolean;
  onOpenIncoming: () => void;
  onOpenNew: () => void;
  onOpenHistory: () => void;
  onOpenReports: () => void;
  onOpenStock: () => void;
  onDecision: (
    loadId: string,
    decision: "VALIDATE" | "RETURN" | "CANCEL",
    comment: string,
  ) => Promise<boolean>;
}) {
  const today = isoDate(new Date());
  const todayLoads = data.loads.filter((load) => load.screeningDate === today);
  const pending = data.loads.filter((load) => load.status === "SUBMITTED");
  const drafts = data.loads.filter((load) => load.status === "DRAFT");
  const availableIncoming = data.incomingLoads.filter(
    (load) => load.status === "AVAILABLE",
  );
  const todayOutput = todayLoads.reduce(
    (sum, load) => sum + Number(load.totalOutputKg || 0),
    0,
  );
  const availableStock = data.stock
    .filter((stock) => stock.stockStatus === "AVAILABLE")
    .reduce((sum, stock) => sum + Number(stock.availableWeightKg || 0), 0);

  return (
    <div className="space-y-6">
      <section className="overflow-hidden border border-[#2f2823] bg-[#171310] text-white">
        <div className="grid gap-8 p-6 lg:grid-cols-[1fr_auto] lg:items-end lg:p-8">
          <div>
            <p className="font-mono text-xs font-black uppercase tracking-[0.18em] text-[#d78a46]">
              Screening control room
            </p>
            <h1 className="mt-2 text-4xl font-black uppercase tracking-tight sm:text-5xl">
              {formatDate(today)}
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-[#a89c92]">
              Record completed farmer loads, control validation and maintain full
              ERP-lot traceability.
            </p>
          </div>

          <button
            type="button"
            onClick={onOpenNew}
            className="inline-flex h-14 items-center justify-center gap-3 bg-[#d78a46] px-6 text-sm font-black uppercase text-[#171310] transition hover:bg-[#e49b58]"
          >
            <Truck size={21} />
            Record completed load
            <ChevronRight size={18} />
          </button>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {[
          {
            label: "Incoming available",
            value: availableIncoming.length,
            detail: "Farmer loads ready to select",
            icon: ClipboardList,
          },
          {
            label: "Loads today",
            value: todayLoads.length,
            detail: `${drafts.length} drafts open`,
            icon: Truck,
          },
          {
            label: "Output today",
            value: formatKg(todayOutput),
            detail: "All five product streams",
            icon: Boxes,
          },
          {
            label: "Pending validation",
            value: pending.length,
            detail: profile.role === "manager" ? "Manager action required" : "Awaiting Manager",
            icon: Clock3,
          },
          {
            label: "Available product stock",
            value: formatKg(availableStock),
            detail: `${data.stock.length} ERP lots`,
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

      <section className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
        <div className="border border-[#cfc4b7] bg-white">
          <div className="flex items-center justify-between gap-3 border-b border-[#d8cec3] px-5 py-4">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.14em] text-[#b86c2c]">
                Today's activity
              </p>
              <h2 className="mt-1 text-2xl font-black uppercase">Screened loads</h2>
            </div>
            <button
              type="button"
              onClick={onOpenHistory}
              className="text-xs font-black uppercase text-[#8a4e22] underline underline-offset-4"
            >
              Full history
            </button>
          </div>

          {todayLoads.length === 0 ? (
            <div className="grid min-h-64 place-items-center p-8 text-center">
              <div>
                <Truck size={36} className="mx-auto text-[#b9ada2]" />
                <p className="mt-4 font-black uppercase text-slate-700">
                  No screening loads recorded today
                </p>
                <p className="mt-2 text-sm text-slate-500">
                  The Supervisor records one form after a farmer lot is completed.
                </p>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-[#e3dbd2]">
              {todayLoads.map((load) => (
                <div key={load.id} className="p-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-xl font-black">{load.rawLotNumber}</h3>
                        <span
                          className={`border px-2 py-1 text-[10px] font-black uppercase ${statusStyle(load.status)}`}
                        >
                          {load.status}
                        </span>
                      </div>
                      <p className="mt-1 text-sm font-semibold text-slate-500">
                        {load.shift} shift
                        {load.lineName ? ` · ${load.lineName}` : ""}
                      </p>
                    </div>

                    <div className="text-right">
                      <p className="font-mono text-lg font-black">
                        {formatKg(load.totalOutputKg)}
                      </p>
                      <p className="text-xs font-bold text-slate-500">
                        {Number(load.yieldPercent || 0).toFixed(1)}% yield
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-5 gap-2">
                    {productOrder.map((type) => {
                      const product = load.products.find(
                        (item) => item.productType === type,
                      );
                      return (
                        <div
                          key={type}
                          className="border border-[#ddd4cb] bg-[#f6f2ed] p-2 text-center"
                        >
                          <p className="text-[10px] font-black uppercase text-[#8a4e22]">
                            {productShortLabels[type]}
                          </p>
                          <p className="mt-1 font-mono text-xs font-black">
                            {Number(product?.totalWeightKg ?? 0).toLocaleString(
                              "en-NA",
                              { maximumFractionDigits: 0 },
                            )}
                          </p>
                        </div>
                      );
                    })}
                  </div>
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
                {pending.slice(0, 4).map((load) => (
                  <div key={load.id} className="border border-[#43382f] bg-[#171310] p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-black">{load.rawLotNumber}</p>
                        <p className="mt-1 text-xs text-[#82766d]">
                          {formatDate(load.screeningDate)} · {load.createdBy}
                        </p>
                      </div>
                      <p className="font-mono text-sm font-black text-[#d78a46]">
                        {formatKg(load.totalOutputKg)}
                      </p>
                    </div>

                    {profile.role === "manager" && (
                      <button
                        type="button"
                        disabled={loading}
                        onClick={() =>
                          void onDecision(load.id, "VALIDATE", "")
                        }
                        className="mt-3 inline-flex w-full items-center justify-center gap-2 bg-emerald-700 px-3 py-2 text-xs font-black uppercase text-white hover:bg-emerald-800 disabled:opacity-50"
                      >
                        <PackageCheck size={15} />
                        Validate & create stock
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {profile.role === "manager" && (
            <button
              type="button"
              onClick={onOpenIncoming}
              className="flex w-full items-center justify-between border border-[#cfc4b7] bg-white p-5 text-left transition hover:border-[#b86c2c]"
            >
              <span>
                <span className="block text-[11px] font-black uppercase tracking-[0.14em] text-[#b86c2c]">
                  Incoming loads
                </span>
                <span className="mt-1 block text-xl font-black uppercase">
                  Record a farmer truck
                </span>
              </span>
              <ChevronRight size={22} />
            </button>
          )}

          {profile.role === "manager" && (
            <button
              type="button"
              onClick={onOpenReports}
              className="flex w-full items-center justify-between border border-[#cfc4b7] bg-white p-5 text-left transition hover:border-[#b86c2c]"
            >
              <span>
                <span className="block text-[11px] font-black uppercase tracking-[0.14em] text-[#b86c2c]">
                  Screening reports
                </span>
                <span className="mt-1 block text-xl font-black uppercase">
                  Download validated PDF / Excel
                </span>
              </span>
              <Download size={22} />
            </button>
          )}

          <button
            type="button"
            onClick={onOpenStock}
            className="flex w-full items-center justify-between border border-[#cfc4b7] bg-white p-5 text-left transition hover:border-[#b86c2c]"
          >
            <span>
              <span className="block text-[11px] font-black uppercase tracking-[0.14em] text-[#b86c2c]">
                Product stock
              </span>
              <span className="mt-1 block text-xl font-black uppercase">
                Open ERP lot inventory
              </span>
            </span>
            <ChevronRight size={22} />
          </button>
        </div>
      </section>
    </div>
  );
}

function incomingStatusStyle(status: IncomingLoadStatus): string {
  return {
    AVAILABLE: "border-emerald-300 bg-emerald-100 text-emerald-900",
    IN_SCREENING: "border-blue-300 bg-blue-100 text-blue-900",
    PENDING_VALIDATION: "border-amber-300 bg-amber-100 text-amber-900",
    SCREENED: "border-slate-300 bg-slate-200 text-slate-800",
    CANCELLED: "border-red-300 bg-red-100 text-red-800",
  }[status];
}

function IncomingLoadsManagement({
  data,
  loading,
  onSave,
  onCancel,
}: {
  data: ScreeningBootstrap;
  loading: boolean;
  onSave: (payload: IncomingLoadSavePayload) => Promise<boolean>;
  onCancel: (loadId: string, comment: string) => Promise<boolean>;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [lotNumber, setLotNumber] = useState("");
  const [farmerId, setFarmerId] = useState("");
  const [farmId, setFarmId] = useState("");
  const [receivedDate, setReceivedDate] = useState(isoDate(new Date()));
  const [receivedWeightKg, setReceivedWeightKg] = useState("");
  const [truckRegistration, setTruckRegistration] = useState("");
  const [transporterName, setTransporterName] = useState("");
  const [driverName, setDriverName] = useState("");
  const [notes, setNotes] = useState("");
  const [erpLots, setErpLots] = useState<IncomingErpLots>(
    blankIncomingErpLots(),
  );
  const [search, setSearch] = useState("");

  const farmers = data.farmers ?? [];
  const selectedFarmer = useMemo(
    () => farmers.find((farmer) => farmer.id === farmerId) ?? null,
    [farmerId, farmers],
  );
  const availableFarms = selectedFarmer?.farms ?? [];

  useEffect(() => {
    if (!farmerId) {
      setFarmId("");
      return;
    }

    if (!availableFarms.some((farm) => farm.id === farmId)) {
      setFarmId("");
    }
  }, [availableFarms, farmId, farmerId]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return data.incomingLoads;
    return data.incomingLoads.filter((load) =>
      `${load.lotNumber} ${load.farmerName} ${load.farmName} ${load.truckRegistration} ${load.transporterName} ${productOrder
        .map((productType) => load.erpLots?.[productType] ?? "")
        .join(" ")}`
        .toLowerCase()
        .includes(query),
    );
  }, [data.incomingLoads, search]);

  function resetForm() {
    setEditingId(null);
    setLotNumber("");
    setFarmerId("");
    setFarmId("");
    setReceivedDate(isoDate(new Date()));
    setReceivedWeightKg("");
    setTruckRegistration("");
    setTransporterName("");
    setDriverName("");
    setNotes("");
    setErpLots(blankIncomingErpLots());
  }

  function editLoad(load: IncomingLoadRow) {
    if (load.status !== "AVAILABLE") return;
    setEditingId(load.id);
    setLotNumber(load.lotNumber);

    const matchedFarmer =
      farmers.find((farmer) => farmer.id === load.farmerId)
      ?? farmers.find(
        (farmer) =>
          farmer.farmerName.trim().toLowerCase()
          === load.farmerName.trim().toLowerCase(),
      )
      ?? null;

    const matchedFarm =
      matchedFarmer?.farms.find((farm) => farm.id === load.farmId)
      ?? matchedFarmer?.farms.find(
        (farm) =>
          farm.farmName.trim().toLowerCase()
          === load.farmName.trim().toLowerCase(),
      )
      ?? null;

    setFarmerId(matchedFarmer?.id ?? "");
    setFarmId(matchedFarm?.id ?? "");
    setReceivedDate(load.receivedDate);
    setReceivedWeightKg(String(load.receivedWeightKg));
    setTruckRegistration(load.truckRegistration);
    setTransporterName(load.transporterName);
    setDriverName(load.driverName);
    setNotes(load.notes);
    setErpLots({
      ...blankIncomingErpLots(),
      ...load.erpLots,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const success = await onSave({
      loadId: editingId,
      lotNumber: lotNumber.trim().toUpperCase(),
      farmerId,
      farmId,
      receivedDate,
      receivedWeightKg: Number(receivedWeightKg || 0),
      truckRegistration: truckRegistration.trim().toUpperCase(),
      transporterName: transporterName.trim(),
      driverName: driverName.trim(),
      notes: notes.trim(),
      erpLots: Object.fromEntries(
        productOrder.map((productType) => [
          productType,
          erpLots[productType].trim().toUpperCase(),
        ]),
      ) as IncomingErpLots,
    });

    if (success) resetForm();
  }

  async function cancelLoad(load: IncomingLoadRow) {
    const comment = window.prompt(
      `Reason for cancelling incoming load ${load.lotNumber}:`,
    );
    if (comment === null) return;
    await onCancel(load.id, comment.trim());
  }

  const availableCount = data.incomingLoads.filter(
    (load) => load.status === "AVAILABLE",
  ).length;

  return (
    <div className="space-y-6">
      <section className="border border-[#2f2823] bg-[#171310] p-6 text-white">
        <p className="font-mono text-xs font-black uppercase tracking-[0.18em] text-[#d78a46]">
          Management receipt
        </p>
        <h1 className="mt-2 text-4xl font-black uppercase tracking-tight">
          Incoming farmer loads
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-[#a89c92]">
          Management selects the registered farmer and farm, records the truck
          once and assigns all five ERP product lots. Screening then receives the
          complete load automatically.
        </p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <div className="border border-white/15 bg-white/5 px-4 py-3 sm:col-span-2">
            <p className="text-[10px] font-black uppercase tracking-[0.14em] text-[#d78a46]">
              FSC code
            </p>
            <p className="mt-1 font-mono text-sm font-black">
              {data.settings.fscCode}
            </p>
          </div>
          {productOrder.map((productType) => (
            <div key={productType} className="border border-white/15 bg-white/5 px-4 py-3">
              <p className="text-[10px] font-black uppercase tracking-[0.14em] text-[#d78a46]">
                {productShortLabels[productType]} price
              </p>
              <p className="mt-1 text-sm font-black">
                {data.settings.currency}{" "}
                {Number(data.settings.prices[productType] ?? 0).toLocaleString("en-NA")}
                /t
              </p>
            </div>
          ))}
        </div>
      </section>

      <form onSubmit={submit} className="border border-[#cfc4b7] bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#d8cec3] bg-[#f4efe9] px-5 py-4">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.14em] text-[#b86c2c]">
              {editingId ? "Edit available load" : "New incoming load"}
            </p>
            <p className="mt-1 text-sm font-semibold text-slate-600">
              Select a registered farmer and farm. Received weight and all five ERP product lots are required.
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

        <div className="grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Farmer lot number">
            <input
              value={lotNumber}
              onChange={(event) => setLotNumber(event.target.value.toUpperCase())}
              placeholder="Existing farmer lot number"
              className={inputClass}
              required
            />
          </Field>

          <Field label="Farmer / supplier">
            <select
              value={farmerId}
              onChange={(event) => {
                setFarmerId(event.target.value);
                setFarmId("");
              }}
              className={inputClass}
              required
            >
              <option value="">Select farmer</option>
              {farmers.map((farmer) => (
                <option key={farmer.id} value={farmer.id}>
                  {farmer.farmerName}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Farm name">
            <select
              value={farmId}
              onChange={(event) => setFarmId(event.target.value)}
              className={inputClass}
              disabled={!farmerId}
              required
            >
              <option value="">
                {farmerId ? "Select farm" : "Select farmer first"}
              </option>
              {availableFarms.map((farm) => (
                <option key={farm.id} value={farm.id}>
                  {farm.farmName}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Date received">
            <input
              type="date"
              value={receivedDate}
              onChange={(event) => setReceivedDate(event.target.value)}
              className={inputClass}
              required
            />
          </Field>

          <Field label="Received weight (kg)">
            <input
              type="number"
              min="0.001"
              step="0.001"
              value={receivedWeightKg}
              onChange={(event) => setReceivedWeightKg(event.target.value)}
              placeholder="0"
              className={inputClass}
              required
            />
          </Field>

          <Field label="Truck registration">
            <input
              value={truckRegistration}
              onChange={(event) =>
                setTruckRegistration(event.target.value.toUpperCase())
              }
              placeholder="Optional"
              className={inputClass}
            />
          </Field>

          <Field label="Transporter">
            <input
              value={transporterName}
              onChange={(event) => setTransporterName(event.target.value)}
              placeholder="Optional transporter"
              className={inputClass}
            />
          </Field>

          <Field label="Driver">
            <input
              value={driverName}
              onChange={(event) => setDriverName(event.target.value)}
              placeholder="Optional driver"
              className={inputClass}
            />
          </Field>

          <div className="md:col-span-2 xl:col-span-4">
            <div className="border border-[#d8cec3] bg-[#f7f2ec]">
              <div className="border-b border-[#d8cec3] bg-[#201a16] px-4 py-3 text-white">
                <p className="text-[11px] font-black uppercase tracking-[0.14em] text-[#d78a46]">
                  ERP product lots · required
                </p>
                <p className="mt-1 text-xs font-semibold text-[#b8aca2]">
                  One ERP lot for each product created from this farmer load.
                </p>
              </div>
              <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-5">
                {productOrder.map((productType) => (
                  <Field
                    key={productType}
                    label={`${productShortLabels[productType]} · ${productLabels[productType]}`}
                  >
                    <input
                      value={erpLots[productType]}
                      onChange={(event) =>
                        setErpLots((current) => ({
                          ...current,
                          [productType]: event.target.value.toUpperCase(),
                        }))
                      }
                      placeholder="ERP lot number"
                      className={inputClass}
                      required
                    />
                  </Field>
                ))}
              </div>
            </div>
          </div>

          <div className="md:col-span-2 xl:col-span-3">
            <Field label="Comments">
              <input
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Quality, delivery or unloading notes"
                className={inputClass}
              />
            </Field>
          </div>

          <div className="flex items-end">
            <button
              type="submit"
              disabled={loading}
              className="inline-flex h-12 w-full items-center justify-center gap-2 bg-[#d78a46] px-5 text-sm font-black uppercase text-[#171310] hover:bg-[#e49b58] disabled:opacity-50"
            >
              {loading ? (
                <LoaderCircle size={18} className="animate-spin" />
              ) : editingId ? (
                <Save size={18} />
              ) : (
                <Plus size={18} />
              )}
              {editingId ? "Save changes" : "Add incoming load"}
            </button>
          </div>
        </div>
      </form>

      <section className="border border-[#cfc4b7] bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#d8cec3] px-5 py-4">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.14em] text-[#b86c2c]">
              Incoming register
            </p>
            <h2 className="mt-1 text-2xl font-black uppercase">
              {availableCount} available for Screening
            </h2>
          </div>

          <div className="relative w-full max-w-md">
            <Search
              size={17}
              className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search farmer lot, ERP lot, farmer, truck or transporter"
              className={`${inputClass} pl-11`}
            />
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="grid min-h-56 place-items-center p-8 text-center">
            <div>
              <ClipboardList size={38} className="mx-auto text-[#b9ada2]" />
              <p className="mt-4 font-black uppercase text-slate-700">
                No incoming loads found
              </p>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-[#201a16] text-white">
                <tr className="text-left text-[10px] font-black uppercase tracking-[0.08em]">
                  <th className="px-4 py-4">Farmer lot</th>
                  <th className="px-4 py-4">Farmer / Farm</th>
                  <th className="px-4 py-4">Received</th>
                  <th className="px-4 py-4 text-right">Weight</th>
                  <th className="px-4 py-4">Truck / Transporter</th>
                  <th className="px-4 py-4">ERP product lots</th>
                  <th className="px-4 py-4">Status</th>
                  <th className="px-4 py-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((load) => (
                  <tr key={load.id} className="border-b border-[#e4dcd3]">
                    <td className="px-4 py-4 font-mono text-xs font-black">
                      {load.lotNumber}
                    </td>
                    <td className="px-4 py-4">
                      <p className="font-black">{load.farmerName}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {load.farmName || "—"}
                      </p>
                    </td>
                    <td className="px-4 py-4">{formatDate(load.receivedDate)}</td>
                    <td className="px-4 py-4 text-right font-mono font-black">
                      {formatKg(load.receivedWeightKg)}
                    </td>
                    <td className="px-4 py-4">
                      <p className="font-bold">{load.truckRegistration || "—"}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {load.transporterName || "—"}
                      </p>
                    </td>
                    <td className="px-4 py-4">
                      <div className="grid gap-1">
                        {productOrder.map((productType) => (
                          <p
                            key={productType}
                            className="font-mono text-[10px] font-black"
                          >
                            <span className="mr-2 text-[#b86c2c]">
                              {productShortLabels[productType]}
                            </span>
                            {load.erpLots?.[productType] || "MISSING"}
                          </p>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <span
                        className={`border px-2 py-1 text-[10px] font-black uppercase ${incomingStatusStyle(load.status)}`}
                      >
                        {load.status.replaceAll("_", " ")}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      {load.status === "AVAILABLE" && (
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => editLoad(load)}
                            className="grid h-9 w-9 place-items-center border border-[#817267] bg-white hover:border-[#b86c2c]"
                            title="Edit"
                          >
                            <Pencil size={15} />
                          </button>
                          <button
                            type="button"
                            disabled={loading}
                            onClick={() => void cancelLoad(load)}
                            className="grid h-9 w-9 place-items-center border border-red-400 bg-red-50 text-red-700 disabled:opacity-50"
                            title="Cancel incoming load"
                          >
                            <X size={15} />
                          </button>
                        </div>
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

function ScreeningForm({
  data,
  loading,
  onSave,
  onOpenHistory,
}: {
  data: ScreeningBootstrap;
  loading: boolean;
  onSave: (payload: ScreeningSavePayload) => Promise<boolean>;
  onOpenHistory: () => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [incomingLoadId, setIncomingLoadId] = useState("");
  const [screeningDate, setScreeningDate] = useState(isoDate(new Date()));
  const [shift, setShift] = useState<"DAY" | "NIGHT">("DAY");
  const [lineName, setLineName] = useState("");
  const [notes, setNotes] = useState("");
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<string[]>([]);
  const [products, setProducts] = useState<ScreeningProductRow[]>(blankProducts());

  const availableIncomingLoads = useMemo(
    () =>
      data.incomingLoads.filter(
        (load) =>
          load.status === "AVAILABLE" && hasCompleteIncomingErpLots(load),
      ),
    [data.incomingLoads],
  );

  const selectedIncomingLoad = useMemo(
    () =>
      data.incomingLoads.find((load) => load.id === incomingLoadId) ?? null,
    [data.incomingLoads, incomingLoadId],
  );

  useEffect(() => {
    if (!selectedIncomingLoad || editingId) return;
    setProducts(productsFromIncomingLoad(selectedIncomingLoad));
  }, [editingId, selectedIncomingLoad]);

  const numericRawWeight = Number(selectedIncomingLoad?.receivedWeightKg ?? 0);
  const totalOutput = products.reduce(
    (sum, product) => sum + Number(product.totalWeightKg || 0),
    0,
  );
  const difference = numericRawWeight - totalOutput;
  const yieldPercent =
    numericRawWeight > 0 ? (totalOutput / numericRawWeight) * 100 : 0;

  const filteredEmployees = useMemo(() => {
    const query = employeeSearch.trim().toLowerCase();
    if (!query) return data.employees;
    return data.employees.filter((employee) =>
      `${employee.employeeCode} ${employee.employeeName} ${employee.department} ${employee.position}`
        .toLowerCase()
        .includes(query),
    );
  }, [data.employees, employeeSearch]);

  function resetForm() {
    setEditingId(null);
    setIncomingLoadId("");
    setScreeningDate(isoDate(new Date()));
    setShift("DAY");
    setLineName("");
    setNotes("");
    setEmployeeSearch("");
    setSelectedEmployeeIds([]);
    setProducts(blankProducts());
  }

  function toggleEmployee(employeeId: string) {
    setSelectedEmployeeIds((current) =>
      current.includes(employeeId)
        ? current.filter((id) => id !== employeeId)
        : [...current, employeeId],
    );
  }

  function updateProduct(
    productType: ScreeningProductType,
    patch: Partial<ScreeningProductRow>,
  ) {
    setProducts((current) =>
      current.map((product) =>
        product.productType === productType ? { ...product, ...patch } : product,
      ),
    );
  }

  async function submitForm(submit: boolean) {
    if (!incomingLoadId) return;

    const success = await onSave({
      loadId: editingId,
      incomingLoadId,
      screeningDate,
      shift,
      lineName: lineName.trim(),
      notes: notes.trim(),
      employeeIds: selectedEmployeeIds,
      products,
      submit,
    });

    if (success) {
      resetForm();
      if (submit) onOpenHistory();
    }
  }

  return (
    <div className="space-y-6">
      <section className="border border-[#2f2823] bg-[#171310] p-6 text-white">
        <p className="font-mono text-xs font-black uppercase tracking-[0.18em] text-[#d78a46]">
          Completed screening load
        </p>
        <h1 className="mt-2 text-4xl font-black uppercase tracking-tight">
          Select and screen farmer lot
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-[#a89c92]">
          Choose a load already entered by Management. The farmer lot, received
          weight, delivery details and five ERP product lots are filled automatically.
        </p>
      </section>

      <section className="border border-[#cfc4b7] bg-white">
        <div className="border-b border-[#d8cec3] bg-[#f4efe9] px-5 py-4">
          <p className="text-[11px] font-black uppercase tracking-[0.14em] text-[#b86c2c]">
            01 · Select incoming farmer load
          </p>
        </div>

        <div className="grid gap-4 p-5 xl:grid-cols-[minmax(0,1.3fr)_repeat(3,minmax(0,0.7fr))]">
          <Field label="Incoming farmer load">
            <select
              value={incomingLoadId}
              onChange={(event) => setIncomingLoadId(event.target.value)}
              className={inputClass}
            >
              <option value="">Select an available load</option>
              {availableIncomingLoads.map((load) => (
                <option key={load.id} value={load.id}>
                  {load.lotNumber} · {load.farmerName} · {formatKg(load.receivedWeightKg)}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Screening date">
            <input
              type="date"
              value={screeningDate}
              onChange={(event) => setScreeningDate(event.target.value)}
              className={inputClass}
            />
          </Field>

          <Field label="Shift">
            <select
              value={shift}
              onChange={(event) =>
                setShift(event.target.value as "DAY" | "NIGHT")
              }
              className={inputClass}
            >
              <option value="DAY">Day shift</option>
              <option value="NIGHT">Night shift</option>
            </select>
          </Field>

          <Field label="Screening line / machine">
            <input
              value={lineName}
              onChange={(event) => setLineName(event.target.value)}
              placeholder="Trommel / screening line"
              className={inputClass}
            />
          </Field>
        </div>

        {availableIncomingLoads.length === 0 && (
          <div className="border-t border-amber-300 bg-amber-50 px-5 py-4 text-sm font-bold text-amber-900">
            No complete incoming farmer load is currently available. Management must
            record the truck and all five ERP product lots first.
          </div>
        )}

        {data.incomingLoads.some(
          (load) =>
            load.status === "AVAILABLE" && !hasCompleteIncomingErpLots(load),
        ) && (
          <div className="border-t border-red-300 bg-red-50 px-5 py-4 text-sm font-bold text-red-800">
            Some older available loads are missing ERP product lots. Office must edit
            those loads before Screening can select them.
          </div>
        )}

        {selectedIncomingLoad && (
          <div className="border-t border-[#d8cec3] bg-[#201a16] p-5 text-white">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {[
              ["Farmer lot", selectedIncomingLoad.lotNumber],
              ["Farmer / Farm", `${selectedIncomingLoad.farmerName}${selectedIncomingLoad.farmName ? ` · ${selectedIncomingLoad.farmName}` : ""}`],
              ["Received", formatDate(selectedIncomingLoad.receivedDate)],
              ["Raw weight", formatKg(selectedIncomingLoad.receivedWeightKg)],
              ["Truck", selectedIncomingLoad.truckRegistration || "—"],
            ].map(([label, value]) => (
              <div key={label} className="border border-[#43382f] bg-[#171310] p-3">
                <p className="text-[10px] font-black uppercase tracking-[0.1em] text-[#81766d]">
                  {label}
                </p>
                <p className="mt-2 text-sm font-black text-[#e0d7cf]">{value}</p>
              </div>
            ))}
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              {productOrder.map((productType) => (
                <div
                  key={productType}
                  className="border border-[#5a4637] bg-[#241b15] p-3"
                >
                  <p className="text-[10px] font-black uppercase tracking-[0.1em] text-[#d78a46]">
                    {productShortLabels[productType]} ERP lot
                  </p>
                  <p className="mt-2 font-mono text-sm font-black text-white">
                    {selectedIncomingLoad.erpLots[productType]}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="border-t border-[#d8cec3] p-5">
          <Field label="Comments">
            <input
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Optional production notes"
              className={inputClass}
            />
          </Field>
        </div>
      </section>

      <section className="border border-[#cfc4b7] bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#d8cec3] bg-[#f4efe9] px-5 py-4">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.14em] text-[#b86c2c]">
              02 · Screening team
            </p>
            <p className="mt-1 text-sm font-semibold text-slate-600">
              Select all employees who worked on this load.
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
            03 · Five product outputs
          </p>
          <p className="mt-1 text-sm font-semibold text-slate-600">
            ERP lots are assigned by Office. Enter only big bags and total weights.
          </p>
        </div>

        <div className="grid gap-4 p-5 xl:grid-cols-2">
          {products.map((product) => {
            const weight = Number(product.totalWeightKg || 0);
            const bags = Number(product.bigBagCount || 0);
            const average = bags > 0 ? weight / bags : 0;
            const productYield =
              numericRawWeight > 0 ? (weight / numericRawWeight) * 100 : 0;

            return (
              <article
                key={product.productType}
                className="border border-[#d8cec3] bg-[#faf8f5]"
              >
                <div className="flex items-center justify-between gap-3 border-b border-[#ded5cb] bg-[#201a16] px-4 py-3 text-white">
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-xs font-black text-[#d78a46]">
                      {productShortLabels[product.productType]}
                    </span>
                    <h3 className="font-black uppercase">
                      {productLabels[product.productType]}
                    </h3>
                  </div>
                  <span className="font-mono text-xs font-black text-[#d78a46]">
                    {productYield.toFixed(1)}%
                  </span>
                </div>

                <div className="grid gap-3 p-4 sm:grid-cols-3">
                  <Field label="ERP lot number · Office">
                    <div className="flex h-12 items-center border border-[#cfc4b7] bg-[#eee8e1] px-4 font-mono text-sm font-black text-[#4b3a2e]">
                      {product.erpLotNumber || "Select an incoming load"}
                    </div>
                  </Field>

                  <Field label="Big bags">
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={product.bigBagCount}
                      onChange={(event) =>
                        updateProduct(product.productType, {
                          bigBagCount: Number(event.target.value || 0),
                        })
                      }
                      className={inputClass}
                    />
                  </Field>

                  <Field label="Total weight (kg)">
                    <input
                      type="number"
                      min="0"
                      step="0.001"
                      value={product.totalWeightKg}
                      onChange={(event) =>
                        updateProduct(product.productType, {
                          totalWeightKg: Number(event.target.value || 0),
                        })
                      }
                      className={inputClass}
                    />
                  </Field>
                </div>

                <div className="flex items-center justify-between border-t border-[#ded5cb] px-4 py-3 text-xs font-bold text-slate-500">
                  <span>Average weight per big bag</span>
                  <span className="font-mono text-sm font-black text-[#171310]">
                    {formatKg(average)}
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        {[
          ["Total output", formatKg(totalOutput)],
          ["Difference / process loss", formatKg(difference)],
          ["Total yield", `${yieldPercent.toFixed(2)}%`],
        ].map(([label, value]) => (
          <div key={label} className="border border-[#2f2823] bg-[#171310] p-5 text-white">
            <p className="text-[11px] font-black uppercase tracking-[0.12em] text-[#8e8379]">
              {label}
            </p>
            <p className="mt-3 font-mono text-2xl font-black text-[#d78a46]">
              {value}
            </p>
          </div>
        ))}
      </section>

      <div className="flex flex-wrap justify-end gap-3">
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
          disabled={loading || !incomingLoadId}
          onClick={() => void submitForm(false)}
          className="inline-flex h-12 items-center gap-2 border border-[#2f2823] bg-white px-5 text-sm font-black uppercase disabled:opacity-50"
        >
          {loading ? (
            <LoaderCircle size={17} className="animate-spin" />
          ) : (
            <Save size={17} />
          )}
          Save draft
        </button>

        <button
          type="button"
          disabled={loading || !incomingLoadId}
          onClick={() => void submitForm(true)}
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
  );
}

function ScreeningHistory({
  role,
  data,
  loading,
  onEdit,
  onDecision,
}: {
  role: PortalRole;
  data: ScreeningBootstrap;
  loading: boolean;
  onEdit: () => void;
  onDecision: (
    loadId: string,
    decision: "VALIDATE" | "RETURN" | "CANCEL",
    comment: string,
  ) => Promise<boolean>;
}) {
  const [statusFilter, setStatusFilter] = useState<"ALL" | ScreeningStatus>("ALL");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return data.loads.filter((load) => {
      const statusMatches =
        statusFilter === "ALL" || load.status === statusFilter;
      const searchMatches =
        !query ||
        `${load.rawLotNumber} ${load.createdBy} ${load.lineName}`
          .toLowerCase()
          .includes(query);
      return statusMatches && searchMatches;
    });
  }, [data.loads, search, statusFilter]);

  async function decide(
    load: ScreeningLoadRow,
    decision: "VALIDATE" | "RETURN" | "CANCEL",
  ) {
    let comment = "";

    if (decision === "RETURN") {
      const entered = window.prompt("Reason for returning this load:");
      if (entered === null) return;
      comment = entered.trim();
      if (!comment) return;
    }

    if (
      decision === "CANCEL" &&
      !window.confirm(`Cancel screening load ${load.rawLotNumber}?`)
    ) {
      return;
    }

    await onDecision(load.id, decision, comment);
  }

  return (
    <div className="space-y-6">
      <section className="border border-[#2f2823] bg-[#171310] p-6 text-white">
        <p className="font-mono text-xs font-black uppercase tracking-[0.18em] text-[#d78a46]">
          Traceability
        </p>
        <h1 className="mt-2 text-4xl font-black uppercase tracking-tight">
          Screening load history
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
              placeholder="Search raw lot, line or creator"
              className={`${inputClass} pl-11`}
            />
          </div>

          <select
            value={statusFilter}
            onChange={(event) =>
              setStatusFilter(event.target.value as "ALL" | ScreeningStatus)
            }
            className={`${inputClass} min-w-52`}
          >
            <option value="ALL">All statuses</option>
            <option value="DRAFT">Draft</option>
            <option value="SUBMITTED">Submitted</option>
            <option value="VALIDATED">Validated</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
        </div>
      </section>

      {filtered.length === 0 ? (
        <section className="grid min-h-72 place-items-center border border-[#cfc4b7] bg-white p-8 text-center">
          <div>
            <History size={38} className="mx-auto text-[#b9ada2]" />
            <p className="mt-4 font-black uppercase text-slate-700">
              No screening loads found
            </p>
          </div>
        </section>
      ) : (
        <div className="space-y-4">
          {filtered.map((load) => (
            <article key={load.id} className="border border-[#cfc4b7] bg-white">
              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#d8cec3] bg-[#f6f2ed] p-5">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-2xl font-black uppercase">
                      {load.rawLotNumber}
                    </h2>
                    <span
                      className={`border px-2.5 py-1 text-[10px] font-black uppercase ${statusStyle(load.status)}`}
                    >
                      {load.status}
                    </span>
                  </div>
                  <p className="mt-2 text-sm font-semibold text-slate-500">
                    {formatDate(load.screeningDate)} · {load.shift} shift
                    {load.lineName ? ` · ${load.lineName}` : ""}
                  </p>
                  <p className="mt-1 text-sm font-bold text-[#8a4e22]">
                    {load.farmerName || "Farmer not recorded"}
                    {load.farmName ? ` · ${load.farmName}` : ""}
                  </p>
                  <p className="mt-2 text-xs text-slate-500">
                    Created by <strong>{load.createdBy || "—"}</strong> ·{" "}
                    {load.employees.length} employees
                  </p>
                </div>

                <div className="grid grid-cols-3 gap-5 text-right">
                  <div>
                    <p className="text-[10px] font-black uppercase text-slate-400">
                      Raw
                    </p>
                    <p className="mt-1 font-mono text-sm font-black">
                      {formatKg(load.rawWeightKg)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-black uppercase text-slate-400">
                      Output
                    </p>
                    <p className="mt-1 font-mono text-sm font-black">
                      {formatKg(load.totalOutputKg)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-black uppercase text-slate-400">
                      Yield
                    </p>
                    <p className="mt-1 font-mono text-sm font-black">
                      {Number(load.yieldPercent || 0).toFixed(1)}%
                    </p>
                  </div>
                </div>
              </div>

              {load.returnComment && (
                <div className="border-b border-amber-300 bg-amber-50 px-5 py-3 text-sm font-bold text-amber-900">
                  Returned to draft: {load.returnComment}
                </div>
              )}

              <div className="overflow-x-auto p-5">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#d8cec3] text-left text-[10px] font-black uppercase tracking-[0.08em] text-slate-500">
                      <th className="px-3 py-3">Product</th>
                      <th className="px-3 py-3">ERP lot</th>
                      <th className="px-3 py-3 text-right">Big bags</th>
                      <th className="px-3 py-3 text-right">Weight</th>
                      <th className="px-3 py-3 text-right">Average</th>
                    </tr>
                  </thead>
                  <tbody>
                    {productOrder.map((type) => {
                      const product = load.products.find(
                        (item) => item.productType === type,
                      );
                      const weight = Number(product?.totalWeightKg ?? 0);
                      const bags = Number(product?.bigBagCount ?? 0);

                      return (
                        <tr key={type} className="border-b border-[#eee8e2]">
                          <td className="px-3 py-3 font-black">
                            {productLabels[type]}
                          </td>
                          <td className="px-3 py-3 font-mono text-xs">
                            {product?.erpLotNumber || "—"}
                          </td>
                          <td className="px-3 py-3 text-right">{bags}</td>
                          <td className="px-3 py-3 text-right font-mono">
                            {formatKg(weight)}
                          </td>
                          <td className="px-3 py-3 text-right font-mono">
                            {formatKg(bags > 0 ? weight / bags : 0)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#d8cec3] bg-[#faf8f5] px-5 py-4">
                <div className="text-xs font-semibold text-slate-500">
                  Submitted: {formatDateTime(load.submittedAt)}
                  {load.validatedAt && (
                    <> · Validated: {formatDateTime(load.validatedAt)}</>
                  )}
                </div>

                <div className="flex flex-wrap gap-2">
                  {load.status === "DRAFT" && (
                    <button
                      type="button"
                      onClick={onEdit}
                      className="inline-flex items-center gap-2 border border-[#6f6156] bg-white px-3 py-2 text-xs font-black uppercase"
                    >
                      <Save size={15} />
                      Open new-load form
                    </button>
                  )}

                  {role === "manager" && load.status === "VALIDATED" && (
                    <ReportDownloadButtons load={load} data={data} compact />
                  )}

                  {role === "manager" && load.status === "SUBMITTED" && (
                    <>
                      <button
                        type="button"
                        disabled={loading}
                        onClick={() => void decide(load, "RETURN")}
                        className="inline-flex items-center gap-2 border border-amber-400 bg-amber-50 px-3 py-2 text-xs font-black uppercase text-amber-900 disabled:opacity-50"
                      >
                        <RotateCcw size={15} />
                        Return
                      </button>
                      <button
                        type="button"
                        disabled={loading}
                        onClick={() => void decide(load, "CANCEL")}
                        className="inline-flex items-center gap-2 border border-red-400 bg-red-50 px-3 py-2 text-xs font-black uppercase text-red-800 disabled:opacity-50"
                      >
                        <X size={15} />
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={loading}
                        onClick={() => void decide(load, "VALIDATE")}
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

function ReportDownloadButtons({
  load,
  data,
  compact = false,
}: {
  load: ScreeningLoadRow;
  data: ScreeningBootstrap;
  compact?: boolean;
}) {
  function runDownload(format: "PDF" | "EXCEL") {
    try {
      const report = buildScreeningReportData(load, data);
      if (format === "PDF") {
        downloadScreeningReportPdf(report);
      } else {
        downloadScreeningReportExcel(report);
      }
    } catch (error) {
      window.alert(errorText(error));
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        onClick={() => runDownload("PDF")}
        className={`inline-flex items-center gap-2 border border-[#26744f] bg-emerald-50 font-black uppercase text-emerald-900 transition hover:bg-emerald-100 ${
          compact ? "px-3 py-2 text-xs" : "px-4 py-3 text-sm"
        }`}
      >
        <FileText size={compact ? 15 : 18} />
        PDF report
      </button>
      <button
        type="button"
        onClick={() => runDownload("EXCEL")}
        className={`inline-flex items-center gap-2 border border-[#315b8a] bg-blue-50 font-black uppercase text-blue-900 transition hover:bg-blue-100 ${
          compact ? "px-3 py-2 text-xs" : "px-4 py-3 text-sm"
        }`}
      >
        <FileSpreadsheet size={compact ? 15 : 18} />
        Excel report
      </button>
    </div>
  );
}

function ScreeningReports({ data }: { data: ScreeningBootstrap }) {
  const [search, setSearch] = useState("");

  const validatedLoads = useMemo(() => {
    const query = search.trim().toLowerCase();

    return data.loads.filter((load) => {
      if (load.status !== "VALIDATED") return false;
      if (!query) return true;

      const incoming = data.incomingLoads.find(
        (item) => item.id === load.incomingLoadId,
      );

      return `${load.rawLotNumber} ${load.farmerName} ${load.farmName} ${incoming?.farmerName ?? ""} ${incoming?.farmName ?? ""}`
        .toLowerCase()
        .includes(query);
    });
  }, [data.incomingLoads, data.loads, search]);

  return (
    <div className="space-y-6">
      <section className="border border-[#2f2823] bg-[#171310] p-6 text-white">
        <p className="font-mono text-xs font-black uppercase tracking-[0.18em] text-[#d78a46]">
          Office documents
        </p>
        <h1 className="mt-2 text-4xl font-black uppercase tracking-tight">
          Screening reports
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-[#a89c92]">
          Reports become available immediately after Manager validation.
          Download the farmer report as PDF or Excel at any time.
        </p>
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
            placeholder="Search report code, farmer or farm"
            className={`${inputClass} pl-11`}
          />
        </div>
      </section>

      {validatedLoads.length === 0 ? (
        <section className="grid min-h-72 place-items-center border border-[#cfc4b7] bg-white p-8 text-center">
          <div>
            <FileText size={42} className="mx-auto text-[#b9ada2]" />
            <p className="mt-4 font-black uppercase text-slate-700">
              No validated Screening Report
            </p>
            <p className="mt-2 text-sm text-slate-500">
              Validate a submitted screening load to generate its report.
            </p>
          </div>
        </section>
      ) : (
        <div className="space-y-4">
          {validatedLoads.map((load) => {
            const report = buildScreeningReportData(load, data);

            return (
              <article
                key={load.id}
                className="border border-[#cfc4b7] bg-white"
              >
                <div className="grid gap-5 p-5 lg:grid-cols-[1fr_auto] lg:items-center">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-2xl font-black uppercase">
                        {report.reportCode}
                      </h2>
                      <span className="border border-emerald-300 bg-emerald-100 px-2.5 py-1 text-[10px] font-black uppercase text-emerald-900">
                        Report ready
                      </span>
                    </div>
                    <p className="mt-2 text-sm font-black text-[#8a4e22]">
                      {report.farmerName || "Farmer not recorded"} ·{" "}
                      {report.farmName}
                    </p>
                    <p className="mt-1 text-sm font-semibold text-slate-500">
                      Delivery {reportDate(report.deliveryDate)} ·{" "}
                      {reportTonnage(report.totalTonnage)} t ·{" "}
                      {report.currency} {reportNumber(report.totalValue, 2)}
                    </p>
                    <p className="mt-2 text-xs text-slate-400">
                      FSC {report.fscCode}
                      {report.validatedAt
                        ? ` · Validated ${formatDateTime(report.validatedAt)}`
                        : ""}
                    </p>
                  </div>

                  <ReportDownloadButtons load={load} data={data} />
                </div>

                <div className="overflow-x-auto border-t border-[#e4dcd3]">
                  <table className="min-w-full text-sm">
                    <thead className="bg-[#f6f2ed]">
                      <tr className="text-left text-[10px] font-black uppercase tracking-[0.08em] text-slate-500">
                        <th className="px-4 py-3">Quality</th>
                        <th className="px-4 py-3 text-right">Price / t</th>
                        <th className="px-4 py-3 text-right">Tonnage</th>
                        <th className="px-4 py-3 text-right">Percentage</th>
                        <th className="px-4 py-3 text-right">Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.rows.map((row) => (
                        <tr
                          key={row.productType}
                          className="border-t border-[#eee8e2]"
                        >
                          <td className="px-4 py-3 font-black">
                            {row.qualityLabel}
                          </td>
                          <td className="px-4 py-3 text-right font-mono">
                            {reportNumber(row.pricePerTon, 0)}
                          </td>
                          <td className="px-4 py-3 text-right font-mono">
                            {reportTonnage(row.tonnage)}
                          </td>
                          <td className="px-4 py-3 text-right font-mono">
                            {reportPercentage(row.percentage)}
                          </td>
                          <td className="px-4 py-3 text-right font-mono font-black">
                            {row.value === 0
                              ? "-"
                              : reportNumber(row.value, 2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ScreeningStock({ data }: { data: ScreeningBootstrap }) {
  const [productFilter, setProductFilter] = useState<"ALL" | ScreeningProductType>(
    "ALL",
  );
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return data.stock.filter((stock) => {
      const productMatches =
        productFilter === "ALL" || stock.productType === productFilter;
      const searchMatches =
        !query ||
        `${stock.erpLotNumber} ${stock.sourceRawLotNumber}`
          .toLowerCase()
          .includes(query);
      return productMatches && searchMatches;
    });
  }, [data.stock, productFilter, search]);

  const totals = useMemo(
    () =>
      productOrder.map((type) => ({
        type,
        weight: data.stock
          .filter(
            (stock) =>
              stock.productType === type && stock.stockStatus === "AVAILABLE",
          )
          .reduce(
            (sum, stock) => sum + Number(stock.availableWeightKg || 0),
            0,
          ),
        bags: data.stock
          .filter(
            (stock) =>
              stock.productType === type && stock.stockStatus === "AVAILABLE",
          )
          .reduce((sum, stock) => sum + Number(stock.availableBigBags || 0), 0),
      })),
    [data.stock],
  );

  return (
    <div className="space-y-6">
      <section className="border border-[#2f2823] bg-[#171310] p-6 text-white">
        <p className="font-mono text-xs font-black uppercase tracking-[0.18em] text-[#d78a46]">
          Validated inventory
        </p>
        <h1 className="mt-2 text-4xl font-black uppercase tracking-tight">
          Product stock
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-[#a89c92]">
          ERP lots created after Manager validation. These lots will be selected
          later by Production.
        </p>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {totals.map(({ type, weight, bags }) => (
          <div key={type} className="border border-[#cfc4b7] bg-white p-4">
            <p className="font-mono text-xs font-black text-[#b86c2c]">
              {productShortLabels[type]}
            </p>
            <p className="mt-2 text-sm font-black uppercase">
              {productLabels[type]}
            </p>
            <p className="mt-4 font-mono text-xl font-black">{formatKg(weight)}</p>
            <p className="mt-1 text-xs font-semibold text-slate-500">
              {bags} available big bags
            </p>
          </div>
        ))}
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
              placeholder="Search ERP lot or source raw lot"
              className={`${inputClass} pl-11`}
            />
          </div>

          <select
            value={productFilter}
            onChange={(event) =>
              setProductFilter(event.target.value as "ALL" | ScreeningProductType)
            }
            className={`${inputClass} min-w-60`}
          >
            <option value="ALL">All products</option>
            {productOrder.map((type) => (
              <option key={type} value={type}>
                {productLabels[type]}
              </option>
            ))}
          </select>
        </div>
      </section>

      {filtered.length === 0 ? (
        <section className="grid min-h-72 place-items-center border border-[#cfc4b7] bg-white p-8 text-center">
          <div>
            <Warehouse size={40} className="mx-auto text-[#b9ada2]" />
            <p className="mt-4 font-black uppercase text-slate-700">
              No validated product stock
            </p>
          </div>
        </section>
      ) : (
        <section className="overflow-hidden border border-[#cfc4b7] bg-white">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-[#201a16] text-white">
                <tr className="text-left text-[10px] font-black uppercase tracking-[0.08em]">
                  <th className="px-4 py-4">Product</th>
                  <th className="px-4 py-4">ERP lot</th>
                  <th className="px-4 py-4">Source raw lot</th>
                  <th className="px-4 py-4 text-right">Initial weight</th>
                  <th className="px-4 py-4 text-right">Available weight</th>
                  <th className="px-4 py-4 text-right">Available bags</th>
                  <th className="px-4 py-4">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((stock) => (
                  <tr key={stock.id} className="border-b border-[#e4dcd3]">
                    <td className="px-4 py-4 font-black uppercase">
                      {productLabels[stock.productType]}
                    </td>
                    <td className="px-4 py-4 font-mono text-xs font-black">
                      {stock.erpLotNumber}
                    </td>
                    <td className="px-4 py-4 font-mono text-xs">
                      {stock.sourceRawLotNumber}
                    </td>
                    <td className="px-4 py-4 text-right font-mono">
                      {formatKg(stock.initialWeightKg)}
                    </td>
                    <td className="px-4 py-4 text-right font-mono font-black">
                      {formatKg(stock.availableWeightKg)}
                    </td>
                    <td className="px-4 py-4 text-right font-black">
                      {stock.availableBigBags}
                    </td>
                    <td className="px-4 py-4">
                      <span className="border border-emerald-300 bg-emerald-100 px-2 py-1 text-[10px] font-black uppercase text-emerald-900">
                        {stock.stockStatus}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-[11px] font-black uppercase tracking-[0.1em] text-[#6e6259]">
        {label}
      </span>
      {children}
    </label>
  );
}
