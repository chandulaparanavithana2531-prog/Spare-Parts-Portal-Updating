import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';

const filepath = path.join(process.cwd(), 'user_sheet_temp.xlsx');

function checkHidden() {
  if (!fs.existsSync(filepath)) {
    console.error('File not found!');
    return;
  }
  const workbook = XLSX.read(filepath, { type: 'file' });
  console.log('All Sheet Names:', workbook.SheetNames);
  if (workbook.Workbook && workbook.Workbook.Sheets) {
    workbook.Workbook.Sheets.forEach((sheet, idx) => {
      console.log(`Sheet: ${workbook.SheetNames[idx]}, Hidden state: ${sheet.Hidden}`);
    });
  } else {
    console.log('No Workbook metadata found.');
  }
}

checkHidden();
