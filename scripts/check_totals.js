import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';

const filepath = path.join(process.cwd(), 'user_sheet_temp.xlsx');

function checkTotals() {
  if (!fs.existsSync(filepath)) {
    console.error('File not found!');
    return;
  }
  const workbook = XLSX.read(filepath, { type: 'file' });
  
  for (const sheetName of workbook.SheetNames) {
    if (sheetName === 'Summary') continue;
    const worksheet = workbook.Sheets[sheetName];
    const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1:A1');
    const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
    
    // Headers are at index 2
    const headers = rows[2] || [];
    const qtyIdx = headers.findIndex(h => String(h).toLowerCase().includes('qty'));
    const valIdx = headers.findIndex(h => String(h).toLowerCase().includes('value') || String(h).toLowerCase().includes('cost'));
    
    let totalQty = 0;
    let totalVal = 0;
    let itemCostCount = 0;
    let skuCount = 0;
    
    // Scan headers to find specific value col or unit cost col
    const unitCostIdx = headers.findIndex(h => String(h).toLowerCase().includes('unit cost'));
    const valueLkrIdx = headers.findIndex(h => String(h).toLowerCase().includes('value (lkr)'));

    for (let r = 3; r < rows.length; r++) {
      const row = rows[r];
      if (!row || row.length === 0) continue;
      const keyCell = row[0];
      if (!keyCell) continue;
      
      skuCount++;
      const qty = parseFloat(row[qtyIdx]) || 0;
      totalQty += qty;
      
      if (valueLkrIdx !== -1) {
        const val = parseFloat(row[valueLkrIdx]) || 0;
        totalVal += val;
      } else if (unitCostIdx !== -1) {
        const cost = parseFloat(row[unitCostIdx]) || 0;
        totalVal += qty * cost;
      }
    }
    
    console.log(`\n--- Sheet: ${sheetName} ---`);
    console.log(`  Parsed SKUs: ${skuCount}`);
    console.log(`  Sum Qty: ${totalQty}`);
    console.log(`  Sum Value: ${totalVal}`);
  }
}

checkTotals();
