import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';

const targets = {
  'Lanka Tiles': { skus: 11827, qty: 80862, value: 138367065.71 },
  'Lanka Wall Tiles': { skus: 6334, qty: 172570, value: 1210698993 },
  'Rocell Horana': { skus: 7819, qty: 147485, value: 572072554 }
};

function checkSheet(filepath, factoryId, keyColName, qtyColName) {
  const data = fs.readFileSync(filepath);
  const workbook = XLSX.read(data, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1:A1');

  const headers = [];
  for (let c = range.s.c; c <= range.e.c; c++) {
    const cell = worksheet[XLSX.utils.encode_cell({ r: range.s.r, c })];
    headers.push(cell && cell.v ? String(cell.v).trim() : '');
  }

  const keyIdx = headers.findIndex(h => h.toLowerCase() === keyColName.toLowerCase());
  let qtyIdx = headers.findIndex(h => h.toLowerCase() === qtyColName.toLowerCase());
  if (qtyIdx === -1) {
    qtyIdx = headers.findIndex(h => h.toLowerCase().includes('qty') || h.toLowerCase().includes('stock'));
  }

  let totalQty = 0;
  let skuCount = 0;

  for (let r = range.s.r + 1; r <= range.e.r; r++) {
    const cellKey = worksheet[XLSX.utils.encode_cell({ r, c: keyIdx })];
    if (!cellKey || !cellKey.v) continue;

    skuCount++;
    const cellQty = worksheet[XLSX.utils.encode_cell({ r, c: qtyIdx })];
    if (cellQty && cellQty.v) {
      totalQty += parseFloat(cellQty.v) || 0;
    }
  }

  const target = targets[factoryId];
  console.log(`\nFactory: ${factoryId}`);
  console.log(`  Parsed SKU Count: ${skuCount} | Target SKU: ${target.skus} | Match: ${skuCount === target.skus}`);
  console.log(`  Parsed Total Qty: ${totalQty} | Target Qty: ${target.qty} | Match: ${totalQty === target.qty}`);
  const avgCost = target.value / totalQty;
  console.log(`  Calculated Average Unit Cost: ${avgCost}`);
}

checkSheet('tracker_LT.xlsx', 'Lanka Tiles', 'Material Number', 'Qty (Unrestricted)');
checkSheet('tracker_LWT.xlsx', 'Lanka Wall Tiles', 'Material Number', 'Qty (Closing Stock)');
checkSheet('tracker_RCLH.xlsx', 'Rocell Horana', 'Material Number', 'Qty');
