import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';

const sheetFile = path.join(process.cwd(), 'user_sheet_temp.xlsx');
const dbFile = path.join(process.cwd(), 'db.json');

function runVerification() {
  if (!fs.existsSync(sheetFile)) {
    console.error('Spreadsheet not found!');
    process.exit(1);
  }
  if (!fs.existsSync(dbFile)) {
    console.error('db.json not found!');
    process.exit(1);
  }
  
  const workbook = XLSX.read(sheetFile, { type: 'file' });
  const dbParts = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
  
  // 1. Calculate spreadsheet totals
  let sheetSkuTotal = 0;
  let sheetValueTotal = 0;
  const sheetBreakdown = {};
  
  const sheets = [
    { name: 'LT - Inventory', factory: 'Lanka Tiles' },
    { name: 'LWT - Inventory', factory: 'Lanka Wall Tiles' },
    { name: 'RCL-H - Inventory', factory: 'Rocell Horana' },
    { name: 'RCL-E - Inventory', factory: 'Rocell Eheliyagoda' }
  ];
  
  sheets.forEach(config => {
    let worksheet = workbook.Sheets[config.name];
    if (config.factory === 'Rocell Eheliyagoda') {
      const rcleDataPath = path.join(process.cwd(), 'rcle_data_temp.xlsx');
      const rcleWorkbook = XLSX.read(rcleDataPath, { type: 'file' });
      worksheet = rcleWorkbook.Sheets['GS June 2026'];
    }
    if (!worksheet) return;
    
    const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
    // Find headers by looking for "material", "item code", or similar
    let headerRowIdx = 2; // Default to row index 2
    for (let r = 0; r < Math.min(10, rows.length); r++) {
      if (rows[r] && rows[r].some(cell => String(cell).toLowerCase().includes('material') || String(cell).toLowerCase().includes('item code') || String(cell).toLowerCase() === 'code')) {
        headerRowIdx = r;
        break;
      }
    }
    const headers = rows[headerRowIdx] || [];
    
    const qtyIdx = headers.findIndex(h => String(h).toLowerCase().includes('qty') || String(h).toLowerCase().includes('quantity') || String(h).toLowerCase().includes('on hand'));
    const costIdx = headers.findIndex(h => String(h).toLowerCase() === 'unit cost' || String(h).toLowerCase() === 'price');
    const valIdx = headers.findIndex(h => String(h).toLowerCase().includes('value') || String(h).toLowerCase().includes('total value') || String(h).toLowerCase().includes('inventory value'));
    
    let skus = 0;
    let value = 0;
    
    for (let r = headerRowIdx + 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || !row[0]) continue;
      skus++;
      const qty = parseFloat(row[qtyIdx]) || 0;
      if (config.factory === 'Lanka Tiles' || config.factory === 'Lanka Wall Tiles') {
        value += valIdx !== -1 ? parseFloat(row[valIdx]) || 0 : 0;
      } else {
        value += valIdx !== -1 ? parseFloat(row[valIdx]) || 0 : (qty * (costIdx !== -1 ? parseFloat(row[costIdx]) || 0 : 0));
      }
    }
    
    sheetBreakdown[config.factory] = { skus, value };
    sheetSkuTotal += skus;
    sheetValueTotal += value;
  });
  
  // 2. Calculate Portal Database totals
  let dbSkuTotal = 0;
  let dbValueTotal = 0;
  const dbBreakdown = {};
  
  dbParts.forEach(p => {
    const factory = p.factoryId || 'Unknown';
    if (!dbBreakdown[factory]) {
      dbBreakdown[factory] = { skus: 0, value: 0 };
    }
    dbBreakdown[factory].skus++;
    dbBreakdown[factory].value += p.totalValue || 0;
    dbSkuTotal++;
    dbValueTotal += p.totalValue || 0;
  });
  
  console.log('\n===============================================================');
  console.log('                 DATA RECONCILIATION SUMMARY                  ');
  console.log('===============================================================');
  console.log(`\nMetric                | Google Sheet       | Portal Database    | Match Status`);
  console.log('---------------------------------------------------------------');
  console.log(`Total SKU Count       | ${sheetSkuTotal.toLocaleString().padEnd(18)} | ${dbSkuTotal.toLocaleString().padEnd(18)} | ${sheetSkuTotal === dbSkuTotal ? '✅ MATCHED' : '❌ MISMATCH'}`);
  console.log(`Total Valuation (LKR) | Rs. ${Math.round(sheetValueTotal).toLocaleString().padEnd(14)} | Rs. ${Math.round(dbValueTotal).toLocaleString().padEnd(14)} | ${Math.abs(sheetValueTotal - dbValueTotal) < 1.0 ? '✅ MATCHED' : '❌ MISMATCH'}`);
  
  console.log('\n===============================================================');
  console.log('                 BREAKDOWN BY BUSINESS UNIT                   ');
  console.log('===============================================================');
  
  Object.keys(sheetBreakdown).forEach(factory => {
    const sBU = sheetBreakdown[factory];
    const dBU = dbBreakdown[factory] || { skus: 0, value: 0 };
    
    console.log(`\nFactory: ${factory}`);
    console.log(`  SKU Count: Sheet = ${sBU.skus} | Portal = ${dBU.skus} | Status: ${sBU.skus === dBU.skus ? '✅ Match' : '❌ Mismatch'}`);
    console.log(`  Valuation: Sheet = Rs. ${Math.round(sBU.value).toLocaleString()} | Portal = Rs. ${Math.round(dBU.value).toLocaleString()} | Status: ${Math.abs(sBU.value - dBU.value) < 1.0 ? '✅ Match' : '❌ Mismatch'}`);
  });
  
  console.log('\n===============================================================');
  
  if (sheetSkuTotal === dbSkuTotal && Math.abs(sheetValueTotal - dbValueTotal) < 1.0) {
    console.log('\x1b[32m%s\x1b[0m', 'SUCCESS: 100% Parity Achieved between Sheet and Portal Database.');
    process.exit(0);
  } else {
    console.log('\x1b[31m%s\x1b[0m', 'FAILURE: Discrepancy detected between Sheet and Portal Database.');
    process.exit(1);
  }
}

runVerification();
