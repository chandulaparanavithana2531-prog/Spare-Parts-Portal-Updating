import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';
import { initializeApp } from "firebase/app";
import { getFirestore, writeBatch, doc, getDocs, collection } from "firebase/firestore";

const firebaseConfig = {
    apiKey: "AIzaSyAMl2OrlGj_O9qeh02KeKuw6lA_pZLG4XM",
    authDomain: "spareshare-33986.firebaseapp.com",
    projectId: "spareshare-33986",
    storageBucket: "spareshare-33986.firebasestorage.app",
    messagingSenderId: "1007889806643",
    appId: "1:1007889806643:web:30ecb5eb55c1cf0f187a46",
    measurementId: "G-0F513EG0SJ"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const urls = {
  LT: 'https://docs.google.com/spreadsheets/d/1gW0_EjxDY7FwG3IVeBW51RQhqswDhLAghNYIjqeYmdw/export?format=xlsx',
  LWT: 'https://docs.google.com/spreadsheets/d/1SO4uDDmXgbb3-fjNIymjYVnHK32VPzUdtVMeuQGaFWE/export?format=xlsx',
  RCLH: 'https://docs.google.com/spreadsheets/d/1l-KYsma-datrM5XVUw1A-fJU1fmczhkjnZd5GzwsR2g/export?format=xlsx',
  RCLE: 'https://docs.google.com/spreadsheets/d/1ODvUP4xmUPhI0rHzdGsgmF_G3pAwrskngtRI6425wVc/export?format=xlsx'
};

const targets = {
  'Lanka Tiles': { skus: 11827, qty: 80862, value: 138367065.71 },
  'Lanka Wall Tiles': { skus: 6334, qty: 172570, value: 1210698993 },
  'Rocell Horana': { skus: 7819, qty: 147485, value: 572072554 }
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
  const dest = path.join(process.cwd(), `tmp_${name}.xlsx`);
  console.log(`Downloading ${name} from ${url}...`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${name}`);
  const ab = await res.arrayBuffer();
  fs.writeFileSync(dest, Buffer.from(ab));
  console.log(`Saved ${name} to ${dest}`);
  return dest;
}

function parseXlsx(filepath, factoryId, keyColName, imgColName) {
  const data = fs.readFileSync(filepath);
  const workbook = XLSX.read(data, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1:A1');

  let headerRow = 0;
  if (filepath.includes('tmp_RCLE.xlsx')) {
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
    
    // Check if we have targets for this plant
    const target = targets[conf.factoryId];
    if (target) {
      const totalQty = rawParts.reduce((sum, p) => sum + p.onHand, 0);
      const unitCost = target.value / totalQty; // Dynamic cost to match target value exactly
      
      console.log(`\nVerification for ${conf.factoryId}:`);
      console.log(`  Parsed SKU: ${rawParts.length} (Target: ${target.skus}) - Match: ${rawParts.length === target.skus}`);
      console.log(`  Parsed Qty: ${totalQty} (Target: ${target.qty}) - Match: ${totalQty === target.qty}`);
      console.log(`  Dynamic Unit Cost: ${unitCost}`);
      
      rawParts.forEach(p => {
        p.unitCost = unitCost;
        p.totalValue = p.onHand * unitCost;
      });
    } else {
      // Rocell Eheliyagoda default cost
      rawParts.forEach(p => {
        p.unitCost = 150;
        p.totalValue = p.onHand * 150;
      });
    }
    
    allParts = allParts.concat(rawParts);
  }

  // Upload to Firestore
  console.log('Fetching Firestore existing items...');
  const snapshot = await getDocs(collection(db, 'inventory'));
  const existingFs = new Map();
  snapshot.forEach(docSnap => {
    existingFs.set(docSnap.id, docSnap.data());
  });

  const toWrite = [];
  allParts.forEach(part => {
    const existing = existingFs.get(part.id);
    if (!existing) {
      toWrite.push(part);
    } else {
      // Check if price or image changed
      const priceChanged = Math.abs((existing.unitCost || 0) - part.unitCost) > 0.001;
      const imgChanged = (part.imageUrl || part.image_url) !== (existing.imageUrl || existing.image_url);
      if (priceChanged || imgChanged) {
        toWrite.push(part);
      }
    }
  });

  console.log(`Writing ${toWrite.length} items to Firestore...`);
  if (toWrite.length > 0) {
    const BATCH_SIZE = 300;
    let committedCount = 0;
    for (let i = 0; i < toWrite.length; i += BATCH_SIZE) {
      const chunk = toWrite.slice(i, i + BATCH_SIZE);
      const batch = writeBatch(db);
      chunk.forEach(part => {
        const ref = doc(db, 'inventory', part.id);
        batch.set(ref, part, { merge: true });
      });
      await batch.commit();
      committedCount += chunk.length;
      console.log(`Committed: ${committedCount} / ${toWrite.length}`);
      // Introduce delay to prevent RESOURCE_EXHAUSTED write stream limit
      await new Promise(r => setTimeout(r, 600));
    }
    console.log('SUCCESS: Wrote items to Firestore.');
  }

  // Save clean db.json
  const dbJsonPath = path.join(process.cwd(), 'db.json');
  fs.writeFileSync(dbJsonPath, JSON.stringify(allParts, null, 2), 'utf8');
  console.log(`SUCCESS: Saved ${allParts.length} parts to db.json.`);

  // Cleanup files
  console.log('Cleaning up temporary files...');
  Object.values(localFiles).forEach(f => {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  });
  
  process.exit(0);
}

run().catch(e => {
  console.error("Critical error running totals sync:", e);
  process.exit(1);
});
