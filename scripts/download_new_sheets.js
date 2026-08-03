import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';

const sheet1Url = 'https://docs.google.com/spreadsheets/d/1rJRHhBG5FoR89SMc-afmfGfXUHpJNjW0-bwYow9BjBM/export?format=xlsx';
const sheet2Url = 'https://docs.google.com/spreadsheets/d/146d9NtVrYmqqIn-2wB9bjbbkZWkqtwX_dXaY3UeuQSI/export?format=xlsx';

const sheet1Path = path.join(process.cwd(), 'new_sheet1_temp.xlsx');
const sheet2Path = path.join(process.cwd(), 'new_sheet2_temp.xlsx');

async function download(url, dest) {
  console.log(`Downloading from ${url}...`);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download spreadsheet: ${res.statusText}`);
  }
  const ab = await res.arrayBuffer();
  fs.writeFileSync(dest, Buffer.from(ab));
  console.log(`Saved to ${dest}`);
}

function inspect(dest, label) {
  console.log(`\n===============================================================`);
  console.log(`                 INSPECTING ${label}                           `);
  console.log(`===============================================================`);
  
  const workbook = XLSX.read(dest, { type: 'file' });
  console.log('Sheet Names:', workbook.SheetNames);
  
  workbook.SheetNames.forEach(sheetName => {
    const worksheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
    console.log(`\n--- Sheet: ${sheetName} ---`);
    console.log(`Total Rows: ${rows.length}`);
    if (rows.length > 0) {
      console.log('Headers:', rows[0].slice(0, 15));
    }
    // Find headers by looking for "material" or similar
    let headerRowIdx = 0;
    for (let r = 0; r < Math.min(10, rows.length); r++) {
      if (rows[r] && rows[r].some(cell => String(cell).toLowerCase().includes('material') || String(cell).toLowerCase().includes('description'))) {
        headerRowIdx = r;
        console.log(`Found headers at row idx ${r}:`, rows[r].slice(0, 15));
        break;
      }
    }
    
    // Print first 3 data rows after headers
    for (let r = headerRowIdx + 1; r < Math.min(headerRowIdx + 5, rows.length); r++) {
      if (rows[r]) {
        console.log(`Row ${r}:`, rows[r].slice(0, 15));
      }
    }
  });
}

async function run() {
  await download(sheet1Url, sheet1Path);
  await download(sheet2Url, sheet2Path);
  
  inspect(sheet1Path, 'Sheet 1 (1rJRHhBG5FoR89SMc-afmfGfXUHpJNjW0-bwYow9BjBM)');
  inspect(sheet2Path, 'Sheet 2 (146d9NtVrYmqqIn-2wB9bjbbkZWkqtwX_dXaY3UeuQSI)');
}

run().catch(err => {
  console.error("Error:", err);
});
