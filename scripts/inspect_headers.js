import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';

const filepath = path.join(process.cwd(), 'user_sheet_temp.xlsx');

function inspectHeaders() {
  if (!fs.existsSync(filepath)) {
    console.error('File not found!');
    return;
  }
  const workbook = XLSX.read(filepath, { type: 'file' });
  
  workbook.SheetNames.forEach(sheetName => {
    console.log(`\n===========================================`);
    console.log(`Sheet: ${sheetName}`);
    console.log(`===========================================`);
    
    const worksheet = workbook.Sheets[sheetName];
    const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1:A1');
    
    // Print the first 10 rows
    for (let r = range.s.r; r <= Math.min(range.e.r, range.s.r + 10); r++) {
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
          rowCells.push(`Col ${XLSX.utils.encode_col(c)}: "${cellText.substring(0, 50)}"`);
        }
      }
      if (hasVal) {
        console.log(`Row ${r + 1}:`, rowCells.join(' | '));
      }
    }
  });
}

inspectHeaders();
