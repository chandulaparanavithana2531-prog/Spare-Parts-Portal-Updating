import * as XLSX from 'xlsx';
import { SparePart } from '../types';
import materialImages from '../material_images.json';

// Helper to normalize keys slightly to handle case variations
const normalizeKey = (key: string): string => key.trim().toLowerCase();

// Helper to extract Drive ID and create direct link
const getDirectDriveLink = (url: string): string | null => {
  if (!url) return null;
  let id = '';
  const parts = url.split('/');

  // Case 1: /file/d/ID/view
  const dIndex = parts.indexOf('d');
  if (dIndex !== -1 && parts.length > dIndex + 1) {
    id = parts[dIndex + 1];
  } else {
    // Case 2: id=ID param
    const match = url.match(/[?&]id=([^&]+)/);
    if (match) {
      id = match[1];
    }
  }

  if (!id) return null;

  // Use reliable direct image CDN format
  return `https://lh3.googleusercontent.com/d/${id}`;
};

export interface ExcelParseResult {
  parts: SparePart[];
  metadata: {
    totalRows: number;
    validItems: number;
    filteredItems: number;
    duplicateIds: number;
    totalCollisions: number;
    factoryId: string;
    fileName: string;
  };
}

export const parseExcelFile = async (file: File, factoryId: string): Promise<ExcelParseResult> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];

        const rawArray = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];

        let headerRowIndex = 0;
        const keyColumns = ['material', 'part', 'description', 'stock', 'qty', 'value', 'price', 'cost', 'on hand', 'item code', 'criticality', 'priority'];

        for (let i = 0; i < Math.min(20, rawArray.length); i++) {
          const rowStr = rawArray[i].map(cell => String(cell).toLowerCase()).join(' ');
          let matchCount = 0;
          keyColumns.forEach(key => {
            if (rowStr.includes(key)) matchCount++;
          });

          if (matchCount >= 2) {
            headerRowIndex = i;
            break;
          }
        }

        const rawRows = XLSX.utils.sheet_to_json(worksheet, { range: headerRowIndex }) as any[];
        
        const idCounts: Record<string, number> = {};
        let filteredCount = 0;

        const parts: SparePart[] = rawRows.map((row) => {
          const getVal = (keys: string[]) => {
            for (const k of keys) {
              if (row[k] !== undefined) return row[k];
              const foundKey = Object.keys(row).find(rk => rk.toLowerCase() === k.trim().toLowerCase());
              if (foundKey) return row[foundKey];
            }
            return null;
          };

          const parseNum = (val: any) => {
            if (typeof val === 'number') return val;
            if (typeof val === 'string') {
              const clean = val.replace(/[^0-9.-]/g, '');
              return parseFloat(clean) || 0;
            }
            return 0;
          };

          let materialNumber = getVal(['Material Number', 'Material No', 'Item Code', 'Code', 'Material Code', 'Mat No', 'Item No', 'Material', 'Stock Code']);
          let partNumber = getVal(['Part Number', 'Part No', 'PartNo', 'Ref No', 'Part Code', 'Manufacturer Part No']);

          if (!materialNumber && partNumber) materialNumber = partNumber;
          if (!partNumber && materialNumber) partNumber = materialNumber;

          if (!materialNumber) {
            filteredCount++;
            return null;
          }

          const description = getVal(['Description', 'Item Description', 'Material Description', 'Item Name', 'Desc']) || 'No Description';
          const onHand = parseNum(getVal(['On hand', 'On Hand Qty', 'Stock', 'Current Stock', 'Quantity', 'Qty', 'Closing Stock', 'Physical Stock', 'Unrestricted', 'Total Stock', 'Stk Qty']));
          let unitCost = parseNum(getVal(['Unit Cost', 'Avg Cost', 'Unit Value', 'Rate', 'Price', 'Standard Cost', 'Cost', 'W.Avg.Cost', 'Unit Price', 'Moving Price', 'MAP', 'Unit Rate']));
          let totalValue = parseNum(getVal(['Total Value', 'Value', 'Total Amount', 'Amount', 'Stock Value', 'Inventory Value', 'Total', 'Total Cost', 'Gross Value', 'Net Value']));

          if (totalValue > 0 && unitCost === 0 && onHand > 0) {
            unitCost = totalValue / onHand;
          } else if (unitCost > 0 && totalValue === 0) {
            totalValue = unitCost * onHand;
          } else if (totalValue === 0 && unitCost > 0 && onHand > 0) {
            totalValue = unitCost * onHand;
          }

          const safeId = `${factoryId}-${materialNumber}`.replace(/[^a-zA-Z0-9-_]/g, '');
          idCounts[safeId] = (idCounts[safeId] || 0) + 1;

          // Extract all image links from columns matching image patterns (including numbered columns like Image Link 1, 2, 3)
          const imageKeys = Object.keys(row).filter(rk => {
            const k = rk.toLowerCase().trim();
            return k.startsWith('image') || k.startsWith('drive link') || k.startsWith('photo') || k.startsWith('picture');
          });

          let processedImageUrl: string | null = null;
          const collectedLinks: string[] = [];

          imageKeys.forEach(k => {
            const val = row[k];
            if (val && String(val).trim().toUpperCase() !== '#N/A') {
              const valStr = String(val).trim();
              const links = valStr.match(/https:\/\/[^\s,]+/g);
              if (links && links.length > 0) {
                links.forEach(l => {
                  const dl = getDirectDriveLink(l);
                  if (dl) collectedLinks.push(dl);
                  else collectedLinks.push(l);
                });
              } else if (valStr.startsWith('http')) {
                const dl = getDirectDriveLink(valStr);
                if (dl) collectedLinks.push(dl);
                else collectedLinks.push(valStr);
              }
            }
          });

          if (collectedLinks.length > 0) {
            processedImageUrl = collectedLinks.join(' ');
          }

          if (!processedImageUrl) {
            const matStr = String(materialNumber).trim();
            if (materialImages[matStr as keyof typeof materialImages]) {
              processedImageUrl = materialImages[matStr as keyof typeof materialImages];
            }
          }

          const part: SparePart = {
            id: safeId,
            factoryId: factoryId,
            materialNumber: String(materialNumber),
            partNumber: String(partNumber),
            description: String(description),
            qtyMoreThan3Years: parseNum(getVal(['More Than 3 Years', 'Qty > 3 Years'])),
            valueMoreThan3Years: parseNum(getVal(['Over 3 Year Value', 'Value > 3 Years'])),
            onHand: onHand,
            unitCost: unitCost,
            totalValue: totalValue,
            spareType: String(getVal(['Spare Type', 'Type', 'S.Type']) || 'General'),
            categoryName: String(getVal(['Sub Category', 'SubCategory', 'Category Name', 'Category', 'Item Category', 'Mat. Group', 'Material Group']) || '-'),
            machine: String(getVal(['Machine Name', 'Machine', 'Equipment Name', 'Equipment', 'Machinery Name', 'Machinery']) || '-'),
            criticality: String(getVal(['Criticality', 'Priority', 'Crit']) || '-'),
          };

          if (processedImageUrl) part.imageUrl = processedImageUrl;

          return part;
        }).filter(item => item !== null) as SparePart[];

        const duplicateCount = Object.values(idCounts).filter(c => c > 1).length;
        const totalCollisions = Object.values(idCounts).reduce((acc, c) => acc + (c > 1 ? c - 1 : 0), 0);

        resolve({
          parts,
          metadata: {
            totalRows: rawRows.length,
            validItems: parts.length,
            filteredItems: filteredCount,
            duplicateIds: duplicateCount,
            totalCollisions: totalCollisions,
            factoryId,
            fileName: file.name
          }
        });
      } catch (error) {
        reject(error);
      }
    };

    reader.onerror = (error) => reject(error);
    reader.readAsArrayBuffer(file);
  });
};

export interface SystemReportParseResult {
  reportType: 'SAP_MB52' | 'SAP_MB51' | 'ORACLE_SUBINVENTORY' | 'ORACLE_TRANSACTION';
  factoryId: string;
  updatedParts: Partial<SparePart>[];
  metadata: {
    totalRows: number;
    validItems: number;
    factoryId: string;
    system: 'SAP' | 'Oracle';
    reportName: string;
  };
}

/**
 * Parses daily system reports generated by SAP or Oracle inventory modules.
 * Extracted data elements map to SparePart updates (stock corrections or consumption values).
 */
export const parseSystemReport = async (
  file: File,
  factoryId: string,
  system: 'SAP' | 'Oracle',
  reportType: string
): Promise<SystemReportParseResult> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];

        const rawRows = XLSX.utils.sheet_to_json(worksheet) as any[];
        const updatedParts: Partial<SparePart>[] = [];

        rawRows.forEach((row) => {
          // Case-insensitive key lookup helper
          const getVal = (keys: string[]) => {
            for (const k of keys) {
              if (row[k] !== undefined) return row[k];
              const foundKey = Object.keys(row).find(rk => rk.toLowerCase() === k.trim().toLowerCase());
              if (foundKey) return row[foundKey];
            }
            return null;
          };

          const parseNum = (val: any) => {
            if (typeof val === 'number') return val;
            if (typeof val === 'string') {
              const clean = val.replace(/[^0-9.-]/g, '');
              return parseFloat(clean) || 0;
            }
            return 0;
          };

          if (system === 'SAP') {
            if (reportType === 'MB52') {
              // SAP MB52 Stock Report: extracts material, description, quantity unrestricted, value unrestricted
              const materialNumber = getVal(['Material', 'Material No', 'Article', 'Material Number']);
              if (materialNumber) {
                const onHand = parseNum(getVal(['Unrestricted', 'Stock', 'Value Unrestricted', 'Quantity', 'Qty', 'Unrestricted Use']));
                const totalValue = parseNum(getVal(['Value Unrestricted', 'Total Value', 'Amount', 'Value Unrestricted Use']));
                const description = getVal(['Material Description', 'Description', 'Item Description']) || 'SAP Spare Part';
                const unitCost = onHand > 0 ? totalValue / onHand : 0;

                updatedParts.push({
                  id: `${factoryId}-${materialNumber}`.replace(/[^a-zA-Z0-9-_]/g, ''),
                  factoryId,
                  materialNumber: String(materialNumber),
                  description: String(description),
                  onHand,
                  unitCost,
                  totalValue,
                  partNumber: String(materialNumber),
                  spareType: 'General',
                  categoryName: '-',
                  machine: '-',
                  criticality: '-'
                });
              }
            } else if (reportType === 'MB51') {
              // SAP MB51 Daily Consumption: extracts material and movement quantity
              const materialNumber = getVal(['Material', 'Material No', 'Article']);
              if (materialNumber) {
                const qty = parseNum(getVal(['Quantity', 'Qty', 'Qty in Un. of Entry']));
                updatedParts.push({
                  id: `${factoryId}-${materialNumber}`.replace(/[^a-zA-Z0-9-_]/g, ''),
                  materialNumber: String(materialNumber),
                  qtyMoreThan3Years: Math.abs(qty) // Temporarily load transaction qty in qtyMoreThan3Years for db update
                });
              }
            }
          } else if (system === 'Oracle') {
            if (reportType === 'SUBINVENTORY') {
              // Oracle Subinventory Quantity: extracts item, description, primary/onhand quantity
              const itemCode = getVal(['Item', 'Item Code', 'Inventory Item']);
              if (itemCode) {
                const onHand = parseNum(getVal(['On-Hand Quantity', 'Primary Quantity', 'Quantity', 'OnHand']));
                const description = getVal(['Description', 'Item Description']) || 'Oracle Spare Part';

                updatedParts.push({
                  id: `${factoryId}-${itemCode}`.replace(/[^a-zA-Z0-9-_]/g, ''),
                  factoryId,
                  materialNumber: String(itemCode),
                  description: String(description),
                  onHand,
                  partNumber: String(itemCode),
                  spareType: 'General',
                  categoryName: '-',
                  machine: '-',
                  criticality: '-'
                });
              }
            } else if (reportType === 'TRANSACTION') {
              // Oracle Material Transaction: extracts item code and daily issue quantity
              const itemCode = getVal(['Item', 'Item Code', 'Inventory Item']);
              if (itemCode) {
                const qty = parseNum(getVal(['Transaction Quantity', 'Quantity', 'Qty']));
                updatedParts.push({
                  id: `${factoryId}-${itemCode}`.replace(/[^a-zA-Z0-9-_]/g, ''),
                  materialNumber: String(itemCode),
                  qtyMoreThan3Years: Math.abs(qty)
                });
              }
            }
          }
        });

        resolve({
          reportType: (system === 'SAP' ? `SAP_${reportType}` : `ORACLE_${reportType}`) as any,
          factoryId,
          updatedParts,
          metadata: {
            totalRows: rawRows.length,
            validItems: updatedParts.length,
            factoryId,
            system,
            reportName: file.name
          }
        });
      } catch (error) {
        reject(error);
      }
    };

    reader.onerror = (error) => reject(error);
    reader.readAsArrayBuffer(file);
  });
};