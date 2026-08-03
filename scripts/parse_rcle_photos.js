import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';

const rcleFilePath = path.join(process.cwd(), 'rcle_responses_temp.xlsx');
const imagesMapPath = path.join(process.cwd(), 'material_images.json');

const getDirectDriveLink = (url) => {
  if (!url) return null;
  let id = '';
  // Check open?id= format
  if (url.includes('id=')) {
    const match = url.match(/[?&]id=([^&]+)/);
    if (match) id = match[1];
  } else {
    // Check d/ format
    const parts = url.split('/');
    const dIndex = parts.indexOf('d');
    if (dIndex !== -1 && parts.length > dIndex + 1) {
      id = parts[dIndex + 1];
    }
  }
  if (!id) return null;
  id = id.trim().split(/[&?]/)[0];
  return `https://lh3.googleusercontent.com/d/${id}`;
};

function parseRclePhotos() {
  if (!fs.existsSync(rcleFilePath)) {
    console.error('rcle_responses_temp.xlsx not found!');
    return;
  }
  
  let materialImagesMap = {};
  if (fs.existsSync(imagesMapPath)) {
    materialImagesMap = JSON.parse(fs.readFileSync(imagesMapPath, 'utf8'));
  }
  
  const workbook = XLSX.read(rcleFilePath, { type: 'file' });
  const tabs = ['Movindu', 'Arushan'];
  
  let addedCount = 0;
  let skippedCount = 0;
  
  tabs.forEach(tab => {
    const sheet = workbook.Sheets[tab];
    if (!sheet) {
      console.warn(`Sheet ${tab} not found!`);
      return;
    }
    
    const rows = XLSX.utils.sheet_to_json(sheet);
    console.log(`Processing tab: ${tab} (${rows.length} rows)`);
    
    rows.forEach((row, idx) => {
      // Find key for Material No
      const matKey = Object.keys(row).find(k => k.toLowerCase().includes('material'));
      const imgKey = Object.keys(row).find(k => k.toLowerCase().includes('image'));
      
      if (!matKey || !imgKey) return;
      
      const rawMat = row[matKey];
      const rawImg = row[imgKey];
      
      if (!rawMat || !rawImg) return;
      
      const materialNumber = String(rawMat).trim();
      const rawImgString = String(rawImg).trim();
      
      // Split the image string by newlines, spaces, or commas
      const rawUrls = rawImgString.split(/[\r\n\s,]+/);
      const normalizedUrls = rawUrls
        .map(url => getDirectDriveLink(url.trim()))
        .filter(url => url !== null);
      
      if (normalizedUrls.length > 0) {
        const imageString = normalizedUrls.join(' ');
        materialImagesMap[materialNumber] = imageString;
        addedCount++;
      } else {
        skippedCount++;
      }
    });
  });
  
  console.log(`Successfully parsed RCL-E photos: Added/Updated: ${addedCount}, Skipped/No Link: ${skippedCount}`);
  
  // Write back to material_images.json
  fs.writeFileSync(imagesMapPath, JSON.stringify(materialImagesMap, null, 2), 'utf8');
  console.log(`Saved updated image mappings to ${imagesMapPath} (Total keys: ${Object.keys(materialImagesMap).length})`);
}

parseRclePhotos();
