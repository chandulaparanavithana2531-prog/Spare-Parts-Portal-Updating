import { initializeApp } from "firebase/app";
import { getFirestore, writeBatch, doc } from "firebase/firestore";
import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';

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

async function run() {
  const file = path.join(process.cwd(), 'sheet_data.xlsx');
  console.log(`Reading Excel file from: ${file}...`);
  
  const mappingFile = path.join(process.cwd(), 'material_images.json');
  let materialImagesMap = {};
  if (fs.existsSync(mappingFile)) {
    materialImagesMap = JSON.parse(fs.readFileSync(mappingFile, 'utf8'));
    console.log(`Loaded ${Object.keys(materialImagesMap).length} material image mappings for seeding fallback.`);
  }

  const data = fs.readFileSync(file);
  const workbook = XLSX.read(data, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];

  const range = XLSX.utils.decode_range(worksheet['!ref']);
  console.log("Sheet rows count:", range.e.r - range.s.r + 1);

  const parts = [];
  const factoryId = 'Lanka Tiles';

  for (let r = range.s.r + 1; r <= range.e.r; r++) {
    const cellMaterial = worksheet[XLSX.utils.encode_cell({ r, c: 0 })];
    const cellOldMaterial = worksheet[XLSX.utils.encode_cell({ r, c: 1 })];
    const cellDesc = worksheet[XLSX.utils.encode_cell({ r, c: 2 })];
    const cellUom = worksheet[XLSX.utils.encode_cell({ r, c: 3 })];
    const cellQty = worksheet[XLSX.utils.encode_cell({ r, c: 4 })];
    const cellImageLink = worksheet[XLSX.utils.encode_cell({ r, c: 5 })];

    if (!cellMaterial || !cellMaterial.v) continue;

    let imageUrl = null;
    if (cellImageLink) {
      if (cellImageLink.l && cellImageLink.l.Target) {
        imageUrl = getDirectDriveLink(cellImageLink.l.Target);
      } else if (cellImageLink.v && String(cellImageLink.v).startsWith('http')) {
        imageUrl = getDirectDriveLink(cellImageLink.v);
      }
    }

    const materialNumber = String(cellMaterial.v).trim();
    if (!imageUrl && materialImagesMap[materialNumber]) {
      imageUrl = materialImagesMap[materialNumber];
    }

    const partNumber = cellOldMaterial && cellOldMaterial.v ? String(cellOldMaterial.v).trim() : materialNumber;
    const description = cellDesc && cellDesc.v ? String(cellDesc.v).trim() : 'No Description';
    const onHand = cellQty && cellQty.v ? parseFloat(cellQty.v) || 0 : 0;
    const unitCost = 150; // Mock average standard cost
    const totalValue = onHand * unitCost;

    // Derived category and type
    const spareType = materialNumber.startsWith('SE-') ? 'Electrical' : 'Mechanical';
    const categoryName = materialNumber.split('-')[1] || 'General';

    // Safe composite ID matching backend behavior
    const safeId = `${factoryId}-${materialNumber}`.replace(/[^a-zA-Z0-9-_]/g, '');

    const part = {
      id: safeId,
      factoryId,
      materialNumber,
      partNumber,
      description,
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

    parts.push(part);
  }

  console.log(`Parsed ${parts.length} total parts to write.`);

  // Write in batches of 400
  const BATCH_SIZE = 400;
  let successCount = 0;
  
  for (let i = 0; i < parts.length; i += BATCH_SIZE) {
    const chunk = parts.slice(i, i + BATCH_SIZE);
    const batch = writeBatch(db);
    
    chunk.forEach(part => {
      const ref = doc(db, 'inventory', part.id);
      batch.set(ref, part);
    });
    
    await batch.commit();
    successCount += chunk.length;
    console.log(`Uploaded batch: ${successCount} / ${parts.length} parts committed.`);
  }

  console.log(`SUCCESS: Uploaded ${successCount} parts under Lanka Tiles!`);
  process.exit(0);
}

run().catch(err => {
  console.error("Critical error running upload:", err);
  process.exit(1);
});
