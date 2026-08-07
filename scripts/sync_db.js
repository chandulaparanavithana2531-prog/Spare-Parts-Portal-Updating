import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';
import { initializeApp } from "firebase/app";
import { getFirestore, writeBatch, doc, getDocs, collection, deleteDoc } from "firebase/firestore";

// Firebase Config
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

const masterUrl = 'https://docs.google.com/spreadsheets/d/1EzsyACHF2VPOmP_oXYrTmZ-dV7F3XMQjOn1Qh0ocfJc/export?format=xlsx';
const rcleFsnUrl = 'https://docs.google.com/spreadsheets/d/1rJRHhBG5FoR89SMc-afmfGfXUHpJNjW0-bwYow9BjBM/export?format=xlsx';
const rcleDataUrl = 'https://docs.google.com/spreadsheets/d/146d9NtVrYmqqIn-2wB9bjbbkZWkqtwX_dXaY3UeuQSI/export?format=xlsx';

const masterPath = path.join(process.cwd(), 'user_sheet_temp.xlsx');
const rcleFsnPath = path.join(process.cwd(), 'rcle_fsn_temp.xlsx');
const rcleDataPath = path.join(process.cwd(), 'rcle_data_temp.xlsx');
const imagesMapPath = path.join(process.cwd(), 'material_images.json');
const reportPath = path.join(process.cwd(), 'uploads', 'missing_photos_report.json');
const cachePath = path.join(process.cwd(), 'uploads', 'image_verification_cache.json');

// Ensure uploads folder exists
const uploadsDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

// Download Helper
async function downloadFile(name, url, dest) {
  console.log(`Downloading ${name} from ${url}...`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${name}`);
  const ab = await res.arrayBuffer();
  fs.writeFileSync(dest, Buffer.from(ab));
  console.log(`Saved ${name} to ${dest}`);
}

// Image Verifier
async function verifyImageUrls(uniqueUrls) {
  console.log(`Starting validation for ${uniqueUrls.length} unique image URLs...`);
  
  let cache = {};
  if (fs.existsSync(cachePath)) {
    try { cache = JSON.parse(fs.readFileSync(cachePath, 'utf8')); } catch (e) {}
  }
  
  const brokenUrls = new Set();
  const unchecked = [];
  
  uniqueUrls.forEach(url => {
    if (cache[url] !== undefined) {
      if (cache[url] === false) {
        brokenUrls.add(url);
      }
    } else {
      unchecked.push(url);
    }
  });
  
  console.log(`Cache hit: ${uniqueUrls.length - unchecked.length} URLs. Checking ${unchecked.length} unchecked URLs...`);
  
  // Check in batches of 30 to prevent network throttle
  const BATCH_SIZE = 30;
  for (let i = 0; i < unchecked.length; i += BATCH_SIZE) {
    const chunk = unchecked.slice(i, i + BATCH_SIZE);
    await Promise.all(chunk.map(async (url) => {
      try {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), 1500); // 1.5s timeout
        
        const res = await fetch(url, { method: 'HEAD', signal: controller.signal });
        clearTimeout(id);
        
        if (res.ok || res.status === 302 || res.status === 403) {
          // Some Google user content links return 403 on HEAD but work on GET, let's treat them as valid
          cache[url] = true;
        } else {
          cache[url] = false;
          brokenUrls.add(url);
        }
      } catch (err) {
        cache[url] = false;
        brokenUrls.add(url);
      }
    }));
    console.log(`Progress: Checked ${Math.min(i + BATCH_SIZE, unchecked.length)} / ${unchecked.length} URLs.`);
  }
  
  // Save updated cache
  fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2), 'utf8');
  return brokenUrls;
}

// Parse RCL-E FSN
function parseRcleFsn() {
  if (!fs.existsSync(rcleFsnPath)) {
    console.error('RCL-E FSN sheet missing!');
    return {};
  }
  const workbook = XLSX.read(rcleFsnPath, { type: 'file' });
  const mapping = {};
  
  const sheetsConfig = [
    { name: 'F - Fast Moving Items', fsn: 'Fast' },
    { name: 'S - Slow Moving Items', fsn: 'Slow' },
    { name: 'N - Non Moving Items', fsn: 'Non-moving' }
  ];
  
  sheetsConfig.forEach(config => {
    const worksheet = workbook.Sheets[config.name];
    if (!worksheet) return;
    const rows = XLSX.utils.sheet_to_json(worksheet);
    rows.forEach(row => {
      const matKey = Object.keys(row).find(k => k.toLowerCase() === 'material');
      if (matKey && row[matKey]) {
        mapping[String(row[matKey]).trim()] = config.fsn;
      }
    });
  });
  
  console.log(`Parsed RCL-E FSN Sheet: ${Object.keys(mapping).length} items classified.`);
  return mapping;
}

async function run() {
  await downloadFile('Master Inventory Spreadsheet', masterUrl, masterPath);
  await downloadFile('RCL-E FSN Classification Spreadsheet', rcleFsnUrl, rcleFsnPath);
  await downloadFile('RCL-E Inventory Spreadsheet', rcleDataUrl, rcleDataPath);
  
  const rcleFsnMap = parseRcleFsn();
  
  let materialImagesMap = {};
  if (fs.existsSync(imagesMapPath)) {
    try { materialImagesMap = JSON.parse(fs.readFileSync(imagesMapPath, 'utf8')); } catch (e) {}
  }
  
  // Gather unique image URLs
  const uniqueUrlsSet = new Set();
  Object.values(materialImagesMap).forEach(imgStr => {
    if (imgStr) {
      imgStr.split(/\s+/).forEach(url => {
        if (url && url.startsWith('http')) uniqueUrlsSet.add(url);
      });
    }
  });
  
  const brokenUrls = await verifyImageUrls(Array.from(uniqueUrlsSet));
  console.log(`Identified ${brokenUrls.size} broken image URLs.`);
  
  // Load master workbook
  const workbook = XLSX.read(masterPath, { type: 'file' });
  const allParts = [];
  const missingPhotosList = [];
  
  const sheetsConfig = [
    { sheet: 'LT - Inventory', factoryId: 'Lanka Tiles' },
    { sheet: 'LWT - Inventory', factoryId: 'Lanka Wall Tiles' },
    { sheet: 'RCL-H - Inventory', factoryId: 'Rocell Horana' },
    { sheet: 'RCL-E - Inventory', factoryId: 'Rocell Eheliyagoda' }
  ];
  
  sheetsConfig.forEach(config => {
    let worksheet = workbook.Sheets[config.sheet];
    if (config.factoryId === 'Rocell Eheliyagoda') {
      console.log('Loading Rocell Eheliyagoda inventory from rcle_data_temp.xlsx [GS June 2026]...');
      const rcleWorkbook = XLSX.read(rcleDataPath, { type: 'file' });
      worksheet = rcleWorkbook.Sheets['GS June 2026'];
    }
    
    if (!worksheet) {
      console.error(`Sheet ${config.sheet} not found!`);
      return;
    }
    
    const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
    // Find headers by looking for "material", "item code", or similar
    let headerRowIdx = 2; // Default to row index 2
    for (let r = 0; r < Math.min(10, rows.length); r++) {
      if (rows[r] && rows[r].some(cell => String(cell).toLowerCase().includes('material') || String(cell).toLowerCase().includes('item code') || String(cell).toLowerCase() === 'code')) {
        headerRowIdx = r;
        break;
      }
    }
    const headers = rows[headerRowIdx] || [];
    
    const matIdx = headers.findIndex(h => String(h).toLowerCase().includes('material') || String(h).toLowerCase().includes('item code') || String(h).toLowerCase() === 'code');
    const descIdx = headers.findIndex(h => String(h).toLowerCase().includes('description'));
    const uomIdx = headers.findIndex(h => String(h).toLowerCase().includes('uom') || String(h).toLowerCase() === 'unit of measure' || String(h).toLowerCase().includes('primary unit of measure') || String(h).toLowerCase() === 'unit');
    const qtyIdx = headers.findIndex(h => String(h).toLowerCase().includes('qty') || String(h).toLowerCase().includes('quantity') || String(h).toLowerCase().includes('on hand'));
    const costIdx = headers.findIndex(h => String(h).toLowerCase() === 'unit cost' || String(h).toLowerCase() === 'price');
    const valIdx = headers.findIndex(h => String(h).toLowerCase().includes('value') || String(h).toLowerCase().includes('total value'));
    const fsnIdx = headers.findIndex(h => String(h).toLowerCase() === 'fsn' || String(h).toLowerCase() === 'fsn_classification');
    
    console.log(`\nParsing Sheet: ${config.sheet}`);
    console.log(`Header Row Index: ${headerRowIdx}`);
    console.log(`Indices -> mat: ${matIdx}, desc: ${descIdx}, uom: ${uomIdx}, qty: ${qtyIdx}, cost: ${costIdx}, val: ${valIdx}, fsn: ${fsnIdx}`);
    
    let sheetSkuCount = 0;
    for (let r = headerRowIdx + 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || row.length === 0) continue;
      const rawMat = row[matIdx];
      if (!rawMat) continue;
      
      const materialNumber = String(rawMat).trim();
      const description = descIdx !== -1 && row[descIdx] ? String(row[descIdx]).trim() : 'No Description';
      const uom = uomIdx !== -1 && row[uomIdx] ? String(row[uomIdx]).trim() : 'EA';
      const onHand = qtyIdx !== -1 ? parseFloat(row[qtyIdx]) || 0 : 0;
      
      let unitCost = 0;
      let totalValue = 0;
      
      if (config.factoryId === 'Lanka Tiles' || config.factoryId === 'Lanka Wall Tiles') {
        totalValue = valIdx !== -1 ? parseFloat(row[valIdx]) || 0 : 0;
        unitCost = onHand > 0 ? totalValue / onHand : 0;
      } else {
        unitCost = costIdx !== -1 ? parseFloat(row[costIdx]) || 0 : 0;
        totalValue = valIdx !== -1 ? parseFloat(row[valIdx]) || 0 : (onHand * unitCost);
      }
      
      // Determine FSN Classification
      let fsnClassification = 'Non-moving';
      if (config.factoryId === 'Lanka Tiles' || config.factoryId === 'Lanka Wall Tiles') {
        const rawFsn = fsnIdx !== -1 && row[fsnIdx] ? String(row[fsnIdx]).trim().toUpperCase() : '';
        if (rawFsn.startsWith('F')) fsnClassification = 'Fast';
        else if (rawFsn.startsWith('S')) fsnClassification = 'Slow';
        else fsnClassification = 'Non-moving';
      } else if (config.factoryId === 'Rocell Eheliyagoda') {
        const sheetFsn = rcleFsnMap[materialNumber];
        if (sheetFsn) {
          fsnClassification = sheetFsn;
        } else {
          fsnClassification = 'Non-moving';
        }
      } else {
        // Rocell Horana Fallback rule
        if (onHand >= 20) fsnClassification = 'Fast';
        else if (onHand > 0) fsnClassification = 'Slow';
        else fsnClassification = 'Non-moving';
      }
      
      // Category & Type
      let spareType = 'Mechanical';
      if (materialNumber.startsWith('SE-') || materialNumber.startsWith('SE.')) {
        spareType = 'Electrical';
      }
      
      let categoryName = 'General';
      const mParts = materialNumber.split(/[.-]/);
      if (mParts.length > 1) {
        categoryName = mParts[1];
      }
      
      // Image lookup
      const imageUrls = materialImagesMap[materialNumber];
      let finalUrl = '';
      let isPhotoPending = true;
      
      if (imageUrls) {
        // Filter out broken URLs
        const validUrls = imageUrls.split(/\s+/).filter(url => !brokenUrls.has(url));
        if (validUrls.length > 0) {
          finalUrl = validUrls.join(' ');
          isPhotoPending = false;
        }
      }
      
      const safeId = `${config.factoryId.replace(/\s+/g, '')}-${materialNumber}`.replace(/[^a-zA-Z0-9-_]/g, '');
      
      const part = {
        id: safeId,
        factoryId: config.factoryId,
        materialNumber,
        partNumber: materialNumber,
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
        criticality: 'Essential',
        fsnClassification,
        photoPending: isPhotoPending
      };
      
      if (finalUrl) {
        part.imageUrl = finalUrl;
        part.image_url = finalUrl;
      }
      
      allParts.push(part);
      sheetSkuCount++;
      
      if (isPhotoPending) {
        missingPhotosList.push({
          id: safeId,
          factoryId: config.factoryId,
          materialNumber,
          description,
          reason: imageUrls ? 'Broken/Inaccessible Link' : 'No photo mapped'
        });
      }
    }
    console.log(`Parsed ${sheetSkuCount} items for ${config.factoryId}.`);
  });
  
  // Write local db.json
  const dbJsonPath = path.join(process.cwd(), 'db.json');
  fs.writeFileSync(dbJsonPath, JSON.stringify(allParts, null, 2), 'utf8');
  console.log(`\nSUCCESS: Saved ${allParts.length} parts to local db.json.`);
  
  // Write minified public/parts.json static asset fallback
  const publicPartsPath = path.join(process.cwd(), 'public', 'parts.json');
  fs.writeFileSync(publicPartsPath, JSON.stringify(allParts), 'utf8');
  console.log(`SUCCESS: Saved minified public/parts.json fallback asset.`);
  
  // Write Missing Photos Report
  fs.writeFileSync(reportPath, JSON.stringify(missingPhotosList, null, 2), 'utf8');
  console.log(`SUCCESS: Logged ${missingPhotosList.length} items to missing_photos_report.json.`);
  
  // Update Firestore using diff checks
  console.log('\nFetching current Firestore collection size for diffing...');
  let fsSnapshot;
  try {
    fsSnapshot = await getDocs(collection(db, 'inventory'));
  } catch (e) {
    console.warn("[Firestore] Failed to read inventory (Quota exceeded). Relying on local db.json fallback.");
    process.exit(0);
  }
  
  const fsPartsMap = new Map();
  fsSnapshot.forEach(docSnap => {
    fsPartsMap.set(docSnap.id, docSnap.data());
  });
  console.log(`Firestore collection has ${fsPartsMap.size} documents.`);
  
  const toWrite = [];
  const toDelete = [];
  
  // Build lookup for compiled parts
  const compiledPartsMap = new Map(allParts.map(p => [p.id, p]));
  
  // Find modified or new items
  allParts.forEach(compiled => {
    const existing = fsPartsMap.get(compiled.id);
    if (!existing) {
      toWrite.push(compiled);
    } else {
      // Diff fields
      const isDiff = 
        existing.onHand !== compiled.onHand ||
        Math.abs((existing.unitCost || 0) - compiled.unitCost) > 0.001 ||
        Math.abs((existing.totalValue || 0) - compiled.totalValue) > 0.001 ||
        existing.fsnClassification !== compiled.fsnClassification ||
        (existing.imageUrl || '') !== (compiled.imageUrl || '') ||
        existing.photoPending !== compiled.photoPending ||
        existing.description !== compiled.description;
      
      if (isDiff) {
        toWrite.push(compiled);
      }
    }
  });
  
  // Find obsolete items to delete
  fsPartsMap.forEach((_, fsId) => {
    if (!compiledPartsMap.has(fsId)) {
      toDelete.push(fsId);
    }
  });
  
  console.log(`Diff Analysis: New/Modified: ${toWrite.length} items, Stale to Delete: ${toDelete.length} items.`);
  
  // Perform Deletions
  if (toDelete.length > 0) {
    const BATCH_SIZE = 400;
    for (let i = 0; i < toDelete.length; i += BATCH_SIZE) {
      const chunk = toDelete.slice(i, i + BATCH_SIZE);
      const batch = writeBatch(db);
      chunk.forEach(id => {
        batch.delete(doc(db, 'inventory', id));
      });
      await batch.commit();
      console.log(`Deleted: ${Math.min(i + BATCH_SIZE, toDelete.length)} / ${toDelete.length} stale items.`);
      await new Promise(r => setTimeout(r, 600));
    }
  }
  
  // Perform Writes
  if (toWrite.length > 0) {
    const BATCH_SIZE = 400;
    let committed = 0;
    for (let i = 0; i < toWrite.length; i += BATCH_SIZE) {
      const chunk = toWrite.slice(i, i + BATCH_SIZE);
      const batch = writeBatch(db);
      chunk.forEach(part => {
        batch.set(doc(db, 'inventory', part.id), part, { merge: true });
      });
      await batch.commit();
      committed += chunk.length;
      console.log(`Committed Firestore updates: ${committed} / ${toWrite.length}`);
      await new Promise(r => setTimeout(r, 600));
    }
    console.log('SUCCESS: Finished writing updates to Firestore.');
  } else {
    console.log('No updates required for Firestore.');
  }
  
  process.exit(0);
}

run().catch(e => {
  console.error("Critical error running sync script:", e);
  process.exit(1);
});
