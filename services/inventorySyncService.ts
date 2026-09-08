/**
 * inventorySyncService.ts
 *
 * Client-side and Node-compatible Excel format detector and parser for
 * all 4 plant export schemas:
 *   1. Lanka Tiles (LT) [SAP Report]
 *   2. Lanka Wall Tiles (LWT) [SAP Report]
 *   3. Rocell Horana (RCL-H) [Oracle Report]
 *   4. Rocell Eheliyagoda (RCL-E) [Oracle Report]
 */

import * as XLSX from 'xlsx';
import type { SparePart } from '../types.ts';

// ---------------------------------------------------------------------------
// Canonical Row Schema
// ---------------------------------------------------------------------------

export type PlantId = 'Lanka Tiles' | 'Lanka Wall Tiles' | 'Rocell Horana' | 'Rocell Eheliyagoda';
export type PlantKey = 'LT' | 'LWT' | 'RCL-H' | 'RCL-E';

export interface CanonicalInventoryRow {
  /** Composite DB key segment — plant affiliation */
  plant_id: PlantId | string;
  /** Primary item identifier (SAP: Material Number, Oracle: Item Code) */
  item_code: string;
  /** Human-readable description */
  description: string;
  /** Item category (Oracle "Item Category" / "Sub"; null for SAP) */
  category: string | null;
  /** Current on-hand quantity */
  quantity_on_hand: number;
  /** Standardised unit-of-measure, always UPPERCASE e.g. "EACH", "KG" */
  uom: string;
  /** Unit cost — populated from Oracle / LWT if present */
  unit_cost: number | null;
  /** Total inventory value — Oracle / LWT if present */
  total_value: number | null;
  /** SAP material description legacy code — metadata only */
  legacy_item_code?: string;
  /** Source ERP system */
  source_system: 'SAP' | 'ORACLE';
  /** Unix-ms timestamp of this sync run */
  last_synced_at: number;
}

// ---------------------------------------------------------------------------
// Ingestion Summary — mirrors server response
// ---------------------------------------------------------------------------

export interface IngestionSummary {
  status: 'success' | 'error';
  source: 'SAP' | 'ORACLE' | 'UNKNOWN';
  plant: string;
  total_rows_read: number;
  items_updated: number;
  new_items_added: number;
  skipped_rows: number;
  message?: string;
  sheet_rows_updated?: number;
  sheet_new_rows_appended?: number;
  sheet_warning?: string;
  updatedParts?: SparePart[];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Normalises raw UOM string to UPPERCASE canonical form.
 */
export function normalizeUOM(raw: string | undefined | null): string {
  if (!raw) return 'EACH';
  const s = String(raw).trim().toUpperCase();
  const MAP: Record<string, string> = {
    EA: 'EACH',
    EACH: 'EACH',
    EACHES: 'EACH',
    PC: 'PIECE',
    PCS: 'PIECE',
    PIECE: 'PIECE',
    PIECES: 'PIECE',
    KG: 'KG',
    KGS: 'KG',
    KILOGRAM: 'KG',
    LT: 'LITRE',
    LTR: 'LITRE',
    LITRE: 'LITRE',
    LITER: 'LITRE',
    M: 'METRE',
    MTR: 'METRE',
    METRE: 'METRE',
    METER: 'METRE',
    NOS: 'NOS',
    NO: 'NOS',
    NUM: 'NOS',
    SET: 'SET',
    SETS: 'SET',
    BOX: 'BOX',
    PK: 'PACK',
    PACK: 'PACK',
    ROLL: 'ROLL',
    ROL: 'ROLL',
    FT: 'FEET',
    IN: 'INCH',
    L: 'LITRE',
    PAIR: 'PAIR',
    PAIRS: 'PAIR',
    CAN: 'CAN',
    BTL: 'BOTTLE',
    BOTTLE: 'BOTTLE',
  };
  return MAP[s] ?? s;
}

/**
 * Safely converts any cell value to a float. Default 0 if invalid or negative.
 */
export function toFloat(val: any): number {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') {
    if (isNaN(val) || val < 0) return 0;
    return val;
  }
  const cleaned = String(val).replace(/[^0-9.\-]/g, '');
  const parsed = parseFloat(cleaned);
  if (isNaN(parsed) || parsed < 0) return 0;
  return parsed;
}

/**
 * Strips leading zeros from a string that is entirely numeric.
 */
export function stripLeadingZeros(s: string): string {
  const trimmed = String(s ?? '').trim();
  if (/^\d+$/.test(trimmed)) {
    return String(parseInt(trimmed, 10));
  }
  return trimmed;
}

/**
 * Case-insensitive search for header column index.
 */
export function findColIndex(headers: any[], ...candidates: string[]): number {
  const lowers = candidates.map(c => c.toLowerCase().trim());
  return headers.findIndex(h => {
    const hs = String(h ?? '').toLowerCase().trim();
    return lowers.includes(hs);
  });
}

export function isInvalidItemCode(raw: any): boolean {
  if (raw === null || raw === undefined) return true;
  const s = String(raw).trim().toLowerCase();
  if (!s || s === '' || s === 'nan' || s === 'null' || s === 'undefined') return true;
  if (s === 'total' || s === 'grand total' || s === 'subtotal' || s === 'row labels') return true;
  if (s === 'material' || s === 'material number' || s === 'material no' || s === 'item code' || s === 'item') return true;
  return false;
}

/**
 * Normalises raw plant name input or plant key ('LT', 'LWT', 'RCL-H', 'RCL-E') to canonical PlantId
 */
export function resolvePlantId(rawName: string | undefined | null, fallback: string = ''): PlantId {
  if (!rawName) return (fallback || 'Lanka Tiles') as PlantId;
  const s = rawName.trim().toLowerCase();
  if (s === 'lwt' || (s.includes('lanka') && s.includes('wall'))) return 'Lanka Wall Tiles';
  if (s === 'lt' || (s.includes('lanka') && s.includes('tile')) || s.includes('lanka tiles')) return 'Lanka Tiles';
  if (s === 'rcl-h' || s === 'rclh' || s.includes('horana') || s.includes('rocell horana')) return 'Rocell Horana';
  if (s === 'rcl-e' || s === 'rcle' || s.includes('eheliyagoda') || s.includes('rocell eheliyagoda') || s === 'gsc') return 'Rocell Eheliyagoda';
  return (fallback || rawName) as PlantId;
}

// ---------------------------------------------------------------------------
// Format Detection & Auto-Detection
// ---------------------------------------------------------------------------

export type DetectedFormat = 'SAP' | 'ORACLE' | 'UNKNOWN';

export interface DetectionResult {
  format: DetectedFormat;
  plantId: PlantId;
  schemaType: 'SAP_LT' | 'SAP_LWT' | 'ORACLE_RCLH' | 'ORACLE_RCLE' | 'UNKNOWN';
}

/**
 * Inspects the workbook (first 5-10 rows) and auto-detects plant & format.
 *
 * Rules:
 *   - "Closing Stock" and "BUn" -> LWT (SAP)
 *   - "Sum of Unrestricted" -> LT (SAP)
 *   - "Item Description" and "Qty" (or "Sub") without "Organization" -> RCL-H (Oracle)
 *   - "Item Category" and "Organization" -> RCL-E (Oracle)
 */
export function detectPlantAndFormat(
  workbook: XLSX.WorkBook,
  fallbackPlant: string = 'Lanka Tiles'
): DetectionResult {
  const resolvedFallback = resolvePlantId(fallbackPlant);
  const sheetNames = workbook.SheetNames;
  if (!sheetNames || sheetNames.length === 0) {
    return { format: 'UNKNOWN', plantId: resolvedFallback, schemaType: 'UNKNOWN' };
  }

  // Inspect first sheet headers up to 10 rows
  const firstSheetName = sheetNames[0];
  if (!firstSheetName) {
    return { format: 'UNKNOWN', plantId: resolvedFallback, schemaType: 'UNKNOWN' };
  }

  const sheet = workbook.Sheets[firstSheetName];
  const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as any[][];

  for (let i = 0; i < Math.min(10, rawRows.length); i++) {
    const rowStr = rawRows[i].map(c => String(c ?? '').toLowerCase()).join('|');

    // 1. LWT: "Closing Stock" and "BUn"
    if (rowStr.includes('closing stock') && (rowStr.includes('bun') || rowStr.includes('avg rate'))) {
      return { format: 'SAP', plantId: 'Lanka Wall Tiles', schemaType: 'SAP_LWT' };
    }

    // 2. LT: "Sum of Unrestricted"
    if (rowStr.includes('sum of unrestricted') || rowStr.includes('qty (unrestricted)')) {
      return { format: 'SAP', plantId: 'Lanka Tiles', schemaType: 'SAP_LT' };
    }

    // 3. RCL-E: "Item Category" and "Organization"
    if (rowStr.includes('organization') && (rowStr.includes('item category') || rowStr.includes('primary unit of measure'))) {
      return { format: 'ORACLE', plantId: 'Rocell Eheliyagoda', schemaType: 'ORACLE_RCLE' };
    }

    // 4. RCL-H: "Item Description" and "Qty" / "Sub" (without Organization)
    if (
      rowStr.includes('item description') &&
      (rowStr.includes('qty') || rowStr.includes('unit cost') || rowStr.includes('sub')) &&
      !rowStr.includes('organization')
    ) {
      return { format: 'ORACLE', plantId: 'Rocell Horana', schemaType: 'ORACLE_RCLH' };
    }
  }

  // Header fallback based on selected plant
  if (resolvedFallback === 'Lanka Wall Tiles') {
    return { format: 'SAP', plantId: 'Lanka Wall Tiles', schemaType: 'SAP_LWT' };
  } else if (resolvedFallback === 'Rocell Horana') {
    return { format: 'ORACLE', plantId: 'Rocell Horana', schemaType: 'ORACLE_RCLH' };
  } else if (resolvedFallback === 'Rocell Eheliyagoda') {
    return { format: 'ORACLE', plantId: 'Rocell Eheliyagoda', schemaType: 'ORACLE_RCLE' };
  }

  return { format: 'SAP', plantId: 'Lanka Tiles', schemaType: 'SAP_LT' };
}

export function detectFormat(workbook: XLSX.WorkBook): DetectedFormat {
  return detectPlantAndFormat(workbook).format;
}

// ---------------------------------------------------------------------------
// 1. Lanka Tiles (LT) SAP Parser
// ---------------------------------------------------------------------------

export function parseSAP_LT(
  workbook: XLSX.WorkBook,
  plantId: PlantId = 'Lanka Tiles'
): { rows: CanonicalInventoryRow[]; skipped: number } {
  const sheetName =
    workbook.SheetNames.find(n =>
      n.replace(/\s+/g, ' ').trim().toLowerCase().includes('current inventory status')
    ) ?? workbook.SheetNames[0];

  const sheet = workbook.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', blankrows: true }) as any[][];

  let headerIdx = 2; // Default Row 3 (Index 2)
  for (let i = 0; i < Math.min(10, rawRows.length); i++) {
    const rowStr = rawRows[i].map(c => String(c ?? '').toLowerCase()).join('|');
    if (rowStr.includes('material number') || rowStr.includes('sum of unrestricted') || rowStr.includes('material description')) {
      headerIdx = i;
      break;
    }
  }

  const headers: any[] = rawRows[headerIdx] ?? [];
  const colMatNum = findColIndex(headers, 'Material Number', 'Material No', 'Material', 'Item Code');
  const colOldMat = findColIndex(headers, 'Old material number', 'Old Material', 'Old Mat No');
  const colDesc   = findColIndex(headers, 'Material Description', 'Description');
  const colUOM    = findColIndex(headers, 'Base Unit of Measure', 'UoM', 'Unit of Measure', 'UOM');
  const colQty    = findColIndex(headers, 'Sum of Unrestricted', 'Unrestricted', 'Qty on Hand', 'Stock Qty', 'Quantity', 'Qty');
  const colValue  = findColIndex(headers, 'Value (LKR)', 'Value', 'Total Value');

  const matNumIdx = colMatNum !== -1 ? colMatNum : 1;
  const oldMatIdx = colOldMat !== -1 ? colOldMat : 2;
  const descIdx   = colDesc   !== -1 ? colDesc   : 3;
  const uomIdx    = colUOM    !== -1 ? colUOM    : 4;
  const qtyIdx    = colQty    !== -1 ? colQty    : 5;

  const now = Date.now();
  const rows: CanonicalInventoryRow[] = [];
  let skipped = 0;

  for (let i = headerIdx + 1; i < rawRows.length; i++) {
    const row = rawRows[i];
    if (!row || row.length === 0) { skipped++; continue; }

    const rawMatNum = String(row[matNumIdx] ?? '').trim();
    if (isInvalidItemCode(rawMatNum)) {
      skipped++;
      continue;
    }

    const itemCode   = stripLeadingZeros(rawMatNum);
    const legacyCode = oldMatIdx !== -1 ? (String(row[oldMatIdx] ?? '').trim() || undefined) : undefined;
    const desc       = String(row[descIdx] ?? '').trim() || 'No Description';
    const uom        = normalizeUOM(String(row[uomIdx] ?? ''));
    const qty        = toFloat(row[qtyIdx]);
    const totalVal   = colValue !== -1 ? toFloat(row[colValue]) : null;

    rows.push({
      plant_id:        plantId,
      item_code:       itemCode,
      description:     desc,
      category:        null,
      quantity_on_hand: qty,
      uom,
      unit_cost:       null,
      total_value:     totalVal && totalVal > 0 ? totalVal : null,
      ...(legacyCode ? { legacy_item_code: legacyCode } : {}),
      source_system:   'SAP',
      last_synced_at:  now,
    });
  }

  return { rows, skipped };
}

// ---------------------------------------------------------------------------
// 2. Lanka Wall Tiles (LWT) SAP Parser
// ---------------------------------------------------------------------------

export function parseSAP_LWT(
  workbook: XLSX.WorkBook,
  plantId: PlantId = 'Lanka Wall Tiles'
): { rows: CanonicalInventoryRow[]; skipped: number } {
  const sheetName =
    workbook.SheetNames.find(n =>
      n.toLowerCase().includes('spare parts') || n.toLowerCase().includes('stock with images') || n.toLowerCase().includes('lwt')
    ) ?? workbook.SheetNames[0];

  const sheet = workbook.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', blankrows: true }) as any[][];

  // Header is usually at Row 4 (Index 3; skip first 3 title/empty rows)
  let headerIdx = 3;
  for (let i = 0; i < Math.min(10, rawRows.length); i++) {
    const rowStr = rawRows[i].map(c => String(c ?? '').toLowerCase()).join('|');
    if (rowStr.includes('material') || rowStr.includes('closing stock') || rowStr.includes('description')) {
      headerIdx = i;
      break;
    }
  }

  const headers: any[] = rawRows[headerIdx] ?? [];
  const colMat   = findColIndex(headers, 'Material', 'Material Number', 'Material No', 'Item Code');
  const colDesc  = findColIndex(headers, 'Material Description', 'Description');
  const colStock = findColIndex(headers, 'Closing Stock', 'Qty on Hand', 'Qty (Closing Stock)', 'Qty', 'Quantity');
  const colBUn   = findColIndex(headers, 'BUn', 'UOM', 'Base Unit of Measure', 'Unit of Measure');
  const colRate  = findColIndex(headers, 'Avg Rate.', 'Avg Rate', 'Unit Cost', 'Price');
  const colValue = findColIndex(headers, 'Closing Value', 'Value (LKR)', 'Total Value', 'Value');

  const matIdx   = colMat   !== -1 ? colMat   : 1; // Col B
  const descIdx  = colDesc  !== -1 ? colDesc  : 2; // Col C
  const stockIdx = colStock !== -1 ? colStock : 3; // Col D
  const bunIdx   = colBUn   !== -1 ? colBUn   : 4; // Col E
  const valueIdx = colValue !== -1 ? colValue : 5; // Col F
  const rateIdx  = colRate  !== -1 ? colRate  : 7; // Col H

  const now = Date.now();
  const rows: CanonicalInventoryRow[] = [];
  let skipped = 0;

  for (let i = headerIdx + 1; i < rawRows.length; i++) {
    const row = rawRows[i];
    if (!row || row.length === 0) { skipped++; continue; }

    const rawMatNum = String(row[matIdx] ?? '').trim();
    if (isInvalidItemCode(rawMatNum)) {
      skipped++;
      continue;
    }

    const itemCode = stripLeadingZeros(rawMatNum);
    const desc     = String(row[descIdx] ?? '').trim() || 'No Description';
    const qty      = toFloat(row[stockIdx]);
    const uom      = normalizeUOM(String(row[bunIdx] ?? ''));
    const unitCost = colRate !== -1 ? toFloat(row[rateIdx]) : null;
    const totVal   = colValue !== -1 ? toFloat(row[valueIdx]) : null;

    rows.push({
      plant_id:        plantId,
      item_code:       itemCode,
      description:     desc,
      category:        null,
      quantity_on_hand: qty,
      uom,
      unit_cost:       unitCost && unitCost > 0 ? unitCost : null,
      total_value:     totVal && totVal > 0 ? totVal : (unitCost ? unitCost * qty : null),
      source_system:   'SAP',
      last_synced_at:  now,
    });
  }

  return { rows, skipped };
}

// ---------------------------------------------------------------------------
// 3. Rocell Horana (RCL-H) Oracle Parser
// ---------------------------------------------------------------------------

export function parseOracle_RCLH(
  workbook: XLSX.WorkBook,
  plantId: PlantId = 'Rocell Horana'
): { rows: CanonicalInventoryRow[]; skipped: number } {
  const sheetName =
    workbook.SheetNames.find(n =>
      n.toLowerCase().includes('sheet1') || n.toLowerCase().includes('rcl-h') || n.toLowerCase().includes('stock with images')
    ) ?? workbook.SheetNames[0];

  const sheet = workbook.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', blankrows: true }) as any[][];

  // Header Row: Row 3 (Index 2; skip first 2 title/empty rows)
  let headerIdx = 2;
  for (let i = 0; i < Math.min(10, rawRows.length); i++) {
    const rowStr = rawRows[i].map(c => String(c ?? '').toLowerCase()).join('|');
    if (rowStr.includes('item code') || rowStr.includes('item description') || rowStr.includes('qty')) {
      headerIdx = i;
      break;
    }
  }

  const headers: any[] = rawRows[headerIdx] ?? [];
  const colCode = findColIndex(headers, 'Item Code', 'Material Number', 'Material', 'Item');
  const colSub  = findColIndex(headers, 'Sub', 'Item Category', 'Category');
  const colDesc = findColIndex(headers, 'Item Description', 'Description', 'Material Description');
  const colQty  = findColIndex(headers, 'Qty', 'Qty on Hand', 'Quantity');
  const colUOM  = findColIndex(headers, 'UOM', 'Primary Unit Of Measure', 'Unit of Measure');
  const colCost = findColIndex(headers, 'Unit Cost', 'Cost');
  const colVal  = findColIndex(headers, 'Value', 'Value (LKR)', 'Inventory Value', 'Total Value');

  const codeIdx = colCode !== -1 ? colCode : 0; // Col A
  const subIdx  = colSub  !== -1 ? colSub  : 1; // Col B
  const descIdx = colDesc !== -1 ? colDesc : 2; // Col C
  const qtyIdx  = colQty  !== -1 ? colQty  : 3; // Col D
  const uomIdx  = colUOM  !== -1 ? colUOM  : 4; // Col E
  const costIdx = colCost !== -1 ? colCost : 5; // Col F
  const valIdx  = colVal  !== -1 ? colVal  : 6; // Col G

  const now = Date.now();
  const rows: CanonicalInventoryRow[] = [];
  let skipped = 0;

  for (let i = headerIdx + 1; i < rawRows.length; i++) {
    const row = rawRows[i];
    if (!row || row.length === 0) { skipped++; continue; }

    const rawCode = String(row[codeIdx] ?? '').trim();
    if (isInvalidItemCode(rawCode)) {
      skipped++;
      continue;
    }

    const category  = subIdx !== -1 ? (String(row[subIdx] ?? '').trim() || null) : null;
    const desc      = String(row[descIdx] ?? '').trim() || 'No Description';
    const qty       = toFloat(row[qtyIdx]);
    const uom       = normalizeUOM(String(row[uomIdx] ?? ''));
    const unitCost  = costIdx !== -1 ? toFloat(row[costIdx]) : null;
    const totVal    = valIdx !== -1 ? toFloat(row[valIdx]) : null;

    rows.push({
      plant_id:        plantId,
      item_code:       rawCode,
      description:     desc,
      category,
      quantity_on_hand: qty,
      uom,
      unit_cost:       unitCost && unitCost > 0 ? unitCost : null,
      total_value:     totVal && totVal > 0 ? totVal : (unitCost ? unitCost * qty : null),
      source_system:   'ORACLE',
      last_synced_at:  now,
    });
  }

  return { rows, skipped };
}

// ---------------------------------------------------------------------------
// 4. Rocell Eheliyagoda (RCL-E) Oracle Parser
// ---------------------------------------------------------------------------

export function parseOracle_RCLE(
  workbook: XLSX.WorkBook,
  plantId: PlantId = 'Rocell Eheliyagoda'
): { rows: CanonicalInventoryRow[]; skipped: number } {
  const sheetName =
    workbook.SheetNames.find(n =>
      /^gs\s/i.test(n.trim()) || n.toLowerCase().includes('rcl-e') || n.toLowerCase().includes('consolidated')
    ) ?? workbook.SheetNames[0];

  const sheet = workbook.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', blankrows: true }) as any[][];

  // Header Row: Row 3 (Index 2)
  let headerIdx = 2;
  for (let i = 0; i < Math.min(10, rawRows.length); i++) {
    const rowStr = rawRows[i].map(c => String(c ?? '').toLowerCase()).join('|');
    if (rowStr.includes('item code') && (rowStr.includes('description') || rowStr.includes('organization') || rowStr.includes('quantity'))) {
      headerIdx = i;
      break;
    }
  }

  const headers: any[] = rawRows[headerIdx] ?? [];

  const colOrg  = findColIndex(headers, 'Organization', 'Org', 'Plant');
  const colCat  = findColIndex(headers, 'Item Category', 'Category');
  const colCode = findColIndex(headers, 'Item Code', 'ItemCode', 'Item');
  const colDesc = findColIndex(headers, 'Description', 'Item Description');
  const colUOM  = findColIndex(headers, 'Primary Unit Of Measure', 'UOM', 'Unit of Measure', 'UoM');
  const colQty  = findColIndex(headers, 'Quantity', 'Physical Stock Qty', 'Qty', 'On Hand');
  const colCost = findColIndex(headers, 'Unit Cost', 'Cost');
  const colVal  = findColIndex(headers, 'Inventory Value', 'Value (LKR)', 'Total Value', 'Value');

  const now = Date.now();
  const rows: CanonicalInventoryRow[] = [];
  let skipped = 0;

  for (let i = headerIdx + 1; i < rawRows.length; i++) {
    const row = rawRows[i];
    if (!row || row.length === 0) { skipped++; continue; }

    const rawCode = colCode !== -1 ? String(row[colCode] ?? '').trim() : '';
    if (isInvalidItemCode(rawCode)) {
      skipped++;
      continue;
    }

    const orgRaw          = colOrg !== -1 ? String(row[colOrg] ?? '').trim() : '';
    const resolvedPlant   = resolvePlantId(orgRaw, plantId);

    const category  = colCat  !== -1 ? (String(row[colCat]  ?? '').trim() || null) : null;
    const desc      = colDesc !== -1 ? (String(row[colDesc] ?? '').trim() || 'No Description') : 'No Description';
    const uom       = normalizeUOM(colUOM !== -1 ? String(row[colUOM] ?? '') : '');
    const qty       = toFloat(colQty !== -1 ? row[colQty] : 0);
    const unitCost  = colCost !== -1 ? toFloat(row[colCost]) : null;
    const totVal    = colVal  !== -1 ? toFloat(row[colVal])  : null;

    rows.push({
      plant_id:        resolvedPlant,
      item_code:       rawCode,
      description:     desc,
      category,
      quantity_on_hand: qty,
      uom,
      unit_cost:       unitCost && unitCost > 0 ? unitCost : null,
      total_value:     totVal && totVal > 0 ? totVal : (unitCost ? unitCost * qty : null),
      source_system:   'ORACLE',
      last_synced_at:  now,
    });
  }

  return { rows, skipped };
}

// ---------------------------------------------------------------------------
// Top-level Unified Dispatcher
// ---------------------------------------------------------------------------

export interface ParseInventoryResult {
  format: DetectedFormat;
  plantId: PlantId;
  schemaType: string;
  rows: CanonicalInventoryRow[];
  skipped: number;
  totalRowsRead: number;
}

export function parseInventoryWorkbook(
  workbook: XLSX.WorkBook,
  targetPlant: string = 'Lanka Tiles'
): ParseInventoryResult {
  const detection = detectPlantAndFormat(workbook, targetPlant);
  const plantId   = resolvePlantId(targetPlant, detection.plantId);

  let parsed: { rows: CanonicalInventoryRow[]; skipped: number };

  if (detection.schemaType === 'SAP_LWT' || (detection.format === 'SAP' && plantId === 'Lanka Wall Tiles')) {
    parsed = parseSAP_LWT(workbook, plantId);
  } else if (detection.schemaType === 'ORACLE_RCLH' || (detection.format === 'ORACLE' && plantId === 'Rocell Horana')) {
    parsed = parseOracle_RCLH(workbook, plantId);
  } else if (detection.schemaType === 'ORACLE_RCLE' || (detection.format === 'ORACLE' && plantId === 'Rocell Eheliyagoda')) {
    parsed = parseOracle_RCLE(workbook, plantId);
  } else {
    parsed = parseSAP_LT(workbook, plantId);
  }

  return {
    format:        detection.format,
    plantId,
    schemaType:    detection.schemaType,
    rows:          parsed.rows,
    skipped:       parsed.skipped,
    totalRowsRead: parsed.rows.length + parsed.skipped,
  };
}

/**
 * Reads File buffer and runs unified parser.
 */
export async function parseInventoryFile(
  file: File,
  targetPlant: string = 'Lanka Tiles'
): Promise<ParseInventoryResult> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        const workbook = XLSX.read(data, { type: 'array' });
        const res = parseInventoryWorkbook(workbook, targetPlant);
        resolve(res);
      } catch (err) {
        reject(err);
      }
    };

    reader.onerror = (err) => reject(err);
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Main client-side parsing & multi-plant inventory synchronization entrypoint.
 * Parses Excel files client-side using `xlsx` to avoid HTTP 405 errors.
 * 
 * Rules:
 *   1. Existing Spare Part Match: Update/replace stock quantity with new report quantity
 *      (and update unit cost, total valuation, and description if changed).
 *   2. New Spare Part (Code Not Found in Portal): Create and insert new item record under plant catalog.
 *   3. Keep items in other plants untouched.
 */
export async function parseAndSyncPlantFile(
  file: File,
  plantKey: PlantKey | string,
  username: string = 'System User'
): Promise<IngestionSummary & { updatedParts?: SparePart[] }> {
  const arrayBuffer = await file.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });
  const firstSheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[firstSheetName];

  const canonicalPlantId = resolvePlantId(plantKey);
  const parseRes = parseInventoryWorkbook(workbook, canonicalPlantId);

  if (!parseRes.rows || parseRes.rows.length === 0) {
    throw new Error(`No valid inventory rows extracted from "${file.name}" for plant ${plantKey}.`);
  }

  const targetPlantId = parseRes.plantId || canonicalPlantId;

  // Retrieve existing inventory cache
  let existingList: SparePart[] = [];
  try {
    const existingStr = typeof localStorage !== 'undefined' ? localStorage.getItem('spareshare_inventory') : null;
    existingList = existingStr ? JSON.parse(existingStr) : [];
  } catch {
    existingList = [];
  }

  const untouchedOtherPlantItems: SparePart[] = [];
  const targetPlantExistingMap = new Map<string, SparePart>();

  for (const item of existingList) {
    const itemPlantId = resolvePlantId(item.factoryId);
    const normalizedItem: SparePart = { ...item, factoryId: itemPlantId };

    if (itemPlantId === targetPlantId) {
      targetPlantExistingMap.set(normalizedItem.materialNumber.trim().toLowerCase(), normalizedItem);
      targetPlantExistingMap.set(normalizedItem.id.trim().toLowerCase(), normalizedItem);
    } else {
      untouchedOtherPlantItems.push(normalizedItem);
    }
  }

  let itemsUpdated = 0;
  let newItemsAdded = 0;
  const now = Date.now();
  const nowIso = new Date(now).toISOString().split('T')[0];

  const processedTargetParts = new Map<string, SparePart>();

  for (const row of parseRes.rows) {
    const itemCode = row.item_code;
    const plantForPart = targetPlantId;
    const compositeId = `${plantForPart}-${itemCode}`.replace(/[^a-zA-Z0-9\-_.]/g, '-');
    const lookupKey = itemCode.trim().toLowerCase();

    const existingItem = targetPlantExistingMap.get(lookupKey) || targetPlantExistingMap.get(compositeId.toLowerCase());

    const qty = Number(row.quantity_on_hand) || 0;
    const totVal = Number(row.total_value) || 0;
    const uCost = Number(row.unit_cost) || (qty > 0 && totVal > 0 ? totVal / qty : 0);

    if (existingItem) {
      if (!processedTargetParts.has(compositeId)) {
        itemsUpdated++;
      }
      // Match found: Update/replace stock quantity, unit cost, total valuation, and description if changed
      const updatedPart: SparePart = {
        ...existingItem,
        id: compositeId,
        factoryId: plantForPart,
        materialNumber: itemCode,
        partNumber: itemCode,
        description: row.description || existingItem.description,
        onHand: qty,
        unitCost: uCost || existingItem.unitCost || 0,
        totalValue: totVal || (uCost * qty) || existingItem.totalValue || 0,
        categoryName: row.category || existingItem.categoryName || '-',
        spareType: row.category || existingItem.spareType || 'General',
        uom: row.uom || existingItem.uom || 'EACH',
        lastStockUpdateDate: nowIso,
        lastStockUpdateUser: username,
        ...(row.legacy_item_code ? { legacyItemCode: row.legacy_item_code } : {}),
      };
      processedTargetParts.set(compositeId, updatedPart);
    } else {
      if (!processedTargetParts.has(compositeId)) {
        newItemsAdded++;
      }
      // New item creation under that plant's inventory catalog
      const newPart: SparePart = {
        id: compositeId,
        factoryId: plantForPart,
        materialNumber: itemCode,
        partNumber: itemCode,
        description: row.description || 'No Description',
        categoryName: row.category || '-',
        onHand: qty,
        unitCost: uCost,
        totalValue: totVal || (uCost * qty),
        spareType: row.category || 'General',
        uom: row.uom || 'EACH',
        machine: '-',
        criticality: '-',
        qtyMoreThan3Years: 0,
        valueMoreThan3Years: 0,
        lastStockUpdateDate: nowIso,
        lastStockUpdateUser: username,
        ...(row.legacy_item_code ? { legacyItemCode: row.legacy_item_code } : {}),
      };
      processedTargetParts.set(compositeId, newPart);
    }
  }

  // Combine untouched items from other plants + updated/new items for target plant
  const finalInventory = [...untouchedOtherPlantItems, ...Array.from(processedTargetParts.values())];

  // Save to localStorage
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem('spareshare_inventory', JSON.stringify(finalInventory));
    } catch (err) {
      console.warn('[parseAndSyncPlantFile] localStorage write error:', err);
    }
  }

  // Save to Express REST API / Firestore
  const partsToSaveArray = Array.from(processedTargetParts.values());

  try {
    const dbModule = await import('./db.ts');
    if (dbModule && dbModule.saveInventory) {
      await dbModule.saveInventory(partsToSaveArray, username);
    }
  } catch (saveErr) {
    console.warn('[parseAndSyncPlantFile] Firestore save error (using localStorage fallback):', saveErr);
  }

  const API_URL = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) || 'http://localhost:3000';
  const saveUrls = [
    `${API_URL}/api/inventory/save-inventory`,
    'http://localhost:3000/api/inventory/save-inventory',
  ];

  for (const url of saveUrls) {
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parts: partsToSaveArray, username }),
      });
      break;
    } catch {
      // API fallback
    }
  }

  return {
    status: 'success',
    source: parseRes.format as 'SAP' | 'ORACLE' | 'UNKNOWN',
    plant: targetPlantId,
    total_rows_read: parseRes.totalRowsRead,
    items_updated: itemsUpdated,
    new_items_added: newItemsAdded,
    skipped_rows: parseRes.skipped,
    updatedParts: finalInventory,
  };
}

