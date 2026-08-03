import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';

const files = ['sheet_data.xlsx', 'lwt_sheet.xlsx', 'lwt_sheet_new.xlsx', 'user_sheet_temp.xlsx'];

files.forEach(file => {
  const filepath = path.join(process.cwd(), file);
  if (!fs.existsSync(filepath)) {
    console.log(`${file} does not exist`);
    return;
  }
  try {
    const workbook = XLSX.read(filepath, { type: 'file' });
    console.log(`\n=== File: ${file} ===`);
    console.log('Sheet Names:', workbook.SheetNames);
    workbook.SheetNames.forEach(sheetName => {
      const worksheet = workbook.Sheets[sheetName];
      console.log(`  Sheet: ${sheetName}, Range: ${worksheet['!ref'] || 'A1:A1'}`);
    });
  } catch (err) {
    console.error(`Error reading ${file}:`, err.message);
  }
});
