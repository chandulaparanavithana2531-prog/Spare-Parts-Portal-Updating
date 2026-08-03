import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';

const filepath = path.join(process.cwd(), 'user_sheet_temp.xlsx');

function printSummary() {
  if (!fs.existsSync(filepath)) {
    console.error('File not found!');
    return;
  }
  const workbook = XLSX.read(filepath, { type: 'file' });
  
  console.log('Sheet Names:', workbook.SheetNames);
  
  const worksheet = workbook.Sheets['Summary'];
  if (!worksheet) {
    console.log('No Summary sheet found!');
    return;
  }
  
  const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1:A1');
  console.log(`Summary sheet range: ${worksheet['!ref']}`);
  
  let printed = 0;
  for (let r = range.s.r; r <= range.e.r; r++) {
    const rowCells = [];
    let hasVal = false;
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cellRef = XLSX.utils.encode_cell({ r, c });
      const cell = worksheet[cellRef];
      if (cell && cell.v !== undefined && cell.v !== '') {
        hasVal = true;
        let cellText = String(cell.v).trim();
        if (cell.l && cell.l.Target) {
          cellText += ` (Link: ${cell.l.Target})`;
        }
        rowCells.push(`Col ${XLSX.utils.encode_col(c)}: "${cellText}"`);
      }
    }
    if (hasVal) {
      console.log(`Row ${r + 1}:`, rowCells.join(' | '));
      printed++;
      if (printed > 60) {
        console.log('Reached limit of printed rows');
        break;
      }
    }
  }
}

printSummary();
