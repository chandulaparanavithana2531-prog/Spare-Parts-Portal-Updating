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
  const existingMappingPath = path.join(process.cwd(), 'material_images.json');
  let existingMapping = {};
  if (fs.existsSync(existingMappingPath)) {
    try {
      existingMapping = JSON.parse(fs.readFileSync(existingMappingPath, 'utf8'));
      console.log(`[Init] Loaded existing material images mapping with ${Object.keys(existingMapping).length} entries.`);
    } catch (e) {
      console.error(`[Init] Error parsing existing material_images.json:`, e);
    }
  }

  const lwtSheetPath = path.join(process.cwd(), 'lwt_sheet.xlsx');
  if (!fs.existsSync(lwtSheetPath)) {
    console.error(`[LWT] Downloaded LWT sheet not found at: ${lwtSheetPath}`);
    process.exit(1);
  }

  console.log(`[LWT] Reading Excel file: ${lwtSheetPath}...`);
  const data = fs.readFileSync(lwtSheetPath);
  const workbook = XLSX.read(data, { type: 'buffer' });

  let newEntriesCount = 0;
  let overwrittenCount = 0;

  workbook.SheetNames.forEach(sheetName => {
    console.log(`[LWT] Processing sheet: ${sheetName}...`);
    const worksheet = workbook.Sheets[sheetName];
    const range = XLSX.utils.decode_range(worksheet['!ref']);

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
        if (!existingMapping[materialNumber]) {
          existingMapping[materialNumber] = imageUrl;
          newEntriesCount++;
        } else if (existingMapping[materialNumber] !== imageUrl) {
          existingMapping[materialNumber] = imageUrl;
          overwrittenCount++;
        }
      }
    }
  });

  console.log(`[LWT] Merge complete.`);
  console.log(`  Added new mappings: ${newEntriesCount}`);
  console.log(`  Overwritten/updated mappings: ${overwrittenCount}`);
  console.log(`  Total active entries: ${Object.keys(existingMapping).length}`);

  fs.writeFileSync(existingMappingPath, JSON.stringify(existingMapping, null, 2));
  console.log(`[LWT] Saved updated mapping back to: ${existingMappingPath}`);
  
  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
