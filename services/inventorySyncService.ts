/**
 * inventorySyncService.ts
 *
 * Client-side (and Node-compatible) Excel format detector and parser for
 * SAP LT/LWT inventory exports and Oracle RCL-E/RCL-H inventory reports.
 *
 * Exports:
 *   - CanonicalInventoryRow  — normalized schema produced by both parsers
 *   - IngestionSummary       — response shape returned by the server sync API
 *   - detectFormat()         — inspects workbook to identify SAP vs Oracle
 *   - parseSAPInventory()    — parses SAP " Current Inventory Status " sheet
 *   - parseOracleInventory() — parses Oracle "GS ..." sheet
 *   - parseInventoryFile()   — top-level dispatcher (detect + parse)
 */

import * as XLSX from 'xlsx';

// ---------------------------------------------------------------------------
// Canonical Row Schema
// ---------------------------------------------------------------------------

export interface CanonicalInventoryRow {
  /** Composite DB key segment — plant affiliation */
  plant_id: string;
  /** Primary item identifier (SAP: Material Number, Oracle: Item Code) */
  item_code: string;
  /** Human-readable description */
  description: string;
  /** Item category (Oracle "Item Category"; null for SAP) */
  category: string | null;
  /** Current on-hand quantity */
  quantity_on_hand: number;
  /** Standardised unit-of-measure, always UPPERCASE e.g. "EACH", "KG" */
  uom: string;
  /** Unit cost — populated from Oracle; null for SAP (SAP doesn't export cost) */
  unit_cost: number | null;
  /** Total inventory value — Oracle only */
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
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Normalises a raw UOM string to UPPERCASE.
 * Maps common abbreviations to canonical forms.
 */
function normalizeUOM(raw: string | undefined | null): string {
  if (!raw) return 'EACH';
  const s = String(raw).trim().toUpperCase();
  const MAP: Record<string, string> = {
    EA: 'EACH',
    'EACH': 'EACH',
    PC: 'PIECE',
    PCS: 'PIECE',
    PIECE: 'PIECE',
    KG: 'KG',
    KGS: 'KG',
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
  };
  return MAP[s] ?? s;
}

/**
 * Safely converts any cell value to a float.
 * Returns 0 if the value is blank, null, undefined, or non-numeric.
 */
function toFloat(val: any): number {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  const cleaned = String(val).replace(/[^0-9.\-]/g, '');
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * Strips leading zeros from a string that is entirely numeric.
 * e.g. "000100201" → "100201".  "SE.001.000007" remains unchanged.
 */
function stripLeadingZeros(s: string): string {
  if (/^\d+$/.test(s)) {
    return String(parseInt(s, 10));
  }
  return s;
}

/**
 * Finds the index of a column header in a header row,
 * using case-insensitive, trimmed matching.
 */
function findColIndex(headers: any[], ...candidates: string[]): number {
  const lowers = candidates.map(c => c.toLowerCase().trim());
  return headers.findIndex(h => {
    const hs = String(h ?? '').toLowerCase().trim();
    return lowers.includes(hs);
  });
}

// ---------------------------------------------------------------------------
// Format Detection
// ---------------------------------------------------------------------------

export type DetectedFormat = 'SAP' | 'ORACLE' | 'UNKNOWN';

/**
 * Inspects an XLSX Workbook to determine whether it is a SAP or Oracle export.
 *
 * SAP signals:
 *   - Sheet name contains "Current Inventory Status" (with or without spaces)
 *   - OR column headers on the first data sheet include "Sum of Unrestricted"
 *
 * Oracle signals:
 *   - Sheet name matches /GS /i (e.g. "GS June 2026")
 *   - OR column headers include "Organization" AND "Item Code"
 */
export function detectFormat(workbook: XLSX.WorkBook): DetectedFormat {
  const sheetNames = workbook.SheetNames;

  // --- SAP: sheet name check ---
  const sapSheetName = sheetNames.find(n =>
    n.replace(/\s+/g, ' ').trim().toLowerCase().includes('current inventory status')
  );
  if (sapSheetName) return 'SAP';

  // --- Oracle: sheet name check ---
  const oracleSheetName = sheetNames.find(n =>
    /^gs\s/i.test(n.trim())
  );
  if (oracleSheetName) return 'ORACLE';

  // --- Header-based fallback detection on first sheet ---
  const firstSheetName = sheetNames[0];
  if (!firstSheetName) return 'UNKNOWN';

  const sheet = workbook.Sheets[firstSheetName];
  // Read the first 10 rows as raw arrays to inspect headers
  const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as any[][];

  for (let i = 0; i < Math.min(10, rawRows.length); i++) {
    const rowStr = rawRows[i].map((c: any) => String(c ?? '').toLowerCase()).join('|');
    if (rowStr.includes('sum of unrestricted')) return 'SAP';
    if (rowStr.includes('organization') && rowStr.includes('item code')) return 'ORACLE';
  }

  return 'UNKNOWN';
}

// ---------------------------------------------------------------------------
// SAP Parser
// ---------------------------------------------------------------------------

/**
 * Parses a SAP " Current Inventory Status " export.
 *
 * Sheet layout:
 *   Row 1–2 : metadata / blank (skipped)
 *   Row 3   : Header row
 *   Row 4+  : Data rows
 *
 *   Col B → Material Number   → item_code
 *   Col C → Old material number → legacy_item_code
 *   Col D → Material Description → description
 *   Col E → Base Unit of Measure → uom
 *   Col F → Sum of Unrestricted → quantity_on_hand
 */
export function parseSAPInventory(
  workbook: XLSX.WorkBook,
  plantId: string
): { rows: CanonicalInventoryRow[]; skipped: number } {
  // Prefer named sheet, fall back to index 0
  const sheetName =
    workbook.SheetNames.find(n =>
      n.replace(/\s+/g, ' ').trim().toLowerCase().includes('current inventory status')
    ) ?? workbook.SheetNames[0];

  const sheet = workbook.Sheets[sheetName];
  // Read everything as raw arrays (header:1) so we can control the header row
  const rawRows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: '',
    blankrows: true,
  }) as any[][];

  // Header is at row index 2 (0-based = row 3 in spreadsheet)
  const HEADER_ROW_INDEX = 2;

  // Find actual header row by scanning for "Material Number" or "Sum of Unrestricted"
  let headerIdx = HEADER_ROW_INDEX;
  for (let i = 0; i < Math.min(10, rawRows.length); i++) {
    const rowStr = rawRows[i].map((c: any) => String(c ?? '').toLowerCase()).join('|');
    if (rowStr.includes('material number') || rowStr.includes('sum of unrestricted')) {
      headerIdx = i;
      break;
    }
  }

  const headers: any[] = rawRows[headerIdx] ?? [];

  // Map column names to indices
  const colMatNum   = findColIndex(headers, 'Material Number', 'Material No', 'Material');
  const colOldMat   = findColIndex(headers, 'Old material number', 'Old Material', 'Old Mat No');
  const colDesc     = findColIndex(headers, 'Material Description', 'Description');
  const colUOM      = findColIndex(headers, 'Base Unit of Measure', 'UoM', 'Unit of Measure', 'UOM');
  const colQty      = findColIndex(headers, 'Sum of Unrestricted', 'Unrestricted', 'Stock Qty', 'Quantity');

  // If mandatory columns cannot be found, use positional fallback (B=1, C=2, D=3, E=4, F=5)
  const matNumIdx   = colMatNum  !== -1 ? colMatNum  : 1;
  const oldMatIdx   = colOldMat  !== -1 ? colOldMat  : 2;
  const descIdx     = colDesc    !== -1 ? colDesc    : 3;
  const uomIdx      = colUOM     !== -1 ? colUOM     : 4;
  const qtyIdx      = colQty     !== -1 ? colQty     : 5;

  const now = Date.now();
  const rows: CanonicalInventoryRow[] = [];
  let skipped = 0;

  for (let i = headerIdx + 1; i < rawRows.length; i++) {
    const row = rawRows[i];
    if (!row || row.length === 0) { skipped++; continue; }

    const rawMatNum = String(row[matNumIdx] ?? '').trim();
    if (!rawMatNum || rawMatNum === '' || rawMatNum.toLowerCase() === 'total' || rawMatNum.toLowerCase() === 'grand total') {
      skipped++;
      continue;
    }

    const itemCode   = stripLeadingZeros(rawMatNum);
    const legacyCode = String(row[oldMatIdx] ?? '').trim() || undefined;
    const desc       = String(row[descIdx]   ?? '').trim() || 'No Description';
    const uom        = normalizeUOM(String(row[uomIdx]  ?? ''));
    const qty        = toFloat(row[qtyIdx]);

    rows.push({
      plant_id:        plantId,
      item_code:       itemCode,
      description:     desc,
      category:        null,
      quantity_on_hand: qty,
      uom,
      unit_cost:       null,
      total_value:     null,
      ...(legacyCode ? { legacy_item_code: legacyCode } : {}),
      source_system:   'SAP',
      last_synced_at:  now,
    });
  }

  return { rows, skipped };
}

// ---------------------------------------------------------------------------
// Oracle Parser
// ---------------------------------------------------------------------------

/**
 * Parses an Oracle "GS June 2026" style inventory export.
 *
 * Sheet layout:
 *   Row 1   : Report metadata title
 *   Row 2   : Blank or secondary title
 *   Row 3   : Header row
 *   Row 4+  : Data rows
 *   Last row: Grand Total summary (Item Code is NaN/empty → skipped)
 *
 *   "Organization"              → plant_code (overrides plantId if present)
 *   "Item Category"             → category
 *   "Item Code"                 → item_code
 *   "Description"               → description
 *   "Primary Unit Of Measure"   → uom
 *   "Quantity"                  → quantity_on_hand
 *   "Unit Cost"                 → unit_cost
 *   "Inventory Value"           → total_value
 */
export function parseOracleInventory(
  workbook: XLSX.WorkBook,
  plantId: string
): { rows: CanonicalInventoryRow[]; skipped: number } {
  // Prefer "GS ..." sheet, fall back to index 0
  const sheetName =
    workbook.SheetNames.find(n => /^gs\s/i.test(n.trim())) ??
    workbook.SheetNames[0];

  const sheet = workbook.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: '',
    blankrows: true,
  }) as any[][];

  // Header is at row index 2 (0-based = row 3)
  let headerIdx = 2;
  for (let i = 0; i < Math.min(10, rawRows.length); i++) {
    const rowStr = rawRows[i].map((c: any) => String(c ?? '').toLowerCase()).join('|');
    if (rowStr.includes('item code') && rowStr.includes('description')) {
      headerIdx = i;
      break;
    }
  }

  const headers: any[] = rawRows[headerIdx] ?? [];

  const colOrg      = findColIndex(headers, 'Organization', 'Org', 'Plant');
  const colCat      = findColIndex(headers, 'Item Category', 'Category');
  const colItemCode = findColIndex(headers, 'Item Code', 'ItemCode', 'Item');
  const colDesc     = findColIndex(headers, 'Description', 'Item Description');
  const colUOM      = findColIndex(headers, 'Primary Unit Of Measure', 'UOM', 'Unit of Measure', 'UoM');
  const colQty      = findColIndex(headers, 'Quantity', 'On Hand Quantity', 'Qty');
  const colCost     = findColIndex(headers, 'Unit Cost', 'Unit Price', 'Cost');
  const colValue    = findColIndex(headers, 'Inventory Value', 'Total Value', 'Value');

  const now = Date.now();
  const rows: CanonicalInventoryRow[] = [];
  let skipped = 0;

  for (let i = headerIdx + 1; i < rawRows.length; i++) {
    const row = rawRows[i];
    if (!row || row.length === 0) { skipped++; continue; }

    // Item Code must be a non-empty, non-NaN value
    const rawItemCode = row[colItemCode] ?? '';
    const itemCodeStr = String(rawItemCode).trim();
    if (
      !itemCodeStr ||
      itemCodeStr === '' ||
      itemCodeStr.toLowerCase() === 'nan' ||
      itemCodeStr.toLowerCase() === 'total' ||
      itemCodeStr.toLowerCase() === 'grand total'
    ) {
      skipped++;
      continue;
    }

    // Resolve plant: use Organization column if available, otherwise form param
    const orgRaw = colOrg !== -1 ? String(row[colOrg] ?? '').trim() : '';
    const resolvedPlant = orgRaw || plantId;

    const category    = colCat !== -1 ? (String(row[colCat] ?? '').trim() || null) : null;
    const desc        = colDesc !== -1 ? (String(row[colDesc] ?? '').trim() || 'No Description') : 'No Description';
    const uom         = normalizeUOM(colUOM !== -1 ? String(row[colUOM] ?? '') : '');
    const qty         = toFloat(colQty !== -1 ? row[colQty] : 0);
    const unitCost    = colCost !== -1  ? toFloat(row[colCost])  : null;
    const totalValue  = colValue !== -1 ? toFloat(row[colValue]) : null;

    rows.push({
      plant_id:        resolvedPlant,
      item_code:       itemCodeStr,
      description:     desc,
      category,
      quantity_on_hand: qty,
      uom,
      unit_cost:       unitCost !== null && unitCost === 0 ? null : unitCost,
      total_value:     totalValue !== null && totalValue === 0 ? null : totalValue,
      source_system:   'ORACLE',
      last_synced_at:  now,
    });
  }

  return { rows, skipped };
}

// ---------------------------------------------------------------------------
// Top-level dispatcher
// ---------------------------------------------------------------------------

export interface ParseInventoryResult {
  format: DetectedFormat;
  rows: CanonicalInventoryRow[];
  skipped: number;
  totalRowsRead: number;
}

/**
 * Detects the ERP format and runs the appropriate parser.
 * Works both in the browser (File → ArrayBuffer) and in Node.js (Buffer).
 */
export async function parseInventoryFile(
  file: File,
  plantId: string
): Promise<ParseInventoryResult> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        const workbook = XLSX.read(data, { type: 'array' });
        const format = detectFormat(workbook);

        if (format === 'SAP') {
          const { rows, skipped } = parseSAPInventory(workbook, plantId);
          resolve({ format, rows, skipped, totalRowsRead: rows.length + skipped });
        } else if (format === 'ORACLE') {
          const { rows, skipped } = parseOracleInventory(workbook, plantId);
          resolve({ format, rows, skipped, totalRowsRead: rows.length + skipped });
        } else {
          resolve({ format: 'UNKNOWN', rows: [], skipped: 0, totalRowsRead: 0 });
        }
      } catch (err) {
        reject(err);
      }
    };

    reader.onerror = (err) => reject(err);
    reader.readAsArrayBuffer(file);
  });
}
