import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';

const filepath = path.join(process.cwd(), 'user_sheet_temp.xlsx');

function checkSamples() {
  if (!fs.existsSync(filepath)) {
    console.error('File not found!');
    return;
  }
  const workbook = XLSX.read(filepath, { type: 'file' });
  
  for (const sheetName of workbook.SheetNames) {
    if (sheetName === 'Summary') continue;
    const worksheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
    console.log(`\n--- ${sheetName} ---`);
    console.log('Row 0:', rows[0]);
    console.log('Row 1:', rows[1]);
    console.log('Row 2 (Headers):', rows[2]);
    console.log('Row 3:', rows[3]);
    console.log('Row 4:', rows[4]);
    console.log('Row 5:', rows[5]);
  }
}

checkSamples();
