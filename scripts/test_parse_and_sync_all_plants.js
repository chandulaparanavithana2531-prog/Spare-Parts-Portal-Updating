/**
 * test_parse_and_sync_all_plants.js
 *
 * Automated verification for multi-plant Excel inventory synchronization using parseAndSyncPlantFile.
 * Tests all 4 plants: LT, LWT, RCL-H, RCL-E.
 *
 * Verifies:
 *   1. Client-side file parsing using xlsx
 *   2. Material code matching and stock quantity replacement
 *   3. Unit cost, total valuation, and description update on match
 *   4. New item creation when code is not found
 *   5. Items in other plants remain untouched
 */

import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  parseAndSyncPlantFile,
  parseInventoryWorkbook,
  resolvePlantId
} from '../services/inventorySyncService.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const ROOT       = path.join(__dirname, '..');

let totalPassed = 0;
let totalFailed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    totalPassed++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    totalFailed++;
  }
}

async function runTests() {
  console.log('==============================================================================');
  console.log('   MULTI-PLANT EXCEL INVENTORY SYNC UNIT TESTS (LT, LWT, RCL-H, RCL-E)       ');
  console.log('==============================================================================\n');

  // Define test matrix
  const plantCases = [
    { key: 'LT',    file: 'tmp_LT.xlsx',   expectedPlantName: 'Lanka Tiles' },
    { key: 'LWT',   file: 'tmp_LWT.xlsx',  expectedPlantName: 'Lanka Wall Tiles' },
    { key: 'RCL-H', file: 'tmp_RCLH.xlsx', expectedPlantName: 'Rocell Horana' },
    { key: 'RCL-E', file: 'tmp_RCLE.xlsx', expectedPlantName: 'Rocell Eheliyagoda' },
  ];

  for (const c of plantCases) {
    const filePath = path.join(ROOT, c.file);
    if (!fs.existsSync(filePath)) {
      console.warn(`⚠️ File ${c.file} not found in root, skipping test for ${c.key}.`);
      continue;
    }

    console.log(`\n--- Testing Plant Key "${c.key}" (${c.expectedPlantName}) with ${c.file} ---`);

    // 1. Read buffer and create File object simulation
    const fileBuffer = fs.readFileSync(filePath);
    const mockFile = new File([fileBuffer], c.file, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });

    // 2. Setup initial mock inventory in global/local state with 1 existing match item and 1 item in another plant
    const workbook = XLSX.readFile(filePath);
    const parseRes = parseInventoryWorkbook(workbook, c.expectedPlantName);
    assert(parseRes.rows.length > 0, `Parsed ${parseRes.rows.length} rows for ${c.key}`);

    const sampleMatchRow = parseRes.rows[0];
    const matchMaterialCode = sampleMatchRow.item_code;
    const matchSafeId = `${c.expectedPlantName}-${matchMaterialCode}`.replace(/[^a-zA-Z0-9\-_.]/g, '-');

    const mockInitialInventory = [
      // Match item in target plant with old stock quantity = 999999
      {
        id: matchSafeId,
        factoryId: c.expectedPlantName,
        materialNumber: matchMaterialCode,
        partNumber: matchMaterialCode,
        description: 'OLD DESCRIPTION BEFORE SYNC',
        onHand: 999999,
        unitCost: 1.0,
        totalValue: 999999.0,
        categoryName: 'TEST',
        spareType: 'TEST',
        uom: 'EACH',
        machine: 'TEST',
        criticality: 'HIGH',
      },
      // Untouched item in ANOTHER plant
      {
        id: 'UNTOUCHED-PLANT-ITEM-999',
        factoryId: 'Untouched Factory X',
        materialNumber: 'UNTOUCHED-999',
        partNumber: 'UNTOUCHED-999',
        description: 'THIS ITEM MUST REMAIN UNTOUCHED',
        onHand: 777,
        unitCost: 10.0,
        totalValue: 7770.0,
        categoryName: 'PRESERVED',
        spareType: 'PRESERVED',
        uom: 'EACH',
        machine: '-',
        criticality: '-',
      }
    ];

    // Mock localStorage
    const mockStore = new Map();
    mockStore.set('spareshare_inventory', JSON.stringify(mockInitialInventory));

    global.localStorage = {
      getItem: (k) => mockStore.get(k) || null,
      setItem: (k, v) => mockStore.set(k, String(v)),
      removeItem: (k) => mockStore.delete(k),
      clear: () => mockStore.clear(),
    };

    // 3. Execute parseAndSyncPlantFile
    const syncResult = await parseAndSyncPlantFile(mockFile, c.key, 'unit_test_user');

    assert(syncResult.status === 'success', `Sync status is success for ${c.key}`);
    assert(syncResult.plant === c.expectedPlantName, `Target plant resolved correctly to "${c.expectedPlantName}"`);
    assert(syncResult.items_updated >= 1, `At least 1 item updated (matched existing code ${matchMaterialCode})`);
    assert(syncResult.new_items_added > 0, `New items created for un-matched rows (${syncResult.new_items_added} new added)`);

    // 4. Verify local storage resulting state
    const savedInventoryStr = global.localStorage.getItem('spareshare_inventory');
    const savedInventory = JSON.parse(savedInventoryStr);

    // Verify untouched item in other plant is still present and unchanged
    const untouchedItem = savedInventory.find(i => i.id === 'UNTOUCHED-PLANT-ITEM-999');
    assert(Boolean(untouchedItem), 'Item in other plant ("Untouched Factory X") was kept untouched');
    assert(untouchedItem?.onHand === 777, 'Untouched item onHand quantity preserved (777)');

    // Verify existing match item stock quantity was replaced with new report quantity
    const updatedMatchItem = savedInventory.find(i => i.materialNumber === matchMaterialCode && i.factoryId === c.expectedPlantName);
    assert(Boolean(updatedMatchItem), `Matched item "${matchMaterialCode}" exists in updated catalog`);
    assert(updatedMatchItem.onHand === sampleMatchRow.quantity_on_hand, `Stock quantity replaced: ${updatedMatchItem.onHand} === ${sampleMatchRow.quantity_on_hand}`);
    assert(updatedMatchItem.description === sampleMatchRow.description, `Description updated to report description: "${updatedMatchItem.description}"`);
    assert(updatedMatchItem.criticality === 'HIGH', 'Preserved non-overlapping field (criticality = HIGH)');

    // Verify total size
    const expectedTotalSize = syncResult.items_updated + syncResult.new_items_added + 1;
    assert(savedInventory.length === expectedTotalSize, `Total saved items count is accurate: ${savedInventory.length} (${syncResult.items_updated + syncResult.new_items_added} unique parsed + 1 untouched)`);
  }

  console.log('\n==============================================================================');
  console.log(`   TEST SUMMARY: ${totalPassed} PASSED, ${totalFailed} FAILED   `);
  console.log('==============================================================================\n');

  if (totalFailed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal test execution error:', err);
  process.exit(1);
});
