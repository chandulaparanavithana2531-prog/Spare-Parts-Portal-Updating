/**
 * test_inventory_sync.js
 *
 * Automated test script for the /api/inventory/sync-upload endpoint.
 *
 * Tests:
 *   1. SAP format detection (sheet name: " Current Inventory Status ")
 *   2. Oracle format detection (sheet name: "GS June 2026")
 *   3. Initial upload — all rows should be inserted as new items
 *   4. Secondary upload — altered stock quantities; verify update (no duplicates)
 *
 * Usage:
 *   node scripts/test_inventory_sync.js
 *   node scripts/test_inventory_sync.js --url http://localhost:3000
 *
 * Prerequisites:
 *   npm install xlsx form-data node-fetch  (already in package.json as xlsx)
 *
 * Note: This script uses the CommonJS require() API (compatible with Node 14+).
 */

import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ── Config ───────────────────────────────────────────────────────────────────

const BASE_URL     = process.argv.find(a => a.startsWith('--url='))?.split('=')[1]
                     || process.env.VITE_API_URL
                     || 'http://localhost:3000';
const PLANT_SAP    = 'Lanka Tiles';
const PLANT_ORACLE = 'Rocell Eheliyagoda';
const USERNAME     = 'test_script';
const TMP_DIR      = path.join(__dirname, '..', 'uploads');

// ── Colour helpers ────────────────────────────────────────────────────────────

const C = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  green:  '\x1b[32m',
  red:    '\x1b[31m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
  gray:   '\x1b[90m',
};

const pass  = (msg) => console.log(`  ${C.green}✔${C.reset}  ${msg}`);
const fail  = (msg) => console.log(`  ${C.red}✘${C.reset}  ${C.red}${msg}${C.reset}`);
const info  = (msg) => console.log(`  ${C.cyan}ℹ${C.reset}  ${msg}`);
const warn  = (msg) => console.log(`  ${C.yellow}⚠${C.reset}  ${msg}`);
const head  = (msg) => console.log(`\n${C.bold}${C.cyan}▸ ${msg}${C.reset}`);

let totalPassed = 0;
let totalFailed = 0;

function assert(condition, passMsg, failMsg) {
  if (condition) {
    pass(passMsg);
    totalPassed++;
  } else {
    fail(failMsg);
    totalFailed++;
  }
}

// ── Fixture Builders ─────────────────────────────────────────────────────────

/**
 * Creates an in-memory SAP " Current Inventory Status " workbook.
 * Structure exactly matches the real LT/LWT SAP export format.
 *
 * @param {Object[]} dataRows  - Array of { materialNumber, oldMat, desc, uom, qty }
 * @returns {Buffer} xlsx buffer
 */
function buildSAPFixture(dataRows) {
  const wb = XLSX.utils.book_new();

  // Row 0: blank metadata
  // Row 1: blank metadata
  // Row 2 (index 2): header row
  // Row 3+ : data

  const sheetData = [
    [],                                                              // Row 1 — blank
    ['Plant Inventory Export', new Date().toISOString()],            // Row 2 — metadata
    ['', 'Material Number', 'Old material number', 'Material Description', 'Base Unit of Measure', 'Sum of Unrestricted'], // Row 3 — header (index 2)
    ...dataRows.map(r => ['', r.materialNumber, r.oldMat ?? '', r.desc, r.uom, r.qty])
  ];

  const ws = XLSX.utils.aoa_to_sheet(sheetData);
  XLSX.utils.book_append_sheet(wb, ws, ' Current Inventory Status ');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

/**
 * Creates an in-memory Oracle "GS June 2026" workbook.
 * Structure exactly matches the real RCL-E / RCL-H Oracle export format.
 *
 * @param {Object[]} dataRows  - Array of { org, category, itemCode, desc, uom, qty, cost, value }
 * @returns {Buffer} xlsx buffer
 */
function buildOracleFixture(dataRows) {
  const wb = XLSX.utils.book_new();

  // Row 0: report title
  // Row 1: blank / secondary title
  // Row 2 (index 2): header row
  // Row 3+: data
  // Last row: grand total (Item Code blank) — skipped by parser

  const sheetData = [
    ['Spare Part Inventory Report — Rocell Eheliyagoda'],             // Row 1 — title
    [],                                                               // Row 2 — blank
    ['Organization', 'Item Category', 'Item Code', 'Description', 'Primary Unit Of Measure', 'Quantity', 'Unit Cost', 'Inventory Value'], // Row 3 — header (index 2)
    ...dataRows.map(r => [r.org, r.category, r.itemCode, r.desc, r.uom, r.qty, r.cost ?? 0, r.value ?? 0]),
    ['', '', '', '', '', '', '', ''],  // blank grand-total row (should be skipped)
  ];

  const ws = XLSX.utils.aoa_to_sheet(sheetData);
  XLSX.utils.book_append_sheet(wb, ws, 'GS June 2026');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

// ── Upload helper ─────────────────────────────────────────────────────────────

/**
 * POST a buffer as a multipart file to /api/inventory/sync-upload.
 * Uses native fetch (Node 18+) or falls back to dynamic import of node-fetch.
 */
async function postSyncUpload(buffer, filename, plantId) {
  const { FormData, Blob } = await import('node:buffer').catch(() => ({}));

  // Node 18+ has global FormData & Blob; older nodes need form-data package
  let formData;
  try {
    formData = new globalThis.FormData();
    const blob = new globalThis.Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    formData.append('file', blob, filename);
  } catch {
    // fallback for older Node
    const { default: FormData } = await import('form-data');
    formData = new FormData();
    formData.append('file', buffer, { filename, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  formData.append('plantId',  plantId);
  formData.append('username', USERNAME);

  const response = await fetch(`${BASE_URL}/api/inventory/sync-upload`, {
    method: 'POST',
    body: formData,
  });

  const json = await response.json();
  return { status: response.status, body: json };
}

// ── SAP test data ─────────────────────────────────────────────────────────────

const SAP_INITIAL = [
  { materialNumber: '000100201', oldMat: '', desc: 'Ball Bearing 6204 DDU',   uom: 'EA',  qty: 15 },
  { materialNumber: '000100202', oldMat: '', desc: 'V-Belt A-42',             uom: 'EA',  qty: 24 },
  { materialNumber: '000100203', oldMat: '', desc: 'Limit Switch TZ-8108',    uom: 'EA',  qty: 8  },
  { materialNumber: '000100204', oldMat: '', desc: 'Coupling Element HRC-110',uom: 'EA',  qty: 12 },
  { materialNumber: '000100205', oldMat: '', desc: 'Solenoid Valve 24VDC',    uom: 'EA',  qty: 5  },
];

// Same material numbers but altered quantities
const SAP_UPDATED = SAP_INITIAL.map(r => ({ ...r, qty: r.qty + 10 }));

// ── Oracle test data ──────────────────────────────────────────────────────────

const ORACLE_INITIAL = [
  { org: 'GSC', category: 'SE', itemCode: 'SE.001.000007.00.00', desc: 'Temperature Controller E5CC', uom: 'Each', qty: 3,  cost: 250,  value: 750  },
  { org: 'GSC', category: 'SE', itemCode: 'SE.001.000008.00.00', desc: 'Solid State Relay 40A',       uom: 'Each', qty: 12, cost: 85,   value: 1020 },
  { org: 'GSC', category: 'SM', itemCode: 'SM.002.000012.00.00', desc: 'Proximity Sensor M18',        uom: 'Each', qty: 7,  cost: 120,  value: 840  },
  { org: 'GSC', category: 'SM', itemCode: 'SM.002.000015.00.00', desc: 'Pneumatic Cylinder DNC-40',   uom: 'Each', qty: 2,  cost: 450,  value: 900  },
  { org: 'GSC', category: 'SE', itemCode: 'SE.001.000020.00.00', desc: 'Pressure Gauge 0-10 Bar',     uom: 'Each', qty: 15, cost: 65,   value: 975  },
];

const ORACLE_UPDATED = ORACLE_INITIAL.map(r => ({ ...r, qty: r.qty * 2, value: r.cost * r.qty * 2 }));

// ── Main test runner ──────────────────────────────────────────────────────────

async function runTests() {
  console.log(`\n${C.bold}${C.cyan}╔══════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.bold}${C.cyan}║   Inventory Sync Module — Test Suite          ║${C.reset}`);
  console.log(`${C.bold}${C.cyan}╚══════════════════════════════════════════════╝${C.reset}`);
  info(`Server: ${BASE_URL}`);
  info(`Plants : ${PLANT_SAP} (SAP) | ${PLANT_ORACLE} (Oracle)`);

  // ────────────────────────────────────────────────────────────────────────────
  // TEST 1: SAP initial upload (all new)
  // ────────────────────────────────────────────────────────────────────────────
  head('TEST 1 — SAP Initial Upload (All Items New)');
  try {
    const buf = buildSAPFixture(SAP_INITIAL);
    const { status, body } = await postSyncUpload(buf, 'sap_inventory_test.xlsx', PLANT_SAP);

    info(`Response: HTTP ${status}`);
    info(`Summary : ${JSON.stringify(body)}`);

    assert(status === 200,             'HTTP 200 OK',                      `Expected 200, got ${status}`);
    assert(body.status === 'success',  'status = success',                 `status = ${body.status}: ${body.message}`);
    assert(body.source === 'SAP',      'source = SAP (format detected)',   `source = ${body.source}`);
    assert(body.plant === PLANT_SAP,   `plant = ${PLANT_SAP}`,             `plant = ${body.plant}`);
    assert(body.total_rows_read >= SAP_INITIAL.length, `total_rows_read >= ${SAP_INITIAL.length}`, `total_rows_read = ${body.total_rows_read}`);
    assert(body.new_items_added === SAP_INITIAL.length, `new_items_added = ${SAP_INITIAL.length} (all inserted)`, `new_items_added = ${body.new_items_added}`);
    assert(body.items_updated === 0,   'items_updated = 0 (no pre-existing rows)', `items_updated = ${body.items_updated}`);
  } catch (err) {
    fail(`SAP initial upload threw: ${err.message}`);
    totalFailed++;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // TEST 2: SAP secondary upload (updated quantities — no duplicates)
  // ────────────────────────────────────────────────────────────────────────────
  head('TEST 2 — SAP Secondary Upload (Updated Stock, No Duplicates)');
  try {
    const buf = buildSAPFixture(SAP_UPDATED);
    const { status, body } = await postSyncUpload(buf, 'sap_inventory_update.xlsx', PLANT_SAP);

    info(`Response: HTTP ${status}`);
    info(`Summary : ${JSON.stringify(body)}`);

    assert(status === 200,             'HTTP 200 OK',                              `Expected 200, got ${status}`);
    assert(body.status === 'success',  'status = success',                         `status = ${body.status}: ${body.message}`);
    assert(body.source === 'SAP',      'source = SAP',                             `source = ${body.source}`);
    assert(body.new_items_added === 0, 'new_items_added = 0 (no duplicates)',      `new_items_added = ${body.new_items_added}`);
    assert(body.items_updated === SAP_INITIAL.length, `items_updated = ${SAP_INITIAL.length} (all rows updated)`, `items_updated = ${body.items_updated}`);

    // Verify db.json reflects the updated quantities
    const dbPath = path.join(__dirname, '..', 'db.json');
    if (fs.existsSync(dbPath)) {
      const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
      let allUpdated = true;
      SAP_UPDATED.forEach(r => {
        const itemCode  = String(parseInt(r.materialNumber, 10));
        const id        = `${PLANT_SAP}-${itemCode}`.replace(/[^a-zA-Z0-9\-_.]/g, '-');
        const dbRecord  = db.find(p => p.id === id);
        if (!dbRecord) {
          warn(`  db.json: record not found for id=${id}`);
          allUpdated = false;
        } else if (dbRecord.onHand !== r.qty) {
          warn(`  db.json: ${id} onHand=${dbRecord.onHand}, expected ${r.qty}`);
          allUpdated = false;
        }
      });
      assert(allUpdated, 'db.json reflects updated stock quantities', 'One or more stock values were NOT updated in db.json');
    } else {
      warn('db.json not found — skipping db verification (run server first to create it)');
    }
  } catch (err) {
    fail(`SAP secondary upload threw: ${err.message}`);
    totalFailed++;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // TEST 3: Oracle initial upload (all new)
  // ────────────────────────────────────────────────────────────────────────────
  head('TEST 3 — Oracle Initial Upload (All Items New)');
  try {
    const buf = buildOracleFixture(ORACLE_INITIAL);
    const { status, body } = await postSyncUpload(buf, 'oracle_inventory_test.xlsx', PLANT_ORACLE);

    info(`Response: HTTP ${status}`);
    info(`Summary : ${JSON.stringify(body)}`);

    assert(status === 200,                'HTTP 200 OK',                        `Expected 200, got ${status}`);
    assert(body.status === 'success',     'status = success',                   `status = ${body.status}: ${body.message}`);
    assert(body.source === 'ORACLE',      'source = ORACLE (format detected)',  `source = ${body.source}`);
    assert(body.total_rows_read >= ORACLE_INITIAL.length, `total_rows_read >= ${ORACLE_INITIAL.length}`, `total_rows_read = ${body.total_rows_read}`);
    assert(body.new_items_added === ORACLE_INITIAL.length, `new_items_added = ${ORACLE_INITIAL.length} (all inserted)`, `new_items_added = ${body.new_items_added}`);
    assert(body.items_updated === 0,      'items_updated = 0',                  `items_updated = ${body.items_updated}`);
  } catch (err) {
    fail(`Oracle initial upload threw: ${err.message}`);
    totalFailed++;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // TEST 4: Oracle secondary upload (updated quantities — no duplicates)
  // ────────────────────────────────────────────────────────────────────────────
  head('TEST 4 — Oracle Secondary Upload (Updated Stock, No Duplicates)');
  try {
    const buf = buildOracleFixture(ORACLE_UPDATED);
    const { status, body } = await postSyncUpload(buf, 'oracle_inventory_update.xlsx', PLANT_ORACLE);

    info(`Response: HTTP ${status}`);
    info(`Summary : ${JSON.stringify(body)}`);

    assert(status === 200,                'HTTP 200 OK',                              `Expected 200, got ${status}`);
    assert(body.status === 'success',     'status = success',                         `status = ${body.status}: ${body.message}`);
    assert(body.source === 'ORACLE',      'source = ORACLE',                          `source = ${body.source}`);
    assert(body.new_items_added === 0,    'new_items_added = 0 (no duplicates)',       `new_items_added = ${body.new_items_added}`);
    assert(body.items_updated === ORACLE_INITIAL.length, `items_updated = ${ORACLE_INITIAL.length} (all rows updated)`, `items_updated = ${body.items_updated}`);

    // Verify db.json reflects updated quantities
    const dbPath = path.join(__dirname, '..', 'db.json');
    if (fs.existsSync(dbPath)) {
      const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
      let allUpdated = true;
      ORACLE_UPDATED.forEach(r => {
        // Plant resolved from Organization column ("GSC") → falls through to plantId
        const resolvedPlant = r.org || PLANT_ORACLE;
        const id = `${resolvedPlant}-${r.itemCode}`.replace(/[^a-zA-Z0-9\-_.]/g, '-');
        const dbRecord = db.find(p => p.id === id);
        if (!dbRecord) {
          warn(`  db.json: record not found for id=${id}`);
          allUpdated = false;
        } else if (dbRecord.onHand !== r.qty) {
          warn(`  db.json: ${id} onHand=${dbRecord.onHand}, expected ${r.qty}`);
          allUpdated = false;
        }
      });
      assert(allUpdated, 'db.json reflects updated Oracle stock quantities', 'One or more Oracle stock values were NOT updated in db.json');
    } else {
      warn('db.json not found — skipping db verification (run server first to create it)');
    }
  } catch (err) {
    fail(`Oracle secondary upload threw: ${err.message}`);
    totalFailed++;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // TEST 5: Unknown format rejection
  // ────────────────────────────────────────────────────────────────────────────
  head('TEST 5 — Unknown Format Rejection');
  try {
    // Build a generic workbook with no matching sheet names or column headers
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([['Col A', 'Col B', 'Col C'], [1, 2, 3]]);
    XLSX.utils.book_append_sheet(wb, ws, 'Random Sheet');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const { status, body } = await postSyncUpload(buf, 'unknown_format.xlsx', PLANT_SAP);

    info(`Response: HTTP ${status}`);
    info(`Body    : ${JSON.stringify(body)}`);

    assert(status === 422,            'HTTP 422 Unprocessable Entity for unknown format', `Expected 422, got ${status}`);
    assert(body.status === 'error',   'status = error',                                    `status = ${body.status}`);
  } catch (err) {
    fail(`Unknown format test threw: ${err.message}`);
    totalFailed++;
  }

  // ── Summary ─────────────────────────────────────────────────────────────────
  console.log(`\n${C.bold}${C.cyan}╔══════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.bold}${C.cyan}║   TEST RESULTS                                ║${C.reset}`);
  console.log(`${C.bold}${C.cyan}╚══════════════════════════════════════════════╝${C.reset}`);
  console.log(`  ${C.green}Passed : ${totalPassed}${C.reset}`);
  console.log(`  ${C.red}Failed : ${totalFailed}${C.reset}`);
  console.log(`  ${totalFailed === 0 ? C.green + '✔ ALL TESTS PASSED' : C.red + '✘ SOME TESTS FAILED'}${C.reset}\n`);

  process.exit(totalFailed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error(`\n${C.red}FATAL: Test runner threw an unexpected error:${C.reset}`, err);
  process.exit(1);
});
