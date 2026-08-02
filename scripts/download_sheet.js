import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';

const url = 'https://docs.google.com/spreadsheets/d/1RmMDKC8tgSFz26jB9TGP9Tq4_g5WoMo86-SKOTzVH6U/export?format=xlsx';
const dest = path.join(process.cwd(), 'user_sheet_temp.xlsx');

async function run() {
  console.log(`Downloading sheet from ${url}...`);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download spreadsheet: ${res.statusText}`);
  }
  const ab = await res.arrayBuffer();
  fs.writeFileSync(dest, Buffer.from(ab));
  console.log(`Saved sheet to ${dest}`);

  const workbook = XLSX.read(dest, { type: 'file' });
  console.log('Sheet Names:', workbook.SheetNames);
  
  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1:A1');
    console.log(`\n--- Sheet: ${sheetName} (Range: ${worksheet['!ref']}) ---`);
    
    // Read first few rows
    const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
    console.log(`Total Rows: ${rows.length}`);
    if (rows.length > 0) {
      console.log('Headers:', rows[0].slice(0, 15)); // Limit to first 15 columns for cleaner output
    }
    if (rows.length > 1) {
      console.log('Row 1:', rows[1].slice(0, 15));
    }
    if (rows.length > 2) {
      console.log('Row 2:', rows[2].slice(0, 15));
    }
  }
  
  // Keep the downloaded file for now so we can use it to import later
  console.log(`Downloaded Excel file kept at: ${dest}`);
}

run().catch(err => {
  console.error('Error:', err);
});
