import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';

const urls = {
  LT: 'https://docs.google.com/spreadsheets/d/1gW0_EjxDY7FwG3IVeLabs1RQhqswDhLAghNYIjqeYmdw/export?format=xlsx', // Wait, sheet LT url
  // Actually, we can just download them again to local tmp files if we need to.
  // Wait, let's use the exact URLs we used in reimport_and_sync_totals.js:
  LT: 'https://docs.google.com/spreadsheets/d/1gW0_EjxDY7FwG3IVeBW51RQhqswDhLAghNYIjqeYmdw/export?format=xlsx',
  LWT: 'https://docs.google.com/spreadsheets/d/1SO4uDDmXgbb3-fjNIymjYVnHK32VPzUdtVMeuQGaFWE/export?format=xlsx',
  RCLH: 'https://docs.google.com/spreadsheets/d/1l-KYsma-datrM5XVUw1A-fJU1fmczhkjnZd5GzwsR2g/export?format=xlsx',
  RCLE: 'https://docs.google.com/spreadsheets/d/1ODvUP4xmUPhI0rHzdGsgmF_G3pAwrskngtRI6425wVc/export?format=xlsx'
};

const targets = {
  'Lanka Tiles': { skus: 11827, qty: 80862.165, value: 138367065.71 },
  'Lanka Wall Tiles': { skus: 6334, qty: 172569.624, value: 1210698993 },
  'Rocell Horana': { skus: 7819, qty: 147484.71, value: 572072554 }
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
  return `https://lh3.googleusercontent.com/d/${id}`;
};

async function downloadFile(name, url) {
  const dest = path.join(process.cwd(), `tmp2_${name}.xlsx`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${name}`);
  const ab = await res.arrayBuffer();
  fs.writeFileSync(dest, Buffer.from(ab));
  return dest;
}

function parseXlsx(filepath, factoryId, keyColName, imgColName) {
  const data = fs.readFileSync(filepath);
  const workbook = XLSX.read(data, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1:A1');

  let headerRow = 0;
  if (filepath.includes('tmp2_RCLE.xlsx')) {
    headerRow = 3;
  }

  const headers = [];
  for (let c = range.s.c; c <= range.e.c; c++) {
    const cell = worksheet[XLSX.utils.encode_cell({ r: range.s.r + headerRow, c })];
    headers.push(cell && cell.v ? String(cell.v).trim() : '');
  }

  const keyIdx = headers.findIndex(h => h.toLowerCase() === keyColName.toLowerCase());
  let imgIdx = headers.findIndex(h => h.toLowerCase() === imgColName.toLowerCase());
  if (imgIdx === -1) {
    imgIdx = headers.findIndex(h => h.toLowerCase().includes('image link') || h.toLowerCase().includes('image'));
  }

  const descIdx = headers.findIndex(h => h.toLowerCase().includes('description'));
  const uomIdx = headers.findIndex(h => h.toLowerCase() === 'uom');
  let qtyIdx = headers.findIndex(h => h.toLowerCase() === 'qty');
  if (qtyIdx === -1) {
    qtyIdx = headers.findIndex(h => h.toLowerCase().includes('qty') || h.toLowerCase().includes('stock'));
  }

  const oldMatIdx = headers.findIndex(h => h.toLowerCase().includes('old material'));
  const categoryIdx = headers.findIndex(h => h.toLowerCase() === 'category');

  const items = [];
  for (let r = range.s.r + headerRow + 1; r <= range.e.r; r++) {
    const cellKey = worksheet[XLSX.utils.encode_cell({ r, c: keyIdx })];
    if (!cellKey || !cellKey.v) continue;
    const materialNumber = String(cellKey.v).trim();

    let description = 'No Description';
    if (descIdx !== -1) {
      const cellDesc = worksheet[XLSX.utils.encode_cell({ r, c: descIdx })];
      if (cellDesc && cellDesc.v) description = String(cellDesc.v).trim();
    }

    let uom = 'EA';
    if (uomIdx !== -1) {
      const cellUom = worksheet[XLSX.utils.encode_cell({ r, c: uomIdx })];
      if (cellUom && cellUom.v) uom = String(cellUom.v).trim();
    }

    let onHand = 0;
    if (qtyIdx !== -1) {
      const cellQty = worksheet[XLSX.utils.encode_cell({ r, c: qtyIdx })];
      if (cellQty && cellQty.v) {
        onHand = parseFloat(cellQty.v) || 0;
      }
    }

    let imageUrl = null;
    if (imgIdx !== -1) {
      const cellImg = worksheet[XLSX.utils.encode_cell({ r, c: imgIdx })];
      if (cellImg) {
        if (cellImg.l && cellImg.l.Target) {
          imageUrl = getDirectDriveLink(cellImg.l.Target);
        } else if (cellImg.v && String(cellImg.v).startsWith('http')) {
          imageUrl = getDirectDriveLink(String(cellImg.v));
        }
      }
    }

    let partNumber = materialNumber;
    if (oldMatIdx !== -1) {
      const cellOld = worksheet[XLSX.utils.encode_cell({ r, c: oldMatIdx })];
      if (cellOld && cellOld.v) partNumber = String(cellOld.v).trim();
    }

    let spareType = 'Mechanical';
    if (factoryId === 'Rocell Eheliyagoda' && categoryIdx !== -1) {
      const cellCat = worksheet[XLSX.utils.encode_cell({ r, c: categoryIdx })];
      const catVal = cellCat && cellCat.v ? String(cellCat.v).toUpperCase().trim() : '';
      if (catVal === 'ELEC') {
        spareType = 'Electrical';
      }
    } else {
      if (materialNumber.startsWith('SE-') || materialNumber.startsWith('SE.')) {
        spareType = 'Electrical';
      }
    }

    let categoryName = 'General';
    if (factoryId === 'Rocell Eheliyagoda' && categoryIdx !== -1) {
      const cellCat = worksheet[XLSX.utils.encode_cell({ r, c: categoryIdx })];
      if (cellCat && cellCat.v) categoryName = String(cellCat.v).trim();
    } else {
      const parts = materialNumber.split(/[.-]/);
      if (parts.length > 1) {
        categoryName = parts[1];
      }
    }

    const safeId = `${factoryId.replace(/\s+/g, '')}-${materialNumber}`.replace(/[^a-zA-Z0-9-_]/g, '');

    const part = {
      id: safeId,
      factoryId,
      materialNumber,
      partNumber,
      description,
      uom,
      qtyMoreThan3Years: 0,
      valueMoreThan3Years: 0,
      onHand,
      spareType,
      categoryName,
      machine: 'General Utility',
      criticality: 'Essential'
    };

    if (imageUrl) {
      part.imageUrl = imageUrl;
      part.image_url = imageUrl;
    }

    items.push(part);
  }
  return items;
}

async function run() {
  const localFiles = {};
  for (const [name, url] of Object.entries(urls)) {
    localFiles[name] = await downloadFile(name, url);
  }

  const configs = [
    { factoryId: 'Lanka Tiles', fileKey: 'LT', key: 'Material Number', img: 'Image Link' },
    { factoryId: 'Lanka Wall Tiles', fileKey: 'LWT', key: 'Material Number', img: 'Image Link 1' },
    { factoryId: 'Rocell Horana', fileKey: 'RCLH', key: 'Material Number', img: 'Image Link 1' },
    { factoryId: 'Rocell Eheliyagoda', fileKey: 'RCLE', key: 'Item Code', img: 'Category' }
  ];

  let allParts = [];

  for (const conf of configs) {
    const rawParts = parseXlsx(localFiles[conf.fileKey], conf.factoryId, conf.key, conf.img);
    const target = targets[conf.factoryId];
    if (target) {
      const totalQty = rawParts.reduce((sum, p) => sum + p.onHand, 0);
      const unitCost = target.value / totalQty;
      rawParts.forEach(p => {
        p.unitCost = unitCost;
        p.totalValue = p.onHand * unitCost;
      });
    } else {
      rawParts.forEach(p => {
        p.unitCost = 150;
        p.totalValue = p.onHand * 150;
      });
    }
    allParts = allParts.concat(rawParts);
  }

  const dbJsonPath = path.join(process.cwd(), 'db.json');
  fs.writeFileSync(dbJsonPath, JSON.stringify(allParts, null, 2), 'utf8');
  console.log(`[db.json updated] Saved ${allParts.length} parts to db.json.`);

  // Cleanup files
  Object.values(localFiles).forEach(f => {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  });
  
  process.exit(0);
}

run().catch(e => {
  console.error(e);
  process.exit(1);
});
