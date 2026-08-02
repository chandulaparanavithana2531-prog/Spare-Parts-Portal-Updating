import fs from 'fs';
import path from 'path';

const dbPath = path.join(process.cwd(), 'db.json');
if (fs.existsSync(dbPath)) {
  const data = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  const ltParts = data.filter(p => p.factoryId === 'Lanka Tiles');
  console.log(`Total Lanka Tiles parts in db.json: ${ltParts.length}`);
  console.log('Sample Lanka Tiles parts:');
  ltParts.slice(0, 5).forEach(p => {
    console.log(`  ID: ${p.id} | Qty: ${p.onHand} | UnitCost: ${p.unitCost} | TotalValue: ${p.totalValue}`);
  });
  
  const lwtParts = data.filter(p => p.factoryId === 'Lanka Wall Tiles');
  console.log(`Total Lanka Wall Tiles parts in db.json: ${lwtParts.length}`);
  console.log('Sample Lanka Wall Tiles parts:');
  lwtParts.slice(0, 5).forEach(p => {
    console.log(`  ID: ${p.id} | Qty: ${p.onHand} | UnitCost: ${p.unitCost} | TotalValue: ${p.totalValue}`);
  });
} else {
  console.log('db.json not found');
}
