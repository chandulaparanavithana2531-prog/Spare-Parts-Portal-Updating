import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs } from "firebase/firestore";

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

async function countCollection(name) {
    console.log(`Querying collection: ${name}...`);
    try {
        const snapshot = await getDocs(collection(db, name));
        console.log(`SUCCESS: Collection '${name}' has ${snapshot.size} documents.`);
    } catch (e) {
        console.error(`ERROR querying collection '${name}':`, e);
    }
}

async function run() {
    await countCollection('inventory');
    await countCollection('orders');
    process.exit(0);
}

run();
