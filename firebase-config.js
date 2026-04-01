// ============================================================
//  FIREBASE CONFIGURATION — MarketIQ
// ============================================================
//
//  ⚠️  YOU MUST FILL IN YOUR OWN FIREBASE CREDENTIALS BELOW
//
//  How to get these values:
//  1. Go to https://console.firebase.google.com
//  2. Create a project (or open an existing one)
//  3. Click the </> (Web) icon to add a web app
//  4. Copy the firebaseConfig object and paste the values below
//
// ============================================================

const firebaseConfig = {
  apiKey: "AIzaSyBDbsf7hi8fAygqhPxenqkrTaRE9mweHNs",
  authDomain: "marketiq-project.firebaseapp.com",
  projectId: "marketiq-project",
  storageBucket: "marketiq-project.firebasestorage.app",
  messagingSenderId: "536929615909",
  appId: "1:536929615909:web:948a4af0ab9381f8c0bfcc",
  measurementId: "G-TWNR47JPZD"
};

// ============================================================
//  Initialize Firebase — DO NOT EDIT BELOW THIS LINE
// ============================================================

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// Enable offline persistence (optional but nice for mobile)
db.enablePersistence({ synchronizeTabs: true }).catch(err => {
    if (err.code === 'failed-precondition') {
        // Multiple tabs open — persistence only works in one tab at a time
        console.warn("Firebase persistence unavailable: multiple tabs open.");
    } else if (err.code === 'unimplemented') {
        // Browser doesn't support persistence
        console.warn("Firebase persistence not supported in this browser.");
    }
});

console.log("✅ Firebase initialized for MarketIQ");
