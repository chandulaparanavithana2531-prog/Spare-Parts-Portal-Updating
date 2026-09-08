import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';

const DEFAULT_SPREADSHEET_ID = '1EzsyACHF2VPOmP_oXYrTmZ-dV7F3XMQjOn1Qh0ocfJc';

/**
 * Get Google Sheets API client using Service Account credentials from environment.
 */
function getGoogleSheetsClient() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  let privateKey = process.env.GOOGLE_PRIVATE_KEY;

  if (!email || !privateKey) {
    console.warn('[GoogleSheets] Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_PRIVATE_KEY in environment variables.');
    return null;
  }

  // Handle escaped line breaks in private key string
  if (privateKey) {
    privateKey = privateKey.replace(/\\n/g, '\n');
  }

  const auth = new google.auth.JWT({
    email,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  return google.sheets({ version: 'v4', auth });
}

/**
 * Synchronize inventory items from a portal ERP report upload directly into the Master Google Sheet.
 * Updates existing item rows and appends new item rows under the matching plant tab.
 * 
 * @param {string} plantName - Target plant (e.g. "Lanka Tiles", "Lanka Wall Tiles", "Rocell Horana", "Rocell Eheliyagoda")
 * @param {Array} items - Array of normalized SparePart items to sync
 * @returns {Promise<{ sheetRowsUpdated: number, sheetNewRowsAppended: number, warning?: string }>}
 */
export async function syncPortalReportToSheet(plantName, items) {
  if (!items || items.length === 0) {
    return { sheetRowsUpdated: 0, sheetNewRowsAppended: 0 };
  }

  const sheets = getGoogleSheetsClient();
  const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID || DEFAULT_SPREADSHEET_ID;

  if (!sheets) {
    console.warn('[GoogleSheets] Service account credentials not provided. Skipping Google Sheet sync.');
    return {
      sheetRowsUpdated: 0,
      sheetNewRowsAppended: 0,
      warning: 'Google Sheets Service Account credentials (GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY) not configured.'
    };
  }

  try {
    console.log(`[GoogleSheets] Fetching existing rows for sheet "${plantName}"...`);
    
    // Fetch existing values in plant tab
    let response;
    try {
      response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${plantName}'!A:Z`,
      });
    } catch (fetchErr) {
      console.warn(`[GoogleSheets] Could not fetch sheet "${plantName}": ${fetchErr.message}`);
      return {
        sheetRowsUpdated: 0,
        sheetNewRowsAppended: 0,
        warning: `Could not access plant sheet "${plantName}": ${fetchErr.message}`
      };
    }

    const rows = response.data.values || [];
    if (rows.length === 0) {
      console.warn(`[GoogleSheets] Sheet "${plantName}" appears empty or missing rows.`);
    }

    // Determine column mapping by scanning header (row 0)
    let itemCodeIdx = 0;
    let descIdx = 1;
    let categoryIdx = 2;
    let qtyIdx = 3;
    let uomIdx = 4;
    let unitCostIdx = 5;
    let totalValueIdx = 6;
    let dateIdx = 7;

    if (rows.length > 0) {
      const header = rows[0].map(h => (h || '').toString().toLowerCase().trim());
      header.forEach((colName, i) => {
        if (colName.includes('material') || colName.includes('code') || colName.includes('part no') || colName.includes('sku')) itemCodeIdx = i;
        else if (colName.includes('description') || colName.includes('name')) descIdx = i;
        else if (colName.includes('category') || colName.includes('type')) categoryIdx = i;
        else if (colName.includes('qty') || colName.includes('hand') || colName.includes('quantity')) qtyIdx = i;
        else if (colName.includes('uom') || colName.includes('unit')) uomIdx = i;
        else if (colName.includes('cost') || colName.includes('price')) unitCostIdx = i;
        else if (colName.includes('value') || colName.includes('valuation')) totalValueIdx = i;
        else if (colName.includes('date') || colName.includes('update')) dateIdx = i;
      });
    }

    // Index existing item codes -> 1-based row index in Google Sheet
    const itemRowMap = new Map();
    for (let r = 1; r < rows.length; r++) {
      const code = (rows[r][itemCodeIdx] || '').toString().trim();
      if (code) {
        itemRowMap.set(code, r + 1); // 1-based index
      }
    }

    const valueUpdates = [];
    const newRowsToAppend = [];
    const currentDateStr = new Date().toISOString().split('T')[0];

    let sheetRowsUpdated = 0;
    let sheetNewRowsAppended = 0;

    for (const item of items) {
      const itemCode = (item.materialNumber || item.partNumber || item.id || '').toString().trim();
      if (!itemCode) continue;

      if (itemRowMap.has(itemCode)) {
        const rowNum = itemRowMap.get(itemCode);
        
        // Update Quantity, Unit Cost, Total Value, Updated Date
        valueUpdates.push({
          range: `'${plantName}'!D${rowNum}:H${rowNum}`,
          values: [[
            item.onHand || 0,
            'NOS',
            item.unitCost || 0,
            item.totalValue || ((item.unitCost || 0) * (item.onHand || 0)),
            currentDateStr
          ]]
        });
        sheetRowsUpdated++;
      } else {
        // Prepare new row array
        const newRow = [];
        newRow[itemCodeIdx] = itemCode;
        newRow[descIdx] = item.description || '';
        newRow[categoryIdx] = item.categoryName || item.spareType || 'General';
        newRow[qtyIdx] = item.onHand || 0;
        newRow[uomIdx] = 'NOS';
        newRow[unitCostIdx] = item.unitCost || 0;
        newRow[totalValueIdx] = item.totalValue || ((item.unitCost || 0) * (item.onHand || 0));
        newRow[dateIdx] = currentDateStr;

        // Fill any undefined gaps with empty strings
        const maxIdx = Math.max(itemCodeIdx, descIdx, categoryIdx, qtyIdx, uomIdx, unitCostIdx, totalValueIdx, dateIdx);
        for (let i = 0; i <= maxIdx; i++) {
          if (newRow[i] === undefined) newRow[i] = '';
        }

        newRowsToAppend.push(newRow);
        sheetNewRowsAppended++;
      }
    }

    // ── Execute Batch Updates (Chunked in 500s) ──
    const BATCH_SIZE = 500;
    if (valueUpdates.length > 0) {
      console.log(`[GoogleSheets] Executing batch updates for ${valueUpdates.length} existing items in "${plantName}"...`);
      for (let i = 0; i < valueUpdates.length; i += BATCH_SIZE) {
        const chunk = valueUpdates.slice(i, i + BATCH_SIZE);
        await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId,
          requestBody: {
            valueInputOption: 'USER_ENTERED',
            data: chunk
          }
        });
      }
    }

    // ── Execute Appends (Chunked in 500s) ──
    if (newRowsToAppend.length > 0) {
      console.log(`[GoogleSheets] Appending ${newRowsToAppend.length} new items to "${plantName}"...`);
      for (let i = 0; i < newRowsToAppend.length; i += BATCH_SIZE) {
        const chunk = newRowsToAppend.slice(i, i + BATCH_SIZE);
        await sheets.spreadsheets.values.append({
          spreadsheetId,
          range: `'${plantName}'!A:H`,
          valueInputOption: 'USER_ENTERED',
          insertDataOption: 'INSERT_ROWS',
          requestBody: {
            values: chunk
          }
        });
      }
    }

    console.log(`[GoogleSheets] Sync finished for "${plantName}": ${sheetRowsUpdated} updated, ${sheetNewRowsAppended} appended.`);
    return { sheetRowsUpdated, sheetNewRowsAppended };

  } catch (err) {
    console.error(`[GoogleSheets Error] Sync failed for "${plantName}":`, err.message);
    return {
      sheetRowsUpdated: 0,
      sheetNewRowsAppended: 0,
      warning: `Google Sheets sync failed: ${err.message}`
    };
  }
}

/**
 * Download and parse all plant tabs from Master Google Spreadsheet to update portal inventory.
 */
export async function syncFromSheetToPortal() {
  const { exec } = await import('child_process');
  return new Promise((resolve, reject) => {
    exec('node scripts/sync_db.js', (error, stdout, stderr) => {
      if (error) {
        console.error(`[GoogleSheets Sync Error]: ${error.message}`);
        return reject(error);
      }
      console.log(`[GoogleSheets Sync Success]: Portal database updated from Master Google Spreadsheet.`);
      resolve({ stdout, stderr });
    });
  });
}
