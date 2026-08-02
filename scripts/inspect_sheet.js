import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';

const filepath = path.join(process.cwd(), 'user_sheet_temp.xlsx');

function inspect() {
  if (!fs.existsSync(filepath)) {
    console.error('File not found!');
    return;
  }
  const workbook = XLSX.read(filepath, { type: 'file' });
  
  for (const sheetName of workbook.SheetNames) {
    if (sheetName === 'Summary') continue;
    
    const worksheet = workbook.Sheets[sheetName];
    const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1:A1');
    console.log(`\n===========================================`);
    console.log(`Sheet: ${sheetName}`);
    console.log(`===========================================`);
    
    // Check all headers in row index 2 (the 3rd row)
    const headers = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = worksheet[XLSX.utils.encode_cell({ r: 2, c })];
      headers.push({
        col: XLSX.utils.encode_col(c),
        header: cell && cell.v ? String(cell.v).trim() : ''
      });
    }
    console.log('Headers:', headers);

    // Let's search the first 100 rows for any cell containing http links or having a hyperlink object (.l)
    let linksFound = 0;
    for (let r = range.s.r; r <= Math.min(range.e.r, range.s.r + 500); r++) {
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cellRef = XLSX.utils.encode_cell({ r, c });
        const cell = worksheet[cellRef];
        if (cell) {
          if (cell.l) {
            console.log(`Link in ${cellRef} (value: ${cell.v}):`, cell.l);
            linksFound++;
          } else if (cell.v && String(cell.v).startsWith('http')) {
            console.log(`Text link in ${cellRef}:`, cell.v);
            linksFound++;
          }
        }
      }
      if (linksFound > 5) {
        console.log('Stopping link search early (found > 5)...');
        break;
      }
    }
  }
}

inspect();
