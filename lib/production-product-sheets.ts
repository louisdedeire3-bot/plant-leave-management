export type ProductSheetStatus = "READY" | "INCOMPLETE";

export interface ProductionProductSheet {
  productCode: string;
  description: string;
  customerBrand: string;
  productFamily: string;
  bagWeightKg: number;
  bagMaterial: string;
  compatibleLineNumbers: number[];
  bagsPerLayer: number;
  layersPerPallet: number;
  bagsPerPallet: number;
  palletType: string;
  palletLengthMm: number;
  palletWidthMm: number;
  maxPalletHeightMm: number;
  targetNetWeightKg: number;
  palletsPerContainer: number;
  bagsPerContainer: number;
  sleeveRequired: boolean;
  slipSheetRequired: boolean;
  stretchFilmRequired: boolean;
  strappingRequired: boolean;
  cornerProtectorsRequired: boolean;
  lotNumberPosition: string;
  fscRequired: boolean;
  packing5M2Required: boolean;
  consumablesConfigured: boolean;
  validation: string;
  status: ProductSheetStatus;
}

// Product sheets are deliberately code-first for the current pilot. New rows can
// be added progressively as the Product Sheet workbook is completed.
export const productionProductSheets: ProductionProductSheet[] = [
  {
    productCode: "60251ALG228FSC",
    description: "ALG CH.BOIS 2.5KG FSC 100% - 228 SACS",
    customerBrand: "ALG",
    productFamily: "Standard",
    bagWeightKg: 2.5,
    bagMaterial: "Kraft paper",
    compatibleLineNumbers: [1, 2, 4],
    bagsPerLayer: 12,
    layersPerPallet: 19,
    bagsPerPallet: 228,
    palletType: "SNCF",
    palletLengthMm: 1150,
    palletWidthMm: 750,
    maxPalletHeightMm: 2400,
    targetNetWeightKg: 570,
    palletsPerContainer: 30,
    bagsPerContainer: 6840,
    sleeveRequired: true,
    slipSheetRequired: false,
    stretchFilmRequired: true,
    strappingRequired: false,
    cornerProtectorsRequired: false,
    lotNumberPosition: "Bottom of bag",
    fscRequired: true,
    packing5M2Required: false,
    consumablesConfigured: false,
    validation: "Management validated",
    status: "READY",
  },
];

const sheetsByProductCode = new Map(
  productionProductSheets.map((sheet) => [sheet.productCode.toUpperCase(), sheet]),
);

export function getProductionProductSheet(
  productCode: string | null | undefined,
): ProductionProductSheet | null {
  if (!productCode) return null;
  return sheetsByProductCode.get(productCode.trim().toUpperCase()) ?? null;
}

export function lineNumberFromCodeOrLabel(
  lineCode: string,
  lineLabel: string,
): number | null {
  const matches = `${lineCode} ${lineLabel}`.match(/(?:^|\D)([1-4])(?:\D|$)/g);
  if (!matches?.length) return null;
  const lastMatch = matches.at(-1)?.match(/[1-4]/);
  return lastMatch ? Number(lastMatch[0]) : null;
}
