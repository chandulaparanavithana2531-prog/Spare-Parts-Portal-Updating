import fs from 'fs';
import path from 'path';

const filepath = path.join(process.cwd(), 'db.json');

function inspectFsn() {
  if (!fs.existsSync(filepath)) {
    console.error('db.json not found!');
    return;
  }
  const data = JSON.parse(fs.readFileSync(filepath, 'utf8'));
  console.log(`Total items: ${data.length}`);
  
  const fsnCounts = {};
  const fsnFields = new Set();
  
  data.forEach(item => {
    Object.keys(item).forEach(k => {
      if (k.toLowerCase().includes('fsn') || k.toLowerCase().includes('class')) {
        fsnFields.add(k);
      }
    });
    
    // Check possible FSN fields
    const fsnVal = item.fsn || item.FSN || item.fsnClassification || item.FSN_Classification || item.classification;
    if (fsnVal) {
      if (!fsnCounts[fsnVal]) fsnCounts[fsnVal] = 0;
      fsnCounts[fsnVal]++;
    }
  });
  
  console.log('FSN related fields found in items:', Array.from(fsnFields));
  console.log('FSN values count:', fsnCounts);
  
  // Show a few items with FSN values
  const examples = data.filter(item => item.fsn || item.FSN || item.fsnClassification || item.FSN_Classification).slice(0, 5);
  console.log('Examples with FSN:', examples.map(e => ({ id: e.id, fsn: e.fsn || e.FSN || e.fsnClassification || e.FSN_Classification })));
}

inspectFsn();
