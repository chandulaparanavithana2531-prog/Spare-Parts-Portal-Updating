import fs from 'fs';
import path from 'path';

const src = path.join(process.cwd(), 'db.json');
const dest = path.join(process.cwd(), 'public', 'parts.json');

function run() {
  if (!fs.existsSync(src)) {
    console.error(`Source file ${src} not found!`);
    return;
  }
  console.log(`Reading database from ${src}...`);
  const data = JSON.parse(fs.readFileSync(src, 'utf8'));
  console.log(`Read ${data.length} items.`);
  
  console.log(`Writing minified database to ${dest}...`);
  fs.writeFileSync(dest, JSON.stringify(data));
  const stats = fs.statSync(dest);
  console.log(`Successfully wrote public/parts.json. File size: ${(stats.size / (1024 * 1024)).toFixed(2)} MB`);
}

run();
