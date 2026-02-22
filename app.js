// ============================================================
//  MARKETIQ — Main Application Logic
//  Firebase Auth + Firestore + Full Game Logic
// ============================================================

// ===== STATE =====
let currentUser   = null;   // { uid, username, rating, ...firestoreData }
let currentPuzzle = null;
let selectedOption = null;
let thrillTimer    = null;
let thrillRemaining = 60;
let leaderboardUnsubscribe = null;

// ===== AUTH MODE ('signin' | 'signup') =====
let authMode = 'signin';

// ===== FIRESTORE COLLECTION =====
const USERS_COL = "users";

// ============================================================
//  USERNAME → EMAIL MAPPING
//  Firebase Auth requires an email address. We silently map
//  each username to a deterministic internal email so users
//  never see or need to remember an email address.
// ============================================================
function usernameToEmail(username) {
    return `${username.toLowerCase().replace(/[^a-z0-9]/g, '_')}@marketiq.app`;
}

// ============================================================
//  INIT — driven entirely by onAuthStateChanged, no localStorage
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    animateLoadingBar();
    initAuthListener();
    initPasswordStrength();
});

function initAuthListener() {
    // ── Hard fallback: if auth doesn't respond in 8s, show login anyway ──
    const authTimeout = setTimeout(() => {
        console.warn("Auth listener timed out — showing login.");
        hideLoading("Connection slow — please check your Firebase config.");
        showSection('login');
    }, 8000);

    auth.onAuthStateChanged(async (firebaseUser) => {
        clearTimeout(authTimeout); // cancel fallback — auth responded

        if (firebaseUser) {
            // User is signed in — fetch their Firestore profile by UID
            try {
                const snap = await db.collection(USERS_COL).doc(firebaseUser.uid).get();
                if (snap.exists) {
                    currentUser = { uid: firebaseUser.uid, ...snap.data() };
                    hideLoading();
                    showSection('home');
                    updateNavUser();
                    updateMobileNav('home');
                    resetDailyIfNeeded();
                } else {
                    // Auth account exists but no Firestore doc — sign out gracefully
                    console.warn("Auth user found but no Firestore doc. Signing out.");
                    await auth.signOut();
                    hideLoading();
                    showSection('login');
                }
            } catch (err) {
                console.error("Error loading user profile:", err);
                hideLoading("Connection error — check your Firebase setup.");
                showSection('login');
            }
        } else {
            // No user signed in
            currentUser = null;
            hideLoading();
            showSection('login');
            updateNavUser();
            updateMobileNav('login');
            const mobileNav = document.getElementById('mobileNav');
            if (mobileNav) mobileNav.style.display = 'none';
        }
    });
}

function animateLoadingBar() {
    const fill = document.getElementById('loadingBarFill');
    const text = document.getElementById('loadingText');
    if (!fill) return;

    const msgs = ["Connecting to server...", "Loading leaderboard...", "Almost ready..."];
    // Animate bar width: 0% → 33% → 66% → 90% in steps
    const widths = ['0%', '33%', '66%', '90%'];

    fill.style.transition = 'width 0.5s ease';
    fill.style.width = widths[0];

    let i = 0;
    const interval = setInterval(() => {
        i++;
        if (i < msgs.length && text) text.textContent = msgs[i];
        if (i < widths.length)      fill.style.width  = widths[i];
        if (i >= msgs.length)       clearInterval(interval);
    }, 700);
}

function hideLoading(errorMsg) {
    const screen = document.getElementById('loadingScreen');
    const fill   = document.getElementById('loadingBarFill');
    const text   = document.getElementById('loadingText');
    if (!screen) return;

    // Snap bar to 100% before hiding
    if (fill) { fill.style.transition = 'width 0.3s ease'; fill.style.width = '100%'; }

    if (errorMsg) {
        if (text) text.textContent = errorMsg;
        setTimeout(() => screen.classList.add('hidden'), 1800);
    } else {
        setTimeout(() => screen.classList.add('hidden'), 400);
    }
}

// ============================================================
//  AUTH MODE TOGGLE (Sign In ↔ Create Account)
// ============================================================
function toggleAuthMode() {
    authMode = authMode === 'signin' ? 'signup' : 'signin';

    const isSignUp      = authMode === 'signup';
    const modeTitle     = document.getElementById('authModeTitle');
    const modeHint      = document.getElementById('authModeHint');
    const loginBtn      = document.getElementById('loginBtn');
    const toggleLabel   = document.getElementById('authToggleLabel');
    const toggleBtn     = document.getElementById('authToggleBtn');
    const pwStrengthBar = document.getElementById('pwStrengthBar');
    const pwStrengthTxt = document.getElementById('pwStrengthText');
    const pwInput       = document.getElementById('passwordInput');

    if (isSignUp) {
        if (modeTitle)     modeTitle.textContent   = 'Create Account';
        if (modeHint)      modeHint.textContent    = 'Your username is your public identity on the leaderboard.';
        if (loginBtn)      loginBtn.textContent    = 'Create Account';
        if (toggleLabel)   toggleLabel.textContent = 'Already have an account?';
        if (toggleBtn)     toggleBtn.textContent   = 'Sign In';
        if (pwStrengthBar) pwStrengthBar.classList.add('show');
        if (pwInput)       pwInput.setAttribute('autocomplete', 'new-password');
    } else {
        if (modeTitle)     modeTitle.textContent   = 'Sign In';
        if (modeHint)      modeHint.textContent    = '';
        if (loginBtn)      loginBtn.textContent    = 'Sign In';
        if (toggleLabel)   toggleLabel.textContent = "Don't have an account?";
        if (toggleBtn)     toggleBtn.textContent   = 'Create Account';
        if (pwStrengthBar) pwStrengthBar.classList.remove('show');
        if (pwStrengthTxt) pwStrengthTxt.textContent = '';
        if (pwInput)       pwInput.setAttribute('autocomplete', 'current-password');
    }
}

// ============================================================
//  PASSWORD VISIBILITY TOGGLE
// ============================================================
function togglePasswordVisibility() {
    const pwInput = document.getElementById('passwordInput');
    if (!pwInput) return;
    pwInput.type = pwInput.type === 'password' ? 'text' : 'password';
}

// ============================================================
//  PASSWORD STRENGTH (shown only during sign-up)
// ============================================================
function initPasswordStrength() {
    const pwInput = document.getElementById('passwordInput');
    if (!pwInput) return;
    pwInput.addEventListener('input', () => {
        if (authMode !== 'signup') return;
        const val = pwInput.value;
        const score = scorePassword(val);
        updateStrengthUI(score);
    });
}

function scorePassword(pw) {
    let s = 0;
    if (pw.length >= 8)  s++;
    if (/[A-Z]/.test(pw)) s++;
    if (/[0-9]/.test(pw)) s++;
    if (/[^A-Za-z0-9]/.test(pw)) s++;
    return s; // 0–4
}

function updateStrengthUI(score) {
    const fill = document.getElementById('pwStrengthFill');
    const text = document.getElementById('pwStrengthText');
    if (!fill || !text) return;
    const levels = [
        { label: '',        color: 'transparent', width: '0%'   },
        { label: 'Weak',    color: '#ef4444',      width: '25%'  },
        { label: 'Fair',    color: '#f97316',      width: '50%'  },
        { label: 'Good',    color: '#eab308',      width: '75%'  },
        { label: 'Strong',  color: '#22c55e',      width: '100%' },
    ];
    const l = levels[score] || levels[0];
    fill.style.width      = l.width;
    fill.style.background = l.color;
    text.textContent      = l.label;
    text.style.color      = l.color;
}

// ============================================================
//  UNIFIED AUTH HANDLER
// ============================================================
async function handleAuth(event) {
    event.preventDefault();

    const username = document.getElementById('usernameInput').value.trim();
    const password = document.getElementById('passwordInput').value;

    // Basic client-side validation
    if (!username || username.length < 3) {
        showToast("Username must be at least 3 characters.", 'error');
        return;
    }
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
        showToast("Username may only contain letters, numbers, and underscores.", 'error');
        return;
    }
    if (!password || password.length < 6) {
        showToast("Password must be at least 6 characters.", 'error');
        return;
    }

    const btn = document.getElementById('loginBtn');
    btn.disabled    = true;
    btn.textContent = authMode === 'signup' ? 'Creating Account...' : 'Signing In...';

    const email = usernameToEmail(username);

    try {
        if (authMode === 'signup') {
            await handleSignUp(username, email, password);
        } else {
            await handleSignIn(email, password);
        }
    } finally {
        btn.disabled    = false;
        btn.textContent = authMode === 'signup' ? 'Create Account' : 'Sign In';
    }
}

// ── Sign Up ──────────────────────────────────────────────────
async function handleSignUp(username, email, password) {
    // Check if username is already taken (Firestore lookup before creating Auth user)
    const usernameSnap = await db.collection(USERS_COL)
        .where('username', '==', username).limit(1).get();

    if (!usernameSnap.empty) {
        showToast("That username is already taken. Choose another.", 'error');
        return;
    }

    try {
        // Create Firebase Auth user
        const cred = await auth.createUserWithEmailAndPassword(email, password);
        const uid  = cred.user.uid;

        // Create Firestore profile doc keyed by UID
        const newUser = {
            uid,
            username,
            rating: 1200,
            puzzlesSolved: 0,
            accuracy: 0,
            streak: 0,
            lastPlayedDate: null,
            lastThrillDate: null,
            dailyPuzzlesCompleted: 0,
            performance: { optimal: 0, good: 0, risky: 0, poor: 0 },
            recentActivity: [],
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        await db.collection(USERS_COL).doc(uid).set(newUser);

        // onAuthStateChanged will handle the rest (set currentUser, navigate)
        showToast(`Welcome to MarketIQ, ${username}! Starting rating: 1,200`, 'success');
        clearAuthForm();

    } catch (err) {
        console.error("Sign-up error:", err);
        if (err.code === 'auth/email-already-in-use') {
            showToast("That username is already registered. Try signing in.", 'error');
        } else {
            showToast(firebaseAuthError(err.code), 'error');
        }
    }
}

// ── Sign In ──────────────────────────────────────────────────
async function handleSignIn(email, password) {
    try {
        await auth.signInWithEmailAndPassword(email, password);
        // onAuthStateChanged will load the profile and navigate
        showToast("Welcome back!", 'success');
        clearAuthForm();
    } catch (err) {
        console.error("Sign-in error:", err);
        showToast(firebaseAuthError(err.code), 'error');
    }
}

// ── Friendly error messages ───────────────────────────────────
function firebaseAuthError(code) {
    const map = {
        'auth/wrong-password':        "Incorrect password. Please try again.",
        'auth/user-not-found':        "No account found for that username.",
        'auth/invalid-email':         "Invalid username format.",
        'auth/too-many-requests':     "Too many attempts. Please wait a moment.",
        'auth/network-request-failed':"Network error — check your connection.",
        'auth/weak-password':         "Password is too weak (min 6 characters).",
    };
    return map[code] || "Authentication failed. Please try again.";
}

function clearAuthForm() {
    const u = document.getElementById('usernameInput');
    const p = document.getElementById('passwordInput');
    if (u) u.value = '';
    if (p) p.value = '';
}

// ============================================================
//  LOGOUT
// ============================================================
function logout() {
    if (leaderboardUnsubscribe) { leaderboardUnsubscribe(); leaderboardUnsubscribe = null; }
    auth.signOut().then(() => {
        currentUser = null;
        updateNavUser();
        updateMobileNav('login');
        const mobileNav = document.getElementById('mobileNav');
        if (mobileNav) mobileNav.style.display = 'none';
        showSection('login');
        showToast("Signed out. See you tomorrow!", 'info');
    }).catch(err => {
        console.error("Sign-out error:", err);
        showToast("Sign-out failed. Please try again.", 'error');
    });
}

// ===== NAVIGATION =====
function showSection(name) {
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    const el = document.getElementById(name + 'Section');
    if (el) el.classList.add('active');

    updateMobileNav(name);

    if (name === 'home')        { updateHomeStats(); }
    if (name === 'puzzles')     { loadDailyPuzzle(); }
    if (name === 'thrill')      { loadThrillStatus(); }
    if (name === 'leaderboard') { subscribeLeaderboard(); }
    if (name === 'profile')     { renderProfile(); }
    if (name === 'predictions') { loadPredictions(); }
    if (name !== 'leaderboard' && leaderboardUnsubscribe) {
        leaderboardUnsubscribe();
        leaderboardUnsubscribe = null;
    }
    return false;
}

function navTo(section) {
    if (!currentUser && !['login', 'leaderboard'].includes(section)) {
        showToast("Sign in first to access this section.", 'info');
        showSection('login');
        return false;
    }
    showSection(section);
    return false;
}

function updateMobileNav(active) {
    document.querySelectorAll('.mnav-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.section === active);
    });
    document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.remove('active');
    });
    const mobileNav = document.getElementById('mobileNav');
    if (mobileNav) {
        mobileNav.style.display = currentUser ? 'flex' : 'none';
    }
}

function updateNavUser() {
    const navUser = document.getElementById('navUser');
    if (!navUser) return;
    if (currentUser) {
        navUser.innerHTML = `
            <div class="nav-user-chip">
                <span>${currentUser.username}</span>
                <span class="chip-rating">${currentUser.rating}</span>
            </div>`;
    } else {
        navUser.innerHTML = `<button class="btn-primary btn-sm" onclick="showSection('login')">Sign In</button>`;
    }
}

// ===== HOME STATS =====
function updateHomeStats() {
    if (!currentUser) return;
    setEl('userRating',    currentUser.rating);
    setEl('userAccuracy',  currentUser.puzzlesSolved > 0 ? `${currentUser.accuracy}%` : '—');
    setEl('userStreak',    currentUser.streak);
    setEl('userPuzzles',   currentUser.puzzlesSolved);
    const rem = Math.max(0, 5 - currentUser.dailyPuzzlesCompleted);
    setEl('dailyRemaining', rem);
    updateProgressDots(currentUser.dailyPuzzlesCompleted);
}

function updateProgressDots(completed) {
    for (let i = 0; i < 5; i++) {
        const dot = document.getElementById('dot' + i);
        if (!dot) continue;
        dot.classList.remove('done', 'current');
        if (i < completed) dot.classList.add('done');
        else if (i === completed) dot.classList.add('current');
    }
}

// ===== DAILY PUZZLE =====
function resetDailyIfNeeded() {
    if (!currentUser) return;
    const today = todayKey();
    if (currentUser.lastPlayedDate !== today) {
        currentUser.dailyPuzzlesCompleted = 0;
        currentUser.lastPlayedDate = today;
    }
}

function loadDailyPuzzle() {
    if (!currentUser) { showSection('login'); return; }
    resetDailyIfNeeded();
    updateProgressDots(currentUser.dailyPuzzlesCompleted);

    const remaining = 5 - currentUser.dailyPuzzlesCompleted;
    setEl('puzzlesRemaining', `${Math.max(0, remaining)} remaining`);

    if (currentUser.dailyPuzzlesCompleted >= DAILY_PUZZLES.length) {
        document.getElementById('puzzleContainer').style.display = 'none';
        document.getElementById('noPuzzlesMessage').style.display = 'block';
        return;
    }

    document.getElementById('puzzleContainer').style.display = 'block';
    document.getElementById('noPuzzlesMessage').style.display = 'none';

    currentPuzzle = DAILY_PUZZLES[currentUser.dailyPuzzlesCompleted];
    selectedOption = null;
    renderPuzzle(document.getElementById('puzzleContainer'), currentPuzzle, false);
}

function renderChart(data) {
    if (!window.LightweightCharts) { console.error("LightweightCharts not loaded"); return; }
    const container = document.getElementById('chartContainer');
    if (!container) { console.error("Chart container not found"); return; }

    const chart = LightweightCharts.createChart(container, {
        width: container.clientWidth,
        height: 320,
        layout: { background: { color: '#0f172a' }, textColor: '#d1d5db' },
        grid: { vertLines: { color: '#1f2937' }, horzLines: { color: '#1f2937' } },
        crosshair: { mode: 1 },
        rightPriceScale: { borderColor: '#374151' },
        timeScale: { borderColor: '#374151' }
    });

    const candleSeries = chart.addCandlestickSeries();
    candleSeries.setData(data);

    window.addEventListener('resize', () => {
        chart.applyOptions({ width: container.clientWidth });
    });
}

function renderPuzzle(container, puzzle, isThrill) {
    const label = isThrill
        ? 'THRILL ROUND'
        : `Puzzle ${(currentUser.dailyPuzzlesCompleted ?? 0) + 1} of ${DAILY_PUZZLES.length}`;

    container.innerHTML = `
        <div class="puzzle-label">${label}</div>
        <h2 class="puzzle-title">${puzzle.title}</h2>
        <div class="puzzle-chart">
            <div id="chartContainer" style="width:100%; height:320px;"></div>
        </div>
        <div class="puzzle-context">
            <div class="puzzle-context-label">Context</div>
            <p>${puzzle.context}</p>
        </div>
        <div class="puzzle-tf-row">
            <span class="puzzle-tag">⏱ ${puzzle.timeframe}</span>
        </div>
        <div class="puzzle-question">${puzzle.question}</div>
        <div class="options-grid" id="optGrid_${isThrill ? 'thrill' : 'daily'}">
            ${puzzle.options.map(o => `
                <button class="option-btn"
                    data-quality="${o.quality}"
                    data-id="${o.id}"
                    onclick="selectOption(this, ${isThrill})">
                    <span class="option-id">${o.id}</span>
                    ${o.text}
                </button>
            `).join('')}
        </div>
        <button class="btn-primary submit-btn" id="submitBtn_${isThrill ? 'thrill' : 'daily'}"
            onclick="submitAnswer(${isThrill})" disabled>
            Confirm Decision
        </button>
        <div id="feedbackArea_${isThrill ? 'thrill' : 'daily'}"></div>
    `;

    setTimeout(() => {
        if (puzzle.chartData) renderChart(puzzle.chartData);
    }, 50);
}

function selectOption(btn, isThrill) {
    const gridId = `optGrid_${isThrill ? 'thrill' : 'daily'}`;
    document.querySelectorAll(`#${gridId} .option-btn`).forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    selectedOption = btn.dataset.quality;
    const submit = document.getElementById(`submitBtn_${isThrill ? 'thrill' : 'daily'}`);
    if (submit) submit.disabled = false;
}

async function submitAnswer(isThrill) {
    if (!selectedOption || !currentPuzzle) return;
    if (isThrill && thrillTimer) { clearInterval(thrillTimer); thrillTimer = null; }

    // Reveal correct / wrong options
    const gridId = `optGrid_${isThrill ? 'thrill' : 'daily'}`;
    document.querySelectorAll(`#${gridId} .option-btn`).forEach(btn => {
        btn.disabled = true;
        if (btn.dataset.quality === 'optimal') btn.classList.add('reveal-optimal');
        else if (btn.classList.contains('selected')) btn.classList.add('reveal-wrong');
    });
    const submitBtn = document.getElementById(`submitBtn_${isThrill ? 'thrill' : 'daily'}`);
    if (submitBtn) submitBtn.style.display = 'none';

    // Rating delta
    const ratingDelta  = isThrill ? THRILL_RATING_CHANGES[selectedOption] : RATING_CHANGES[selectedOption];
    const isGoodChoice = selectedOption === 'optimal' || selectedOption === 'good';

    // Update local state
    currentUser.rating        += ratingDelta;
    currentUser.puzzlesSolved += 1;
    currentUser.performance[selectedOption]++;

    const totalGood       = currentUser.performance.optimal + currentUser.performance.good;
    currentUser.accuracy  = Math.round((totalGood / currentUser.puzzlesSolved) * 100);

    if (isThrill) {
        currentUser.lastThrillDate = todayKey();
    } else {
        currentUser.dailyPuzzlesCompleted = Math.min(
            (currentUser.dailyPuzzlesCompleted || 0) + 1,
            DAILY_PUZZLES.length
        );
        currentUser.lastPlayedDate = todayKey();
    }

    updateStreak();

    // ── Persist to Firestore using UID as document ID ─────────────────
    try {
        await db.collection(USERS_COL).doc(currentUser.uid).update({
            rating:                currentUser.rating,
            puzzlesSolved:         currentUser.puzzlesSolved,
            accuracy:              currentUser.accuracy,
            streak:                currentUser.streak,
            performance:           currentUser.performance,
            dailyPuzzlesCompleted: currentUser.dailyPuzzlesCompleted,
            lastPlayedDate:        currentUser.lastPlayedDate,
            lastThrillDate:        currentUser.lastThrillDate,
            recentActivity: firebase.firestore.FieldValue.arrayUnion({
                puzzle:      currentPuzzle.title,
                quality:     selectedOption,
                ratingDelta: ratingDelta,
                ts:          Date.now()
            })
        });
    } catch (err) {
        console.error("Firestore save error:", err);
        showToast("Saved locally. Sync may retry.", 'warning');
    }

    updateNavUser();
    updateProgressDots(currentUser.dailyPuzzlesCompleted);
    setEl('dailyRemaining', Math.max(0, 3 - currentUser.dailyPuzzlesCompleted));
    spawnFloatRating(ratingDelta);

    const feedbackArea = document.getElementById(`feedbackArea_${isThrill ? 'thrill' : 'daily'}`);
    renderFeedback(feedbackArea, currentPuzzle, selectedOption, ratingDelta, isThrill);
}

function renderFeedback(container, puzzle, quality, ratingDelta, isThrill) {
    const labels     = { optimal: '🎯 Optimal Decision', good: '✅ Good Choice', risky: '⚠️ Risky Move', poor: '❌ Poor Decision' };
    const sign       = ratingDelta >= 0 ? '+' : '';
    const cls        = ratingDelta >= 0 ? 'pos' : 'neg';
    const nextLabel  = isThrill
        ? 'Back to Home'
        : currentUser.dailyPuzzlesCompleted >= DAILY_PUZZLES.length ? 'View Results' : 'Next Puzzle →';
    const nextAction = isThrill ? `showSection('home')` : `loadDailyPuzzle()`;

    container.innerHTML = `
        <div class="feedback-block ${quality}">
            <div class="feedback-title">${labels[quality]}</div>
            <div class="feedback-change ${cls}">${sign}${ratingDelta} Rating → New Rating: ${currentUser.rating}</div>
            <p class="feedback-explanation">${puzzle.explanation[quality]}</p>
            <button class="btn-primary" onclick="${nextAction}">${nextLabel}</button>
        </div>
    `;
    container.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ===== THRILL ROUND =====
function loadThrillStatus() {
    if (!currentUser) { showSection('login'); return; }
    resetDailyIfNeeded();

    const container   = document.getElementById('thrillStatus');
    const alreadyDone = currentUser.lastThrillDate === todayKey();

    if (alreadyDone) {
        container.innerHTML = `
            <div class="thrill-done-card">
                <h2>Thrill Round Complete</h2>
                <p>You've already tackled today's thrill round. Come back tomorrow for a new high-stakes challenge.</p>
                <button class="btn-primary" onclick="showSection('home')">Back to Home</button>
            </div>`;
        return;
    }

    container.innerHTML = `
        <div class="thrill-ready-card">
            <h2>Ready for the Challenge?</h2>
            <p>One high-volatility scenario. One decision. 60 seconds on the clock.</p>
            <div class="thrill-stakes">
                <div class="stake-box">
                    <div class="stake-label">Optimal</div>
                    <div class="stake-val pos">+10</div>
                </div>
                <div class="stake-box">
                    <div class="stake-label">Good</div>
                    <div class="stake-val" style="color:var(--blue)">+5</div>
                </div>
                <div class="stake-box">
                    <div class="stake-label">Risky / Poor</div>
                    <div class="stake-val neg">−5</div>
                </div>
            </div>
            <button class="btn-primary btn-large" onclick="startThrillRound()" style="background:var(--orange);color:#fff">
                Start Thrill Round
            </button>
        </div>`;
    document.getElementById('thrillPuzzleContainer').innerHTML = '';
}

function startThrillRound() {
    thrillRemaining = 60;
    selectedOption  = null;

    const puzzle  = THRILL_PUZZLES[Math.floor(Math.random() * THRILL_PUZZLES.length)];
    currentPuzzle = puzzle;

    const statusEl = document.getElementById('thrillStatus');
    const puzzleEl = document.getElementById('thrillPuzzleContainer');

    statusEl.innerHTML = `
        <div style="text-align:center; margin-bottom:24px;">
            <div class="thrill-timer-wrap">
                <div class="timer-circle">
                    <svg viewBox="0 0 100 100" width="100" height="100">
                        <circle cx="50" cy="50" r="44" class="timer-bg"/>
                        <circle cx="50" cy="50" r="44" class="timer-prog" id="timerCircle"
                            stroke-dasharray="276.46" stroke-dashoffset="0"/>
                    </svg>
                    <div class="timer-text" id="timerDisplay">60</div>
                </div>
            </div>
        </div>`;

    renderPuzzle(puzzleEl, puzzle, true);
    startThrillCountdown();
}

function startThrillCountdown() {
    const circumference = 2 * Math.PI * 44;

    thrillTimer = setInterval(() => {
        thrillRemaining--;

        const timerText = document.getElementById('timerDisplay');
        const circle    = document.getElementById('timerCircle');

        if (timerText) timerText.textContent = thrillRemaining;
        if (circle) {
            circle.style.strokeDashoffset = circumference - (thrillRemaining / 60) * circumference;
            if (thrillRemaining <= 10)      circle.style.stroke = 'var(--red)';
            else if (thrillRemaining <= 30) circle.style.stroke = 'var(--amber)';
        }
        if (timerText) {
            if (thrillRemaining <= 10)      timerText.style.color = 'var(--red)';
            else if (thrillRemaining <= 30) timerText.style.color = 'var(--amber)';
        }

        if (thrillRemaining <= 0) {
            clearInterval(thrillTimer);
            thrillTimer = null;
            if (!selectedOption) selectedOption = 'poor';
            submitAnswer(true);
            showToast("Time's up! Auto-submitted.", 'warning');
        }
    }, 1000);
}

// ===== LEADERBOARD (Real-time) =====
function subscribeLeaderboard() {
    if (leaderboardUnsubscribe) leaderboardUnsubscribe();

    const body = document.getElementById('leaderboardBody');
    if (body) body.innerHTML = '<div class="lb-loading">Loading rankings...</div>';

    leaderboardUnsubscribe = db.collection(USERS_COL)
        .orderBy('rating', 'desc')
        .limit(20)
        .onSnapshot(snapshot => {
            renderLeaderboard(snapshot.docs);
        }, err => {
            console.error("Leaderboard error:", err);
            if (body) body.innerHTML = '<div class="lb-loading">Error loading leaderboard.</div>';
        });
}

function renderLeaderboard(docs) {
    const body = document.getElementById('leaderboardBody');
    if (!body) return;

    if (docs.length === 0) {
        body.innerHTML = '<div class="lb-loading">No competitors yet. Be the first!</div>';
        return;
    }

    body.innerHTML = docs.map((doc, i) => {
        const u         = doc.data();
        const rank      = i + 1;
        const isMe      = currentUser && u.uid === currentUser.uid;
        const rankClass = rank === 1 ? 'r1' : rank === 2 ? 'r2' : rank === 3 ? 'r3' : '';

        return `
            <div class="lb-row ${isMe ? 'is-me' : ''}">
                <div class="lbc rank"><span class="rank-badge ${rankClass}">#${rank}</span></div>
                <div class="lbc username">
                    <span class="lb-username ${isMe ? 'me' : ''}">${u.username}${isMe ? ' (you)' : ''}</span>
                </div>
                <div class="lbc rating"><span class="lb-rating-val">${u.rating}</span></div>
                <div class="lbc accuracy"><span class="lb-accuracy-val">${u.accuracy}%</span></div>
                <div class="lbc puzzles"><span class="lb-puzzles-val">${u.puzzlesSolved}</span></div>
            </div>`;
    }).join('');
}

// ===== PROFILE =====
async function renderProfile() {
    if (!currentUser) { showSection('login'); return; }

    // Refresh from Firestore using UID
    try {
        const snap = await db.collection(USERS_COL).doc(currentUser.uid).get();
        if (snap.exists) currentUser = { uid: currentUser.uid, ...snap.data() };
    } catch (err) { /* use local data */ }

    const u = currentUser;
    setEl('profileUsername', u.username);
    setEl('profileRating',   u.rating);
    setEl('profileAccuracy', `${u.accuracy}%`);
    setEl('profilePuzzles',  u.puzzlesSolved);
    setEl('profileStreak',   u.streak);

    const calibScore         = u.calibrationScore != null ? u.calibrationScore.toFixed(3) : '—';
    const calibForecastCount = u.calibrationForecastCount || 0;
    setEl('profileCalibrationScore', calibScore);
    const calibLabel = document.getElementById('profileCalibrationLabel');
    if (calibLabel) {
        if (calibForecastCount === 0) {
            calibLabel.textContent = 'No forecasts yet';
        } else {
            const tier = getCalibrationTier(u.calibrationScore);
            calibLabel.textContent = `${tier} · ${calibForecastCount} resolved`;
            calibLabel.style.color = tier === 'Expert' ? 'var(--green)'
                : tier === 'Skilled' ? 'var(--cyan)'
                : tier === 'Learning' ? 'var(--amber)' : 'var(--text-3)';
        }
    }

    const av = document.getElementById('profileAvatar');
    if (av) av.textContent = u.username.charAt(0).toUpperCase();

    // Global rank
    const rankSnap = await db.collection(USERS_COL)
        .where('rating', '>', u.rating).get().catch(() => null);
    const rank = rankSnap ? rankSnap.size + 1 : '—';
    setEl('profileRankBadge', `#${rank} Global Rank`);

    // Breakdown bars
    const total = u.puzzlesSolved || 1;
    const perf  = u.performance || {};
    animateBar('barOptimal', perf.optimal || 0, total);
    animateBar('barGood',    perf.good    || 0, total);
    animateBar('barRisky',   perf.risky   || 0, total);
    animateBar('barPoor',    perf.poor    || 0, total);
    setEl('optimalCount', perf.optimal || 0);
    setEl('goodCount',    perf.good    || 0);
    setEl('riskyCount',   perf.risky   || 0);
    setEl('poorCount',    perf.poor    || 0);

    // Recent activity
    const actFeed  = document.getElementById('recentActivity');
    const activity = (u.recentActivity || []).slice().reverse().slice(0, 10);
    if (actFeed) {
        if (activity.length === 0) {
            actFeed.innerHTML = '<p class="empty-activity">No activity yet. Start solving puzzles!</p>';
        } else {
            actFeed.innerHTML = activity.map(a => {
                const sign = a.ratingDelta >= 0 ? '+' : '';
                const cls  = a.ratingDelta >= 0 ? 'pos' : 'neg';
                return `
                    <div class="activity-item">
                        <div>
                            <div class="act-title">${a.puzzle}</div>
                            <div class="act-meta">${a.quality.toUpperCase()} · ${timeAgo(a.ts)}</div>
                        </div>
                        <div class="activity-result ${cls}">${sign}${a.ratingDelta}</div>
                    </div>`;
            }).join('');
        }
    }
}

function animateBar(id, count, total) {
    const el = document.getElementById(id);
    if (!el) return;
    const pct = Math.round((count / total) * 100);
    setTimeout(() => { el.style.width = pct + '%'; }, 100);
}

function getCalibrationTier(score) {
    if (score == null) return 'Unranked';
    if (score >= 0.8)  return 'Expert';
    if (score >= 0.6)  return 'Skilled';
    if (score >= 0.4)  return 'Learning';
    return 'Novice';
}

// ===== STREAK =====
function updateStreak() {
    const today     = todayKey();
    const yesterday = yesterdayKey();
    const last      = currentUser.lastPlayedDate;

    if (!last || last === yesterday) {
        currentUser.streak = (last === yesterday) ? (currentUser.streak || 0) + 1 : 1;
    } else if (last !== today) {
        currentUser.streak = 1;
    }
}

// ===== TOAST SYSTEM =====
function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
    const toast  = document.createElement('div');
    toast.className  = `toast ${type}`;
    toast.innerHTML  = `<span class="toast-icon">${icons[type] || 'ℹ️'}</span><span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('hiding');
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}

// ===== FLOATING RATING CHANGE =====
function spawnFloatRating(delta) {
    const el = document.createElement('div');
    el.className      = `float-rating ${delta >= 0 ? 'pos' : 'neg'}`;
    el.textContent    = (delta >= 0 ? '+' : '') + delta;
    el.style.left     = '50%';
    el.style.top      = '45%';
    el.style.transform = 'translateX(-50%)';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1300);
}

// ===== UTILITY =====
function todayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;
}
function yesterdayKey() {
    const d = new Date(); d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;
}
function setEl(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
}
function timeAgo(ts) {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60)    return 'just now';
    if (s < 3600)  return `${Math.floor(s/60)}m ago`;
    if (s < 86400) return `${Math.floor(s/3600)}h ago`;
    return `${Math.floor(s/86400)}d ago`;
}


// ============================================================
//  PREDICTIONS MODULE — Weekly Forecasting
// ============================================================

const PREDICTION_QUESTIONS = [
    {
        id: 'q1',
        category: 'Index',
        text: 'Will Nifty 50 close above its current level by end of this week?',
        description: 'Based on technical setup, macro flow, and FII/DII data.',
        disclaimer: 'For educational purposes only. Not financial advice.'
    },
    {
        id: 'q2',
        category: 'Crypto',
        text: 'Will Bitcoin trade above $70,000 at any point this week?',
        description: 'Consider ETF flow trends, macro risk sentiment, and on-chain data.',
        disclaimer: 'Crypto markets are highly volatile. Educational only.'
    },
    {
        id: 'q3',
        category: 'Macro',
        text: 'Will the US Dollar Index (DXY) weaken vs the Indian Rupee this week?',
        description: 'Factor in Fed rhetoric, RBI stance, and crude oil impact on INR.',
        disclaimer: 'FX forecasting involves significant uncertainty.'
    }
];

let predictionAnswers    = { q1: null, q2: null, q3: null };
let predTimerInterval    = null;
const predChartInstances = {};

function getCurrentWeekKey() {
    const now        = new Date();
    const year       = now.getFullYear();
    const startOfYear = new Date(year, 0, 1);
    const week       = Math.ceil((((now - startOfYear) / 86400000) + startOfYear.getDay() + 1) / 7);
    return `${year}-W${String(week).padStart(2, '0')}`;
}

function getTimeUntilWeekEnd() {
    const now       = new Date();
    const endOfWeek = new Date(now);
    endOfWeek.setDate(now.getDate() + (7 - now.getDay()) % 7 || 7);
    endOfWeek.setHours(23, 59, 59, 999);
    const diff = endOfWeek - now;
    return {
        days:    Math.floor(diff / 86400000),
        hours:   Math.floor((diff % 86400000) / 3600000),
        minutes: Math.floor((diff % 3600000) / 60000),
        seconds: Math.floor((diff % 60000) / 1000)
    };
}

function formatTimeRemaining({ days, hours, minutes, seconds }) {
    if (days > 0)  return `${days}d ${hours}h ${minutes}m`;
    if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
    return `${minutes}m ${seconds}s`;
}

async function loadPredictions() {
    if (!currentUser) { showSection('login'); return; }
    if (predTimerInterval) { clearInterval(predTimerInterval); predTimerInterval = null; }

    const weekKey = getCurrentWeekKey();
    updatePredictionTimer();
    predTimerInterval = setInterval(updatePredictionTimer, 1000);

    try {
        // ── Use UID as document ID ─────────────────────────────────────
        const userPredRef  = db.collection('userPredictions').doc(currentUser.uid);
        const userPredSnap = await userPredRef.get();

        const hasSubmitted = userPredSnap.exists &&
                             userPredSnap.data()[weekKey] &&
                             userPredSnap.data()[weekKey].submitted;

        if (hasSubmitted) {
            document.getElementById('predForecastView').style.display = 'none';
            document.getElementById('predResultsView').style.display  = 'block';
            await renderPredictionResults(weekKey);
        } else {
            document.getElementById('predForecastView').style.display = 'block';
            document.getElementById('predResultsView').style.display  = 'none';
            renderPredictionQuestions();
        }
    } catch (err) {
        console.error('Error loading predictions:', err);
        showToast('Error loading predictions', 'error');
    }
}

function updatePredictionTimer() {
    const el = document.getElementById('predTimeRemaining');
    if (!el) return;
    el.textContent = formatTimeRemaining(getTimeUntilWeekEnd());
}

function renderPredictionQuestions() {
    predictionAnswers = { q1: null, q2: null, q3: null };
    const container   = document.getElementById('predQuestionsContainer');
    if (!container) return;

    container.innerHTML = PREDICTION_QUESTIONS.map((q, i) => `
        <div class="pred-question-card" style="animation-delay:${i * 0.08}s">
            <div class="pred-q-header">
                <span class="pred-q-num">Q${i + 1}</span>
                <span class="pred-q-category">${q.category}</span>
            </div>
            <h3 class="pred-q-text">${q.text}</h3>
            <p class="pred-q-desc">${q.description}</p>
            <div class="pred-slider-wrap">
                <div class="pred-slider-label-row">
                    <span class="pred-slider-side low">Unlikely</span>
                    <div class="pred-value-pill">
                        <span class="pred-value-num mono" id="value_${q.id}">50</span>
                        <span class="pred-value-pct">%</span>
                    </div>
                    <span class="pred-slider-side high">Likely</span>
                </div>
                <div class="pred-range-track">
                    <div class="pred-range-fill" id="fill_${q.id}" style="width:50%"></div>
                    <input type="range" class="pred-range-input" id="slider_${q.id}"
                           min="0" max="100" value="50"
                           oninput="updatePredictionValue('${q.id}', this.value)">
                </div>
                <div class="pred-range-ticks">
                    <span>0%</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span>
                </div>
            </div>
            <div class="pred-disclaimer">${q.disclaimer}</div>
        </div>
    `).join('');

    const btn = document.getElementById('predSubmitBtn');
    if (btn) { btn.disabled = true; btn.innerHTML = 'Submit Forecasts <span class="btn-arrow">→</span>'; }
    const hint = document.querySelector('.pred-submit-hint');
    if (hint) hint.style.display = 'block';
}

function updatePredictionValue(questionId, value) {
    const num     = parseInt(value);
    const valueEl = document.getElementById(`value_${questionId}`);
    const fillEl  = document.getElementById(`fill_${questionId}`);

    if (valueEl) valueEl.textContent = num;
    if (fillEl)  fillEl.style.width  = num + '%';

    const pill = valueEl?.closest('.pred-value-pill');
    if (pill) {
        pill.className = 'pred-value-pill';
        if (num >= 70)      pill.classList.add('prob-high');
        else if (num <= 30) pill.classList.add('prob-low');
    }

    predictionAnswers[questionId] = num;
    const allSet = Object.values(predictionAnswers).every(v => v !== null);
    const btn    = document.getElementById('predSubmitBtn');
    const hint   = document.querySelector('.pred-submit-hint');
    if (btn)  btn.disabled        = !allSet;
    if (hint) hint.style.display  = allSet ? 'none' : 'block';
}

async function submitPredictions() {
    if (!currentUser) return;
    const allSet = Object.values(predictionAnswers).every(v => v !== null);
    if (!allSet) { showToast('Please move all three sliders first.', 'warning'); return; }

    const weekKey   = getCurrentWeekKey();
    const timestamp = Date.now();
    const submitBtn = document.getElementById('predSubmitBtn');
    submitBtn.disabled  = true;
    submitBtn.innerHTML = 'Submitting...';

    try {
        const batch = db.batch();

        // Store each individual forecast (use UID as the per-user doc ID)
        PREDICTION_QUESTIONS.forEach(q => {
            const predRef = db.collection('predictions')
                              .doc(weekKey)
                              .collection(q.id)
                              .doc(currentUser.uid);       // ← UID instead of username
            batch.set(predRef, {
                probability: predictionAnswers[q.id],
                timestamp,
                username: currentUser.username            // keep username for display
            });
        });

        // Store submission record on user's predictions doc (keyed by UID)
        const userPredRef = db.collection('userPredictions').doc(currentUser.uid);
        batch.set(userPredRef, {
            [weekKey]: {
                submitted: true,
                timestamp,
                answers: [predictionAnswers.q1, predictionAnswers.q2, predictionAnswers.q3]
            }
        }, { merge: true });

        await batch.commit();
        showToast('✅ Forecasts submitted!', 'success');

        document.getElementById('predForecastView').style.display = 'none';
        document.getElementById('predResultsView').style.display  = 'block';
        await renderPredictionResults(weekKey);

    } catch (err) {
        console.error('Error submitting predictions:', err);
        showToast('Submission failed. Check your connection.', 'error');
        submitBtn.disabled  = false;
        submitBtn.innerHTML = 'Submit Forecasts <span class="btn-arrow">→</span>';
    }
}

async function renderPredictionResults(weekKey) {
    const container = document.getElementById('predResultsContainer');
    if (!container) return;
    container.innerHTML = `
        <div class="pred-results-loading">
            <div class="pred-loading-spinner"></div>
            Loading crowd data...
        </div>`;

    Object.values(predChartInstances).forEach(c => c.destroy());

    try {
        // Fetch this user's submission using UID
        const userPredRef  = db.collection('userPredictions').doc(currentUser.uid);
        const userPredSnap = await userPredRef.get();
        const userAnswers  = userPredSnap.data()[weekKey].answers;

        const resultsHTML = await Promise.all(PREDICTION_QUESTIONS.map(async (q, idx) => {
            const qSnap    = await db.collection('predictions').doc(weekKey).collection(q.id).get();
            const allProbs = [];
            qSnap.forEach(doc => allProbs.push(doc.data().probability));

            const userProb = userAnswers[idx];
            const mean     = allProbs.length > 0
                ? Math.round(allProbs.reduce((a, b) => a + b, 0) / allProbs.length)
                : userProb;
            const diff     = userProb - mean;
            const diffSign = diff >= 0 ? '+' : '';
            const diffCls  = diff >= 0 ? 'pos' : 'neg';
            const count    = allProbs.length;

            return `
                <div class="pred-result-card" style="animation-delay:${idx * 0.1}s">
                    <div class="pred-result-card-head">
                        <span class="pred-q-num">Q${idx + 1}</span>
                        <span class="pred-q-category">${q.category}</span>
                    </div>
                    <h3 class="pred-result-question">${q.text}</h3>
                    <div class="pred-result-stats">
                        <div class="pred-stat">
                            <div class="pred-stat-value user mono">${userProb}%</div>
                            <div class="pred-stat-label">Your Forecast</div>
                        </div>
                        <div class="pred-stat-divider"></div>
                        <div class="pred-stat">
                            <div class="pred-stat-value mono">${mean}%</div>
                            <div class="pred-stat-label">Crowd Mean</div>
                        </div>
                        <div class="pred-stat-divider"></div>
                        <div class="pred-stat">
                            <div class="pred-stat-value ${diffCls} mono">${diffSign}${diff}%</div>
                            <div class="pred-stat-label">vs Crowd</div>
                        </div>
                        <div class="pred-stat-divider"></div>
                        <div class="pred-stat">
                            <div class="pred-stat-value mono">${count}</div>
                            <div class="pred-stat-label">Participants</div>
                        </div>
                    </div>
                    <div class="pred-chart-wrap">
                        <canvas id="chart_${q.id}" height="160"></canvas>
                    </div>
                </div>`;
        }));

        container.innerHTML = resultsHTML.join('');
        setTimeout(() => {
            PREDICTION_QUESTIONS.forEach((q, idx) => {
                renderPredictionChart(q.id, weekKey, userAnswers[idx]);
            });
        }, 120);

    } catch (err) {
        console.error('Error rendering results:', err);
        container.innerHTML = '<div class="pred-error">Error loading results. Try refreshing.</div>';
    }
}

async function renderPredictionChart(questionId, weekKey, userProb) {
    const canvas = document.getElementById(`chart_${questionId}`);
    if (!canvas) return;

    const qSnap    = await db.collection('predictions').doc(weekKey).collection(questionId).get();
    const allProbs = [];
    qSnap.forEach(doc => allProbs.push(doc.data().probability));

    const buckets    = { '0–20': 0, '21–40': 0, '41–60': 0, '61–80': 0, '81–100': 0 };
    const bucketKeys = Object.keys(buckets);
    const userBucket = getProbabilityBucket(userProb);
    allProbs.forEach(p => { buckets[getProbabilityBucket(p)]++; });

    const bgColors     = bucketKeys.map(b => b === userBucket ? 'rgba(0,229,255,0.75)'  : 'rgba(61,142,240,0.35)');
    const borderColors = bucketKeys.map(b => b === userBucket ? '#00e5ff' : '#3d8ef0');

    if (predChartInstances[questionId]) predChartInstances[questionId].destroy();

    predChartInstances[questionId] = new Chart(canvas, {
        type: 'bar',
        data: {
            labels: bucketKeys,
            datasets: [{
                label: 'Forecasters',
                data: Object.values(buckets),
                backgroundColor: bgColors,
                borderColor: borderColors,
                borderWidth: 2,
                borderRadius: 6,
                borderSkipped: false
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#131d2e',
                    titleColor: '#e8edf5',
                    bodyColor: '#7b92b2',
                    borderColor: '#1e2d47',
                    borderWidth: 1,
                    padding: 10,
                    callbacks: {
                        title: (items) => `Probability range: ${items[0].label}%`,
                        label: (item)  => ` ${item.raw} forecaster${item.raw !== 1 ? 's' : ''}`
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { color: '#3d5070', stepSize: 1, font: { family: "'JetBrains Mono', monospace", size: 11 } },
                    grid:  { color: '#192336' }
                },
                x: {
                    ticks: { color: '#7b92b2', font: { size: 11 } },
                    grid:  { display: false }
                }
            }
        }
    });
}

// ===== HELPERS =====
function getProbabilityBucket(prob) {
    if (prob <= 20) return '0–20';
    if (prob <= 40) return '21–40';
    if (prob <= 60) return '41–60';
    if (prob <= 80) return '61–80';
    return '81–100';
}
