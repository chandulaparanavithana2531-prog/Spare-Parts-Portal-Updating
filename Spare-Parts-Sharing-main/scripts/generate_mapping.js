import * as XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';

const getDirectDriveLink = (url) => {
  if (!url) return null;
  let id = '';
  const parts = url.split('/');
  const dIndex = parts.indexOf('d');
  if (dIndex !== -1 && parts.length > dIndex + 1) {
    id = parts[dIndex + 1];
  } else {
    const match = url.match(/[?&]id=([^&]+)/);
    if (match) {
      id = match[1];
    }
  }
  if (!id) return null;
  return `https://lh3.googleusercontent.com/d/${id}`;
};

async function run() {
  const file = path.join(process.cwd(), 'sheet_data.xlsx');
  console.log(`Reading Excel file from: ${file}...`);
  
  const data = fs.readFileSync(file);
  const workbook = XLSX.read(data, { type: 'buffer' });

  const mapping = {};
  let totalWithImages = 0;

  workbook.SheetNames.forEach(sheetName => {
    console.log(`Processing sheet: ${sheetName}...`);
    const worksheet = workbook.Sheets[sheetName];
    const range = XLSX.utils.decode_range(worksheet['!ref']);
    let sheetCount = 0;

    for (let r = range.s.r + 1; r <= range.e.r; r++) {
      const cellMaterial = worksheet[XLSX.utils.encode_cell({ r, c: 0 })];
      if (!cellMaterial || !cellMaterial.v) continue;

      const materialNumber = String(cellMaterial.v).trim();
      
      // Look through all columns in this row to find any image hyperlink or URL value
      let imageUrl = null;
      for (let c = range.s.c + 1; c <= range.e.c; c++) {
        const cell = worksheet[XLSX.utils.encode_cell({ r, c })];
        if (cell) {
          if (cell.l && cell.l.Target) {
            imageUrl = getDirectDriveLink(cell.l.Target);
            if (imageUrl) break;
          } else if (cell.v && String(cell.v).startsWith('http')) {
            imageUrl = getDirectDriveLink(cell.v);
            if (imageUrl) break;
          }
        }
      }

      if (imageUrl) {
        // If not already mapped, or if we want to overwrite, add to mapping
        if (!mapping[materialNumber]) {
          mapping[materialNumber] = imageUrl;
          sheetCount++;
          totalWithImages++;
        }
      }
    }
    console.log(`  Found ${sheetCount} image mappings in sheet "${sheetName}".`);
  });

  console.log(`\nExtracted ${totalWithImages} total unique material photo mappings.`);
  
  const outPath = path.join(process.cwd(), 'material_images.json');
  fs.writeFileSync(outPath, JSON.stringify(mapping, null, 2));
  console.log(`Saved updated mapping to: ${outPath}`);
  
  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
