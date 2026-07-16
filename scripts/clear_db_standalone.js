
import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, writeBatch, doc } from "firebase/firestore";

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

async function clearCollection(name) {
    console.log(`Clearing collection: ${name}...`);
    const snapshot = await getDocs(collection(db, name));
    console.log(`Found ${snapshot.size} documents in ${name}.`);
    
    if (snapshot.size === 0) return;

    const BATCH_SIZE = 450;
    const docs = snapshot.docs;
    
    for (let i = 0; i < docs.length; i += BATCH_SIZE) {
        const batch = writeBatch(db);
        const chunk = docs.slice(i, i + BATCH_SIZE);
        chunk.forEach(d => batch.delete(d.ref));
        await batch.commit();
        console.log(`Committed batch ${Math.floor(i / BATCH_SIZE) + 1} for ${name}.`);
    }
}

async function run() {
    try {
        await clearCollection('inventory');
        await clearCollection('orders');
        console.log('Successfully cleared all inventory and order data.');
        process.exit(0);
    } catch (error) {
        console.error('Error clearing data:', error);
        process.exit(1);
    }
}

run();
