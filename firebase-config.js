// ============================================================
//  FIREBASE CONFIGURATION — MarketIQ
//  SECURITY-HARDENED VERSION
// ============================================================
//
//  ╔══════════════════════════════════════════════════════════╗
//  ║  CREDENTIAL MANAGEMENT — READ BEFORE DEPLOYING          ║
//  ╠══════════════════════════════════════════════════════════╣
//  ║                                                          ║
//  ║  VULNERABILITY IN ORIGINAL CODE:                         ║
//  ║  Hardcoding Firebase credentials directly in source      ║
//  ║  code means they are exposed the moment the file is      ║
//  ║  pushed to a public GitHub repository. Bots scan         ║
//  ║  GitHub 24/7 for API keys and can abuse them within      ║
//  ║  minutes of a commit — running up cloud bills, reading   ║
//  ║  your database, or deleting data.                        ║
//  ║                                                          ║
//  ║  NOTE: Firebase Web API keys are "public" by design.     ║
//  ║  They identify your project, not authenticate you.       ║
//  ║  Your REAL defense is Firestore Security Rules (see       ║
//  ║  firestore.rules) and App Check. However, keeping keys   ║
//  ║  out of source control is still a security best practice ║
//  ║  and prevents accidental exposure of future secrets      ║
//  ║  (e.g., Cloud Function service account keys).            ║
//  ║                                                          ║
//  ║  SOLUTION: Use a build-time environment variable         ║
//  ║  injection pattern. This file reads from:                ║
//  ║    • window.__ENV (injected by your build tool)          ║
//  ║    • OR hardcoded fallback for local dev only            ║
//  ║                                                          ║
//  ║  DEPLOYMENT APPROACHES:                                   ║
//  ║                                                          ║
//  ║  A) Netlify / Vercel (recommended for this project):     ║
//  ║     Set environment variables in the hosting dashboard.  ║
//  ║     Add a _headers file (see security-headers.txt) for   ║
//  ║     HTTP security headers.                               ║
//  ║                                                          ║
//  ║  B) Vite / Webpack build pipeline:                       ║
//  ║     Copy .env.example → .env.local                       ║
//  ║     Fill in your actual values in .env.local             ║
//  ║     Add .env.local to .gitignore (NEVER commit it)       ║
//  ║     Access via import.meta.env.VITE_FIREBASE_API_KEY     ║
//  ║     (requires converting project to use a bundler)       ║
//  ║                                                          ║
//  ║  C) Simple static hosting (current architecture):        ║
//  ║     Use the build-inject approach shown below. A CI/CD   ║
//  ║     pipeline (GitHub Actions) injects secrets at build   ║
//  ║     time, so they never appear in the repository.        ║
//  ║                                                          ║
//  ╚══════════════════════════════════════════════════════════╝

// ============================================================
//  APPROACH: Build-time injection via window.__ENV
//
//  In your CI/CD pipeline (GitHub Actions example):
//
//    - name: Inject Firebase config
//      run: |
//        cat > env-config.js << EOF
//        window.__ENV = {
//          FIREBASE_API_KEY:             "${{ secrets.FIREBASE_API_KEY }}",
//          FIREBASE_AUTH_DOMAIN:         "${{ secrets.FIREBASE_AUTH_DOMAIN }}",
//          FIREBASE_PROJECT_ID:          "${{ secrets.FIREBASE_PROJECT_ID }}",
//          FIREBASE_STORAGE_BUCKET:      "${{ secrets.FIREBASE_STORAGE_BUCKET }}",
//          FIREBASE_MESSAGING_SENDER_ID: "${{ secrets.FIREBASE_MESSAGING_SENDER_ID }}",
//          FIREBASE_APP_ID:              "${{ secrets.FIREBASE_APP_ID }}"
//        };
//        EOF
//
//  Then include <script src="env-config.js"></script> BEFORE
//  this file in index.html. env-config.js is generated at
//  build time and never committed to the repo.
//
//  For local development, create env-config.js manually
//  (it is listed in .gitignore so it won't be committed).
// ============================================================

(function () {
    'use strict';

    // Read from build-time injected config, fall back to empty strings.
    // Empty strings will cause Firebase init to fail loudly in dev,
    // which is intentional — it reminds you to set up your env config.
    const env = window.__ENV || {};

    const firebaseConfig = {
        apiKey:            env.FIREBASE_API_KEY            || '',
        authDomain:        env.FIREBASE_AUTH_DOMAIN        || '',
        projectId:         env.FIREBASE_PROJECT_ID        || '',
        storageBucket:     env.FIREBASE_STORAGE_BUCKET    || '',
        messagingSenderId: env.FIREBASE_MESSAGING_SENDER_ID || '',
        appId:             env.FIREBASE_APP_ID             || ''
    };

    // Validate that all required keys are present before initializing.
    // This gives a clear error message instead of a cryptic Firebase error.
    const requiredKeys = ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId'];
    const missingKeys  = requiredKeys.filter(k => !firebaseConfig[k]);

    if (missingKeys.length > 0) {
        // Use a non-blocking warning in development so the UI still loads
        // and you can see the config error clearly in the console.
        console.error(
            `🔴 MarketIQ: Missing Firebase config keys: ${missingKeys.join(', ')}\n` +
            `Create env-config.js from .env.example and add it to your index.html.\n` +
            `See firebase-config.js for setup instructions.`
        );
        // In production builds, you might want to render a user-facing error
        // and stop execution instead of proceeding with a broken config:
        // document.body.innerHTML = '<div style="...">Configuration error. Contact support.</div>';
        // return;
    }

    // ── Initialize Firebase ──
    firebase.initializeApp(firebaseConfig);

    // Expose db globally (matches existing app.js usage)
    window.db = firebase.firestore();

    // Enable offline persistence (optional but good for mobile)
    window.db.enablePersistence({ synchronizeTabs: true }).catch(err => {
        if (err.code === 'failed-precondition') {
            console.warn("Firebase persistence unavailable: multiple tabs open.");
        } else if (err.code === 'unimplemented') {
            console.warn("Firebase persistence not supported in this browser.");
        }
    });

    // ── Firebase App Check (STRONGLY RECOMMENDED for production) ──
    //
    // App Check binds your Firebase project to your specific domain,
    // so even if someone copies your API key, they cannot use it to
    // query your Firestore from a different website.
    //
    // Setup:
    //   1. Go to Firebase Console → App Check → Register app
    //   2. Choose reCAPTCHA v3 as the provider
    //   3. Get your reCAPTCHA site key from Google
    //   4. Uncomment the block below and add your site key
    //
    // const { initializeAppCheck, ReCaptchaV3Provider } = firebase.appCheck();
    // initializeAppCheck(firebase.app(), {
    //     provider: new ReCaptchaV3Provider('YOUR_RECAPTCHA_V3_SITE_KEY'),
    //     isTokenAutoRefreshEnabled: true
    // });
    //
    // Then in Firebase Console → Firestore → App Check → Enforce.
    // This is the most impactful single security measure you can add.

    if (firebaseConfig.projectId) {
        console.log(`✅ Firebase initialized for project: ${firebaseConfig.projectId}`);
    }
})();
