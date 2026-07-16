import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, writeBatch, doc } from "firebase/firestore";
import fs from 'fs';
import path from 'path';

const firebaseConfig = {
    apiKey: "AIzaSyAMl2OrlGj_O9qeh02KeKuw6lA_pZLG4XM",
    authDomain: "spareshare-33986.firebaseapp.com",
    projectId: "spareshare-33986",
    storageBucket: "spareshare-33986.firebasestorage.app",
    messagingSenderId: "1007889806643",
    appId: "1:1007889806643:web:30ecb5eb55c1cf0f187a46",
    measurementId: "G-0F513EG0SJ"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function run() {
  const mappingFile = path.join(process.cwd(), 'material_images.json');
  if (!fs.existsSync(mappingFile)) {
    console.error("material_images.json file not found in root.");
    process.exit(1);
  }
  const materialImagesMap = JSON.parse(fs.readFileSync(mappingFile, 'utf8'));
  console.log(`Loaded ${Object.keys(materialImagesMap).length} material image mappings.`);

  console.log("Fetching all documents from 'inventory' collection...");
  const snapshot = await getDocs(collection(db, 'inventory'));
  console.log(`Found ${snapshot.size} total inventory items in database.`);

  const updates = [];
  let matchingLwtCount = 0;

  snapshot.forEach(docSnap => {
    const data = docSnap.data();
    
    // We target Lanka Wall Tiles items
    if (data.factoryId === 'Lanka Wall Tiles') {
      matchingLwtCount++;
      const matNum = data.materialNumber;
      
      // If image is missing, NONE, or we have a mapping
      const currentImage = data.imageUrl || data.image_url;
      const mappedImage = materialImagesMap[matNum];

      if ((!currentImage || currentImage === 'NONE') && mappedImage) {
        updates.push({
          id: docSnap.id,
          imageUrl: mappedImage,
          image_url: mappedImage
        });
      }
    }
  });

  console.log(`LWT items found in inventory: ${matchingLwtCount}`);
  console.log(`LWT items needing image updates: ${updates.length}`);

  if (updates.length === 0) {
    console.log("No database updates required.");
    process.exit(0);
  }

  // Commit in batches of 400
  const BATCH_SIZE = 400;
  let successCount = 0;
  
  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const chunk = updates.slice(i, i + BATCH_SIZE);
    const batch = writeBatch(db);
    
    chunk.forEach(update => {
      const ref = doc(db, 'inventory', update.id);
      batch.update(ref, {
        imageUrl: update.imageUrl,
        image_url: update.image_url
      });
    });
    
    await batch.commit();
    successCount += chunk.length;
    console.log(`Updated batch: ${successCount} / ${updates.length} items committed.`);
  }

  console.log(`SUCCESS: Updated ${successCount} Lanka Wall Tiles inventory items in Firestore with image URLs.`);
  process.exit(0);
}

run().catch(err => {
  console.error("Critical error running Firestore update:", err);
  process.exit(1);
});
