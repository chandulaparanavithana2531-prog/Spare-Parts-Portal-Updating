import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';

const file = path.join(process.cwd(), 'new_sheet2_temp.xlsx');

function run() {
  if (!fs.existsSync(file)) {
    console.error('File not found!');
    return;
  }
  const workbook = XLSX.read(file, { type: 'file' });
  const sheet = workbook.Sheets['GS June 2026'];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  
  const headers = rows[2] || [];
  console.log('Headers:', headers);
  
  const codeIdx = headers.findIndex(h => String(h).toLowerCase().includes('item code') || String(h).toLowerCase().includes('material'));
  const descIdx = headers.findIndex(h => String(h).toLowerCase().includes('description'));
  const qtyIdx = headers.findIndex(h => String(h).toLowerCase().includes('quantity'));
  const costIdx = headers.findIndex(h => String(h).toLowerCase().includes('unit cost'));
  const valIdx = headers.findIndex(h => String(h).toLowerCase().includes('inventory value') || String(h).toLowerCase().includes('total value'));
  
  console.log(`Indices -> code: ${codeIdx}, desc: ${descIdx}, qty: ${qtyIdx}, cost: ${costIdx}, val: ${valIdx}`);
  
  let skuCount = 0;
  let totalValue = 0;
  let totalQty = 0;
  
  for (let r = 3; r < rows.length; r++) {
    const row = rows[r];
    if (!row || !row[0]) continue;
    const itemCode = row[codeIdx];
    if (!itemCode) continue;
    
    skuCount++;
    const qty = parseFloat(row[qtyIdx]) || 0;
    const val = parseFloat(row[valIdx]) || 0;
    
    totalQty += qty;
    totalValue += val;
  }
  
  console.log(`RCL-E New Sheet Summary:`);
  console.log(`- Total SKUs: ${skuCount}`);
  console.log(`- Total Qty: ${totalQty}`);
  console.log(`- Total Value (LKR): Rs. ${Math.round(totalValue).toLocaleString()}`);
}

run();
