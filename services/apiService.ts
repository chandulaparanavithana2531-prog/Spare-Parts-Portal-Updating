import { SparePart, HistoricalConsumptionRecord } from '../types';
import { getHistoricalConsumption } from './db';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

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
export async function fetchBackendParts(): Promise<FetchPartsResponse> {
  try {
    console.log(`[API] Fetching parts from ${API_URL}/parts...`);
    let response = await fetch(`${API_URL}/parts`);
    if (!response.ok) {
      console.log(`[API] /parts returned ${response.status}, trying /api/parts...`);
      response = await fetch(`${API_URL}/api/parts`);
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    return {
      parts: Array.isArray(data) ? data : [],
      source: 'backend'
    };
  } catch (error) {
    console.warn(`[API] Backend parts fetch failed. Using fallback mock data. Error:`, error);
    return {
      parts: MOCK_BACKEND_PARTS,
      source: 'fallback'
    };
  }
}

/**
 * Fetches factory list from the backend server.
 * Tries endpoint routes '/factories' and '/api/factories' sequentially.
 * Falls back to high-quality mock data if backend server is unreachable.
 */
export async function fetchBackendFactories(): Promise<FetchFactoriesResponse> {
  try {
    console.log(`[API] Fetching factories from ${API_URL}/factories...`);
    let response = await fetch(`${API_URL}/factories`);
    if (!response.ok) {
      console.log(`[API] /factories returned ${response.status}, trying /api/factories...`);
      response = await fetch(`${API_URL}/api/factories`);
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
 * Merges datasets from local Firestore and backend, stripping out all duplicates.
 * A spare part is considered duplicate if:
 * 1. It shares the same ID (`id`).
 * 2. It shares the same non-empty, non-placeholder Part Number (`partNumber`).
 * 3. It shares the exact same Description (case-insensitive, trimmed) and Factory Location (`factoryId`).
 */
export function mergeAndDeduplicate(localParts: SparePart[], backendParts: SparePart[]): {
  parts: SparePart[];
  removedDuplicatesCount: number;
} {
  const merged: SparePart[] = [...localParts]; // Keep all local database parts intact
  const seenIds = new Set<string>();
  const seenPartNumbers = new Set<string>();
  const seenNameAndLocation = new Set<string>();
  let removedDuplicatesCount = 0;

  // Build lookups from local database parts
  localParts.forEach(part => {
    const id = part.id ? String(part.id).trim() : '';
    const partNum = part.partNumber ? String(part.partNumber).trim().toLowerCase() : '';
    const nameLocKey = part.description && part.factoryId
      ? `${part.description.trim().toLowerCase()}||${part.factoryId.trim().toLowerCase()}`
      : '';

    if (id) seenIds.add(id);
    if (partNum && partNum !== '-' && partNum !== 'n/a' && partNum !== 'none' && partNum !== '') {
      seenPartNumbers.add(partNum);
    }
    if (nameLocKey) seenNameAndLocation.add(nameLocKey);
  });

  // Only filter duplicate items from backend parts dataset
  backendParts.forEach(part => {
    const id = part.id ? String(part.id).trim() : '';
    const partNum = part.partNumber ? String(part.partNumber).trim().toLowerCase() : '';
    const nameLocKey = part.description && part.factoryId
      ? `${part.description.trim().toLowerCase()}||${part.factoryId.trim().toLowerCase()}`
      : '';

    let isDuplicate = false;

    // 1. Check ID matching
    if (id && seenIds.has(id)) {
      isDuplicate = true;
    }

    // 2. Check Part Number matching (ignoring placeholders)
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
      if (partNum && partNum !== '-' && partNum !== 'n/a' && partNum !== 'none' && partNum !== '') {
        seenPartNumbers.add(partNum);
      }
      if (nameLocKey) seenNameAndLocation.add(nameLocKey);
    } else {
      removedDuplicatesCount++;
      console.log(`[Deduplication] Stripped out duplicate backend entry: "${part.description}" (ID: ${part.id || 'N/A'}, PartNo: ${part.partNumber || 'N/A'}, Factory: ${part.factoryId})`);
    }
  });

  return {
    parts: merged,
    removedDuplicatesCount
  };
}

/**
 * Fetches historical consumption records from the backend server.
 * Falls back to direct Firestore fetching (which has local seeder) if backend is offline.
 */
export async function fetchHistoricalConsumption(): Promise<{
  records: HistoricalConsumptionRecord[];
  source: 'backend' | 'fallback';
}> {
  try {
    console.log(`[API] Fetching historical consumption from ${API_URL}/historical-consumption...`);
    let response = await fetch(`${API_URL}/historical-consumption`);
    if (!response.ok) {
      console.log(`[API] /historical-consumption returned ${response.status}, trying /api/historical-consumption...`);
      response = await fetch(`${API_URL}/api/historical-consumption`);
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
    const localRecords = await getHistoricalConsumption();
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
    const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
    console.log(`[Email Service] Sending notification to: ${emailData.to}`);
    const response = await fetch(`${API_URL}/api/send-email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(emailData),
    });
    
    let resolvedResponse = response;
    if (!resolvedResponse.ok && resolvedResponse.status === 404) {
      resolvedResponse = await fetch(`${API_URL}/send-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(emailData),
      });
    }

    if (!resolvedResponse.ok) {
      throw new Error(`Server returned status: ${resolvedResponse.status}`);
    }

    return await resolvedResponse.json();
  } catch (error) {
    console.warn(`[Email Service] Failed to send email notification to ${emailData.to}. Fallback to console log. Error:`, error);
    return { success: false, message: String(error) };
  }
}

