import { SparePart, HistoricalConsumptionRecord } from '../types';
import { getHistoricalConsumption } from './db';
import { logAction } from './audit';
import { auth } from './firebase';
import { parseInventoryFile, parseAndSyncPlantFile, resolvePlantId, IngestionSummary } from './inventorySyncService';

export { parseAndSyncPlantFile };

/**
 * Merges datasets from local Firestore and backend, stripping out all duplicates.
 * A spare part is considered duplicate if:
 * 1. It shares the same ID (`id`).
 * 2. It shares the same non-empty, non-placeholder Part Number (`partNumber` / `materialNumber`).
 * 3. It shares the exact same Description (case-insensitive, trimmed) and Factory Location (`factoryId`).
 */
export function mergeAndDeduplicate(localParts: SparePart[], backendParts: SparePart[]): {
  parts: SparePart[];
  removedDuplicatesCount: number;
} {
  // Normalize factoryId on local parts
  const normalizedLocalParts: SparePart[] = localParts.map(p => ({
    ...p,
    factoryId: resolvePlantId(p.factoryId)
  }));

  const merged: SparePart[] = [...normalizedLocalParts]; // Keep all local database parts intact
  const seenIds = new Set<string>();
  const seenPartNumbers = new Set<string>();
  const seenNameAndLocation = new Set<string>();
  let removedDuplicatesCount = 0;

  // Build lookups from local database parts
  normalizedLocalParts.forEach(part => {
    const id = part.id ? String(part.id).trim().toLowerCase() : '';
    const matNum = part.materialNumber ? String(part.materialNumber).trim().toLowerCase() : '';
    const partNum = part.partNumber ? String(part.partNumber).trim().toLowerCase() : '';
    const resolvedFactory = resolvePlantId(part.factoryId).trim().toLowerCase();
    const nameLocKey = part.description
      ? `${part.description.trim().toLowerCase()}||${resolvedFactory}`
      : '';

    if (id) seenIds.add(id);
    if (matNum && matNum !== '-' && matNum !== 'n/a' && matNum !== 'none' && matNum !== '') {
      seenPartNumbers.add(matNum);
    }
    if (partNum && partNum !== '-' && partNum !== 'n/a' && partNum !== 'none' && partNum !== '') {
      seenPartNumbers.add(partNum);
    }
    if (nameLocKey) seenNameAndLocation.add(nameLocKey);
  });

  // Only filter duplicate items from backend parts dataset
  backendParts.forEach(rawPart => {
    const part: SparePart = {
      ...rawPart,
      factoryId: resolvePlantId(rawPart.factoryId)
    };

    const id = part.id ? String(part.id).trim().toLowerCase() : '';
    const matNum = part.materialNumber ? String(part.materialNumber).trim().toLowerCase() : '';
    const partNum = part.partNumber ? String(part.partNumber).trim().toLowerCase() : '';
    const resolvedFactory = part.factoryId.trim().toLowerCase();
    const nameLocKey = part.description
      ? `${part.description.trim().toLowerCase()}||${resolvedFactory}`
      : '';

    let isDuplicate = false;

    // 1. Check ID matching
    if (id && seenIds.has(id)) {
      isDuplicate = true;
    }

    // 2. Check Material / Part Number matching (ignoring placeholders)
    if (!isDuplicate && matNum && matNum !== '-' && matNum !== 'n/a' && matNum !== 'none' && matNum !== '' && seenPartNumbers.has(matNum)) {
      isDuplicate = true;
    }
    if (!isDuplicate && partNum && partNum !== '-' && partNum !== 'n/a' && partNum !== 'none' && partNum !== '' && seenPartNumbers.has(partNum)) {
      isDuplicate = true;
    }

    // 3. Check Exact matching description and factory location
    if (!isDuplicate && nameLocKey && seenNameAndLocation.has(nameLocKey)) {
      isDuplicate = true;
    }

    if (!isDuplicate) {
      merged.push(part);
      if (id) seenIds.add(id);
      if (matNum && matNum !== '-' && matNum !== 'n/a' && matNum !== 'none' && matNum !== '') {
        seenPartNumbers.add(matNum);
      }
      if (partNum && partNum !== '-' && partNum !== 'n/a' && partNum !== 'none' && partNum !== '') {
        seenPartNumbers.add(partNum);
      }
      if (nameLocKey) seenNameAndLocation.add(nameLocKey);
    } else {
      removedDuplicatesCount++;
    }
  });

  return {
    parts: merged,
    removedDuplicatesCount
  };
}

export function getApiUrl(): string {
  const configured = import.meta.env.VITE_API_URL;
  // '/api-backend' only exists on the local Vite dev proxy - never use it in production
  if (configured && configured !== '/api-backend') {
    return String(configured).replace(/\/$/, '');
  }
  if (typeof window !== 'undefined' && window.location) {
    return '';
  }
  return 'http://localhost:3000';
}

const API_URL = getApiUrl();

/** JSON headers plus the signed-in user's Firebase ID token (required by the email APIs). */
async function authJsonHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    const token = await auth.currentUser?.getIdToken();
    if (token) headers['Authorization'] = 'Bearer ' + token;
  } catch (e) { /* not signed in */ }
  return headers;
}

async function fetchWithTimeout(resource: string | URL, options: RequestInit & { timeout?: number } = {}): Promise<Response> {
  const { timeout = 2500, ...restOptions } = options;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(resource, {
      ...restOptions,
      signal: controller.signal
    });
    clearTimeout(id);
    return response;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

/**
 * Uploads an SAP or Oracle inventory Excel file to the client-side sync pipeline.
 *
 * @param file     - The .xlsx / .xls file selected by the user
 * @param plantId  - Target plant / factory ID or key (e.g. "LT", "LWT", "RCL-H", "RCL-E", "Lanka Tiles")
 * @param username - Performer username for audit logging
 * @returns IngestionSummary with counts of added / updated / skipped rows
 */
export async function uploadInventorySync(
  file: File,
  plantId: string,
  username: string
): Promise<IngestionSummary> {
  console.log(`[Inventory Sync] Synchronizing "${file.name}" client-side for plant "${plantId}"…`);
  const result = await parseAndSyncPlantFile(file, plantId, username);

  // Best-effort audit logging
  try {
    await logAction(
      username,
      'UPLOAD',
      'inventory',
      result.plant,
      `Synced items from ${file.name} for ${result.plant}`,
      { userName: username, plantId: result.plant, plantName: result.plant }
    );
  } catch (auditErr) {
    console.warn('[Inventory Sync] Audit log write failed (non-fatal):', auditErr);
  }

  return result;
}

// High-quality mock data for backend fallback when the server is offline or unavailable
export const MOCK_BACKEND_PARTS: SparePart[] = [
  {
    id: 'Lanka Tiles-100201',
    factoryId: 'Lanka Tiles',
    materialNumber: '100201',
    partNumber: 'PN-998822',
    description: 'Ball Bearing 6204 DDU',
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
    partNumber: 'PN-998822', // Duplicate part number with Lanka Tiles-100201
    description: 'Ball Bearing 6204 DDU',
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
    description: 'Temperature Controller E5CC',
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
];

export const MOCK_BACKEND_FACTORIES = [
  { id: 'Lanka Tiles', name: 'Lanka Tiles' },
  { id: 'Lanka Wall Tiles', name: 'Lanka Wall Tiles' },
  { id: 'Rocell Horana', name: 'Rocell Horana' },
  { id: 'Rocell Eheliyagoda', name: 'Rocell Eheliyagoda' }
];

export interface FetchPartsResponse {
  parts: SparePart[];
  source: 'backend' | 'fallback';
}

export interface FetchFactoriesResponse {
  factories: { id: string; name: string }[];
  source: 'backend' | 'fallback';
}

/**
 * Fetches all spare parts from the backend server.
 * Tries endpoint routes '/parts' and '/api/parts' sequentially.
 * Falls back to high-quality mock data if backend server is unreachable.
 */
export async function fetchBackendParts(factoryAffiliation?: string): Promise<FetchPartsResponse> {
  try {
    console.log(`[API] Fetching parts from ${API_URL}/parts...`);
    const headers: Record<string, string> = {};
    if (factoryAffiliation) {
      headers['x-factory-affiliation'] = factoryAffiliation;
    }
    let response = await fetchWithTimeout(`${API_URL}/parts`, { headers, timeout: 5000 });
    if (!response.ok) {
      console.log(`[API] /parts returned ${response.status}, trying /api/parts...`);
      response = await fetchWithTimeout(`${API_URL}/api/parts`, { headers, timeout: 5000 });
    }
    if (response.ok) {
      const data = await response.json();
      return {
        parts: Array.isArray(data) ? data : [],
        source: 'backend'
      };
    }
  } catch (error: any) {
    console.warn(`[API] Express backend parts fetch failed: ${error.message}. Trying public/parts.json static asset fallback...`);
  }

  // Fallback to static parts.json asset
  try {
    console.log(`[API] Fetching parts from static public asset /parts.json...`);
    const response = await fetchWithTimeout(`/parts.json`, { timeout: 25000 });
    if (response.ok) {
      let data = await response.json();
      if (Array.isArray(data)) {
        if (factoryAffiliation) {
          data = data.filter((p: SparePart) => p.factoryId === factoryAffiliation);
        }
        return {
          parts: data,
          source: 'fallback'
        };
      }
    }
  } catch (error: any) {
    console.warn(`[API] Static parts.json fallback fetch failed: ${error.message}. Using fallback mock data.`);
  }

  let parts = MOCK_BACKEND_PARTS;
  if (factoryAffiliation) {
    parts = parts.filter(p => p.factoryId === factoryAffiliation);
  }
  return {
    parts,
    source: 'fallback'
  };
}

/**
 * Fetches factory list from the backend server.
 * Tries endpoint routes '/factories' and '/api/factories' sequentially.
 * Falls back to high-quality mock data if backend server is unreachable.
 */
export async function fetchBackendFactories(): Promise<FetchFactoriesResponse> {
  try {
    console.log(`[API] Fetching factories from ${API_URL}/factories...`);
    let response = await fetchWithTimeout(`${API_URL}/factories`);
    if (!response.ok) {
      console.log(`[API] /factories returned ${response.status}, trying /api/factories...`);
      response = await fetchWithTimeout(`${API_URL}/api/factories`);
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    return {
      factories: Array.isArray(data) ? data : [],
      source: 'backend'
    };
  } catch (error) {
    console.warn(`[API] Backend factories fetch failed. Using fallback mock data. Error:`, error);
    return {
      factories: MOCK_BACKEND_FACTORIES,
      source: 'fallback'
    };
  }
}




/**
 * Fetches historical consumption records from the backend server.
 * Falls back to direct Firestore fetching (which has local seeder) if backend is offline.
 */
export async function fetchHistoricalConsumption(factoryAffiliation?: string): Promise<{
  records: HistoricalConsumptionRecord[];
  source: 'backend' | 'fallback';
}> {
  try {
    console.log(`[API] Fetching historical consumption from ${API_URL}/historical-consumption...`);
    const headers: Record<string, string> = {};
    if (factoryAffiliation) {
      headers['x-factory-affiliation'] = factoryAffiliation;
    }
    let response = await fetchWithTimeout(`${API_URL}/historical-consumption`, { headers });
    if (!response.ok) {
      console.log(`[API] /historical-consumption returned ${response.status}, trying /api/historical-consumption...`);
      response = await fetchWithTimeout(`${API_URL}/api/historical-consumption`, { headers });
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    return {
      records: Array.isArray(data) ? data : [],
      source: 'backend'
    };
  } catch (error) {
    console.warn(`[API] Backend historical consumption fetch failed. Using fallback client database. Error:`, error);
    // Fetch directly from Firestore (which triggers local seeder if empty)
    const localRecords = await getHistoricalConsumption({
      username: '',
      role: 'user',
      approved: true,
      factoryAffiliation
    });
    return {
      records: localRecords,
      source: 'fallback'
    };
  }
}

/**
 * Uploads historical consumption file to the backend server.
 */
export async function uploadHistoricalConsumptionFile(
  file: File,
  performerUsername: string,
  factoryId: string = 'All'
): Promise<{ success: boolean; recordsCount: number; message: string }> {
  console.log(`[API] Uploading historical consumption file to ${API_URL}/api/import-history...`);
  
  const formData = new FormData();
  formData.append('file', file);
  formData.append('username', performerUsername);
  formData.append('factoryId', factoryId);

  let response = await fetch(`${API_URL}/api/import-history`, {
    method: 'POST',
    body: formData
  });

  if (!response.ok) {
    console.log(`[API] /api/import-history returned ${response.status}, trying /import-history...`);
    response = await fetch(`${API_URL}/import-history`, {
      method: 'POST',
      body: formData
    });
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `HTTP error! status: ${response.status}`);
  }

  return await response.json();
}

/**
 * Sends an email notification by calling the backend /api/send-email endpoint.
 */
export async function sendEmailNotification(emailData: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}): Promise<{ success: boolean; message?: string }> {
  try {
    const API_URL = getApiUrl();
    console.log(`[Email Service] Sending notification to: ${emailData.to}`);
    const response = await fetch(`${API_URL}/api/send-email`, {
      method: 'POST',
      headers: await authJsonHeaders(),
      body: JSON.stringify(emailData),
    });
    
    let resolvedResponse = response;
    if (!resolvedResponse.ok && resolvedResponse.status === 404) {
      resolvedResponse = await fetch(`${API_URL}/send-email`, {
        method: 'POST',
        headers: await authJsonHeaders(),
        body: JSON.stringify(emailData),
      });
    }

    if (!resolvedResponse.ok) {
      const errBody = await resolvedResponse.json().catch(() => ({} as any));
      throw new Error(errBody.message || `Server returned status: ${resolvedResponse.status}`);
    }

    return await resolvedResponse.json();
  } catch (error) {
    console.warn(`[Email Service] Failed to send email notification to ${emailData.to}. Error:`, error);
    return { success: false, message: String(error) };
  }
}

/**
 * Notifies the backend that a new order has been created.
 * Triggers the OrderCreated backend event and runs the background email job.
 */
export async function notifyOrderCreated(eventData: {
  order: any;
  userEmail: string;
  plantEmail: string;
  userFactory: string;
}): Promise<{ success: boolean; message?: string }> {
  try {
    const API_URL = getApiUrl();
    console.log(`[API Service] Notifying backend of OrderCreated for order: ${eventData.order.id}`);
    
    let response = await fetch(`${API_URL}/api/orders/created`, {
      method: 'POST',
      headers: await authJsonHeaders(),
      body: JSON.stringify(eventData),
    });

    if (!response.ok && response.status === 404) {
      response = await fetch(`${API_URL}/api/orders-created`, {
        method: 'POST',
        headers: await authJsonHeaders(),
        body: JSON.stringify(eventData),
      });
    }

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({} as any));
      throw new Error(errBody.message || `Server returned status: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.warn(`[API Service] Failed to notify backend of OrderCreated event. Error:`, error);
    if (typeof window !== 'undefined') {
      window.alert('Your order was saved, but the request email could not be sent.\n\n' + ((error as any)?.message || String(error)) + '\n\nPlease inform the supplying plant or the portal admin.');
    }
    return { success: false, message: String(error) };
  }
}

/**
 * Notifies the backend that an order status has been updated (e.g. approved, delivered, rejected).
 */
export async function notifyOrderStatusUpdated(eventData: {
  order: any;
  item?: any;
  status: string;
  performerUsername: string;
}): Promise<{ success: boolean; message?: string }> {
  try {
    const API_URL = getApiUrl();
    console.log(`[API Service] Notifying backend of OrderStatusUpdated for order: ${eventData.order.id}`);

    let response = await fetch(`${API_URL}/api/orders/status-updated`, {
      method: 'POST',
      headers: await authJsonHeaders(),
      body: JSON.stringify(eventData),
    });

    if (!response.ok && response.status === 404) {
      response = await fetch(`${API_URL}/orders/status-updated`, {
        method: 'POST',
        headers: await authJsonHeaders(),
        body: JSON.stringify(eventData),
      });
    }

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({} as any));
      throw new Error(errBody.message || `Server returned status: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.warn(`[API Service] Failed to notify backend of OrderStatusUpdated event. Error:`, error);
    return { success: false, message: String(error) };
  }
}


// ---------------------------------------------------------------------------
// Inventory Sync Upload — SAP & Oracle auto-detect endpoint
// ---------------------------------------------------------------------------

export type { IngestionSummary };



