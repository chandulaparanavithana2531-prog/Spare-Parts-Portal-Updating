import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';

const filepath = path.join(process.cwd(), 'user_sheet_temp.xlsx');

function countLinks() {
  if (!fs.existsSync(filepath)) {
    console.error('File not found!');
    return;
  }
  const workbook = XLSX.read(filepath, { type: 'file' });
  
  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1:A1');
    let linkCount = 0;
    let textLinkCount = 0;
    const examples = [];
    
    for (let r = range.s.r; r <= range.e.r; r++) {
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cellRef = XLSX.utils.encode_cell({ r, c });
        const cell = worksheet[cellRef];
        if (cell) {
          if (cell.l && cell.l.Target) {
            linkCount++;
            if (examples.length < 5) {
              examples.push({ cellRef, val: cell.v, target: cell.l.Target });
            }
          } else if (cell.v && String(cell.v).startsWith('http')) {
            textLinkCount++;
            if (examples.length < 5) {
              examples.push({ cellRef, val: cell.v });
            }
          }
        }
      }
    }
    
    console.log(`Sheet: ${sheetName} | Hyperlinks (.l): ${linkCount} | Text links (http*): ${textLinkCount}`);
    if (examples.length > 0) {
      console.log('Examples:', examples);
    }
  }
}

countLinks();
