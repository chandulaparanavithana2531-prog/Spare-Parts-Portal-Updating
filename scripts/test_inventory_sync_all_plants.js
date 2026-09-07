/**
 * test_inventory_sync_all_plants.js
 *
 * Unit test suite verifying the Inventory Ingestion & Synchronization Module
 * across all 4 plant export schemas (Lanka Tiles, Lanka Wall Tiles, Rocell Horana, Rocell Eheliyagoda).
 */

import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import {
  detectPlantAndFormat,
  parseInventoryWorkbook,
  normalizeUOM,
  stripLeadingZeros,
  toFloat,
} from '../services/inventorySyncService.ts';

async function runTests() {
  console.log('===============================================================');
  console.log('   RUNNING INVENTORY SYNC MODULE UNIT TESTS FOR ALL 4 PLANTS   ');
  console.log('===============================================================\n');

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

  // 1. Helper Unit Tests
  console.log('--- Test 1: Helper Normalization ---');
  assert(normalizeUOM('EA') === 'EACH', 'Normalise UOM "EA" -> "EACH"');
  assert(normalizeUOM('pcs') === 'PIECE', 'Normalise UOM "pcs" -> "PIECE"');
  assert(normalizeUOM('MTR') === 'METRE', 'Normalise UOM "MTR" -> "METRE"');
  assert(stripLeadingZeros('000100201') === '100201', 'Strip leading zeros "000100201" -> "100201"');
  assert(stripLeadingZeros('SE.001.000007') === 'SE.001.000007', 'Preserve alphanumeric code "SE.001.000007"');
  assert(toFloat('1,250.50') === 1250.5, 'Convert formatted string "1,250.50" to float');
  assert(toFloat(null) === 0, 'Convert null to 0');
  assert(toFloat(-50) === 0, 'Convert negative quantity to 0');

  // 2. Test Format Detection & Sheet Parsing Logic
  const testFiles = [
    { filename: 'tmp_LT.xlsx', expectedPlant: 'Lanka Tiles', expectedFormat: 'SAP' },
    { filename: 'tmp_LWT.xlsx', expectedPlant: 'Lanka Wall Tiles', expectedFormat: 'SAP' },
    { filename: 'tmp_RCLH.xlsx', expectedPlant: 'Rocell Horana', expectedFormat: 'ORACLE' },
    { filename: 'tmp_RCLE.xlsx', expectedPlant: 'Rocell Eheliyagoda', expectedFormat: 'ORACLE' },
    { filename: 'lwt_sheet.xlsx', expectedPlant: 'Lanka Wall Tiles', expectedFormat: 'SAP' },
    { filename: 'rcle_data_temp.xlsx', expectedPlant: 'Rocell Eheliyagoda', expectedFormat: 'ORACLE' },
  ];

  for (const t of testFiles) {
    const filePath = path.join(process.cwd(), t.filename);
    if (!fs.existsSync(filePath)) {
      console.warn(`\n⚠️ Skipping test file ${t.filename} (file not found in root)`);
      continue;
    }

    console.log(`\n--- Testing File: ${t.filename} ---`);
    const workbook = XLSX.readFile(filePath);
    const detection = detectPlantAndFormat(workbook, t.expectedPlant);

    assert(
      detection.format === t.expectedFormat,
      `Format detection for ${t.filename}: expected ${t.expectedFormat}, got ${detection.format}`
    );
    assert(
      detection.plantId === t.expectedPlant,
      `Plant detection for ${t.filename}: expected ${t.expectedPlant}, got ${detection.plantId}`
    );

    const parseResult = parseInventoryWorkbook(workbook, t.expectedPlant);
    assert(parseResult.rows.length > 0, `Successfully extracted ${parseResult.rows.length} canonical rows`);

    // Verify sample row canonical normalization
    const firstRow = parseResult.rows[0];
    assert(Boolean(firstRow.item_code), `First row has valid item_code: "${firstRow.item_code}"`);
    assert(Boolean(firstRow.description), `First row has valid description: "${firstRow.description}"`);
    assert(typeof firstRow.quantity_on_hand === 'number' && firstRow.quantity_on_hand >= 0, `First row quantity_on_hand is valid non-negative number (${firstRow.quantity_on_hand})`);
    assert(firstRow.uom === firstRow.uom.toUpperCase(), `First row UOM is uppercase: "${firstRow.uom}"`);

    // Check footer discarding
    const hasTotalOrNaN = parseResult.rows.some(r =>
      r.item_code.toLowerCase() === 'total' ||
      r.item_code.toLowerCase() === 'grand total' ||
      r.item_code.toLowerCase() === 'nan'
    );
    assert(!hasTotalOrNaN, 'All footer/summary rows ("Total", "Grand Total", "NaN") successfully discarded');
  }

  // 3. Test Database Upsert Simulation
  console.log('\n--- Test 3: Database Batch Upsert Verification ---');
  const samplePath = path.join(process.cwd(), 'tmp_RCLH.xlsx');
  if (fs.existsSync(samplePath)) {
    const sampleWorkbook = XLSX.readFile(samplePath);
    const parseResult = parseInventoryWorkbook(sampleWorkbook, 'Rocell Horana');
    const rowsToUpsert = parseResult.rows.slice(0, 100);

    const mockDb = new Map();
    let updatedCount = 0;
    let newAddedCount = 0;

    // Seed first item into DB to test match & update
    const firstItem = rowsToUpsert[0];
    const seedId = `${firstItem.plant_id}-${firstItem.item_code}`.replace(/[^a-zA-Z0-9\-_.]/g, '-');
    mockDb.set(seedId, {
      id: seedId,
      factoryId: firstItem.plant_id,
      materialNumber: firstItem.item_code,
      onHand: 0,
    });

    for (const r of rowsToUpsert) {
      const compositeId = `${r.plant_id}-${r.item_code}`.replace(/[^a-zA-Z0-9\-_.]/g, '-');
      if (mockDb.has(compositeId)) {
        const existing = mockDb.get(compositeId);
        mockDb.set(compositeId, { ...existing, onHand: r.quantity_on_hand });
        updatedCount++;
      } else {
        mockDb.set(compositeId, { id: compositeId, factoryId: r.plant_id, materialNumber: r.item_code, onHand: r.quantity_on_hand });
        newAddedCount++;
      }
    }

    assert(updatedCount > 0, `Successfully matched and updated existing item (${updatedCount} updated)`);
    assert(newAddedCount > 0, `Successfully inserted new items (${newAddedCount} new added)`);
    assert(mockDb.size === 100, `Database size accurately reflects total unique records (${mockDb.size})`);
  }

  console.log('\n===============================================================');
  console.log(`   TEST SUMMARY: ${totalPassed} PASSED, ${totalFailed} FAILED   `);
  console.log('===============================================================\n');

  if (totalFailed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
