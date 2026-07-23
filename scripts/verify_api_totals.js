async function run() {
  console.log('Fetching active inventory from local server API...');
  try {
    const res = await fetch('http://localhost:3000/parts');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const parts = await res.json();
    console.log(`Fetched ${parts.length} total parts.`);

    const summary = {};
    parts.forEach(p => {
      const fId = p.factoryId || 'Unknown';
      if (!summary[fId]) {
        summary[fId] = { skus: 0, qty: 0, value: 0 };
      }
      summary[fId].skus += 1;
      summary[fId].qty += p.onHand || 0;
      summary[fId].value += p.totalValue || 0;
    });

    console.log('\n--- Local API Server Inventory Summary ---');
    for (const [plant, stats] of Object.entries(summary)) {
      console.log(`Plant: "${plant}"`);
      console.log(`  SKUs:  ${stats.skus.toLocaleString()}`);
      console.log(`  QTY:   ${stats.qty.toLocaleString()}`);
      console.log(`  Value: Rs. ${stats.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
    }
  } catch (err) {
    console.error('Verification failed:', err.message);
  }
  process.exit(0);
}

run();
