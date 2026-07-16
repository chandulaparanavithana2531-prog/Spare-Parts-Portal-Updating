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

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

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
const upload = multer({ storage: storage });

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
      const localData = JSON.parse(fs.readFileSync(dbJsonPath, 'utf8'));
      if (Array.isArray(localData) && localData.length > 0) {
        console.log(`[Server] Serving ${localData.length} parts from local db.json.`);
        const enriched = localData.map(part => {
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
      const snapshot = await firestoreDb.collection('inventory').get();
      const parts = [];
      snapshot.forEach(doc => {
        const data = doc.data();
        
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

// REST endpoints for historical consumption
app.get(['/historical-consumption', '/api/historical-consumption'], async (req, res) => {
  if (firestoreDb) {
    try {
      const snapshot = await firestoreDb.collection('historical_consumption').get();
      const records = [];
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
  res.json(memoryHistoricalRecords);
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

// POST endpoints for Chatbot Integration with Gemini API
// POST endpoints for Chatbot Integration with Gemini API
app.post(['/chat', '/api/chat'], async (req, res) => {
  const { message, history, relevantParts, systemSummaryText } = req.body;
  
  const firebaseKey = "AIzaSyAMl2OrlGj_O9qeh02KeKuw6lA_pZLG4XM";
  
  const isValidApiKey = (key) => {
    if (!key) return false;
    const trimmed = key.trim();
    if (!trimmed) return false;
    
    const lowers = trimmed.toLowerCase();
    if (
      lowers === "undefined" ||
      lowers === "null" ||
      lowers === "missing_key" ||
      lowers === firebaseKey.toLowerCase() ||
      lowers.includes("youractualapikey") ||
      lowers.includes("apikeyhere")
    ) {
      return false;
    }
    return true;
  };
  
  // Retrieve API key from environment, or from Request Headers if provided by client
  const clientKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');
  const cleanClientKey = isValidApiKey(clientKey) ? clientKey.trim() : null;
  
  // Resolve environment key, filtering out Firebase key and Missing_Key placeholder
  let envKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!isValidApiKey(envKey) && isValidApiKey(process.env.API_KEY)) {
    envKey = process.env.API_KEY;
  }
  
  const apiKey = isValidApiKey(envKey) ? envKey : cleanClientKey;
  
  if (!apiKey) {
    return res.status(400).json({
      success: false,
      message: "Gemini API Key is missing. Please configure GEMINI_API_KEY in your .env file on the server, or input one in the chatbot settings."
    });
  }
  
  try {
    const ai = new GoogleGenAI({ apiKey });
    
    // System instructions persona
    const systemInstruction = `You are the Spare Parts Portal AI Assistant. Your job is to help factory workers and procurement managers quickly find information about spare parts, current stock levels across the 4 factories, historical consumption patterns, and guide them on how to make cross-plant orders.
    Always format numbers nicely. The local currency is Sri Lankan Rupees (Rs.).
    Be concise, professional, and friendly.`;
    
    // Format matching spares context
    const partsContext = relevantParts && relevantParts.length > 0
      ? relevantParts.map(p => `- [${p.factoryId}] Material: ${p.materialNumber}, PartNo: ${p.partNumber || 'N/A'}, Description: ${p.description}, OnHand: ${p.onHand}, Price: Rs. ${p.unitCost}, Machine: ${p.machine || 'N/A'}, Category: ${p.categoryName || 'N/A'}`).join('\n')
      : 'No specific matching spare parts or machines found in the filtered search window.';

    const systemSummary = systemSummaryText || 'N/A';

    const prompt = `
Matched Spares Context (drawn from the active portal dataset):
${partsContext}

System-Wide Inventory Summary (Consolidated Data):
${systemSummary}

User Question: "${message}"

Instructions:
1. Answer the user's question clearly, drawing details directly from the provided System-Wide Inventory Summary or Matched Spares Context.
2. If the user asks a general or aggregate question (e.g. "total stock value", "how many items", "compare factories", "stocks of LT"), answer using the System-Wide Inventory Summary.
3. If the user asks about specific spare parts, category mappings, or machine mappings, check the Matched Spares Context and match parts with specific machines (look at the 'Machine' field).
4. If they ask about spares that are not in the database context, you can suggest typical industrial machine layouts but make it clear that the specific part wasn't found in this system's active collection.
5. If the user asks how to make a cross-plant order or request a transfer, refer to the "Cross-Plant Ordering Guide" steps:
   - Step 1: Log in with credentials.
   - Step 2: Search the parts catalog on the dashboard.
   - Step 3: Check which plant holds the stock (colored factory badge).
   - Step 4: Add the item to the Cart, adjust quantities, and click "Request" to place a cross-plant order.
6. If the user asks how to download or export inventory (e.g., CSV), tell them to navigate to the "Inventory" tab and click "Export CSV".
`;

    // Map history to contents array structure
    const contents = [];
    if (history && Array.isArray(history)) {
      history.forEach(h => {
        const role = h.role === 'user' ? 'user' : 'model';
        const textVal = h.text || h.content;
        if (textVal) {
          contents.push({
            role,
            parts: [{ text: textVal }]
          });
        }
      });
    }
    
    // Add current user prompt
    contents.push({
      role: 'user',
      parts: [{ text: prompt }]
    });

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents,
      config: {
        systemInstruction,
        tools: [
          {
            googleSearch: {}
          }
        ]
      }
    });

    const text = response.text || "I was unable to compile a response.";
    const candidate = response.candidates?.[0];
    const groundingMetadata = candidate?.groundingMetadata;
    const webSearchQueries = groundingMetadata?.webSearchQueries || [];
    
    const groundingSources = groundingMetadata?.groundingChunks
      ?.map((chunk) => {
        if (chunk.web) {
          return {
            title: chunk.web.title || chunk.web.uri,
            uri: chunk.web.uri
          };
        }
        return null;
      })
      .filter((s) => s !== null) || [];

    res.json({
      success: true,
      text,
      webSearchQueries,
      groundingSources
    });

  } catch (err) {
    console.error('[Chat API] Error during Gemini generateContent:', err);
    res.status(500).json({
      success: false,
      message: `Failed to generate response: ${err.message}`
    });
  }
});

app.listen(PORT, () => {
  console.log(`[Server] Spare Parts Backend running on port ${PORT}`);
  
  // Startup validation check for Gemini API key
  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.API_KEY;
  if (!geminiKey || geminiKey === 'Missing_Key') {
    console.warn('\x1b[33m%s\x1b[0m', '[Gemini AI] WARNING: GEMINI_API_KEY / GOOGLE_API_KEY environment variable is not defined on the backend server. The chatbot will rely on client-side API keys forwarded in request headers.');
  } else {
    console.log('\x1b[32m%s\x1b[0m', '[Gemini AI] API Key detected on server. Chatbot will use secure backend environment key.');
  }
});
