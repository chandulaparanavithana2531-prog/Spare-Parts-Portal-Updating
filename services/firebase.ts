import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getAuth, setPersistence, browserSessionPersistence } from "firebase/auth";

// Firebase web config. These values are public by design (they ship to every browser);
// access control is enforced by firestore.rules + the /api/login token.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyCOJAgJMobTaW6WSeFN5di7-4zko3OkLK0",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "spareshare-33986-f2494.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "spareshare-33986-f2494",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "spareshare-33986-f2494.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "649710479060",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:649710479060:web:0118a45c1cf5273f3cbd41",
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || "G-NSYYHFGZE8"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const storage = getStorage(app);

// Sign-in lasts for the browser tab, matching the portal's sessionStorage login
export const auth = getAuth(app);
setPersistence(auth, browserSessionPersistence).catch(() => {});
