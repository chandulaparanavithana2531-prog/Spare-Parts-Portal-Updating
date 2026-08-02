import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';

const urls = {
  LT_Stock_with_Images: 'https://docs.google.com/spreadsheets/d/1gW0_EjxDY7FwG3IVeBW51RQhqswDhLAghNYIjqeYmdw/export?format=xlsx',
  LWT_Stock_with_Images: 'https://docs.google.com/spreadsheets/d/1SO4uDDmXgbb3-fjNIymjYVnHK32VPzUdtVMeuQGaFWE/export?format=xlsx',
  RCLH_Stock_with_Images: 'https://docs.google.com/spreadsheets/d/1l-KYsma-datrM5XVUw1A-fJU1fmczhkjnZd5GzwsR2g/export?format=xlsx',
  RCLE_Inventory: 'https://docs.google.com/spreadsheets/d/146d9NtVrYmqqIn-2wB9bjbbkZWkqtwX_dXaY3UeuQSI/export?format=xlsx',
  LT_ACategory: 'https://docs.google.com/spreadsheets/d/1oUpZbq33z0ckTA8IEVXsksgD_cz87W6siBld1pQAQjM/export?format=xlsx',
  LWT_ACategory: 'https://docs.google.com/spreadsheets/d/1t9xEpXErv7xPTVVXwQXxNC_OseR4cAKw7tNlb88-NVU/export?format=xlsx',
  RCLH_ACategory: 'https://docs.google.com/spreadsheets/d/1YAS__Lscv48AKVH0e78KzNRk6vWApkZo9vWIUJ0Rm94/export?format=xlsx'
};

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
  id = id.split(/[&?]/)[0];
  return `https://lh3.googleusercontent.com/d/${id}`;
};

async function downloadFile(name, url) {
  const dest = path.join(process.cwd(), `tmp_download_${name}.xlsx`);
  console.log(`Downloading ${name} from ${url}...`);
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`Failed to download ${name}: ${res.statusText}`);
    return null;
  }
  const ab = await res.arrayBuffer();
  fs.writeFileSync(dest, Buffer.from(ab));
  console.log(`Saved ${name} to ${dest}`);
  return dest;
}

function extractImagesFromWorkbook(filepath, imageMap) {
  if (!fs.existsSync(filepath)) return;
  const workbook = XLSX.read(filepath, { type: 'file' });
  
  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1:A1');
    
    // Find header row and columns
    // We scan the first 10 rows to find headers like "material number", "item code", etc.
    let headerRowIdx = -1;
    let materialColIdx = -1;
    
    for (let r = range.s.r; r <= Math.min(range.e.r, range.s.r + 15); r++) {
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cell = worksheet[XLSX.utils.encode_cell({ r, c })];
        if (cell && cell.v) {
          const val = String(cell.v).toLowerCase().trim();
          if (val === 'material number' || val === 'item code' || val === 'material no.' || val === 'part number') {
            headerRowIdx = r;
            materialColIdx = c;
            break;
          }
        }
      }
      if (headerRowIdx !== -1) break;
    }
    
    if (headerRowIdx === -1 || materialColIdx === -1) {
      // Fallback: assume row 2 or 3 and column 0 (A)
      headerRowIdx = 2;
      materialColIdx = 0;
      console.log(`[Extract] Warning: could not find explicit material header in ${path.basename(filepath)} - ${sheetName}. Fallback to row 2, col A.`);
    } else {
      console.log(`[Extract] Found material number column at row ${headerRowIdx + 1}, col ${XLSX.utils.encode_col(materialColIdx)} in ${path.basename(filepath)} - ${sheetName}`);
    }
    
    let count = 0;
    for (let r = headerRowIdx + 1; r <= range.e.r; r++) {
      const cellMaterial = worksheet[XLSX.utils.encode_cell({ r, c: materialColIdx })];
      if (!cellMaterial || !cellMaterial.v) continue;
      
      const materialNumber = String(cellMaterial.v).trim();
      if (!materialNumber || materialNumber.toLowerCase() === 'total' || materialNumber.toLowerCase() === 'sum') continue;
      
      // Look for any image link in this row
      let imageUrl = null;
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cell = worksheet[XLSX.utils.encode_cell({ r, c })];
        if (cell) {
          if (cell.l && cell.l.Target) {
            imageUrl = getDirectDriveLink(cell.l.Target);
            if (imageUrl) break;
          } else if (cell.v && String(cell.v).startsWith('http')) {
            imageUrl = getDirectDriveLink(String(cell.v));
            if (imageUrl) break;
          }
        }
      }
      
      if (imageUrl) {
        imageMap[materialNumber] = imageUrl;
        count++;
      }
    }
    console.log(`[Extract] Extracted ${count} image links from ${sheetName}`);
  }
}

async function run() {
  const mappingPath = path.join(process.cwd(), 'material_images.json');
  let imageMap = {};
  if (fs.existsSync(mappingPath)) {
    imageMap = JSON.parse(fs.readFileSync(mappingPath, 'utf8'));
    console.log(`Loaded ${Object.keys(imageMap).length} existing image mappings.`);
  }

  const downloadedFiles = [];
  for (const [name, url] of Object.entries(urls)) {
    const file = await downloadFile(name, url);
    if (file) {
      downloadedFiles.push(file);
      extractImagesFromWorkbook(file, imageMap);
    }
  }

  // Save back to material_images.json
  fs.writeFileSync(mappingPath, JSON.stringify(imageMap, null, 2), 'utf8');
  console.log(`Finished! Total image mappings in material_images.json: ${Object.keys(imageMap).length}`);

  // Clean up
  console.log('Cleaning up temporary files...');
  downloadedFiles.forEach(f => {
    if (fs.existsSync(f)) {
      fs.unlinkSync(f);
    }
  });
}

run().catch(err => {
  console.error(err);
});
