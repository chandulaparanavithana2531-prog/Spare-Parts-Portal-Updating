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

function parseXlsx(filepath, factoryId, keyColName, imgColName) {
  const data = fs.readFileSync(filepath);
  const workbook = XLSX.read(data, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1:A1');

  let headerRow = 0;
  if (filepath.includes('tracker_RCLE.xlsx')) {
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
  // Check column names for Qty
  let qtyIdx = headers.findIndex(h => h.toLowerCase() === 'qty');
  if (qtyIdx === -1) {
    qtyIdx = headers.findIndex(h => h.toLowerCase().includes('qty') || h.toLowerCase().includes('stock'));
  }

  // Old material index (LT only, others fallback to keyVal)
  const oldMatIdx = headers.findIndex(h => h.toLowerCase().includes('old material'));

  const categoryIdx = headers.findIndex(h => h.toLowerCase() === 'category');

  console.log(`[XLSX Parsing] File: ${path.basename(filepath)} | Factory: ${factoryId}`);

  const items = [];
  for (let r = range.s.r + headerRow + 1; r <= range.e.r; r++) {
    const cellKey = worksheet[XLSX.utils.encode_cell({ r, c: keyIdx })];
    if (!cellKey || !cellKey.v) continue;
    const materialNumber = String(cellKey.v).trim();

    // Description
    let description = 'No Description';
    if (descIdx !== -1) {
      const cellDesc = worksheet[XLSX.utils.encode_cell({ r, c: descIdx })];
      if (cellDesc && cellDesc.v) description = String(cellDesc.v).trim();
    }

    // UOM
    let uom = 'EA';
    if (uomIdx !== -1) {
      const cellUom = worksheet[XLSX.utils.encode_cell({ r, c: uomIdx })];
      if (cellUom && cellUom.v) uom = String(cellUom.v).trim();
    }

    // Qty
    let onHand = 0;
    if (qtyIdx !== -1) {
      const cellQty = worksheet[XLSX.utils.encode_cell({ r, c: qtyIdx })];
      if (cellQty && cellQty.v) {
        onHand = parseFloat(cellQty.v) || 0;
      }
    }

    // Image Link
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

    // Old Material / Part Number
    let partNumber = materialNumber;
    if (oldMatIdx !== -1) {
      const cellOld = worksheet[XLSX.utils.encode_cell({ r, c: oldMatIdx })];
      if (cellOld && cellOld.v) partNumber = String(cellOld.v).trim();
    }

    const unitCost = 150;
    const totalValue = onHand * unitCost;

    // Derived category and type
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

    // ID formatting matches backend/inspect formats
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
      unitCost,
      totalValue,
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
  console.log(`  Parsed ${items.length} total parts for ${factoryId}.`);
  return items;
}

async function run() {
  const configs = [
    { factoryId: 'Lanka Tiles', file: 'tracker_LT.xlsx', key: 'Material Number', img: 'Image Link' },
    { factoryId: 'Lanka Wall Tiles', file: 'tracker_LWT.xlsx', key: 'Material Number', img: 'Image Link 1' },
    { factoryId: 'Rocell Horana', file: 'tracker_RCLH.xlsx', key: 'Material Number', img: 'Image Link 1' },
    { factoryId: 'Rocell Eheliyagoda', file: 'tracker_RCLE.xlsx', key: 'Item Code', img: 'Category' }
  ];

  let allParts = [];

  for (const conf of configs) {
    const filePath = path.join(process.cwd(), conf.file);
    if (!fs.existsSync(filePath)) {
      console.error(`Tracker file not found: ${conf.file}`);
      continue;
    }
    const parts = parseXlsx(filePath, conf.factoryId, conf.key, conf.img);
    allParts = allParts.concat(parts);
  }

  console.log(`\nParsed ${allParts.length} total parts across all factories.`);

  // Upload to Firestore
  // To avoid redundant writes and write quota issues, we will only write items that:
  // 1. Do not exist in Firestore.
  // 2. OR exist but need image updates (different or newly resolved image URL).
  console.log('Fetching existing Firestore items for diffing...');
  const snapshot = await getDocs(collection(db, 'inventory'));
  const existingFs = new Map();
  snapshot.forEach(docSnap => {
    const data = docSnap.data();
    existingFs.set(docSnap.id, data);
  });
  console.log(`Loaded ${existingFs.size} existing items from Firestore.`);

  const toWrite = [];
  allParts.forEach(part => {
    const existing = existingFs.get(part.id);
    if (!existing) {
      toWrite.push(part);
    } else {
      // Check if image link has been newly resolved
      const existingImg = existing.imageUrl || existing.image_url;
      const partImg = part.imageUrl || part.image_url;
      if (partImg && existingImg !== partImg) {
        toWrite.push(part);
      }
    }
  });

  console.log(`Items to write to Firestore: ${toWrite.length}`);

  if (toWrite.length > 0) {
    const BATCH_SIZE = 400;
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
      console.log(`Committed Firestore batch: ${committedCount} / ${toWrite.length}`);
    }
    console.log(`SUCCESS: Wrote ${committedCount} items to Firestore.`);
  } else {
    console.log('No new or modified items to write to Firestore.');
  }

  // Update local db.json
  const dbJsonPath = path.join(process.cwd(), 'db.json');
  console.log(`Updating local db.json at: ${dbJsonPath}...`);
  fs.writeFileSync(dbJsonPath, JSON.stringify(allParts, null, 2), 'utf8');
  console.log(`SUCCESS: Saved ${allParts.length} parts to db.json.`);

  process.exit(0);
}

run().catch(err => {
  console.error("Critical error running import:", err);
  process.exit(1);
});
