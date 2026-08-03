import { initializeApp } from "firebase/app";
import { getFirestore, getDocs, collection } from "firebase/firestore";

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
  console.log("Reading inventory collection from Firestore...");
  const snapshot = await getDocs(collection(db, 'inventory'));
  console.log(`Firestore inventory has ${snapshot.size} documents.`);
  
  const stats = {};
  snapshot.forEach(docSnap => {
    const data = docSnap.data();
    const fact = data.factoryId || 'Unknown';
    if (!stats[fact]) {
      stats[fact] = { skus: 0, value: 0 };
    }
    stats[fact].skus++;
    stats[fact].value += data.totalValue || 0;
  });
  
  console.log("\nFirestore Stats Breakdown:");
  Object.entries(stats).forEach(([fact, data]) => {
    console.log(`- ${fact}: ${data.skus} SKUs | Rs. ${Math.round(data.value).toLocaleString()}`);
  });
  
  process.exit(0);
}

run().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});
