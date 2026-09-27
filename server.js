import express from 'express';
import cors from 'cors';
import multer from 'multer';
import * as XLSX from 'xlsx';
import admin from 'firebase-admin';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import nodemailer from 'nodemailer';
import { syncPortalReportToSheet, syncFromSheetToPortal, syncOrderToSheet } from './services/googleSheets.js';
import {
  orderEventEmitter,
  EmailQueue,
  generateCustomerConfirmationEmail,
  generatePlantNotificationEmail,
  generateOrderStatusUpdateEmail
} from './emailQueue.js';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Ensure uploads folder exists and serve it statically
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}
app.use('/uploads', express.static(uploadsDir));

// Load material-to-image mapping
let materialImagesMap = {};
try {
  const mappingPath = path.join(__dirname, 'material_images.json');
  if (fs.existsSync(mappingPath)) {
    materialImagesMap = JSON.parse(fs.readFileSync(mappingPath, 'utf8'));
    console.log(`[Server] Loaded ${Object.keys(materialImagesMap).length} material image mappings.`);
  } else {
    console.warn('[Server] material_images.json file not found in root.');
  }
} catch (err) {
  console.warn('[Server] Failed to load material_images.json:', err.message);
}

// Initialize Firebase Admin with project ID, handling missing credentials gracefully
let firestoreDb = null;
try {
  const projectId = process.env.VITE_FIREBASE_PROJECT_ID || 'spareshare-33986';
  admin.initializeApp({
    projectId: projectId
  });
  firestoreDb = admin.firestore();
  console.log(`[Firebase] Initialized Admin SDK for project: ${projectId}`);
} catch (error) {
  console.warn('[Firebase] Firebase Admin could not initialize (likely missing credentials). Using in-memory storage fallback.', error.message);
}

// Configure Email Transporter
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.ethereal.email',
  port: parseInt(process.env.SMTP_PORT || '587', 10),
  auth: {
    user: process.env.SMTP_USER || 'ethereal.user',
    pass: process.env.SMTP_PASS || 'ethereal.pass'
  }
});

const isMockEmail = !process.env.SMTP_USER || process.env.SMTP_USER === 'ethereal.user';
if (isMockEmail) {
  console.warn('[Email] SMTP credentials are not configured. Running in Mock Mode (emails print to console).');
}

// Initialize global EmailQueue and register event listener
const emailQueue = new EmailQueue(transporter);

orderEventEmitter.on('OrderCreated', ({ order, userEmail, plantEmail, userFactory }) => {
  console.log(`[Event Listener] OrderCreated received for Order ID: ${order.id}. Enqueuing notification emails...`);

  // 1. Calculate Estimated Fulfillment Timeframe
  const isCrossPlant = order.items && order.items.length > 0 && order.items[0].fromFactory !== userFactory;
  const estimatedTimeframe = isCrossPlant ? '5 Business Days (Cross-Plant Transfer)' : '2 Business Days (Local Fulfillment)';

  // 2. Queue Recipient 1: User Confirmation Email
  const userHtml = generateCustomerConfirmationEmail(order, userEmail, estimatedTimeframe);
  const userMailOptions = {
    from: process.env.SMTP_FROM || '"SpareShare Portal" <noreply@spareshare.com>',
    to: userEmail,
    subject: `Order Confirmation - Spare Parts Portal (Order Ref: ${order.id})`,
    text: `Hello ${userEmail},\n\nYour order has been successfully placed.\n\nOrder ID: ${order.id}\nEstimated fulfillment: ${estimatedTimeframe}\n\nThank you,\nSpare Parts Portal`,
    html: userHtml
  };
  emailQueue.addJob(userMailOptions);

  // 3. Queue Recipient 2: Plant Work Order Dispatch Alert
  const plantHtml = generatePlantNotificationEmail(order, plantEmail, userFactory || 'Unknown Plant', userEmail);
  const plantMailOptions = {
    from: process.env.SMTP_FROM || '"SpareShare Portal" <noreply@spareshare.com>',
    to: plantEmail,
    subject: `Action Required: New Work Order Dispatch (Order Ref: ${order.id})`,
    text: `Hello Plant Manager,\n\nA new work order has been requested from your plant inventory.\n\nOrder ID: ${order.id}\nCustomer: ${userEmail}\n\nPlease prepare the items.\n\nThank you,\nSpare Parts Portal`,
    html: plantHtml
  };
  emailQueue.addJob(plantMailOptions);

  // 4. Sync Order to Master Google Sheet ("Orders" tab)
  syncOrderToSheet(order).catch(err => {
    console.warn('[GoogleSheets Sync Warning] Failed to sync new order to sheet:', err.message);
  });
});

orderEventEmitter.on('OrderStatusUpdated', ({ order, item, status, performerUsername }) => {
  console.log(`[Event Listener] OrderStatusUpdated received for Order ID: ${order.id}, item: ${item?.sparePartDescription}, status: ${status}`);

  // Send status email to user
  if (order.requestedBy && order.requestedBy.includes('@')) {
    const html = generateOrderStatusUpdateEmail(order, item || order.items[0], status, performerUsername);
    const mailOptions = {
      from: process.env.SMTP_FROM || '"SpareShare Portal" <noreply@spareshare.com>',
      to: order.requestedBy,
      subject: `Order Update - Ref: ${order.id} (${(status || '').toUpperCase()})`,
      text: `Hello ${order.requestedBy},\n\nYour order ${order.id} status has been updated to ${status} by ${performerUsername}.\n\nThank you,\nSpare Parts Portal`,
      html
    };
    emailQueue.addJob(mailOptions);
  }

  // Also sync updated order to Master Google Sheet
  syncOrderToSheet(order).catch(err => {
    console.warn('[GoogleSheets Sync Warning] Failed to sync updated order to sheet:', err.message);
  });
});

// HTTP Endpoints for Order Events & Email Notifications
app.post(['/api/orders/created', '/orders/created'], async (req, res) => {
  try {
    const { order, userEmail, plantEmail, userFactory } = req.body;
    if (!order) return res.status(400).json({ success: false, message: 'Missing order data' });

    console.log(`[Order API] Triggering OrderCreated for Order ID: ${order.id}`);
    orderEventEmitter.emit('OrderCreated', { order, userEmail, plantEmail, userFactory });

    // Sync order to Master Google Sheet ("Orders" tab)
    const sheetRes = await syncOrderToSheet(order);

    res.json({ success: true, message: 'Order created notifications queued & synced to Google Sheet', sheetSync: sheetRes });
  } catch (err) {
    console.error('[Order API Error]:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post(['/api/orders/status-updated', '/orders/status-updated'], async (req, res) => {
  try {
    const { order, item, status, performerUsername } = req.body;
    if (!order) return res.status(400).json({ success: false, message: 'Missing order data' });

    console.log(`[Order API] Triggering OrderStatusUpdated for Order ID: ${order.id}`);
    orderEventEmitter.emit('OrderStatusUpdated', { order, item, status, performerUsername });

    // Sync order update to Master Google Sheet
    const sheetRes = await syncOrderToSheet(order);

    res.json({ success: true, message: 'Order status update queued & synced to Google Sheet', sheetSync: sheetRes });
  } catch (err) {
    console.error('[Order Status API Error]:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post(['/api/send-email', '/send-email'], (req, res) => {
  try {
    const { to, subject, text, html } = req.body;
    if (!to || !subject) return res.status(400).json({ success: false, message: 'Missing required parameters (to, subject)' });

    const mailOptions = {
      from: process.env.SMTP_FROM || '"SpareShare Portal" <noreply@spareshare.com>',
      to,
      subject,
      text: text || '',
      html
    };

    const job = emailQueue.addJob(mailOptions);
    res.json({ success: true, jobId: job.id, message: `Email queued for ${to}` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// In-Memory Fallback Storage
let memoryHistoricalRecords = [
  { id: 'Lanka_Tiles-2023', factoryId: 'Lanka Tiles', year: 2023, consumptionQty: 12000, consumptionValue: 4500000, uploadedBy: 'system', timestamp: Date.now() },
  { id: 'Lanka_Tiles-2024', factoryId: 'Lanka Tiles', year: 2024, consumptionQty: 14500, consumptionValue: 5200000, uploadedBy: 'system', timestamp: Date.now() },
  { id: 'Lanka_Tiles-2025', factoryId: 'Lanka Tiles', year: 2025, consumptionQty: 16000, consumptionValue: 5800000, uploadedBy: 'system', timestamp: Date.now() },
  
  { id: 'Lanka_Wall_Tiles-2023', factoryId: 'Lanka Wall Tiles', year: 2023, consumptionQty: 9500, consumptionValue: 3800000, uploadedBy: 'system', timestamp: Date.now() },
  { id: 'Lanka_Wall_Tiles-2024', factoryId: 'Lanka Wall Tiles', year: 2024, consumptionQty: 11000, consumptionValue: 4200000, uploadedBy: 'system', timestamp: Date.now() },
  { id: 'Lanka_Wall_Tiles-2025', factoryId: 'Lanka Wall Tiles', year: 2025, consumptionQty: 13000, consumptionValue: 4900000, uploadedBy: 'system', timestamp: Date.now() },
  
  { id: 'Rocell_Horana-2023', factoryId: 'Rocell Horana', year: 2023, consumptionQty: 15000, consumptionValue: 6200000, uploadedBy: 'system', timestamp: Date.now() },
  { id: 'Rocell_Horana-2024', factoryId: 'Rocell Horana', year: 2024, consumptionQty: 17200, consumptionValue: 7100000, uploadedBy: 'system', timestamp: Date.now() },
  { id: 'Rocell_Horana-2025', factoryId: 'Rocell Horana', year: 2025, consumptionQty: 19000, consumptionValue: 8000000, uploadedBy: 'system', timestamp: Date.now() },
  
  { id: 'Rocell_Eheliyagoda-2023', factoryId: 'Rocell Eheliyagoda', year: 2023, consumptionQty: 8000, consumptionValue: 3100000, uploadedBy: 'system', timestamp: Date.now() },
  { id: 'Rocell_Eheliyagoda-2024', factoryId: 'Rocell Eheliyagoda', year: 2024, consumptionQty: 9800, consumptionValue: 3700000, uploadedBy: 'system', timestamp: Date.now() },
  { id: 'Rocell_Eheliyagoda-2025', factoryId: 'Rocell Eheliyagoda', year: 2025, consumptionQty: 11500, consumptionValue: 4400000, uploadedBy: 'system', timestamp: Date.now() }
];

// Configure Multer for in-memory file handling
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50 MB — supports 15,000+ row Excel exports
  },
});

// Factory Mapping Function
function resolveFactoryName(rawName) {
  if (!rawName) return null;
  const name = rawName.trim().toLowerCase();
  
  if (name.includes('lanka') && name.includes('wall')) {
    return 'Lanka Wall Tiles';
  }
  if (name.includes('lanka') && name.includes('tile')) {
    return 'Lanka Tiles';
  }
  if (name.includes('horana')) {
    return 'Rocell Horana';
  }
  if (name.includes('eheliyagoda')) {
    return 'Rocell Eheliyagoda';
  }
  return null;
}

// Google Drive Link Normalization Function
function normalizeImageUrl(url) {
  if (!url) return url;
  if (url.includes('drive.google.com')) {
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
    if (id) {
      id = id.split(/[&?]/)[0];
      return `https://lh3.googleusercontent.com/d/${id}`;
    }
  }
  return url;
}

// REST endpoints for catalog and factories matching frontend expectations
app.get(['/parts', '/api/parts'], async (req, res) => {
  // Check if we have a local db.json file containing migrated parts
  try {
    const dbJsonPath = path.join(process.cwd(), 'db.json');
    console.log(`[Server] Checking for local db.json at: ${dbJsonPath}`);
    if (fs.existsSync(dbJsonPath)) {
      console.log(`[Server] db.json exists, parsing...`);
      let localData = JSON.parse(fs.readFileSync(dbJsonPath, 'utf8'));
      if (Array.isArray(localData) && localData.length > 0) {
        console.log(`[Server] Serving parts from local db.json.`);
        
        const enriched = localData.filter(part => part.is_deleted !== true).map(part => {
          let imageUrl = part.imageUrl;
          let image_url = part.image_url;
          const matNum = part.materialNumber;
          if ((!imageUrl || imageUrl === 'NONE') && materialImagesMap[matNum]) {
            imageUrl = materialImagesMap[matNum];
            image_url = materialImagesMap[matNum];
          }
          if (imageUrl) imageUrl = normalizeImageUrl(imageUrl);
          if (image_url) image_url = normalizeImageUrl(image_url);
          if (image_url && !imageUrl) imageUrl = image_url;
          if (imageUrl && !image_url) image_url = imageUrl;
          
          return {
            ...part,
            imageUrl,
            image_url
          };
        });
        return res.json(enriched);
      }
    } else {
      console.log(`[Server] db.json not found at: ${dbJsonPath}`);
    }
  } catch (err) {
    console.warn('[Server] Failed to read local db.json fallback:', err.message);
  }

  if (firestoreDb) {
    try {
      let queryRef = firestoreDb.collection('inventory');
      const snapshot = await queryRef.get();
      const parts = [];
      snapshot.forEach(doc => {
        const data = doc.data();
        if (data.is_deleted === true) return;
        
        let imageUrl = data.imageUrl;
        let image_url = data.image_url;

        // Normalize if exists
        if (imageUrl) imageUrl = normalizeImageUrl(imageUrl);
        if (image_url) image_url = normalizeImageUrl(image_url);

        // Dynamically associate image URL if it's missing or set to a placeholder
        const matNum = data.materialNumber;
        if ((!imageUrl || imageUrl === 'NONE') && materialImagesMap[matNum]) {
          imageUrl = materialImagesMap[matNum];
          image_url = materialImagesMap[matNum];
        }

        // Ensure both imageUrl and image_url are set if either exists
        if (image_url && !imageUrl) imageUrl = image_url;
        if (imageUrl && !image_url) image_url = imageUrl;

        data.imageUrl = imageUrl;
        data.image_url = image_url;

        parts.push(data);
      });
      if (parts.length > 0) {
        return res.json(parts);
      }
    } catch (err) {
      console.error('[Firebase] Failed to fetch parts:', err.message);
    }
  }

  // Fallback static mock parts list
  res.json([
    {
      id: 'Lanka Tiles-100201',
      factoryId: 'Lanka Tiles',
      materialNumber: '100201',
      partNumber: 'PN-998822',
      description: 'Ball Bearing 6204 DDU (Live Server Fallback)',
      qtyMoreThan3Years: 0,
      valueMoreThan3Years: 0,
      onHand: 15,
      unitCost: 120,
      totalValue: 1800,
      spareType: 'Mechanical',
      categoryName: 'Bearings',
      machine: 'Press Machine',
      criticality: 'Essential',
      imageUrl: 'https://images.unsplash.com/photo-1618944847828-82e943c3dba7?w=300',
      image_url: 'https://images.unsplash.com/photo-1618944847828-82e943c3dba7?w=300'
    },
    {
      id: 'Lanka Wall Tiles-100201',
      factoryId: 'Lanka Wall Tiles',
      materialNumber: '100201',
      partNumber: 'PN-998822',
      description: 'Ball Bearing 6204 DDU (Live Server Fallback)',
      qtyMoreThan3Years: 0,
      valueMoreThan3Years: 0,
      onHand: 8,
      unitCost: 125,
      totalValue: 1000,
      spareType: 'Mechanical',
      categoryName: 'Bearings',
      machine: 'Glazing Machine',
      criticality: 'Essential',
      imageUrl: 'https://images.unsplash.com/photo-1618944847828-82e943c3dba7?w=300',
      image_url: 'https://images.unsplash.com/photo-1618944847828-82e943c3dba7?w=300'
    },
    {
      id: 'Rocell Horana-300402',
      factoryId: 'Rocell Horana',
      materialNumber: '300402',
      partNumber: 'PN-445566',
      description: 'Temperature Controller E5CC (Live Server Fallback)',
      qtyMoreThan3Years: 1,
      valueMoreThan3Years: 250,
      onHand: 3,
      unitCost: 250,
      totalValue: 750,
      spareType: 'Electrical',
      categoryName: 'Controllers',
      machine: 'Kiln',
      criticality: 'Vital',
      imageUrl: 'https://images.unsplash.com/photo-1581092334247-448a6f1d7d6f?w=300',
      image_url: 'https://images.unsplash.com/photo-1581092334247-448a6f1d7d6f?w=300'
    }
  ]);
});

// Endpoint for local image uploads as a fallback or server-managed service
app.post(['/upload-image', '/api/upload-image'], upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).send('No file uploaded.');
    }
    const fileExtension = path.extname(req.file.originalname) || '.jpg';
    const filename = `${Date.now()}-${Math.random().toString(36).substring(2, 7)}${fileExtension}`;
    const filepath = path.join(uploadsDir, filename);
    fs.writeFileSync(filepath, req.file.buffer);
    
    // Construct local URL path, which is served statically
    const imageUrl = `/uploads/${filename}`;
    res.json({ success: true, imageUrl, image_url: imageUrl });
  } catch (error) {
    console.error('[Upload Image API] Error:', error);
    res.status(500).send(`Internal server error: ${error.message}`);
  }
});

app.get(['/factories', '/api/factories'], (req, res) => {
  res.json([
    { id: 'Lanka Tiles', name: 'Lanka Tiles' },
    { id: 'Lanka Wall Tiles', name: 'Lanka Wall Tiles' },
    { id: 'Rocell Horana', name: 'Rocell Horana' },
    { id: 'Rocell Eheliyagoda', name: 'Rocell Eheliyagoda' }
  ]);
});

// Endpoint for data reconciliation status between sheet and portal DB
app.get(['/reconciliation-status', '/api/reconciliation-status'], async (req, res) => {
  const userFactory = req.headers['x-factory-affiliation'];
  try {
    const filepath = path.join(process.cwd(), 'user_sheet_temp.xlsx');
    if (!fs.existsSync(filepath)) {
      return res.status(404).json({ success: false, message: 'Spreadsheet not found on server' });
    }
    const workbook = XLSX.read(filepath, { type: 'file' });
    
    let sheetSkuTotal = 0;
    let sheetValueTotal = 0;
    const breakdown = {};

    const sheets = [
      { name: 'LT - Inventory', factory: 'Lanka Tiles' },
      { name: 'LWT - Inventory', factory: 'Lanka Wall Tiles' },
      { name: 'RCL-H - Inventory', factory: 'Rocell Horana' },
      { name: 'RCL-E - Inventory', factory: 'Rocell Eheliyagoda' }
    ];

    const targetSheets = (userFactory && userFactory !== 'admin' && userFactory !== 'undefined')
      ? sheets.filter(config => config.factory === userFactory)
      : sheets;

    targetSheets.forEach(config => {
      let worksheet = workbook.Sheets[config.name];
      if (config.factory === 'Rocell Eheliyagoda') {
        const rcleDataPath = path.join(process.cwd(), 'rcle_data_temp.xlsx');
        if (fs.existsSync(rcleDataPath)) {
          const rcleWorkbook = XLSX.read(rcleDataPath, { type: 'file' });
          worksheet = rcleWorkbook.Sheets['GS June 2026'];
        }
      }
      if (!worksheet) return;
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
      
      const qtyIdx = headers.findIndex(h => String(h).toLowerCase().includes('qty') || String(h).toLowerCase().includes('quantity') || String(h).toLowerCase().includes('on hand'));
      const costIdx = headers.findIndex(h => String(h).toLowerCase() === 'unit cost' || String(h).toLowerCase() === 'price');
      const valIdx = headers.findIndex(h => String(h).toLowerCase().includes('value') || String(h).toLowerCase().includes('total value') || String(h).toLowerCase().includes('inventory value'));
      
      let skus = 0;
      let value = 0;
      for (let r = headerRowIdx + 1; r < rows.length; r++) {
        const row = rows[r];
        if (!row || !row[0]) continue;
        skus++;
        const qty = parseFloat(row[qtyIdx]) || 0;
        if (config.factory === 'Lanka Tiles' || config.factory === 'Lanka Wall Tiles') {
          value += valIdx !== -1 ? parseFloat(row[valIdx]) || 0 : 0;
        } else {
          value += valIdx !== -1 ? parseFloat(row[valIdx]) || 0 : (qty * (costIdx !== -1 ? parseFloat(row[costIdx]) || 0 : 0));
        }
      }
      breakdown[config.factory] = { skus, value };
      sheetSkuTotal += skus;
      sheetValueTotal += value;
    });

    const dbJsonPath = path.join(process.cwd(), 'db.json');
    let dbParts = [];
    if (fs.existsSync(dbJsonPath)) {
      dbParts = JSON.parse(fs.readFileSync(dbJsonPath, 'utf8'));
    }
    
    let dbSkuTotal = 0;
    let dbValueTotal = 0;
    const dbBreakdown = {};
    
    dbParts.forEach(p => {
      if (p.is_deleted === true) return;
      if (userFactory && userFactory !== 'admin' && userFactory !== 'undefined' && p.factoryId !== userFactory) {
        return;
      }
      if (!dbBreakdown[p.factoryId]) {
        dbBreakdown[p.factoryId] = { skus: 0, value: 0 };
      }
      dbBreakdown[p.factoryId].skus++;
      dbBreakdown[p.factoryId].value += p.totalValue || 0;
      dbSkuTotal++;
      dbValueTotal += p.totalValue || 0;
    });

    const isMatched = dbSkuTotal === sheetSkuTotal && Math.abs(dbValueTotal - sheetValueTotal) < 1.0;

    res.json({
      success: true,
      sheetTotals: {
        skus: sheetSkuTotal,
        value: Math.round(sheetValueTotal),
        breakdown
      },
      portalTotals: {
        skus: dbSkuTotal,
        value: Math.round(dbValueTotal),
        breakdown: dbBreakdown
      },
      isMatched,
      percentageMatched: isMatched ? 100 : Math.round((dbSkuTotal / sheetSkuTotal) * 100)
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Endpoint to fetch missing photos report
app.get(['/missing-photos-report', '/api/missing-photos-report'], (req, res) => {
  try {
    const reportPath = path.join(process.cwd(), 'uploads', 'missing_photos_report.json');
    if (fs.existsSync(reportPath)) {
      const data = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
      res.json(data);
    } else {
      res.json([]);
    }
  } catch (err) {
    res.status(500).send(`Internal server error: ${err.message}`);
  }
});

// REST endpoints for historical consumption
app.get(['/historical-consumption', '/api/historical-consumption'], async (req, res) => {
  const userFactory = req.headers['x-factory-affiliation'];
  let records = [];
  if (firestoreDb) {
    try {
      let queryRef = firestoreDb.collection('historical_consumption');
      if (userFactory && userFactory !== 'admin' && userFactory !== 'undefined') {
        queryRef = queryRef.where('factoryId', '==', userFactory);
      }
      const snapshot = await queryRef.get();
      snapshot.forEach(doc => {
        records.push(doc.data());
      });
      if (records.length > 0) {
        return res.json(records);
      }
    } catch (err) {
      console.error('[Firebase] Failed to fetch historical consumption:', err.message);
    }
  }
  // Fallback to memory
  let filteredMemory = memoryHistoricalRecords;
  if (userFactory && userFactory !== 'admin' && userFactory !== 'undefined') {
    filteredMemory = filteredMemory.filter(r => r.factoryId === userFactory);
  }
  res.json(filteredMemory);
});

// POST endpoint for 3-Year History Excel/CSV Import
app.post(['/import-history', '/api/import-history'], upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).send('No file uploaded.');
    }

    const username = req.body.username || 'unknown';
    const targetFactory = req.body.factoryId || 'All';

    // Parse Excel or CSV buffer
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rawRows = XLSX.utils.sheet_to_json(sheet);

    if (rawRows.length === 0) {
      return res.status(400).send('The uploaded file contains no data.');
    }

    const recordsMap = {}; // Key: factoryId + year
    const errors = [];
    let validRecordsCount = 0;

    // Process and validate rows
    for (let index = 0; index < rawRows.length; index++) {
      const row = rawRows[index];
      
      // Look up column names case-insensitively
      const getVal = (keys) => {
        for (const k of keys) {
          if (row[k] !== undefined) return row[k];
          const foundKey = Object.keys(row).find(rk => rk.toLowerCase().trim() === k.toLowerCase().trim());
          if (foundKey) return row[foundKey];
        }
        return null;
      };

      const rawFactory = getVal(['Factory', 'Factory Name', 'Plant', 'FactoryId', 'Location']);
      const rawYear = getVal(['Year', 'Date', 'Calendar Year']);
      const rawQty = getVal(['Consumption Qty', 'Quantity', 'Qty', 'Consumption Quantity', 'Qty Consumed']);
      const rawValue = getVal(['Consumption Value', 'Value', 'Cost', 'Consumption Value (Rs.)', 'Amount']);

      const resolved = resolveFactoryName(rawFactory);
      const factoryId = targetFactory && targetFactory !== 'All' ? targetFactory : resolved;
      const year = parseInt(rawYear, 10);
      const qty = parseFloat(rawQty);
      const value = parseFloat(rawValue);

      // Validation check
      if (!factoryId) {
        errors.push(`Row ${index + 2}: Invalid or unrecognized factory name "${rawFactory}".`);
        continue;
      }
      if (isNaN(year) || year < 2000 || year > 2030) {
        errors.push(`Row ${index + 2}: Invalid year "${rawYear}". Must be between 2000 and 2030.`);
        continue;
      }
      if (isNaN(qty) || qty < 0) {
        errors.push(`Row ${index + 2}: Invalid quantity "${rawQty}". Must be a positive number.`);
        continue;
      }
      if (isNaN(value) || value < 0) {
        errors.push(`Row ${index + 2}: Invalid value "${rawValue}". Must be a positive number.`);
        continue;
      }

      // Group/Aggregate by Factory + Year
      const groupKey = `${factoryId}-${year}`;
      if (!recordsMap[groupKey]) {
        recordsMap[groupKey] = {
          id: groupKey.replace(/\s+/g, '_'),
          factoryId,
          year,
          consumptionQty: 0,
          consumptionValue: 0,
          uploadedBy: username,
          timestamp: Date.now()
        };
      }
      recordsMap[groupKey].consumptionQty += qty;
      recordsMap[groupKey].consumptionValue += value;
      validRecordsCount++;
    }

    const aggregatedRecords = Object.values(recordsMap);

    if (aggregatedRecords.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid records could be extracted from the file.',
        errors: errors.slice(0, 10)
      });
    }

    // Write to Firestore if connected, otherwise save in memory
    if (firestoreDb) {
      const batch = firestoreDb.batch();
      aggregatedRecords.forEach((record) => {
        const ref = firestoreDb.collection('historical_consumption').doc(record.id);
        batch.set(ref, record);
      });
      await batch.commit();
      console.log(`[Firebase] Successfully saved ${aggregatedRecords.length} aggregated records.`);
    }

    // Always sync with in-memory array for consistency
    aggregatedRecords.forEach((newRec) => {
      const idx = memoryHistoricalRecords.findIndex(r => r.id === newRec.id);
      if (idx !== -1) {
        memoryHistoricalRecords[idx] = newRec;
      } else {
        memoryHistoricalRecords.push(newRec);
      }
    });

    res.json({
      success: true,
      recordsCount: aggregatedRecords.length,
      message: `Import completed! Successfully parsed ${validRecordsCount} rows and generated ${aggregatedRecords.length} factory-wise annual consumption summaries.`,
      errors: errors.slice(0, 5) // Return first few warnings if any
    });

  } catch (err) {
    console.error('[Import API] Critical error processing history upload:', err);
    res.status(500).send(`Internal server error: ${err.message}`);
  }
});



app.post(['/send-email', '/api/send-email'], async (req, res) => {
  const { to, subject, text, html } = req.body;
  if (!to || !subject || (!text && !html)) {
    return res.status(400).send('Missing to, subject, or message body');
  }

  const mailOptions = {
    from: process.env.SMTP_FROM || '"SpareShare Portal" <noreply@spareshare.com>',
    to,
    subject,
    text,
    html
  };

  try {
    if (isMockEmail) {
      console.log('\n================= MOCK EMAIL SENT =================');
      console.log(`To: ${to}`);
      console.log(`Subject: ${subject}`);
      console.log(`Body (Text):\n${text || 'N/A'}`);
      if (html) {
        console.log(`Body (HTML):\n${html}`);
      }
      console.log('===================================================\n');
      console.log("Order confirmation email sent successfully to:", to);
      return res.json({ success: true, mock: true, message: 'Mock email logged to console successfully' });
    }

    const info = await transporter.sendMail(mailOptions);
    console.log("Order confirmation email sent successfully to:", to);
    res.json({ success: true, messageId: info.messageId });
  } catch (emailErr) {
    console.error("FAILED TO SEND ORDER EMAIL:", emailErr);
    res.status(500).send(`Failed to send email: ${emailErr.message}`);
  }
});

// REST API for inventory soft delete
app.delete(['/api/inventory/:id'], async (req, res) => {
  const partId = req.params.id;
  const username = req.body.username || req.query.username || 'admin';
  try {
    if (firestoreDb) {
      const partRef = firestoreDb.collection('inventory').doc(partId);
      const docSnap = await partRef.get();
      if (!docSnap.exists) {
        return res.status(404).json({ success: false, message: 'Item not found' });
      }
      const partData = docSnap.data();

      // Soft delete
      await partRef.update({
        is_deleted: true,
        deleted_at: Date.now()
      });

      // Log action
      const logRef = firestoreDb.collection('audit_logs').doc();
      const log = {
        user_id: username,
        user_name: username,
        plant_id: partData.factoryId || 'System',
        plant_name: partData.factoryId || 'System',
        action: 'DELETED',
        entity_type: 'inventory',
        entity_id: partId,
        changes: JSON.stringify({ is_deleted: { old: partData.is_deleted || false, new: true } }),
        created_at: Date.now(),
        details: `Soft-deleted item: ${partData.description}`
      };
      await logRef.set(log);

      // Update local db.json if present
      const dbJsonPath = path.join(process.cwd(), 'db.json');
      if (fs.existsSync(dbJsonPath)) {
        try {
          let localData = JSON.parse(fs.readFileSync(dbJsonPath, 'utf8'));
          if (Array.isArray(localData)) {
            const idx = localData.findIndex(p => p.id === partId);
            if (idx !== -1) {
              localData[idx].is_deleted = true;
              localData[idx].deleted_at = Date.now();
              fs.writeFileSync(dbJsonPath, JSON.stringify(localData, null, 2), 'utf8');
            }
          }
        } catch (err) {
          console.warn("[Server] Failed to update local db.json on soft delete:", err.message);
        }
      }

      return res.json({ success: true, message: 'Item soft-deleted successfully' });
    } else {
      return res.json({ success: true, message: 'Item soft-deleted in memory' });
    }
  } catch (error) {
    console.error("Soft delete API Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// REST API for inventory restore (undo)
app.post(['/api/audit/restore/:id', '/api/inventory/:id/restore'], async (req, res) => {
  const partId = req.params.id;
  const username = req.body.username || req.query.username || 'admin';
  try {
    if (firestoreDb) {
      const partRef = firestoreDb.collection('inventory').doc(partId);
      const docSnap = await partRef.get();
      if (!docSnap.exists) {
        return res.status(404).json({ success: false, message: 'Item not found' });
      }
      const partData = docSnap.data();

      // Restore item
      await partRef.update({
        is_deleted: false,
        deleted_at: null
      });

      // Log action
      const logRef = firestoreDb.collection('audit_logs').doc();
      const log = {
        user_id: username,
        user_name: username,
        plant_id: partData.factoryId || 'System',
        plant_name: partData.factoryId || 'System',
        action: 'RESTORED',
        entity_type: 'inventory',
        entity_id: partId,
        changes: JSON.stringify({ is_deleted: { old: true, new: false } }),
        created_at: Date.now(),
        details: `Restored item: ${partData.description}`
      };
      await logRef.set(log);

      // Update in db.json if present
      const dbJsonPath = path.join(process.cwd(), 'db.json');
      if (fs.existsSync(dbJsonPath)) {
        try {
          let localData = JSON.parse(fs.readFileSync(dbJsonPath, 'utf8'));
          if (Array.isArray(localData)) {
            const idx = localData.findIndex(p => p.id === partId);
            if (idx !== -1) {
              localData[idx].is_deleted = false;
              localData[idx].deleted_at = null;
              fs.writeFileSync(dbJsonPath, JSON.stringify(localData, null, 2), 'utf8');
            }
          }
        } catch (err) {
          console.warn("[Server] Failed to update local db.json on restore:", err.message);
        }
      }

      return res.json({ success: true, message: 'Item restored successfully' });
    } else {
      return res.json({ success: true, message: 'Item restored in memory' });
    }
  } catch (error) {
    console.error("Restore API Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// REST API for inventory permanent delete
app.delete(['/api/inventory/:id/permanent'], async (req, res) => {
  const partId = req.params.id;
  const username = req.body.username || req.query.username || 'admin';
  try {
    if (firestoreDb) {
      const partRef = firestoreDb.collection('inventory').doc(partId);
      const docSnap = await partRef.get();
      if (!docSnap.exists) {
        return res.status(404).json({ success: false, message: 'Item not found' });
      }
      const partData = docSnap.data();

      // Permanent hard delete
      await partRef.delete();

      // Log action
      const logRef = firestoreDb.collection('audit_logs').doc();
      const log = {
        user_id: username,
        user_name: username,
        plant_id: partData.factoryId || 'System',
        plant_name: partData.factoryId || 'System',
        action: 'DELETED',
        entity_type: 'inventory',
        entity_id: partId,
        changes: JSON.stringify({ permanent_delete: true }),
        created_at: Date.now(),
        details: `Permanently deleted item: ${partData.description}`
      };
      await logRef.set(log);

      // Remove from db.json if present
      const dbJsonPath = path.join(process.cwd(), 'db.json');
      if (fs.existsSync(dbJsonPath)) {
        try {
          let localData = JSON.parse(fs.readFileSync(dbJsonPath, 'utf8'));
          if (Array.isArray(localData)) {
            const filtered = localData.filter(p => p.id !== partId);
            fs.writeFileSync(dbJsonPath, JSON.stringify(filtered, null, 2), 'utf8');
          }
        } catch (err) {
          console.warn("[Server] Failed to update local db.json on permanent delete:", err.message);
        }
      }

      return res.json({ success: true, message: 'Item permanently deleted' });
    } else {
      return res.json({ success: true, message: 'Item permanently deleted in memory' });
    }
  } catch (error) {
    console.error("Permanent delete API Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// REST API for inventory upload history revert & rollback
app.post(['/api/history/revert', '/api/audit/rollback', '/api/inventory/revert'], async (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    const headerRole = req.headers['x-user-role'];
    const headerEmail = req.headers['x-user-email'];
    const headerUsername = req.headers['x-user-name'];

    const bodyRole = req.body?.role || req.body?.userRole || req.body?.currentUser?.role;
    const bodyEmail = req.body?.email || req.body?.userEmail || req.body?.currentUser?.email;
    const bodyUsername = req.body?.username || req.body?.performerUsername || req.body?.currentUser?.username;

    let role = headerRole || bodyRole;
    let username = headerUsername || bodyUsername || 'unknown';
    let email = headerEmail || bodyEmail || username;

    let isAdmin = false;

    // Check JWT / session token if provided
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7).trim();
      try {
        const parts = token.split('.');
        if (parts.length === 3) {
          const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
          if (payload.role) role = payload.role;
          if (payload.email) email = payload.email;
          if (payload.username) username = payload.username;
        }
      } catch (tokenErr) {
        console.warn("[Server Auth] Token parse warning:", tokenErr.message);
      }
    }

    if (role === 'admin' || email === 'admin@spareshare.com' || username === 'admin') {
      isAdmin = true;
    }

    // Server-Side Authorization Guard: Return HTTP 403 Forbidden for non-admins
    if (!isAdmin) {
      return res.status(403).json({
        error: "Unauthorized: Only system administrators can revert inventory history."
      });
    }

    // Reversion Logic for Admins
    const { historyId, batchId } = req.body;
    const targetId = historyId || batchId || req.body.id;

    if (!targetId) {
      return res.status(400).json({ success: false, error: "History ID or Batch ID is required" });
    }

    if (firestoreDb) {
      const historyRef = firestoreDb.collection('upload_history').doc(targetId);
      const historySnap = await historyRef.get();

      let record = null;
      if (historySnap.exists) {
        record = historySnap.data();
      } else {
        const querySnap = await firestoreDb.collection('upload_history').where('id', '==', targetId).get();
        if (!querySnap.empty) {
          record = querySnap.docs[0].data();
        }
      }

      if (record) {
        const batch = firestoreDb.batch();
        const previousState = typeof record.previousState === 'string' ? JSON.parse(record.previousState) : (record.previousState || {});

        Object.entries(previousState).forEach(([partId, prevState]) => {
          const partRef = firestoreDb.collection('inventory').doc(partId);
          if (prevState.isNew) {
            batch.delete(partRef);
          } else {
            const { isNew, ...rest } = prevState;
            batch.set(partRef, rest, { merge: true });
          }
        });

        batch.delete(historyRef);
        await batch.commit();

        // Log REVERT action in audit_logs
        const logRef = firestoreDb.collection('audit_logs').doc();
        await logRef.set({
          user_id: username,
          user_name: username,
          plant_id: record.factoryId || 'System',
          plant_name: record.factoryId || 'System',
          action: 'REVERT',
          entity_type: 'inventory',
          entity_id: record.factoryId || targetId,
          created_at: Date.now(),
          details: `Reverted upload batch ${targetId} (${record.fileName || 'Upload'}) for plant ${record.factoryId || 'System'}`
        });

        // Update local db.json if present
        const dbJsonPath = path.join(process.cwd(), 'db.json');
        if (fs.existsSync(dbJsonPath)) {
          try {
            let localData = JSON.parse(fs.readFileSync(dbJsonPath, 'utf8'));
            if (Array.isArray(localData)) {
              Object.entries(previousState).forEach(([partId, prevState]) => {
                const idx = localData.findIndex(p => p.id === partId);
                if (idx !== -1) {
                  if (prevState.isNew) {
                    localData.splice(idx, 1);
                  } else {
                    const { isNew, ...rest } = prevState;
                    localData[idx] = { ...localData[idx], ...rest };
                  }
                }
              });
              fs.writeFileSync(dbJsonPath, JSON.stringify(localData, null, 2), 'utf8');
            }
          } catch (e) {
            console.warn("[Server] Local db.json sync error on revert:", e);
          }
        }

        return res.json({ success: true, message: `Upload batch ${targetId} successfully reverted.` });
      }
    }

    return res.json({ success: true, message: `Reverted upload batch ${targetId}` });
  } catch (error) {
    console.error("Revert API Error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post(['/orders/created', '/api/orders/created'], async (req, res) => {
  const { order, userEmail, plantEmail, userFactory } = req.body;
  if (!order || !userEmail || !plantEmail) {
    return res.status(400).send('Missing order payload, userEmail, or plantEmail');
  }

  try {
    console.log(`[API] Received OrderCreated event notification for order ${order.id}. Emitting event...`);
    
    // Emit the OrderCreated event to trigger listeners and queue tasks in the background
    orderEventEmitter.emit('OrderCreated', { order, userEmail, plantEmail, userFactory });

    // Respond immediately to prevent API latency during order placement
    res.status(202).json({
      success: true,
      message: 'Order processing and notification emails triggered in background.'
    });
  } catch (error) {
    console.error(`[API] Error triggering OrderCreated event:`, error);
    res.status(500).send(`Failed to process order event: ${error.message}`);
  }
});

// REST API for triggering Google Sheets sync
app.post(['/api/sync-sheets', '/sync-sheets'], async (req, res) => {
  const username = req.body.username || 'admin';
  console.log(`[Sync] Google Sheets sync triggered by user: ${username}`);
  
  const { exec } = require('child_process');
  exec('node scripts/sync_db.js', async (error, stdout, stderr) => {
    if (error) {
      console.error(`[Sync Error] Failed to run sync_db.js: ${error.message}`);
      return;
    }
    console.log(`[Sync Success] Database synced from Google Sheets.`);
    
    // Log audit log event
    try {
      if (firestoreDb) {
        const logRef = firestoreDb.collection('audit_logs').doc();
        await logRef.set({
          user_id: username,
          user_name: username,
          plant_id: 'System',
          plant_name: 'System',
          action: 'UPDATED',
          entity_type: 'google_sheets',
          entity_id: 'Master Sheet',
          changes: JSON.stringify({ sync: { old: 'stale', new: 'synced' } }),
          created_at: Date.now(),
          details: 'Synced database with master Google Sheets'
        });
      }
    } catch (auditError) {
      console.error("[Sync Audit] Failed to log sync action:", auditError);
    }
  });

  return res.json({ success: true, message: "Sync process started in the background." });
});

app.post(['/api/inventory/save-inventory'], async (req, res) => {
  const { parts, username } = req.body;
  if (!parts || !Array.isArray(parts)) {
    return res.status(400).send('Missing parts payload or payload is not an array');
  }

  const performerUsername = username || 'unknown';
  
  try {
    const dbJsonPath = path.join(process.cwd(), 'db.json');
    let localData = [];
    if (fs.existsSync(dbJsonPath)) {
      try {
        localData = JSON.parse(fs.readFileSync(dbJsonPath, 'utf8'));
      } catch (err) {
        console.warn("[Server] Failed to read db.json before save-inventory:", err.message);
      }
    }

    const previousState = {};
    const updatedState = {};

    parts.forEach(newPart => {
      const idx = localData.findIndex(p => p.id === newPart.id);
      if (idx !== -1) {
        previousState[newPart.id] = { ...localData[idx] };
        localData[idx] = { ...localData[idx], ...newPart };
      } else {
        previousState[newPart.id] = { isNew: true };
        localData.push(newPart);
      }
      updatedState[newPart.id] = {
        onHand: newPart.onHand,
        totalValue: newPart.totalValue,
        consumptionQty: newPart.consumptionQty || 0,
        consumptionValue: newPart.consumptionValue || 0
      };
    });

    // Write to db.json
    fs.writeFileSync(dbJsonPath, JSON.stringify(localData, null, 2), 'utf8');
    console.log(`[Server] Saved ${parts.length} parts to local db.json via save-inventory API.`);

    // Sync to Firestore if Admin SDK is connected
    if (firestoreDb && parts.length > 0) {
      try {
        const BATCH_SIZE = 400;
        for (let i = 0; i < parts.length; i += BATCH_SIZE) {
          const chunk = parts.slice(i, i + BATCH_SIZE);
          const batch = firestoreDb.batch();
          chunk.forEach(part => {
            const ref = firestoreDb.collection('inventory').doc(part.id);
            batch.set(ref, part, { merge: true });
          });
          await batch.commit();
        }
        console.log(`[Firebase Admin] Synced ${parts.length} parts to Firestore via save-inventory API.`);

        // Log upload history record to Firestore
        const historyId = `rep-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
        const historyRef = firestoreDb.collection('upload_history').doc(historyId);
        await historyRef.set({
          id: historyId,
          timestamp: Date.now(),
          uploadedBy: performerUsername,
          fileName: 'Excel Template Upload',
          factoryId: parts[0].factoryId,
          reportType: 'EXCEL_TEMPLATE',
          previousState: JSON.stringify(previousState),
          updatedState: JSON.stringify(updatedState)
        });

        // Log audit action
        const logRef = firestoreDb.collection('audit_logs').doc();
        await logRef.set({
          user_id: performerUsername,
          user_name: performerUsername,
          plant_id: parts[0].factoryId,
          plant_name: parts[0].factoryId,
          action: 'UPLOAD',
          entity_type: 'inventory',
          entity_id: parts[0].factoryId,
          changes: JSON.stringify({ count: parts.length }),
          created_at: Date.now(),
          details: `Uploaded ${parts.length} items for ${parts[0].factoryId}`
        });

      } catch (firestoreErr) {
        console.warn("[Firebase Admin Error] Failed to write parts to Firestore:", firestoreErr.message);
      }
    }

    // Real-time Master Google Sheet Sync
    let sheetRowsUpdated = 0;
    let sheetNewRowsAppended = 0;
    let sheetWarning = null;

    if (parts.length > 0) {
      const plantName = parts[0].factoryId;
      try {
        const sheetRes = await syncPortalReportToSheet(plantName, parts);
        sheetRowsUpdated = sheetRes.sheetRowsUpdated || 0;
        sheetNewRowsAppended = sheetRes.sheetNewRowsAppended || 0;
        sheetWarning = sheetRes.warning;
      } catch (sheetErr) {
        console.warn("[Server] Google Sheet sync error:", sheetErr.message);
        sheetWarning = sheetErr.message;
      }
    }

    res.json({
      success: true,
      message: `Successfully updated ${parts.length} items in local database.`,
      portalUpdated: parts.length,
      portalAdded: 0,
      sheetRowsUpdated,
      sheetNewRowsAppended,
      sheetWarning
    });
  } catch (err) {
    console.error('[Server Save-Inventory API] Error:', err);
    res.status(500).send(`Internal server error: ${err.message}`);
  }
});

app.post(['/api/inventory/save-system-report'], async (req, res) => {
  const { factoryId, reportType, updatedParts, username, reportDate } = req.body;
  if (!factoryId || !reportType || !updatedParts || !Array.isArray(updatedParts)) {
    return res.status(400).send('Missing factoryId, reportType, or updatedParts array');
  }

  const performerUsername = username || 'unknown';

  try {
    const dbJsonPath = path.join(process.cwd(), 'db.json');
    let localData = [];
    if (fs.existsSync(dbJsonPath)) {
      try {
        localData = JSON.parse(fs.readFileSync(dbJsonPath, 'utf8'));
      } catch (err) {
        console.warn("[Server] Failed to read db.json before save-system-report:", err.message);
      }
    }

    let updatedCount = 0;
    let deductedCount = 0;

    const previousState = {};
    const updatedState = {};
    const firestoreUpdates = [];

    updatedParts.forEach((partUpdate) => {
      const partId = partUpdate.id;
      const idx = localData.findIndex(p => p.id === partId);

      if (reportType.includes('MB51') || reportType.includes('TRANSACTION')) {
        // Daily Consumption: Subtract from active stock
        if (idx !== -1) {
          const currentData = localData[idx];
          const consumptionQty = partUpdate.qtyMoreThan3Years || 0;
          const newOnHand = Math.max(0, (currentData.onHand || 0) - consumptionQty);
          const newTotalValue = newOnHand * (currentData.unitCost || 0);

          const newConsumptionQty = (currentData.consumptionQty || 0) + consumptionQty;
          const newConsumptionValue = newConsumptionQty * (currentData.unitCost || 0);

          previousState[partId] = {
            onHand: currentData.onHand || 0,
            totalValue: currentData.totalValue || 0,
            consumptionQty: currentData.consumptionQty || 0,
            consumptionValue: currentData.consumptionValue || 0
          };

          updatedState[partId] = {
            onHand: newOnHand,
            totalValue: newTotalValue,
            consumptionQty: newConsumptionQty,
            consumptionValue: newConsumptionValue
          };

          const updateObj = {
            ...currentData,
            onHand: newOnHand,
            totalValue: newTotalValue,
            consumptionQty: newConsumptionQty,
            consumptionValue: newConsumptionValue,
            lastStockUpdateUser: performerUsername
          };
          if (reportDate) {
            updateObj.lastStockUpdateDate = reportDate;
          }

          localData[idx] = updateObj;
          firestoreUpdates.push(updateObj);
          deductedCount++;
        }
      } else {
        // Stock Report: Set or merge stock levels
        if (idx !== -1) {
          const currentData = localData[idx];
          const updateData = {
            ...currentData,
            onHand: partUpdate.onHand || 0,
            lastStockUpdateUser: performerUsername
          };
          if (partUpdate.totalValue !== undefined && partUpdate.totalValue > 0) {
            updateData.totalValue = partUpdate.totalValue;
            updateData.unitCost = partUpdate.unitCost;
          } else {
            updateData.totalValue = (partUpdate.onHand || 0) * (currentData.unitCost || 0);
          }
          if (reportDate) {
            updateData.lastStockUpdateDate = reportDate;
          }

          previousState[partId] = {
            onHand: currentData.onHand || 0,
            totalValue: currentData.totalValue || 0,
            consumptionQty: currentData.consumptionQty || 0,
            consumptionValue: currentData.consumptionValue || 0
          };

          updatedState[partId] = {
            onHand: partUpdate.onHand || 0,
            totalValue: updateData.totalValue,
            consumptionQty: currentData.consumptionQty || 0,
            consumptionValue: currentData.consumptionValue || 0
          };

          localData[idx] = updateData;
          firestoreUpdates.push(updateData);
          updatedCount++;
        } else {
          // If the part does not exist, create it as a new catalog item
          const newPart = {
            id: partId,
            factoryId: partUpdate.factoryId || factoryId,
            materialNumber: partUpdate.materialNumber,
            partNumber: partUpdate.partNumber || partUpdate.materialNumber,
            description: partUpdate.description || 'System Spare Part',
            qtyMoreThan3Years: 0,
            valueMoreThan3Years: 0,
            onHand: partUpdate.onHand || 0,
            unitCost: partUpdate.unitCost || 0,
            totalValue: partUpdate.totalValue || 0,
            spareType: 'General',
            categoryName: '-',
            machine: '-',
            criticality: '-',
            lastStockUpdateUser: performerUsername,
            ...(reportDate ? { lastStockUpdateDate: reportDate } : {})
          };

          previousState[partId] = { isNew: true };
          updatedState[partId] = {
            onHand: newPart.onHand,
            totalValue: newPart.totalValue,
            consumptionQty: 0,
            consumptionValue: 0
          };

          localData.push(newPart);
          firestoreUpdates.push(newPart);
          updatedCount++;
        }
      }
    });

    // Write to db.json
    fs.writeFileSync(dbJsonPath, JSON.stringify(localData, null, 2), 'utf8');
    console.log(`[Server] Saved system report changes to local db.json. Updated: ${updatedCount}, Deducted: ${deductedCount}`);

    // Sync to Firestore if Admin SDK is connected
    if (firestoreDb && firestoreUpdates.length > 0) {
      try {
        const BATCH_SIZE = 400;
        for (let i = 0; i < firestoreUpdates.length; i += BATCH_SIZE) {
          const chunk = firestoreUpdates.slice(i, i + BATCH_SIZE);
          const batch = firestoreDb.batch();
          chunk.forEach(part => {
            const ref = firestoreDb.collection('inventory').doc(part.id);
            batch.set(ref, part, { merge: true });
          });
          await batch.commit();
        }
        console.log(`[Firebase Admin] Synced system report updates to Firestore.`);

        // Log upload history record to Firestore
        if (updatedCount > 0 || deductedCount > 0) {
          const historyId = `rep-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
          const historyRef = firestoreDb.collection('upload_history').doc(historyId);
          await historyRef.set({
            id: historyId,
            timestamp: Date.now(),
            uploadedBy: performerUsername,
            fileName: `${reportType} Report`,
            factoryId: factoryId,
            reportType: reportType,
            previousState: JSON.stringify(previousState),
            updatedState: JSON.stringify(updatedState),
            ...(reportDate ? { reportDate } : {})
          });

          // Log audit action
          const logRef = firestoreDb.collection('audit_logs').doc();
          await logRef.set({
            user_id: performerUsername,
            user_name: performerUsername,
            plant_id: factoryId,
            plant_name: factoryId,
            action: 'UPLOAD',
            entity_type: 'inventory',
            entity_id: factoryId,
            created_at: Date.now(),
            details: `Uploaded ${reportType} report for factory ${factoryId}. Updated: ${updatedCount}, Consumption Deducted: ${deductedCount}`
          });
        }
      } catch (firestoreErr) {
        console.warn("[Firebase Admin Error] Failed to write system report updates to Firestore:", firestoreErr.message);
      }
    }

    res.json({ success: true, updatedCount, deductedCount });
  } catch (err) {
    console.error('[Server Save-System-Report API] Error:', err);
    res.status(500).send(`Internal server error: ${err.message}`);
  }
});

// =============================================================================
// POST /api/inventory/sync-upload
// SAP & Oracle automated inventory synchronisation endpoint.
//
// Accepts multipart/form-data with:
//   file     — .xlsx / .xls binary
//   plantId  — target plant / factory ID string
//   username — performer username for audit logging
//
// Returns IngestionSummary:
//   { status, source, plant, total_rows_read, items_updated, new_items_added, skipped_rows }
// =============================================================================

/**
 * Helper to resolve plant name
 */
function resolvePlantIdServer(rawName, fallback = 'Lanka Tiles') {
  if (!rawName) return fallback;
  const s = String(rawName).trim().toLowerCase();
  if (s.includes('lanka') && s.includes('wall')) return 'Lanka Wall Tiles';
  if (s.includes('lanka') && (s.includes('tile') || s.includes('lt'))) return 'Lanka Tiles';
  if (s.includes('horana') || s.includes('rcl-h') || s.includes('rclh')) return 'Rocell Horana';
  if (s.includes('eheliyagoda') || s.includes('rcl-e') || s.includes('rcle') || s === 'gsc') return 'Rocell Eheliyagoda';
  return fallback;
}

/**
 * Detect SAP vs Oracle from workbook and determine 4-plant schema type.
 */
function detectInventoryFormatServer(workbook, fallbackPlant = 'Lanka Tiles') {
  const sheetNames = workbook.SheetNames;
  const resolvedFallback = resolvePlantIdServer(fallbackPlant, 'Lanka Tiles');

  for (const name of sheetNames) {
    const cleanName = name.replace(/\s+/g, ' ').trim().toLowerCase();
    if (cleanName.includes('current inventory status')) {
      return { format: 'SAP', plantId: 'Lanka Tiles', schemaType: 'SAP_LT' };
    }
    if (cleanName.includes('spare parts') && !cleanName.includes('rcl')) {
      return { format: 'SAP', plantId: 'Lanka Wall Tiles', schemaType: 'SAP_LWT' };
    }
    if (/^gs\s/i.test(name.trim())) {
      return { format: 'ORACLE', plantId: 'Rocell Eheliyagoda', schemaType: 'ORACLE_RCLE' };
    }
  }

  const firstSheetName = sheetNames[0];
  if (!firstSheetName) return { format: 'UNKNOWN', plantId: resolvedFallback, schemaType: 'UNKNOWN' };

  const sheet = workbook.Sheets[firstSheetName];
  const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  for (let i = 0; i < Math.min(10, rawRows.length); i++) {
    const rowStr = rawRows[i].map(c => String(c ?? '').toLowerCase()).join('|');

    if (rowStr.includes('closing stock') && (rowStr.includes('bun') || rowStr.includes('avg rate'))) {
      return { format: 'SAP', plantId: 'Lanka Wall Tiles', schemaType: 'SAP_LWT' };
    }
    if (rowStr.includes('sum of unrestricted') || rowStr.includes('qty (unrestricted)')) {
      return { format: 'SAP', plantId: 'Lanka Tiles', schemaType: 'SAP_LT' };
    }
    if (rowStr.includes('organization') && (rowStr.includes('item category') || rowStr.includes('primary unit of measure'))) {
      return { format: 'ORACLE', plantId: 'Rocell Eheliyagoda', schemaType: 'ORACLE_RCLE' };
    }
    if (
      rowStr.includes('item description') &&
      (rowStr.includes('qty') || rowStr.includes('unit cost') || rowStr.includes('sub')) &&
      !rowStr.includes('organization')
    ) {
      return { format: 'ORACLE', plantId: 'Rocell Horana', schemaType: 'ORACLE_RCLH' };
    }
  }

  if (resolvedFallback === 'Lanka Wall Tiles') {
    return { format: 'SAP', plantId: 'Lanka Wall Tiles', schemaType: 'SAP_LWT' };
  } else if (resolvedFallback === 'Rocell Horana') {
    return { format: 'ORACLE', plantId: 'Rocell Horana', schemaType: 'ORACLE_RCLH' };
  } else if (resolvedFallback === 'Rocell Eheliyagoda') {
    return { format: 'ORACLE', plantId: 'Rocell Eheliyagoda', schemaType: 'ORACLE_RCLE' };
  }

  return { format: 'SAP', plantId: 'Lanka Tiles', schemaType: 'SAP_LT' };
}

function normalizeUOMServer(raw) {
  if (!raw) return 'EACH';
  const s = String(raw).trim().toUpperCase();
  const MAP = {
    EA: 'EACH', EACH: 'EACH', EACHES: 'EACH', PC: 'PIECE', PCS: 'PIECE', PIECE: 'PIECE', PIECES: 'PIECE',
    KG: 'KG', KGS: 'KG', KILOGRAM: 'KG', LT: 'LITRE', LTR: 'LITRE', LITRE: 'LITRE', LITER: 'LITRE',
    M: 'METRE', MTR: 'METRE', METRE: 'METRE', METER: 'METRE',
    NOS: 'NOS', NO: 'NOS', NUM: 'NOS', SET: 'SET', SETS: 'SET',
    BOX: 'BOX', PK: 'PACK', PACK: 'PACK', ROLL: 'ROLL', ROL: 'ROLL',
    FT: 'FEET', IN: 'INCH', L: 'LITRE', PAIR: 'PAIR', PAIRS: 'PAIR', CAN: 'CAN', BTL: 'BOTTLE', BOTTLE: 'BOTTLE',
  };
  return MAP[s] ?? s;
}

function toFloatServer(val) {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') {
    if (isNaN(val) || val < 0) return 0;
    return val;
  }
  const cleaned = String(val).replace(/[^0-9.\-]/g, '');
  const parsed = parseFloat(cleaned);
  if (isNaN(parsed) || parsed < 0) return 0;
  return parsed;
}

function stripLeadingZerosServer(s) {
  const trimmed = String(s ?? '').trim();
  if (/^\d+$/.test(trimmed)) return String(parseInt(trimmed, 10));
  return trimmed;
}

function findColIdxServer(headers, ...candidates) {
  const lowers = candidates.map(c => c.toLowerCase().trim());
  return headers.findIndex(h => {
    const hs = String(h ?? '').toLowerCase().trim();
    return lowers.includes(hs);
  });
}

function isInvalidItemCodeServer(raw) {
  if (raw === null || raw === undefined) return true;
  const s = String(raw).trim().toLowerCase();
  if (!s || s === '' || s === 'nan' || s === 'null' || s === 'undefined') return true;
  if (s === 'total' || s === 'grand total' || s === 'subtotal' || s === 'row labels') return true;
  if (s === 'material' || s === 'material number' || s === 'material no' || s === 'item code' || s === 'item') return true;
  return false;
}

function parseSAP_LT_Server(workbook, plantId) {
  const sheetName = workbook.SheetNames.find(n => n.replace(/\s+/g, ' ').trim().toLowerCase().includes('current inventory status')) ?? workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', blankrows: true });

  let headerIdx = 2;
  for (let i = 0; i < Math.min(10, rawRows.length); i++) {
    const rowStr = rawRows[i].map(c => String(c ?? '').toLowerCase()).join('|');
    if (rowStr.includes('material number') || rowStr.includes('sum of unrestricted') || rowStr.includes('material description')) {
      headerIdx = i;
      break;
    }
  }

  const headers = rawRows[headerIdx] ?? [];
  const matNumIdx = findColIdxServer(headers, 'Material Number', 'Material No', 'Material', 'Item Code') !== -1
    ? findColIdxServer(headers, 'Material Number', 'Material No', 'Material', 'Item Code') : 1;
  const oldMatIdx = findColIdxServer(headers, 'Old material number', 'Old Material', 'Old Mat No') !== -1
    ? findColIdxServer(headers, 'Old material number', 'Old Material', 'Old Mat No') : 2;
  const descIdx   = findColIdxServer(headers, 'Material Description', 'Description') !== -1
    ? findColIdxServer(headers, 'Material Description', 'Description') : 3;
  const uomIdx    = findColIdxServer(headers, 'Base Unit of Measure', 'UoM', 'Unit of Measure', 'UOM') !== -1
    ? findColIdxServer(headers, 'Base Unit of Measure', 'UoM', 'Unit of Measure', 'UOM') : 4;
  const qtyIdx    = findColIdxServer(headers, 'Sum of Unrestricted', 'Unrestricted', 'Qty on Hand', 'Stock Qty', 'Quantity', 'Qty') !== -1
    ? findColIdxServer(headers, 'Sum of Unrestricted', 'Unrestricted', 'Qty on Hand', 'Stock Qty', 'Quantity', 'Qty') : 5;
  const valIdx    = findColIdxServer(headers, 'Value (LKR)', 'Value', 'Total Value');

  const now = Date.now();
  const rows = [];
  let skipped = 0;

  for (let i = headerIdx + 1; i < rawRows.length; i++) {
    const row = rawRows[i];
    if (!row || row.length === 0) { skipped++; continue; }

    const rawMatNum = String(row[matNumIdx] ?? '').trim();
    if (isInvalidItemCodeServer(rawMatNum)) {
      skipped++;
      continue;
    }

    const itemCode = stripLeadingZerosServer(rawMatNum);
    const legacyCode = oldMatIdx !== -1 ? (String(row[oldMatIdx] ?? '').trim() || null) : null;
    const desc       = String(row[descIdx] ?? '').trim() || 'No Description';
    const uom        = normalizeUOMServer(String(row[uomIdx] ?? ''));
    const qty        = toFloatServer(row[qtyIdx]);
    const totalVal   = valIdx !== -1 ? toFloatServer(row[valIdx]) : null;

    rows.push({
      plant_id:        plantId,
      item_code:       itemCode,
      legacy_item_code: legacyCode,
      description:     desc,
      category:        null,
      quantity_on_hand: qty,
      uom,
      unit_cost:       null,
      total_value:     totalVal && totalVal > 0 ? totalVal : null,
      source_system:   'SAP',
      last_synced_at:  now,
    });
  }

  return { rows, skipped };
}

function parseSAP_LWT_Server(workbook, plantId) {
  const sheetName = workbook.SheetNames.find(n => n.toLowerCase().includes('spare parts') || n.toLowerCase().includes('stock with images') || n.toLowerCase().includes('lwt')) ?? workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', blankrows: true });

  let headerIdx = 3;
  for (let i = 0; i < Math.min(10, rawRows.length); i++) {
    const rowStr = rawRows[i].map(c => String(c ?? '').toLowerCase()).join('|');
    if (rowStr.includes('material') || rowStr.includes('closing stock') || rowStr.includes('description')) {
      headerIdx = i;
      break;
    }
  }

  const headers = rawRows[headerIdx] ?? [];
  const colMat   = findColIdxServer(headers, 'Material', 'Material Number', 'Material No', 'Item Code');
  const colDesc  = findColIdxServer(headers, 'Material Description', 'Description');
  const colStock = findColIdxServer(headers, 'Closing Stock', 'Qty on Hand', 'Qty (Closing Stock)', 'Qty', 'Quantity');
  const colBUn   = findColIdxServer(headers, 'BUn', 'UOM', 'Base Unit of Measure', 'Unit of Measure');
  const colRate  = findColIdxServer(headers, 'Avg Rate.', 'Avg Rate', 'Unit Cost', 'Price');
  const colValue = findColIdxServer(headers, 'Closing Value', 'Value (LKR)', 'Total Value', 'Value');

  const matIdx   = colMat   !== -1 ? colMat   : 1;
  const descIdx  = colDesc  !== -1 ? colDesc  : 2;
  const stockIdx = colStock !== -1 ? colStock : 3;
  const bunIdx   = colBUn   !== -1 ? colBUn   : 4;
  const valueIdx = colValue !== -1 ? colValue : 5;
  const rateIdx  = colRate  !== -1 ? colRate  : 7;

  const now = Date.now();
  const rows = [];
  let skipped = 0;

  for (let i = headerIdx + 1; i < rawRows.length; i++) {
    const row = rawRows[i];
    if (!row || row.length === 0) { skipped++; continue; }

    const rawMatNum = String(row[matIdx] ?? '').trim();
    if (isInvalidItemCodeServer(rawMatNum)) {
      skipped++;
      continue;
    }

    const itemCode = stripLeadingZerosServer(rawMatNum);
    const desc     = String(row[descIdx] ?? '').trim() || 'No Description';
    const qty      = toFloatServer(row[stockIdx]);
    const uom      = normalizeUOMServer(String(row[bunIdx] ?? ''));
    const unitCost = colRate !== -1 ? toFloatServer(row[rateIdx]) : null;
    const totVal   = colValue !== -1 ? toFloatServer(row[valueIdx]) : null;

    rows.push({
      plant_id:        plantId,
      item_code:       itemCode,
      description:     desc,
      category:        null,
      quantity_on_hand: qty,
      uom,
      unit_cost:       unitCost && unitCost > 0 ? unitCost : null,
      total_value:     totVal && totVal > 0 ? totVal : (unitCost ? unitCost * qty : null),
      source_system:   'SAP',
      last_synced_at:  now,
    });
  }

  return { rows, skipped };
}

function parseOracle_RCLH_Server(workbook, plantId) {
  const sheetName = workbook.SheetNames.find(n => n.toLowerCase().includes('sheet1') || n.toLowerCase().includes('rcl-h') || n.toLowerCase().includes('stock with images')) ?? workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', blankrows: true });

  let headerIdx = 2;
  for (let i = 0; i < Math.min(10, rawRows.length); i++) {
    const rowStr = rawRows[i].map(c => String(c ?? '').toLowerCase()).join('|');
    if (rowStr.includes('item code') || rowStr.includes('item description') || rowStr.includes('qty')) {
      headerIdx = i;
      break;
    }
  }

  const headers = rawRows[headerIdx] ?? [];
  const colCode = findColIdxServer(headers, 'Item Code', 'Material Number', 'Material', 'Item');
  const colSub  = findColIdxServer(headers, 'Sub', 'Item Category', 'Category');
  const colDesc = findColIdxServer(headers, 'Item Description', 'Description', 'Material Description');
  const colQty  = findColIdxServer(headers, 'Qty', 'Qty on Hand', 'Quantity');
  const colUOM  = findColIdxServer(headers, 'UOM', 'Primary Unit Of Measure', 'Unit of Measure');
  const colCost = findColIdxServer(headers, 'Unit Cost', 'Cost');
  const colVal  = findColIdxServer(headers, 'Value', 'Value (LKR)', 'Inventory Value', 'Total Value');

  const codeIdx = colCode !== -1 ? colCode : 0;
  const subIdx  = colSub  !== -1 ? colSub  : 1;
  const descIdx = colDesc !== -1 ? colDesc : 2;
  const qtyIdx  = colQty  !== -1 ? colQty  : 3;
  const uomIdx  = colUOM  !== -1 ? colUOM  : 4;
  const costIdx = colCost !== -1 ? colCost : 5;
  const valIdx  = colVal  !== -1 ? colVal  : 6;

  const now = Date.now();
  const rows = [];
  let skipped = 0;

  for (let i = headerIdx + 1; i < rawRows.length; i++) {
    const row = rawRows[i];
    if (!row || row.length === 0) { skipped++; continue; }

    const rawCode = String(row[codeIdx] ?? '').trim();
    if (isInvalidItemCodeServer(rawCode)) {
      skipped++;
      continue;
    }

    const category  = subIdx !== -1 ? (String(row[subIdx] ?? '').trim() || null) : null;
    const desc      = String(row[descIdx] ?? '').trim() || 'No Description';
    const qty       = toFloatServer(row[qtyIdx]);
    const uom       = normalizeUOMServer(String(row[uomIdx] ?? ''));
    const unitCost  = costIdx !== -1 ? toFloatServer(row[costIdx]) : null;
    const totVal    = valIdx !== -1 ? toFloatServer(row[valIdx]) : null;

    rows.push({
      plant_id:        plantId,
      item_code:       rawCode,
      description:     desc,
      category,
      quantity_on_hand: qty,
      uom,
      unit_cost:       unitCost && unitCost > 0 ? unitCost : null,
      total_value:     totVal && totVal > 0 ? totVal : (unitCost ? unitCost * qty : null),
      source_system:   'ORACLE',
      last_synced_at:  now,
    });
  }

  return { rows, skipped };
}

function parseOracle_RCLE_Server(workbook, plantId) {
  const sheetName = workbook.SheetNames.find(n => /^gs\s/i.test(n.trim()) || n.toLowerCase().includes('rcl-e') || n.toLowerCase().includes('consolidated')) ?? workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', blankrows: true });

  let headerIdx = 2;
  for (let i = 0; i < Math.min(10, rawRows.length); i++) {
    const rowStr = rawRows[i].map(c => String(c ?? '').toLowerCase()).join('|');
    if (rowStr.includes('item code') && (rowStr.includes('description') || rowStr.includes('organization') || rowStr.includes('quantity'))) {
      headerIdx = i;
      break;
    }
  }

  const headers = rawRows[headerIdx] ?? [];
  const colOrg  = findColIdxServer(headers, 'Organization', 'Org', 'Plant');
  const colCat  = findColIdxServer(headers, 'Item Category', 'Category');
  const colCode = findColIdxServer(headers, 'Item Code', 'ItemCode', 'Item');
  const colDesc = findColIdxServer(headers, 'Description', 'Item Description');
  const colUOM  = findColIdxServer(headers, 'Primary Unit Of Measure', 'UOM', 'Unit of Measure', 'UoM');
  const colQty  = findColIdxServer(headers, 'Quantity', 'Physical Stock Qty', 'Qty', 'On Hand');
  const colCost = findColIdxServer(headers, 'Unit Cost', 'Cost');
  const colVal  = findColIdxServer(headers, 'Inventory Value', 'Value (LKR)', 'Total Value', 'Value');

  const now = Date.now();
  const rows = [];
  let skipped = 0;

  for (let i = headerIdx + 1; i < rawRows.length; i++) {
    const row = rawRows[i];
    if (!row || row.length === 0) { skipped++; continue; }

    const rawCode = colCode !== -1 ? String(row[colCode] ?? '').trim() : '';
    if (isInvalidItemCodeServer(rawCode)) {
      skipped++;
      continue;
    }

    const orgRaw        = colOrg !== -1 ? String(row[colOrg] ?? '').trim() : '';
    const resolvedPlant = resolvePlantIdServer(orgRaw, plantId);

    const category  = colCat  !== -1 ? (String(row[colCat]  ?? '').trim() || null) : null;
    const desc      = colDesc !== -1 ? (String(row[colDesc] ?? '').trim() || 'No Description') : 'No Description';
    const uom       = normalizeUOMServer(colUOM !== -1 ? String(row[colUOM] ?? '') : '');
    const qty       = toFloatServer(colQty !== -1 ? row[colQty] : 0);
    const unitCost  = colCost !== -1 ? toFloatServer(row[colCost]) : null;
    const totVal    = colVal  !== -1 ? toFloatServer(row[colVal])  : null;

    rows.push({
      plant_id:        resolvedPlant,
      item_code:       rawCode,
      description:     desc,
      category,
      quantity_on_hand: qty,
      uom,
      unit_cost:       unitCost && unitCost > 0 ? unitCost : null,
      total_value:     totVal && totVal > 0 ? totVal : (unitCost ? unitCost * qty : null),
      source_system:   'ORACLE',
      last_synced_at:  now,
    });
  }

  return { rows, skipped };
}

function canonicalToSparePart(row, performerUsername, now) {
  const safeId = `${row.plant_id}-${row.item_code}`.replace(/[^a-zA-Z0-9\-_.]/g, '-');
  return {
    id:             safeId,
    factoryId:      row.plant_id,
    materialNumber: row.item_code,
    partNumber:     row.item_code,
    description:    row.description,
    categoryName:   row.category ?? '-',
    onHand:         row.quantity_on_hand,
    unitCost:       row.unit_cost ?? 0,
    totalValue:     row.total_value ?? ((row.unit_cost ?? 0) * row.quantity_on_hand),
    uom:            row.uom,
    source_system:  row.source_system,
    spareType:      row.category ?? 'General',
    machine:        '-',
    criticality:    '-',
    qtyMoreThan3Years:   0,
    valueMoreThan3Years: 0,
    lastStockUpdateDate: new Date(now).toISOString().split('T')[0],
    lastStockUpdateUser: performerUsername,
    last_synced_at:      now,
    ...(row.legacy_item_code ? { legacyItemCode: row.legacy_item_code } : {}),
  };
}

app.post(['/api/inventory/sync-upload', '/api/inventory/sync', '/api/upload', '/inventory/sync-upload'], upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ status: 'error', message: 'No file uploaded.' });
  }

  const rawPlant          = (req.body.plantId || '').trim();
  const performerUsername = (req.body.username || 'unknown').trim();

  if (!rawPlant) {
    return res.status(400).json({ status: 'error', message: 'plantId is required.' });
  }

  try {
    const workbook  = XLSX.read(req.file.buffer, { type: 'buffer' });
    const detection = detectInventoryFormatServer(workbook, rawPlant);
    const plantId   = resolvePlantIdServer(rawPlant, detection.plantId);

    let result;
    if (detection.schemaType === 'SAP_LWT' || (detection.format === 'SAP' && plantId === 'Lanka Wall Tiles')) {
      result = parseSAP_LWT_Server(workbook, plantId);
    } else if (detection.schemaType === 'ORACLE_RCLH' || (detection.format === 'ORACLE' && plantId === 'Rocell Horana')) {
      result = parseOracle_RCLH_Server(workbook, plantId);
    } else if (detection.schemaType === 'ORACLE_RCLE' || (detection.format === 'ORACLE' && plantId === 'Rocell Eheliyagoda')) {
      result = parseOracle_RCLE_Server(workbook, plantId);
    } else {
      result = parseSAP_LT_Server(workbook, plantId);
    }

    const parsedRows  = result.rows;
    const skippedRows = result.skipped;

    if (parsedRows.length === 0) {
      return res.status(400).json({
        status: 'error',
        message: 'No valid data rows could be extracted from the uploaded file.',
        skipped_rows: skippedRows,
      });
    }

    const dbJsonPath = path.join(process.cwd(), 'db.json');
    let localData = [];
    if (fs.existsSync(dbJsonPath)) {
      try {
        localData = JSON.parse(fs.readFileSync(dbJsonPath, 'utf8'));
        if (!Array.isArray(localData)) localData = [];
      } catch (err) {
        console.warn('[Sync Upload] Failed to read db.json:', err.message);
        localData = [];
      }
    }

    const idIndexMap = new Map();
    localData.forEach((p, idx) => {
      if (p.id) idIndexMap.set(p.id, idx);
    });

    const now = Date.now();
    let itemsUpdated  = 0;
    let newItemsAdded = 0;
    const previousState = {};
    const updatedState  = {};
    const firestoreOps  = [];

    for (const row of parsedRows) {
      const sparePart = canonicalToSparePart(row, performerUsername, now);
      const partId    = sparePart.id;

      if (idIndexMap.has(partId)) {
        const existingIdx  = idIndexMap.get(partId);
        const existingData = localData[existingIdx];

        previousState[partId] = {
          onHand:     existingData.onHand ?? 0,
          totalValue: existingData.totalValue ?? 0,
        };

        const merged = {
          ...existingData,
          onHand:             sparePart.onHand,
          description:        sparePart.description,
          uom:                sparePart.uom,
          unitCost:           sparePart.unitCost > 0 ? sparePart.unitCost : (existingData.unitCost ?? 0),
          totalValue:         sparePart.unitCost > 0
                                ? sparePart.totalValue
                                : (existingData.unitCost ?? 0) * sparePart.onHand,
          categoryName:       sparePart.categoryName !== '-' ? sparePart.categoryName : (existingData.categoryName ?? '-'),
          source_system:      sparePart.source_system,
          lastStockUpdateDate: sparePart.lastStockUpdateDate,
          lastStockUpdateUser: performerUsername,
          last_synced_at:     now,
          ...(sparePart.legacyItemCode ? { legacyItemCode: sparePart.legacyItemCode } : {}),
        };

        updatedState[partId] = { onHand: merged.onHand, totalValue: merged.totalValue };
        localData[existingIdx] = merged;
        firestoreOps.push(merged);
        itemsUpdated++;
      } else {
        previousState[partId] = { isNew: true };
        updatedState[partId]  = { onHand: sparePart.onHand, totalValue: sparePart.totalValue };
        localData.push(sparePart);
        firestoreOps.push(sparePart);
        idIndexMap.set(partId, localData.length - 1);
        newItemsAdded++;
      }
    }

    fs.writeFileSync(dbJsonPath, JSON.stringify(localData, null, 2), 'utf8');
    console.log(`[Sync Upload] db.json updated for ${plantId} — updated: ${itemsUpdated}, added: ${newItemsAdded}, skipped: ${skippedRows}`);

    if (firestoreDb && firestoreOps.length > 0) {
      try {
        const BATCH_SIZE = 500;
        for (let i = 0; i < firestoreOps.length; i += BATCH_SIZE) {
          const chunk = firestoreOps.slice(i, i + BATCH_SIZE);
          const batch = firestoreDb.batch();
          chunk.forEach(part => {
            const ref = firestoreDb.collection('inventory').doc(part.id);
            batch.set(ref, part, { merge: true });
          });
          await batch.commit();
        }
        console.log(`[Sync Upload] Firestore synced — ${firestoreOps.length} docs written.`);
      } catch (fsErr) {
        console.warn('[Sync Upload] Firestore write failed (non-fatal):', fsErr.message);
      }
    }

    // Real-time Master Google Sheet Sync
    let sheetRowsUpdated = 0;
    let sheetNewRowsAppended = 0;
    let sheetWarning = null;

    if (firestoreOps.length > 0) {
      try {
        const sheetRes = await syncPortalReportToSheet(plantId, firestoreOps);
        sheetRowsUpdated = sheetRes.sheetRowsUpdated || 0;
        sheetNewRowsAppended = sheetRes.sheetNewRowsAppended || 0;
        sheetWarning = sheetRes.warning;
      } catch (sheetErr) {
        console.warn('[Sync Upload] Google Sheet sync failed:', sheetErr.message);
        sheetWarning = sheetErr.message;
      }
    }

    res.json({
      status: 'success',
      source: detection.format,
      plant: plantId,
      total_rows_read: parsedRows.length + skippedRows,
      items_updated: itemsUpdated,
      new_items_added: newItemsAdded,
      skipped_rows: skippedRows,
      sheet_rows_updated: sheetRowsUpdated,
      sheet_new_rows_appended: sheetNewRowsAppended,
      sheet_warning: sheetWarning,
      message: `Successfully synced ${parsedRows.length} items for ${plantId} (${newItemsAdded} new added, ${itemsUpdated} updated, ${skippedRows} skipped). Google Sheet: ${sheetRowsUpdated} updated, ${sheetNewRowsAppended} appended.`
    });

  } catch (err) {
    console.error('[Sync Upload API Error]:', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`[Server] Spare Parts Backend running on port ${PORT}`);
});
