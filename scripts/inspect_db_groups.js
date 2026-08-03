import fs from 'fs';
import path from 'path';

const filepath = path.join(process.cwd(), 'db.json');

function inspectDb() {
  if (!fs.existsSync(filepath)) {
    console.error('db.json not found!');
    return;
  }
  const data = JSON.parse(fs.readFileSync(filepath, 'utf8'));
  console.log(`Total items in db.json: ${data.length}`);
  
  const groups = {};
  data.forEach(item => {
    const factory = item.factoryId || 'Unknown';
    if (!groups[factory]) {
      groups[factory] = { count: 0, totalQty: 0, totalValue: 0 };
    }
    groups[factory].count++;
    groups[factory].totalQty += item.onHand || 0;
    groups[factory].totalValue += item.totalValue || 0;
  });
  
  console.log('\nGrouped by factoryId in db.json:');
  console.log(JSON.stringify(groups, null, 2));
}

inspectDb();
