import { syncPortalReportToSheet } from '../services/googleSheets.js';

async function runTest() {
  console.log('--- Google Sheets Sync Verification Test ---');

  const testItems = [
    {
      id: 'Lanka Tiles-TEST-1001',
      factoryId: 'Lanka Tiles',
      materialNumber: '100201', // existing or new code
      partNumber: '100201',
      description: 'Test Ball Bearing 6204',
      categoryName: 'Bearings',
      onHand: 42,
      unitCost: 120,
      totalValue: 5040,
      spareType: 'Bearings'
    },
    {
      id: 'Lanka Tiles-TEST-NEW-888',
      factoryId: 'Lanka Tiles',
      materialNumber: 'NEW-ITEM-888',
      partNumber: 'NEW-ITEM-888',
      description: 'Newly Appended Test Spare Part',
      categoryName: 'Mechanical',
      onHand: 10,
      unitCost: 500,
      totalValue: 5000,
      spareType: 'Mechanical'
    }
  ];

  console.log('Simulating report sync for Lanka Tiles...');
  const result = await syncPortalReportToSheet('Lanka Tiles', testItems);
  console.log('Test Result:', result);
}

runTest().catch(console.error);
