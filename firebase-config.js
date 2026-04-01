// ============================================================
//  FIREBASE CONFIGURATION — MarketIQ
//  Firebase v9+ Modular SDK
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore, enableMultiTabIndexedDbPersistence } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBDbsf7hi8fAygqhPxenqkrTaRE9mweHNs",
  authDomain: "marketiq-project.firebaseapp.com",
  projectId: "marketiq-project",
  storageBucket: "marketiq-project.firebasestorage.app",
  messagingSenderId: "536929615909",
  appId: "1:536929615909:web:948a4af0ab9381f8c0bfcc",
  measurementId: "G-TWNR47JPZD"
};

const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);

// Enable offline persistence (multi-tab safe)
enableMultiTabIndexedDbPersistence(db).catch(err => {
    if (err.code === 'failed-precondition') {
        console.warn("Firebase persistence: multiple tabs open — single-tab mode.");
    } else if (err.code === 'unimplemented') {
        console.warn("Firebase persistence not supported in this browser.");
    }
});

export { db };
console.log("✅ Firebase v10 (Modular) initialized for MarketIQ");
