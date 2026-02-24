// ============================================================
//  MARKETIQ — Main Application Logic
//  Firebase Firestore + Full Game Logic
//  SECURITY-HARDENED VERSION
// ============================================================

// ===== STATE =====
let currentUser   = null;
let currentPuzzle = null;
let selectedOption = null;
let thrillTimer    = null;
let thrillRemaining = 60;
let leaderboardUnsubscribe = null;

// ===== FIRESTORE COLLECTION =====
const USERS_COL = "users";

// ============================================================
//  SECURITY MODULE 1: INPUT VALIDATION & SANITIZATION
//  Defense against XSS and injection attacks.
//  Never trust user-supplied strings. Sanitize before any
//  DOM insertion; validate before any Firestore write.
// ============================================================

/**
 * Strips all HTML tags and encodes dangerous characters.
 * Use on ANY string that will be rendered into the DOM via
 * innerHTML. If you only use textContent, this is a belt-
 * and-suspenders measure — keep it anyway.
 *
 * Attack prevented: Stored XSS
 *   e.g. username = '<img src=x onerror=alert(1)>'
 *   Without this, that string written into innerHTML
 *   would execute arbitrary JavaScript in every victim's
 *   browser that loads the leaderboard.
 */
function sanitizeString(str) {
    if (typeof str !== 'string') return '';
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#x27;',
        '/': '&#x2F;',
        '`': '&#x60;',
        '=': '&#x3D;'
    };
    return str.replace(/[&<>"'`=/]/g, s => map[s]);
}

/**
 * Validates a username against a strict allowlist pattern.
 * Only alphanumeric characters and underscores are permitted.
 *
 * Attack prevented: NoSQL Injection / path traversal
 *   Firestore document IDs that look like "../admin" or contain
 *   special characters can cause unpredictable routing. Strict
 *   allowlist validation eliminates the entire class of attack.
 *
 * @param {string} username
 * @returns {{ valid: boolean, error: string|null }}
 */
function validateUsername(username) {
    if (!username || typeof username !== 'string') {
        return { valid: false, error: 'Username is required.' };
    }
    const trimmed = username.trim();
    if (trimmed.length < 3 || trimmed.length > 20) {
        return { valid: false, error: 'Username must be 3–20 characters.' };
    }
    // ALLOWLIST: only a-z, A-Z, 0-9, underscore
    if (!/^[a-zA-Z0-9_]+$/.test(trimmed)) {
        return { valid: false, error: 'Username may only contain letters, numbers, and underscores.' };
    }
    // Block usernames that look like reserved paths
    const reserved = ['admin', 'root', 'system', 'firebase', 'firestore'];
    if (reserved.includes(trimmed.toLowerCase())) {
        return { valid: false, error: 'That username is reserved.' };
    }
    return { valid: true, error: null };
}

/**
 * Validates a password meets minimum security requirements.
 * @param {string} password
 * @returns {{ valid: boolean, error: string|null }}
 */
function validatePassword(password) {
    if (!password || typeof password !== 'string') {
        return { valid: false, error: 'Password is required.' };
    }
    if (password.length < 8) {
        return { valid: false, error: 'Password must be at least 8 characters.' };
    }
    if (password.length > 128) {
        return { valid: false, error: 'Password must be under 128 characters.' };
    }
    return { valid: true, error: null };
}

// ============================================================
//  SECURITY MODULE 2: ROBUST PASSWORD HASHING
//
//  VULNERABILITY IN ORIGINAL CODE:
//  The original used raw SHA-256 with a single hardcoded salt
//  ("miq_salt_v1"). This has two critical weaknesses:
//
//  1. SPEED ATTACK: SHA-256 is a general-purpose hash designed
//     for speed. Modern GPUs can compute ~10 billion SHA-256
//     hashes per second. An attacker who exfiltrates your
//     Firestore "passwordHash" fields can crack weak passwords
//     in seconds with offline dictionary/brute-force attacks.
//
//  2. SHARED SALT: One hardcoded salt means identical passwords
//     produce identical hashes. An attacker can precompute a
//     rainbow table of common passwords against your known salt
//     and crack all accounts simultaneously.
//
//  PRODUCTION RECOMMENDATION:
//  Move password hashing entirely to a Firebase Cloud Function.
//  Never hash passwords on the client. The pattern would be:
//    1. Client sends plaintext password over HTTPS to Cloud Fn.
//    2. Cloud Function hashes with bcrypt (cost factor 12+).
//    3. Cloud Function stores the hash; never returns it.
//  This prevents the client from ever receiving the hash and
//  ensures the algorithm can be upgraded server-side.
//
//  INTERIM MITIGATION (implemented below):
//  We use PBKDF2 via the Web Crypto API. PBKDF2 is deliberately
//  slow (100,000 iterations) and uses a unique per-user random
//  salt, making offline attacks orders of magnitude harder.
//  This is NOT as strong as bcrypt on a server, but it is a
//  substantial improvement over plain SHA-256 on the client.
// ============================================================

/**
 * Derives a strong key from a password using PBKDF2.
 * Generates a cryptographically random per-user salt.
 *
 * @param {string} password  — plaintext password
 * @param {Uint8Array} [salt] — provide to verify; omit to create
 * @returns {Promise<{ hash: string, salt: string }>}
 *          Both values are hex-encoded for Firestore storage.
 */
async function hashPassword(password, existingSaltHex = null) {
    const encoder = new TextEncoder();

    // Generate a fresh random salt for new passwords,
    // or decode the stored one for verification.
    let saltBytes;
    if (existingSaltHex) {
        // Convert stored hex salt back to bytes
        saltBytes = new Uint8Array(
            existingSaltHex.match(/.{2}/g).map(b => parseInt(b, 16))
        );
    } else {
        // 16 bytes (128 bits) of cryptographically random salt
        saltBytes = crypto.getRandomValues(new Uint8Array(16));
    }

    // Import the password as key material
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        encoder.encode(password),
        { name: 'PBKDF2' },
        false,
        ['deriveBits']
    );

    // Derive 256 bits using PBKDF2-SHA256 with 100k iterations.
    // 100,000 iterations means an attacker must do 100,000×
    // SHA-256 operations per password guess instead of 1.
    const derivedBits = await crypto.subtle.deriveBits(
        {
            name: 'PBKDF2',
            salt: saltBytes,
            iterations: 100_000,
            hash: 'SHA-256'
        },
        keyMaterial,
        256
    );

    const hashHex = Array.from(new Uint8Array(derivedBits))
        .map(b => b.toString(16).padStart(2, '0')).join('');
    const saltHex = Array.from(saltBytes)
        .map(b => b.toString(16).padStart(2, '0')).join('');

    return { hash: hashHex, salt: saltHex };
}

/**
 * Verify a plaintext password against a stored hash + salt.
 * Uses constant-time comparison to prevent timing attacks.
 *
 * Attack prevented: Timing Attack
 *   A naive string comparison (hash1 === hash2) returns early
 *   on the first mismatching character, leaking timing info
 *   that can help attackers guess passwords byte-by-byte.
 */
async function verifyPassword(plaintext, storedHash, storedSalt) {
    const { hash: candidateHash } = await hashPassword(plaintext, storedSalt);

    // Constant-time comparison: always compare every character
    if (candidateHash.length !== storedHash.length) return false;
    let diff = 0;
    for (let i = 0; i < candidateHash.length; i++) {
        diff |= candidateHash.charCodeAt(i) ^ storedHash.charCodeAt(i);
    }
    return diff === 0;
}

function togglePasswordVisibility(inputId, btn) {
    const input = document.getElementById(inputId);
    if (!input) return;
    const isHidden = input.type === 'password';
    input.type = isHidden ? 'text' : 'password';
    const svgs = btn.querySelectorAll('svg');
    svgs[0].style.display = isHidden ? 'none' : '';
    svgs[1].style.display = isHidden ? '' : 'none';
}

function getPasswordStrength(password) {
    let score = 0;
    if (password.length >= 8)  score++;
    if (password.length >= 12) score++;
    if (/[A-Z]/.test(password)) score++;
    if (/[0-9]/.test(password)) score++;
    if (/[^A-Za-z0-9]/.test(password)) score++;
    if (score <= 1) return { label: 'Weak',   color: '#ff4560', width: '25%' };
    if (score <= 2) return { label: 'Fair',   color: '#ffb800', width: '50%' };
    if (score <= 3) return { label: 'Good',   color: '#3d8ef0', width: '75%' };
    return             { label: 'Strong', color: '#00e676', width: '100%' };
}

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
    initApp();
});

async function initApp() {
    animateLoadingBar();
    const savedUsername = localStorage.getItem('miq_session');

    if (savedUsername) {
        // Validate the session token shape before using it as a Firestore key
        const validation = validateUsername(savedUsername);
        if (!validation.valid) {
            localStorage.removeItem('miq_session');
            hideLoading();
            showSection('login');
            return;
        }

        try {
            const snap = await db.collection(USERS_COL).doc(savedUsername).get();
            if (snap.exists) {
                const userData = snap.data();
                currentUser = userData;
                if (!userData.passwordHash) {
                    hideLoading();
                    showSection('home');
                    updateNavUser();
                    updateMobileNav('home');
                    handleLegacyPassword(userData, db.collection(USERS_COL).doc(savedUsername), savedUsername);
                } else {
                    hideLoading();
                    showSection('home');
                    updateNavUser();
                    updateMobileNav('home');
                }
            } else {
                localStorage.removeItem('miq_session');
                hideLoading();
                showSection('login');
            }
        } catch (err) {
            console.error("Error restoring session:", err);
            hideLoading("Connection error — check your Firebase setup");
            showSection('login');
        }
    } else {
        hideLoading();
        showSection('login');
    }
}

function animateLoadingBar() {
    const fill = document.getElementById('loadingBarFill');
    const text = document.getElementById('loadingText');
    if (!fill) return;
    let msgs = ["Connecting to server...", "Loading leaderboard...", "Almost ready..."];
    let i = 0;
    let interval = setInterval(() => {
        i++;
        if (i < msgs.length && text) text.textContent = msgs[i];
        if (i >= msgs.length) clearInterval(interval);
    }, 500);
}

function hideLoading(errorMsg) {
    const screen = document.getElementById('loadingScreen');
    if (!screen) return;
    if (errorMsg) {
        const text = document.getElementById('loadingText');
        if (text) text.textContent = errorMsg;
        setTimeout(() => screen.classList.add('hidden'), 1500);
    } else {
        setTimeout(() => screen.classList.add('hidden'), 300);
    }
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
        // Use textContent, NOT innerHTML, to safely display user data.
        // This prevents any stored XSS payload in the username from executing.
        const chip = document.createElement('div');
        chip.className = 'nav-user-chip';

        const nameSpan = document.createElement('span');
        nameSpan.textContent = currentUser.username; // textContent: XSS-safe

        const ratingSpan = document.createElement('span');
        ratingSpan.className = 'chip-rating';
        ratingSpan.textContent = currentUser.rating; // textContent: XSS-safe

        chip.appendChild(nameSpan);
        chip.appendChild(ratingSpan);
        navUser.innerHTML = '';
        navUser.appendChild(chip);
    } else {
        navUser.innerHTML = `<button class="btn-primary btn-sm" onclick="showSection('login')">Sign In</button>`;
    }
}

// ===== LOGIN =====
async function handleLogin(event) {
    event.preventDefault();

    const rawUsername = document.getElementById('usernameInput').value.trim();
    const password    = document.getElementById('passwordInput').value;

    // SERVER-SIDE STYLE VALIDATION on the client before touching Firestore
    const usernameCheck = validateUsername(rawUsername);
    if (!usernameCheck.valid) {
        showToast(usernameCheck.error, 'error');
        return;
    }

    const btn = document.getElementById('loginBtn');
    btn.disabled = true;
    btn.textContent = "Connecting...";

    try {
        const ref  = db.collection(USERS_COL).doc(rawUsername);
        const snap = await ref.get();

        if (snap.exists) {
            // ── RETURNING USER ──
            const userData = snap.data();

            if (userData.passwordHash) {
                if (!password) {
                    showToast("Please enter your password.", 'error');
                    document.getElementById('passwordInput').focus();
                    btn.disabled = false;
                    btn.textContent = "Start Competing";
                    return;
                }
                // SECURITY: verifyPassword uses PBKDF2 + constant-time comparison.
                // If user was registered under old SHA-256 scheme, they must reset
                // their password (handled by handleLegacyPassword flow).
                const isValid = await verifyPassword(password, userData.passwordHash, userData.passwordSalt);
                if (!isValid) {
                    // Generic error message — never reveal whether username or password was wrong.
                    // Attack prevented: Username Enumeration
                    showToast("Invalid username or password.", 'error');
                    document.getElementById('passwordInput').value = '';
                    document.getElementById('passwordInput').focus();
                    btn.disabled = false;
                    btn.textContent = "Start Competing";
                    return;
                }
                currentUser = userData;
                showToast(`Welcome back, ${sanitizeString(rawUsername)}! Rating: ${currentUser.rating}`, 'success');
                finalizeLogin(rawUsername);

            } else {
                // Legacy account — force password creation
                currentUser = userData;
                finalizeLogin(rawUsername, false);
                handleLegacyPassword(userData, ref, rawUsername);
            }

        } else {
            // ── NEW USER ──
            const passwordCheck = validatePassword(password);
            if (!passwordCheck.valid) {
                showToast(passwordCheck.error || "Please create a password.", 'error');
                document.getElementById('passwordInput').focus();
                btn.disabled = false;
                btn.textContent = "Start Competing";
                return;
            }

            // PBKDF2 hash with unique random salt
            const { hash, salt } = await hashPassword(password);
            const newUser = { ...buildNewUser(rawUsername), passwordHash: hash, passwordSalt: salt };
            await ref.set(newUser);
            currentUser = newUser;
            showToast(`Welcome to MarketIQ, ${sanitizeString(rawUsername)}! Starting rating: 1200`, 'success');
            finalizeLogin(rawUsername);
        }

    } catch (err) {
        console.error("Login error:", err);
        showToast("Connection failed. Check Firebase config.", 'error');
        btn.disabled = false;
        btn.textContent = "Start Competing";
    }
}

function buildNewUser(username) {
    return {
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
}

function finalizeLogin(username, showModal = true) {
    localStorage.setItem('miq_session', username);
    updateNavUser();
    updateMobileNav('home');
    resetDailyIfNeeded();
    showSection('home');
    document.getElementById('usernameInput').value = '';
    document.getElementById('passwordInput').value = '';
    const btn = document.getElementById('loginBtn');
    btn.disabled = false;
    btn.textContent = "Start Competing";
}

// ===== SET PASSWORD MODAL =====
let _pendingModalUser = null;
let _modalForced = false;

function openSetPasswordModal(forced = false) {
    _modalForced = forced;
    const modal = document.getElementById('setPasswordModal');
    modal.style.display = 'flex';
    setTimeout(() => modal.classList.add('modal-visible'), 10);
    document.getElementById('newPasswordInput').focus();
}

function closeSetPasswordModal(event) {
    if (_modalForced) return;
    if (event && event.target !== document.getElementById('setPasswordModal')) return;
    _pendingModalUser = null;
    _closeModal();
}

function _closeModal() {
    _modalForced = false;
    const modal = document.getElementById('setPasswordModal');
    modal.classList.remove('modal-visible');
    setTimeout(() => { modal.style.display = 'none'; }, 250);
    document.getElementById('newPasswordInput').removeEventListener('input', onNewPasswordInput);
}

function handleLegacyPassword(userData, ref, username) {
    _pendingModalUser = { userData, ref, username, isNew: false, isLegacy: true };
    const titleEl    = document.getElementById('setPasswordTitle');
    const subtitleEl = document.getElementById('setPasswordSubtitle');
    if (titleEl)    titleEl.textContent    = "Password Required";
    if (subtitleEl) subtitleEl.textContent = "Your account needs a password to stay secure. Please create one to continue.";
    document.getElementById('newPasswordInput').value     = '';
    document.getElementById('confirmPasswordInput').value = '';
    document.getElementById('newPasswordInput').addEventListener('input', onNewPasswordInput);
    showToast(`Welcome back, ${sanitizeString(username)}! Please set a password to continue.`, 'info');
    openSetPasswordModal(true);
}

function onNewPasswordInput() {
    const val = document.getElementById('newPasswordInput').value;
    const wrap = document.getElementById('passwordStrengthWrap');
    const bar  = document.getElementById('passwordStrengthBar');
    const lbl  = document.getElementById('passwordStrengthLabel');
    if (!val) { wrap.style.display = 'none'; return; }
    wrap.style.display = 'flex';
    const s = getPasswordStrength(val);
    bar.style.width = s.width;
    bar.style.background = s.color;
    lbl.textContent = s.label;
    lbl.style.color = s.color;
}

async function confirmSetPassword() {
    const newPw  = document.getElementById('newPasswordInput').value;
    const confPw = document.getElementById('confirmPasswordInput').value;

    const pwCheck = validatePassword(newPw);
    if (!pwCheck.valid) { showToast(pwCheck.error, 'error'); return; }
    if (newPw !== confPw) { showToast("Passwords don't match.", 'error'); return; }

    const btn = document.getElementById('setPasswordBtn');
    btn.disabled = true;
    btn.textContent = "Saving...";

    try {
        // PBKDF2 hash with fresh random salt
        const { hash, salt } = await hashPassword(newPw);
        if (_pendingModalUser) {
            await _pendingModalUser.ref.update({ passwordHash: hash, passwordSalt: salt });
            if (currentUser) {
                currentUser.passwordHash = hash;
                currentUser.passwordSalt = salt;
            }
        }
        _closeModal();
        showToast("Password set! Your account is now protected.", 'success');
        _pendingModalUser = null;
        if (currentUser) { updateNavUser(); showSection('home'); }
    } catch (err) {
        console.error("Set password error:", err);
        showToast("Failed to save password. Try again.", 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = "Set Password";
    }
}

function logout() {
    if (leaderboardUnsubscribe) { leaderboardUnsubscribe(); leaderboardUnsubscribe = null; }
    currentUser = null;
    localStorage.removeItem('miq_session');
    updateNavUser();
    updateMobileNav('login');
    document.getElementById('mobileNav').style.display = 'none';
    showSection('login');
    showToast("Signed out. See you tomorrow!", 'info');
}

function changePassword() {
    if (!currentUser) return;
    const ref = db.collection(USERS_COL).doc(currentUser.username);
    _pendingModalUser = { userData: currentUser, ref, username: currentUser.username, isNew: false, isLegacy: false };
    const titleEl    = document.getElementById('setPasswordTitle');
    const subtitleEl = document.getElementById('setPasswordSubtitle');
    if (titleEl)    titleEl.textContent    = "Change Password";
    if (subtitleEl) subtitleEl.textContent = "Enter a new password for your account.";
    document.getElementById('newPasswordInput').value     = '';
    document.getElementById('confirmPasswordInput').value = '';
    const strengthWrap = document.getElementById('passwordStrengthWrap');
    if (strengthWrap) strengthWrap.style.display = 'none';
    document.getElementById('newPasswordInput').addEventListener('input', onNewPasswordInput);
    openSetPasswordModal(false);
}

// ===== HOME STATS =====
function updateHomeStats() {
    if (!currentUser) return;
    setEl('userRating', currentUser.rating);
    setEl('userAccuracy', currentUser.puzzlesSolved > 0 ? `${currentUser.accuracy}%` : '—');
    setEl('userStreak', currentUser.streak);
    setEl('userPuzzles', currentUser.puzzlesSolved);
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
        width: container.clientWidth, height: 320,
        layout: { background: { color: '#0f172a' }, textColor: '#d1d5db' },
        grid: { vertLines: { color: '#1f2937' }, horzLines: { color: '#1f2937' } },
        crosshair: { mode: 1 },
        rightPriceScale: { borderColor: '#374151' },
        timeScale: { borderColor: '#374151' }
    });
    const candleSeries = chart.addCandlestickSeries();
    candleSeries.setData(data);
    window.addEventListener('resize', () => chart.applyOptions({ width: container.clientWidth }));
}

function renderPuzzle(container, puzzle, isThrill) {
    // SECURITY: Build DOM nodes rather than concatenating raw strings
    // for dynamic content. Static template strings for structural HTML
    // are fine; user-controlled strings must use textContent or sanitizeString.
    const label = isThrill
        ? 'THRILL ROUND'
        : `Puzzle ${(currentUser.dailyPuzzlesCompleted ?? 0) + 1} of ${DAILY_PUZZLES.length}`;

    // Options HTML uses hardcoded puzzle data (not user input), so template literals are safe.
    // If puzzle data ever comes from user submissions, sanitize here.
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
                    data-quality="${sanitizeString(o.quality)}"
                    data-id="${sanitizeString(o.id)}"
                    onclick="selectOption(this, ${isThrill})">
                    <span class="option-id">${sanitizeString(o.id)}</span>
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
    setTimeout(() => { if (puzzle.chartData) renderChart(puzzle.chartData); }, 50);
}

function selectOption(btn, isThrill) {
    const gridId = `optGrid_${isThrill ? 'thrill' : 'daily'}`;
    document.querySelectorAll(`#${gridId} .option-btn`).forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    selectedOption = btn.dataset.quality;
    const submitId = `submitBtn_${isThrill ? 'thrill' : 'daily'}`;
    const submit = document.getElementById(submitId);
    if (submit) submit.disabled = false;
}

async function submitAnswer(isThrill) {
    if (!selectedOption || !currentPuzzle) return;

    // Validate that selectedOption is one of the expected values
    // Prevents a tampered dataset.quality attribute from writing arbitrary data to Firestore
    const validQualities = ['optimal', 'good', 'risky', 'poor'];
    if (!validQualities.includes(selectedOption)) {
        console.error('Invalid quality value detected:', selectedOption);
        showToast('An error occurred. Please refresh.', 'error');
        return;
    }

    if (isThrill && thrillTimer) { clearInterval(thrillTimer); thrillTimer = null; }

    const gridId = `optGrid_${isThrill ? 'thrill' : 'daily'}`;
    document.querySelectorAll(`#${gridId} .option-btn`).forEach(btn => {
        btn.disabled = true;
        if (btn.dataset.quality === 'optimal') btn.classList.add('reveal-optimal');
        else if (btn.classList.contains('selected')) btn.classList.add('reveal-wrong');
    });
    const submitId = `submitBtn_${isThrill ? 'thrill' : 'daily'}`;
    const submitBtn = document.getElementById(submitId);
    if (submitBtn) submitBtn.style.display = 'none';

    const ratingDelta = isThrill ? THRILL_RATING_CHANGES[selectedOption] : RATING_CHANGES[selectedOption];

    currentUser.rating         += ratingDelta;
    currentUser.puzzlesSolved  += 1;
    currentUser.performance[selectedOption]++;

    const totalGood = currentUser.performance.optimal + currentUser.performance.good;
    currentUser.accuracy = Math.round((totalGood / currentUser.puzzlesSolved) * 100);

    if (isThrill) {
        currentUser.lastThrillDate = todayKey();
    } else {
        currentUser.dailyPuzzlesCompleted = Math.min((currentUser.dailyPuzzlesCompleted || 0) + 1, DAILY_PUZZLES.length);
        currentUser.lastPlayedDate = todayKey();
    }
    updateStreak();

    try {
        await db.collection(USERS_COL).doc(currentUser.username).update({
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
    const labels = { optimal: '🎯 Optimal Decision', good: '✅ Good Choice', risky: '⚠️ Risky Move', poor: '❌ Poor Decision' };
    const sign   = ratingDelta >= 0 ? '+' : '';
    const cls    = ratingDelta >= 0 ? 'pos' : 'neg';
    const nextLabel  = isThrill ? 'Back to Home' : currentUser.dailyPuzzlesCompleted >= DAILY_PUZZLES.length ? 'View Results' : 'Next Puzzle →';
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
    const container = document.getElementById('thrillStatus');
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
                <div class="stake-box"><div class="stake-label">Optimal</div><div class="stake-val pos">+10</div></div>
                <div class="stake-box"><div class="stake-label">Good</div><div class="stake-val" style="color:var(--blue)">+5</div></div>
                <div class="stake-box"><div class="stake-label">Risky / Poor</div><div class="stake-val neg">−5</div></div>
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
    const puzzle = THRILL_PUZZLES[Math.floor(Math.random() * THRILL_PUZZLES.length)];
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
            const offset = circumference - (thrillRemaining / 60) * circumference;
            circle.style.strokeDashoffset = offset;
        }
        if (circle) {
            if (thrillRemaining <= 10)      circle.style.stroke = 'var(--red)';
            else if (thrillRemaining <= 30) circle.style.stroke = 'var(--amber)';
        }
        if (timerText) {
            if (thrillRemaining <= 10)      timerText.style.color = 'var(--red)';
            else if (thrillRemaining <= 30) timerText.style.color = 'var(--amber)';
        }
        if (thrillRemaining <= 0) {
            clearInterval(thrillTimer); thrillTimer = null;
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
    const q = db.collection(USERS_COL).orderBy('rating', 'desc').limit(20);
    leaderboardUnsubscribe = q.onSnapshot(snapshot => {
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

    // SECURITY: Build leaderboard rows using DOM methods (textContent) instead of
    // string concatenation to prevent XSS from malicious usernames stored in Firestore.
    body.innerHTML = '';
    docs.forEach((doc, i) => {
        const u = doc.data();
        const rank = i + 1;
        const isMe = currentUser && u.username === currentUser.username;
        const rankClass = rank === 1 ? 'r1' : rank === 2 ? 'r2' : rank === 3 ? 'r3' : '';

        const row = document.createElement('div');
        row.className = `lb-row${isMe ? ' is-me' : ''}`;

        // Each cell uses textContent — XSS-safe regardless of what's in Firestore
        const rankCell = document.createElement('div'); rankCell.className = 'lbc rank';
        const badge = document.createElement('span'); badge.className = `rank-badge ${rankClass}`;
        badge.textContent = `#${rank}`;
        rankCell.appendChild(badge);

        const nameCell = document.createElement('div'); nameCell.className = 'lbc username';
        const nameSpan = document.createElement('span'); nameSpan.className = `lb-username${isMe ? ' me' : ''}`;
        nameSpan.textContent = u.username + (isMe ? ' (you)' : '');
        nameCell.appendChild(nameSpan);

        const ratingCell = document.createElement('div'); ratingCell.className = 'lbc rating';
        const ratingSpan = document.createElement('span'); ratingSpan.className = 'lb-rating-val';
        ratingSpan.textContent = u.rating;
        ratingCell.appendChild(ratingSpan);

        const accCell = document.createElement('div'); accCell.className = 'lbc accuracy';
        const accSpan = document.createElement('span'); accSpan.className = 'lb-accuracy-val';
        accSpan.textContent = `${u.accuracy}%`;
        accCell.appendChild(accSpan);

        const puzCell = document.createElement('div'); puzCell.className = 'lbc puzzles';
        const puzSpan = document.createElement('span'); puzSpan.className = 'lb-puzzles-val';
        puzSpan.textContent = u.puzzlesSolved;
        puzCell.appendChild(puzSpan);

        row.append(rankCell, nameCell, ratingCell, accCell, puzCell);
        body.appendChild(row);
    });
}

// ===== PROFILE =====
async function renderProfile() {
    if (!currentUser) { showSection('login'); return; }
    try {
        const snap = await db.collection(USERS_COL).doc(currentUser.username).get();
        if (snap.exists) currentUser = snap.data();
    } catch (err) { /* use local data */ }

    const u = currentUser;
    setEl('profileUsername', u.username);       // setEl uses textContent — safe
    setEl('profileRating', u.rating);
    setEl('profileAccuracy', `${u.accuracy}%`);
    setEl('profilePuzzles', u.puzzlesSolved);
    setEl('profileStreak', u.streak);

    const calibScore = u.calibrationScore != null ? u.calibrationScore.toFixed(3) : '—';
    const calibForecastCount = u.calibrationForecastCount || 0;
    setEl('profileCalibrationScore', calibScore);
    const calibLabel = document.getElementById('profileCalibrationLabel');
    if (calibLabel) {
        if (calibForecastCount === 0) {
            calibLabel.textContent = 'No forecasts yet';
        } else {
            const tier = getCalibrationTier(u.calibrationScore);
            calibLabel.textContent = `${tier} · ${calibForecastCount} resolved`;
            calibLabel.style.color = tier === 'Expert' ? 'var(--green)' : tier === 'Skilled' ? 'var(--cyan)' : tier === 'Learning' ? 'var(--amber)' : 'var(--text-3)';
        }
    }

    const av = document.getElementById('profileAvatar');
    if (av) av.textContent = u.username.charAt(0).toUpperCase();

    const rankSnap = await db.collection(USERS_COL).where('rating', '>', u.rating).get().catch(() => null);
    const rank = rankSnap ? rankSnap.size + 1 : '—';
    setEl('profileRankBadge', `#${rank} Global Rank`);

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

    const actFeed = document.getElementById('recentActivity');
    const activity = (u.recentActivity || []).slice().reverse().slice(0, 10);
    if (actFeed) {
        if (activity.length === 0) {
            actFeed.innerHTML = '<p class="empty-activity">No activity yet. Start solving puzzles!</p>';
        } else {
            // SECURITY: Use DOM construction for user-influenced data
            actFeed.innerHTML = '';
            activity.forEach(a => {
                const sign  = a.ratingDelta >= 0 ? '+' : '';
                const cls   = a.ratingDelta >= 0 ? 'pos' : 'neg';
                const when  = timeAgo(a.ts);

                const item = document.createElement('div');
                item.className = 'activity-item';

                const left = document.createElement('div');
                const title = document.createElement('div'); title.className = 'act-title';
                title.textContent = a.puzzle; // textContent: safe
                const meta = document.createElement('div'); meta.className = 'act-meta';
                meta.textContent = `${a.quality.toUpperCase()} · ${when}`;
                left.append(title, meta);

                const result = document.createElement('div');
                result.className = `activity-result ${cls}`;
                result.textContent = `${sign}${a.ratingDelta}`;

                item.append(left, result);
                actFeed.appendChild(item);
            });
        }
    }
}

function animateBar(id, count, total) {
    const el = document.getElementById(id);
    if (!el) return;
    const pct = Math.round((count / total) * 100);
    setTimeout(() => { el.style.width = pct + '%'; }, 100);
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

// ===== TOAST =====
function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icon = document.createElement('span'); icon.className = 'toast-icon';
    icon.textContent = icons[type] || 'ℹ️';
    const msg = document.createElement('span');
    msg.textContent = message; // textContent: prevents XSS in toast messages
    toast.append(icon, msg);
    container.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('hiding');
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}

// ===== FLOATING RATING =====
function spawnFloatRating(delta) {
    const el = document.createElement('div');
    el.className = `float-rating ${delta >= 0 ? 'pos' : 'neg'}`;
    el.textContent = (delta >= 0 ? '+' : '') + delta;
    el.style.left = '50%'; el.style.top = '45%';
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

/**
 * Safe DOM text setter. Uses textContent, never innerHTML.
 * This is the correct way to set dynamic text in the DOM.
 */
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
        id: 'q1', category: 'Index',
        text: 'Will Nifty 50 close above its current level by end of this week?',
        description: 'Based on technical setup, macro flow, and FII/DII data.',
        disclaimer: 'For educational purposes only. Not financial advice.'
    },
    {
        id: 'q2', category: 'Crypto',
        text: 'Will Bitcoin trade above $70,000 at any point this week?',
        description: 'Consider ETF flow trends, macro risk sentiment, and on-chain data.',
        disclaimer: 'Crypto markets are highly volatile. Educational only.'
    },
    {
        id: 'q3', category: 'Macro',
        text: 'Will the US Dollar Index (DXY) weaken vs the Indian Rupee this week?',
        description: 'Factor in Fed rhetoric, RBI stance, and crude oil impact on INR.',
        disclaimer: 'FX forecasting involves significant uncertainty.'
    }
];

let predictionAnswers  = { q1: null, q2: null, q3: null };
let predTimerInterval  = null;
const predChartInstances = {};

function getCurrentWeekKey() {
    const now  = new Date();
    const year = now.getFullYear();
    const startOfYear = new Date(year, 0, 1);
    const week = Math.ceil((((now - startOfYear) / 86400000) + startOfYear.getDay() + 1) / 7);
    return `${year}-W${String(week).padStart(2, '0')}`;
}

function getTimeUntilWeekEnd() {
    const now = new Date();
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
    if (days > 0) return `${days}d ${hours}h ${minutes}m`;
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
        const userPredRef  = db.collection('userPredictions').doc(currentUser.username);
        const userPredSnap = await userPredRef.get();
        const hasSubmitted = userPredSnap.exists && userPredSnap.data()[weekKey]?.submitted;
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
    const container = document.getElementById('predQuestionsContainer');
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
    // Validate that questionId is one of the known IDs before using it
    if (!['q1', 'q2', 'q3'].includes(questionId)) return;

    const num     = parseInt(value);
    if (isNaN(num) || num < 0 || num > 100) return; // bounds check

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
    const btn = document.getElementById('predSubmitBtn');
    const hint = document.querySelector('.pred-submit-hint');
    if (btn) btn.disabled = !allSet;
    if (hint) hint.style.display = allSet ? 'none' : 'block';
}

async function submitPredictions() {
    if (!currentUser) return;
    const allSet = Object.values(predictionAnswers).every(v => v !== null);
    if (!allSet) { showToast('Please move all three sliders first.', 'warning'); return; }

    // Server-side style bounds check before writing to Firestore
    for (const [key, val] of Object.entries(predictionAnswers)) {
        if (!Number.isInteger(val) || val < 0 || val > 100) {
            showToast('Invalid prediction value detected.', 'error');
            return;
        }
    }

    const weekKey   = getCurrentWeekKey();
    const timestamp = Date.now();
    const submitBtn = document.getElementById('predSubmitBtn');
    submitBtn.disabled  = true;
    submitBtn.innerHTML = 'Submitting...';

    try {
        const batch = db.batch();
        PREDICTION_QUESTIONS.forEach(q => {
            const predRef = db.collection('predictions').doc(weekKey).collection(q.id).doc(currentUser.username);
            batch.set(predRef, { probability: predictionAnswers[q.id], timestamp, username: currentUser.username });
        });
        const userPredRef = db.collection('userPredictions').doc(currentUser.username);
        batch.set(userPredRef, {
            [weekKey]: { submitted: true, timestamp, answers: [predictionAnswers.q1, predictionAnswers.q2, predictionAnswers.q3] }
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
    container.innerHTML = `<div class="pred-results-loading"><div class="pred-loading-spinner"></div>Loading crowd data...</div>`;
    Object.values(predChartInstances).forEach(c => c.destroy());

    try {
        const userPredRef  = db.collection('userPredictions').doc(currentUser.username);
        const userPredSnap = await userPredRef.get();
        const userAnswers  = userPredSnap.data()[weekKey].answers;

        const resultsHTML = await Promise.all(PREDICTION_QUESTIONS.map(async (q, idx) => {
            const qSnap    = await db.collection('predictions').doc(weekKey).collection(q.id).get();
            const allProbs = [];
            qSnap.forEach(doc => allProbs.push(doc.data().probability));
            const userProb = userAnswers[idx];
            const mean     = allProbs.length > 0 ? Math.round(allProbs.reduce((a, b) => a + b, 0) / allProbs.length) : userProb;
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
                        <div class="pred-stat"><div class="pred-stat-value user mono">${userProb}%</div><div class="pred-stat-label">Your Forecast</div></div>
                        <div class="pred-stat-divider"></div>
                        <div class="pred-stat"><div class="pred-stat-value mono">${mean}%</div><div class="pred-stat-label">Crowd Mean</div></div>
                        <div class="pred-stat-divider"></div>
                        <div class="pred-stat"><div class="pred-stat-value ${diffCls} mono">${diffSign}${diff}%</div><div class="pred-stat-label">vs Crowd</div></div>
                        <div class="pred-stat-divider"></div>
                        <div class="pred-stat"><div class="pred-stat-value mono">${count}</div><div class="pred-stat-label">Participants</div></div>
                    </div>
                    <div class="pred-chart-wrap"><canvas id="chart_${q.id}" height="160"></canvas></div>
                </div>`;
        }));
        container.innerHTML = resultsHTML.join('');
        setTimeout(() => {
            PREDICTION_QUESTIONS.forEach((q, idx) => renderPredictionChart(q.id, weekKey, userAnswers[idx]));
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
    const buckets      = { '0–20': 0, '21–40': 0, '41–60': 0, '61–80': 0, '81–100': 0 };
    const bucketKeys   = Object.keys(buckets);
    const userBucket   = getProbabilityBucket(userProb);
    allProbs.forEach(p => { buckets[getProbabilityBucket(p)]++; });
    const bgColors     = bucketKeys.map(b => b === userBucket ? 'rgba(0,229,255,0.75)' : 'rgba(61,142,240,0.35)');
    const borderColors = bucketKeys.map(b => b === userBucket ? '#00e5ff' : '#3d8ef0');
    if (predChartInstances[questionId]) predChartInstances[questionId].destroy();
    predChartInstances[questionId] = new Chart(canvas, {
        type: 'bar',
        data: {
            labels: bucketKeys,
            datasets: [{ label: 'Forecasters', data: Object.values(buckets), backgroundColor: bgColors, borderColor: borderColors, borderWidth: 2, borderRadius: 6, borderSkipped: false }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#131d2e', titleColor: '#e8edf5', bodyColor: '#7b92b2',
                    borderColor: '#1e2d47', borderWidth: 1, padding: 10,
                    callbacks: {
                        title: (items) => `Probability range: ${items[0].label}%`,
                        label: (item)  => ` ${item.raw} forecaster${item.raw !== 1 ? 's' : ''}`
                    }
                }
            },
            scales: {
                y: { beginAtZero: true, ticks: { color: '#3d5070', stepSize: 1, font: { family: "'JetBrains Mono', monospace", size: 11 } }, grid: { color: '#192336' } },
                x: { ticks: { color: '#7b92b2', font: { size: 11 } }, grid: { display: false } }
            }
        }
    });
}

function getProbabilityBucket(prob) {
    if (prob <= 20)  return '0–20';
    if (prob <= 40)  return '21–40';
    if (prob <= 60)  return '41–60';
    if (prob <= 80)  return '61–80';
    return '81–100';
}
