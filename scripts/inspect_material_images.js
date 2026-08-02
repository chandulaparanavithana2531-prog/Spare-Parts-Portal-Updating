import fs from 'fs';
import path from 'path';

const mappingPath = path.join(process.cwd(), 'material_images.json');
if (fs.existsSync(mappingPath)) {
  const mapping = JSON.parse(fs.readFileSync(mappingPath, 'utf8'));
  const keys = Object.keys(mapping);
  console.log(`Total image mappings: ${keys.length}`);
  console.log('Sample mappings (first 10):');
  keys.slice(0, 10).forEach(k => {
    console.log(`  ${k} => ${mapping[k]}`);
  });
} else {
  console.log('material_images.json not found');
}
