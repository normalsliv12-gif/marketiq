// ============================================================
//  MARKETIQ — Main Application Logic
//  Firebase Firestore + Full Game Logic
// ============================================================

// ===== STATE =====
let currentUser   = null;   // { username, ...firestoreData }
let currentPuzzle = null;
let selectedOption = null;
let thrillTimer    = null;
let thrillRemaining = 60;
let leaderboardUnsubscribe = null; // for real-time listener

// ===== FIRESTORE COLLECTION =====
const USERS_COL = "users";

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
    initApp();
});

async function initApp() {
    animateLoadingBar();

    // Check saved session
    const savedUsername = localStorage.getItem('miq_session');

    if (savedUsername) {
        try {
            const snap = await db.collection(USERS_COL).doc(savedUsername).get();
            if (snap.exists) {
                const userData = snap.data();
                currentUser = userData;

                // Legacy account check: no passwordHash set → force password creation
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
                // User in storage but not in Firestore (cleared?)
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

    // Section-specific logic
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

// ===== PASSWORD UTILITIES =====

// Simple SHA-256 hash using Web Crypto API
async function hashPassword(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password + 'miq_salt_v1');
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
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
    if (score <= 1) return { label: 'Weak', color: '#ff4560', width: '25%' };
    if (score <= 2) return { label: 'Fair', color: '#ffb800', width: '50%' };
    if (score <= 3) return { label: 'Good', color: '#3d8ef0', width: '75%' };
    return { label: 'Strong', color: '#00e676', width: '100%' };
}

// Pending user state for password modal flow
let _pendingModalUser = null;

// ===== LOGIN =====
async function handleLogin(event) {
    event.preventDefault();
    const username = document.getElementById('usernameInput').value.trim();
    const password = document.getElementById('passwordInput').value;

    if (!username) return;
    if (username.length < 3) { showToast("Username must be at least 3 characters.", 'error'); return; }

    const btn = document.getElementById('loginBtn');
    btn.disabled = true;
    btn.textContent = "Connecting...";

    try {
        const ref  = db.collection(USERS_COL).doc(username);
        const snap = await ref.get();

        if (snap.exists) {
            // ── RETURNING USER ──
            const userData = snap.data();

            if (userData.passwordHash) {
                // ── PASSWORD-PROTECTED ACCOUNT: password is mandatory ──
                if (!password) {
                    showToast("Please enter your password.", 'error');
                    document.getElementById('passwordInput').focus();
                    btn.disabled = false;
                    btn.textContent = "Start Competing";
                    return;
                }
                const inputHash = await hashPassword(password);
                if (inputHash !== userData.passwordHash) {
                    showToast("Incorrect password. Try again.", 'error');
                    document.getElementById('passwordInput').value = '';
                    document.getElementById('passwordInput').focus();
                    btn.disabled = false;
                    btn.textContent = "Start Competing";
                    return;
                }
                // Correct password ✓
                currentUser = userData;
                showToast(`Welcome back, ${username}! Rating: ${currentUser.rating}`, 'success');
                finalizeLogin(username);

            } else {
                // ── LEGACY ACCOUNT: no password set → force password creation ──
                currentUser = userData;
                finalizeLogin(username, false);
                handleLegacyPassword(userData, ref, username);
            }

        } else {
            // ── NEW USER: password is mandatory ──
            if (!password) {
                showToast("Please create a password to register your account.", 'error');
                document.getElementById('passwordInput').focus();
                btn.disabled = false;
                btn.textContent = "Start Competing";
                return;
            }
            if (password.length < 4) {
                showToast("Password must be at least 4 characters.", 'error');
                btn.disabled = false;
                btn.textContent = "Start Competing";
                return;
            }
            const hash = await hashPassword(password);
            const newUser = { ...buildNewUser(username), passwordHash: hash };
            await ref.set(newUser);
            currentUser = newUser;
            showToast(`Welcome to MarketIQ, ${username}! Starting rating: 1200`, 'success');
            finalizeLogin(username);
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

// Tracks whether the modal is in "forced" mode (cannot be dismissed)
let _modalForced = false;

function openSetPasswordModal(forced = false) {
    _modalForced = forced;
    const modal = document.getElementById('setPasswordModal');
    modal.style.display = 'flex';
    setTimeout(() => modal.classList.add('modal-visible'), 10);
    document.getElementById('newPasswordInput').focus();
}

// Backdrop click — only dismissable when not in forced mode
function closeSetPasswordModal(event) {
    if (_modalForced) return; // cannot dismiss mandatory modal
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

// ── LEGACY PASSWORD HANDLER ──
// Called for accounts that exist in Firestore but have no passwordHash.
// Forces the user to create a password before they can use the app.
function handleLegacyPassword(userData, ref, username) {
    _pendingModalUser = { userData, ref, username, isNew: false, isLegacy: true };

    const titleEl    = document.getElementById('setPasswordTitle');
    const subtitleEl = document.getElementById('setPasswordSubtitle');
    if (titleEl)    titleEl.textContent    = "Password Required";
    if (subtitleEl) subtitleEl.textContent = "Your account needs a password to stay secure. Please create one to continue.";

    document.getElementById('newPasswordInput').value     = '';
    document.getElementById('confirmPasswordInput').value = '';
    document.getElementById('newPasswordInput').addEventListener('input', onNewPasswordInput);

    showToast(`Welcome back, ${username}! Please set a password to continue.`, 'info');
    openSetPasswordModal(true /* forced */);
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

    if (newPw.length < 4) { showToast("Password must be at least 4 characters.", 'error'); return; }
    if (newPw !== confPw) { showToast("Passwords don't match.", 'error'); return; }
    // Strength is shown as guidance only — any password ≥ 4 chars is accepted at the user's discretion.

    const btn = document.getElementById('setPasswordBtn');
    btn.disabled = true;
    btn.textContent = "Saving...";

    try {
        const hash = await hashPassword(newPw);
        if (_pendingModalUser) {
            await _pendingModalUser.ref.update({ passwordHash: hash });
            if (currentUser) currentUser.passwordHash = hash;
        }
        _closeModal();
        showToast("Password set! Your account is now protected.", 'success');
        _pendingModalUser = null;

        // If this was a legacy forced-modal flow, ensure home is shown
        if (currentUser) {
            updateNavUser();
            showSection('home');
        }
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

// ===== CHANGE PASSWORD (from Profile) =====
function changePassword() {
    if (!currentUser) return;
    const ref = db.collection(USERS_COL).doc(currentUser.username);

    _pendingModalUser = { userData: currentUser, ref, username: currentUser.username, isNew: false, isLegacy: false };

    const titleEl    = document.getElementById('setPasswordTitle');
    const subtitleEl = document.getElementById('setPasswordSubtitle');
    if (titleEl)    titleEl.textContent    = "Change Password";
    if (subtitleEl) subtitleEl.textContent = "Enter a new password for your account. You can do this any time.";

    document.getElementById('newPasswordInput').value     = '';
    document.getElementById('confirmPasswordInput').value = '';
    const strengthWrap = document.getElementById('passwordStrengthWrap');
    if (strengthWrap) strengthWrap.style.display = 'none';

    document.getElementById('newPasswordInput').addEventListener('input', onNewPasswordInput);
    openSetPasswordModal(false /* not forced — user can navigate away */);
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
        // Don't save to Firestore yet — will save when they answer
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
    if (!window.LightweightCharts) {
        console.error("LightweightCharts not loaded");
        return;
    }

    const container = document.getElementById('chartContainer');
    if (!container) {
        console.error("Chart container not found");
        return;
    }

    const chart = LightweightCharts.createChart(container, {
        width: container.clientWidth,
        height: 320,
        layout: {
            background: { color: '#0f172a' },
            textColor: '#d1d5db',
        },
        grid: {
            vertLines: { color: '#1f2937' },
            horzLines: { color: '#1f2937' },
        },
        crosshair: { mode: 1 },
        rightPriceScale: { borderColor: '#374151' },
        timeScale: { borderColor: '#374151' }
    });

    const candleSeries = chart.addCandlestickSeries();
    candleSeries.setData(data);

    window.addEventListener('resize', () => {
        chart.applyOptions({
            width: container.clientWidth
        });
    });
}

function renderPuzzle(container, puzzle, isThrill) {
    const label = isThrill ? 'THRILL ROUND' : `Puzzle ${(currentUser.dailyPuzzlesCompleted ?? 0) + 1} of ${DAILY_PUZZLES.length}`;
    const chartHTML = `
    <div class="puzzle-chart">
        <div id="chartContainer" style="width:100%; height:320px;"></div>
    </div>
`;


    container.innerHTML = `
        <div class="puzzle-label">${label}</div>
        <h2 class="puzzle-title">${puzzle.title}</h2>
        ${chartHTML}
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
// Delay slightly so DOM renders first
setTimeout(() => {
    if (puzzle.chartData) {
        renderChart(puzzle.chartData);
    }
}, 50);

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
    if (isThrill && thrillTimer) { clearInterval(thrillTimer); thrillTimer = null; }

    // Disable all options
    const gridId = `optGrid_${isThrill ? 'thrill' : 'daily'}`;
    document.querySelectorAll(`#${gridId} .option-btn`).forEach(btn => {
        btn.disabled = true;
        if (btn.dataset.quality === 'optimal') btn.classList.add('reveal-optimal');
        else if (btn.classList.contains('selected'))  btn.classList.add('reveal-wrong');
    });
    const submitId = `submitBtn_${isThrill ? 'thrill' : 'daily'}`;
    const submitBtn = document.getElementById(submitId);
    if (submitBtn) submitBtn.style.display = 'none';

    // Rating change
    const ratingDelta = isThrill ? THRILL_RATING_CHANGES[selectedOption] : RATING_CHANGES[selectedOption];
    const isGoodChoice = selectedOption === 'optimal' || selectedOption === 'good';

    // Update local user object
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

    // Update streak
    updateStreak();

    // Save to Firestore
    try {
        await db.collection(USERS_COL).doc(currentUser.username).update({
            rating:                 currentUser.rating,
            puzzlesSolved:          currentUser.puzzlesSolved,
            accuracy:               currentUser.accuracy,
            streak:                 currentUser.streak,
            performance:            currentUser.performance,
            dailyPuzzlesCompleted:  currentUser.dailyPuzzlesCompleted,
            lastPlayedDate:         currentUser.lastPlayedDate,
            lastThrillDate:         currentUser.lastThrillDate,
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

    // Update nav chip
    updateNavUser();
    updateProgressDots(currentUser.dailyPuzzlesCompleted);
    setEl('dailyRemaining', Math.max(0, 3 - currentUser.dailyPuzzlesCompleted));

    // Floating rating animation
    spawnFloatRating(ratingDelta);

    // Render feedback
    const feedbackArea = document.getElementById(`feedbackArea_${isThrill ? 'thrill' : 'daily'}`);
    renderFeedback(feedbackArea, currentPuzzle, selectedOption, ratingDelta, isThrill);
}

function renderFeedback(container, puzzle, quality, ratingDelta, isThrill) {
    const labels = { optimal: '🎯 Optimal Decision', good: '✅ Good Choice', risky: '⚠️ Risky Move', poor: '❌ Poor Decision' };
    const sign   = ratingDelta >= 0 ? '+' : '';
    const cls    = ratingDelta >= 0 ? 'pos' : 'neg';
    const nextLabel = isThrill
        ? 'Back to Home'
        : currentUser.dailyPuzzlesCompleted >= DAILY_PUZZLES.length ? 'View Results' : 'Next Puzzle →';
    const nextAction = isThrill
        ? `showSection('home')`
        : `loadDailyPuzzle()`;

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

    const puzzle = THRILL_PUZZLES[Math.floor(Math.random() * THRILL_PUZZLES.length)];
    currentPuzzle = puzzle;

    const statusEl = document.getElementById('thrillStatus');
    const puzzleEl = document.getElementById('thrillPuzzleContainer');

    // Show circular timer
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
    const circumference = 2 * Math.PI * 44; // 276.46

    thrillTimer = setInterval(() => {
        thrillRemaining--;

        const timerText = document.getElementById('timerDisplay');
        const circle    = document.getElementById('timerCircle');

        if (timerText) timerText.textContent = thrillRemaining;
        if (circle) {
            const offset = circumference - (thrillRemaining / 60) * circumference;
            circle.style.strokeDashoffset = offset;
        }

        // Change color as time runs low
        if (circle) {
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
            // Auto-submit as poor if no answer
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

    const q = db.collection(USERS_COL)
        .orderBy('rating', 'desc')
        .limit(20);

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

    body.innerHTML = docs.map((doc, i) => {
        const u = doc.data();
        const rank = i + 1;
        const isMe = currentUser && u.username === currentUser.username;
        const rankClass = rank === 1 ? 'r1' : rank === 2 ? 'r2' : rank === 3 ? 'r3' : '';

        return `
            <div class="lb-row ${isMe ? 'is-me' : ''}">
                <div class="lbc rank">
                    <span class="rank-badge ${rankClass}">#${rank}</span>
                </div>
                <div class="lbc username">
                    <span class="lb-username ${isMe ? 'me' : ''}">${u.username}${isMe ? ' (you)' : ''}</span>
                </div>
                <div class="lbc rating">
                    <span class="lb-rating-val">${u.rating}</span>
                </div>
                <div class="lbc accuracy">
                    <span class="lb-accuracy-val">${u.accuracy}%</span>
                </div>
                <div class="lbc puzzles">
                    <span class="lb-puzzles-val">${u.puzzlesSolved}</span>
                </div>
            </div>`;
    }).join('');
}

// ===== PROFILE =====
async function renderProfile() {
    if (!currentUser) { showSection('login'); return; }

    // Refresh user data from Firestore
    try {
        const snap = await db.collection(USERS_COL).doc(currentUser.username).get();
        if (snap.exists) currentUser = snap.data();
    } catch (err) { /* use local data */ }

    const u = currentUser;
    setEl('profileUsername', u.username);
    setEl('profileRating', u.rating);
    setEl('profileAccuracy', `${u.accuracy}%`);
    setEl('profilePuzzles', u.puzzlesSolved);
    setEl('profileStreak', u.streak);

    // Calibration score display
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

    // Avatar initial
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
    const actFeed = document.getElementById('recentActivity');
    const activity = (u.recentActivity || []).slice().reverse().slice(0, 10);
    if (actFeed) {
        if (activity.length === 0) {
            actFeed.innerHTML = '<p class="empty-activity">No activity yet. Start solving puzzles!</p>';
        } else {
            actFeed.innerHTML = activity.map(a => {
                const sign  = a.ratingDelta >= 0 ? '+' : '';
                const cls   = a.ratingDelta >= 0 ? 'pos' : 'neg';
                const when  = timeAgo(a.ts);
                return `
                    <div class="activity-item">
                        <div>
                            <div class="act-title">${a.puzzle}</div>
                            <div class="act-meta">${a.quality.toUpperCase()} · ${when}</div>
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
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span class="toast-icon">${icons[type] || 'ℹ️'}</span><span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('hiding');
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}

// ===== FLOATING RATING CHANGE =====
function spawnFloatRating(delta) {
    const el = document.createElement('div');
    el.className = `float-rating ${delta >= 0 ? 'pos' : 'neg'}`;
    el.textContent = (delta >= 0 ? '+' : '') + delta;
    el.style.left = '50%';
    el.style.top  = '45%';
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
//  3 questions · crowd consensus · Chart.js visualization
// ============================================================


// ===== PREDICTION QUESTIONS (edit weekly) =====
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

// ===== STATE =====
let predictionAnswers  = { q1: null, q2: null, q3: null };
let predTimerInterval  = null;
const predChartInstances = {};   // track Chart.js instances to destroy on re-render

// ===== WEEK KEY HELPERS =====
function getCurrentWeekKey() {
    const now  = new Date();
    const year = now.getFullYear();
    // ISO week number
    const startOfYear = new Date(year, 0, 1);
    const week = Math.ceil((((now - startOfYear) / 86400000) + startOfYear.getDay() + 1) / 7);
    return `${year}-W${String(week).padStart(2, '0')}`;
}

function getTimeUntilWeekEnd() {
    const now    = new Date();
    // Week ends Sunday 23:59:59
    const endOfWeek = new Date(now);
    endOfWeek.setDate(now.getDate() + (7 - now.getDay()) % 7 || 7);
    endOfWeek.setHours(23, 59, 59, 999);
    const diff   = endOfWeek - now;
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

// ===== LOAD PREDICTIONS =====
async function loadPredictions() {
    if (!currentUser) { showSection('login'); return; }

    // Clear any existing timer
    if (predTimerInterval) { clearInterval(predTimerInterval); predTimerInterval = null; }

    const weekKey = getCurrentWeekKey();

    // Start countdown
    updatePredictionTimer();
    predTimerInterval = setInterval(updatePredictionTimer, 1000);

    try {
        const userPredRef  = db.collection('userPredictions').doc(currentUser.username);
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

// ===== COUNTDOWN TIMER =====
function updatePredictionTimer() {
    const el = document.getElementById('predTimeRemaining');
    if (!el) return;
    el.textContent = formatTimeRemaining(getTimeUntilWeekEnd());
}

// ===== RENDER QUESTION CARDS =====
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

    // Reset submit button
    const btn = document.getElementById('predSubmitBtn');
    if (btn) {
        btn.disabled     = true;
        btn.innerHTML    = 'Submit Forecasts <span class="btn-arrow">→</span>';
    }
    const hint = document.querySelector('.pred-submit-hint');
    if (hint) hint.style.display = 'block';
}

// ===== SLIDER UPDATE =====
function updatePredictionValue(questionId, value) {
    const num     = parseInt(value);
    const valueEl = document.getElementById(`value_${questionId}`);
    const fillEl  = document.getElementById(`fill_${questionId}`);

    if (valueEl) valueEl.textContent = num;
    if (fillEl)  fillEl.style.width  = num + '%';

    // Color the value pill by zone
    const pill = valueEl?.closest('.pred-value-pill');
    if (pill) {
        pill.className = 'pred-value-pill';
        if (num >= 70)      pill.classList.add('prob-high');
        else if (num <= 30) pill.classList.add('prob-low');
    }

    predictionAnswers[questionId] = num;

    // Enable submit only when ALL three sliders have been touched
    const allSet = Object.values(predictionAnswers).every(v => v !== null);
    const btn    = document.getElementById('predSubmitBtn');
    const hint   = document.querySelector('.pred-submit-hint');
    if (btn) btn.disabled = !allSet;
    if (hint) hint.style.display = allSet ? 'none' : 'block';
}

// ===== SUBMIT PREDICTIONS =====
async function submitPredictions() {
    if (!currentUser) return;

    const allSet = Object.values(predictionAnswers).every(v => v !== null);
    if (!allSet) { showToast('Please move all three sliders first.', 'warning'); return; }

    const weekKey   = getCurrentWeekKey();
    const timestamp = Date.now();
    const submitBtn = document.getElementById('predSubmitBtn');

    submitBtn.disabled   = true;
    submitBtn.innerHTML  = 'Submitting...';

    try {
        const batch = db.batch();

        // Store each individual forecast (for crowd aggregation)
        PREDICTION_QUESTIONS.forEach(q => {
            const predRef = db.collection('predictions')
                              .doc(weekKey)
                              .collection(q.id)
                              .doc(currentUser.username);
            batch.set(predRef, {
                probability: predictionAnswers[q.id],
                timestamp,
                username: currentUser.username
            });
        });

        // Store submission record on user doc
        const userPredRef = db.collection('userPredictions').doc(currentUser.username);
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

// ===== RENDER RESULTS =====
async function renderPredictionResults(weekKey) {
    const container = document.getElementById('predResultsContainer');
    if (!container) return;
    container.innerHTML = `
        <div class="pred-results-loading">
            <div class="pred-loading-spinner"></div>
            Loading crowd data...
        </div>`;

    // Destroy any existing Chart.js instances
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

        // Render charts after DOM update
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

// ===== CHART RENDER =====
async function renderPredictionChart(questionId, weekKey, userProb) {
    const canvas = document.getElementById(`chart_${questionId}`);
    if (!canvas) return;

    const qSnap    = await db.collection('predictions').doc(weekKey).collection(questionId).get();
    const allProbs = [];
    qSnap.forEach(doc => allProbs.push(doc.data().probability));

    // Build 5-bucket distribution
    const buckets      = { '0–20': 0, '21–40': 0, '41–60': 0, '61–80': 0, '81–100': 0 };
    const bucketKeys   = Object.keys(buckets);
    const userBucket   = getProbabilityBucket(userProb);
    allProbs.forEach(p => { buckets[getProbabilityBucket(p)]++; });

    const bgColors     = bucketKeys.map(b =>
        b === userBucket ? 'rgba(0,229,255,0.75)' : 'rgba(61,142,240,0.35)'
    );
    const borderColors = bucketKeys.map(b =>
        b === userBucket ? '#00e5ff' : '#3d8ef0'
    );

    // Destroy previous instance if exists
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
    if (prob <= 20)  return '0–20';
    if (prob <= 40)  return '21–40';
    if (prob <= 60)  return '41–60';
    if (prob <= 80)  return '61–80';
    return '81–100';
}

function calculateMean(arr) {
    if (!arr || arr.length === 0) return 0;
    return Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
}

function calculateDistribution(arr) {
    const d = { '0–20': 0, '21–40': 0, '41–60': 0, '61–80': 0, '81–100': 0 };
    arr.forEach(p => { d[getProbabilityBucket(p)]++; });
    return d;
}
// ============================================================
//  NOTES MODULE — Interactive Learning System
//  Professional slide-based education with animations
// ============================================================

let currentSlideIndex = 0;
let currentChapterData = null;

// ===== CHAPTER DATA =====
const CHAPTERS = {
    fundamentals: {
        title: 'Stock Market Fundamentals',
        slides: [
            {
                title: 'Welcome to Stock Markets',
                subtitle: 'Your journey to financial literacy starts here',
                content: `<div class="slide-text-content">
                    <p>The stock market is where shares of public companies are bought and sold. It's a marketplace that connects buyers and sellers, enabling <strong>price discovery</strong> and <strong>capital formation</strong>.</p>
                    <p><strong>Key Point:</strong> You're not just trading pieces of paper—you're becoming a part-owner of real businesses.</p>
                </div>`,
                visual: `<div class="slide-visual-hero">
                    <svg viewBox="0 0 200 140" class="slide-svg">
                        <defs>
                            <linearGradient id="grad1" x1="0%" y1="0%" x2="0%" y2="100%">
                                <stop offset="0%" style="stop-color:var(--green);stop-opacity:0.8" />
                                <stop offset="100%" style="stop-color:var(--green);stop-opacity:0.3" />
                            </linearGradient>
                        </defs>
                        <rect x="20" y="40" width="30" height="75" fill="url(#grad1)" rx="4" class="chart-bar"/>
                        <rect x="60" y="55" width="30" height="60" fill="var(--cyan)" opacity="0.75" rx="4" class="chart-bar" style="animation-delay:0.1s"/>
                        <rect x="100" y="30" width="30" height="85" fill="var(--blue)" opacity="0.75" rx="4" class="chart-bar" style="animation-delay:0.2s"/>
                        <rect x="140" y="45" width="30" height="70" fill="var(--amber)" opacity="0.75" rx="4" class="chart-bar" style="animation-delay:0.3s"/>
                        <line x1="10" y1="120" x2="190" y2="120" stroke="var(--border-bright)" stroke-width="2"/>
                        <line x1="10" y1="20" x2="10" y2="120" stroke="var(--border-bright)" stroke-width="2"/>
                    </svg>
                    <p class="slide-caption">Markets reflect collective business performance</p>
                </div>`
            },
            {
                title: 'What is a Stock?',
                subtitle: 'Ownership in companies, digitally represented',
                content: `<div class="slide-text-content">
                    <p>A <strong>stock</strong> (or share) represents fractional ownership in a company. When you buy 100 shares of Apple, you own a tiny piece of the entire company.</p>
                    <p><strong>Why companies issue stock:</strong></p>
                    <ul class="slide-list">
                        <li>💰 Raise capital for expansion</li>
                        <li>📉 Pay off debt</li>
                        <li>🔬 Fund research & development</li>
                    </ul>
                </div>`,
                visual: `<div class="slide-visual-diagram">
                    <div class="diagram-flow">
                        <div class="diagram-box company">
                            <div class="diagram-icon">🏢</div>
                            <div class="diagram-label">Company ABC</div>
                        </div>
                        <div class="diagram-arrow">↓</div>
                        <div class="diagram-shares-row">
                            <div class="diagram-box share">📄</div>
                            <div class="diagram-box share">📄</div>
                            <div class="diagram-box share">📄</div>
                            <div class="diagram-box share">📄</div>
                        </div>
                    </div>
                    <div class="diagram-label-bottom">Divided into 1,000,000 shares</div>
                </div>`
            },
            {
                title: 'How Stock Markets Work',
                subtitle: 'Buyers meet sellers through exchanges',
                content: `<div class="slide-text-content">
                    <p>Stock markets are <strong>organized exchanges</strong> where trading happens electronically. Think of it as a giant auction house running continuously.</p>
                    <p><strong>Key Players:</strong></p>
                    <ul class="slide-list">
                        <li><strong>NSE/BSE:</strong> Indian stock exchanges</li>
                        <li><strong>NYSE/NASDAQ:</strong> US exchanges</li>
                        <li><strong>Brokers:</strong> Your gateway (Zerodha, Upstox)</li>
                        <li><strong>SEBI:</strong> Market regulator (ensures fairness)</li>
                    </ul>
                </div>`,
                visual: `<div class="slide-visual-flow">
                    <div class="flow-chain">
                        <div class="flow-step">
                            <div class="flow-icon buyer">👤</div>
                            <div class="flow-label">You (Buyer)</div>
                        </div>
                        <div class="flow-connector">→</div>
                        <div class="flow-step">
                            <div class="flow-icon broker">🏦</div>
                            <div class="flow-label">Broker</div>
                        </div>
                        <div class="flow-connector">→</div>
                        <div class="flow-step">
                            <div class="flow-icon exchange">📊</div>
                            <div class="flow-label">Exchange</div>
                        </div>
                        <div class="flow-connector">→</div>
                        <div class="flow-step">
                            <div class="flow-icon seller">👤</div>
                            <div class="flow-label">Seller</div>
                        </div>
                    </div>
                </div>`
            },
            {
                title: 'Understanding Candlesticks',
                subtitle: 'The language of price charts',
                content: `<div class="slide-text-content">
                    <p><strong>Candlesticks</strong> are visual representations of price movement in a time period. Each candle shows 4 prices:</p>
                    <ul class="slide-list">
                        <li><strong>Open:</strong> Starting price</li>
                        <li><strong>Close:</strong> Ending price</li>
                        <li><strong>High:</strong> Highest price reached</li>
                        <li><strong>Low:</strong> Lowest price reached</li>
                    </ul>
                    <p><strong>Color coding:</strong> Green = bullish (close > open), Red = bearish (close < open)</p>
                </div>`,
                visual: `<div class="slide-visual-candle">
                    <div class="candle-container">
                        <div class="candle-example bullish">
                            <div class="candle-wick-top"></div>
                            <div class="candle-body green"></div>
                            <div class="candle-wick-bottom"></div>
                            <div class="candle-labels left">
                                <span class="label-high">← High</span>
                                <span class="label-close">← Close</span>
                                <span class="label-open">← Open</span>
                                <span class="label-low">← Low</span>
                            </div>
                        </div>
                        <div class="candle-type-label">Bullish Candle</div>
                    </div>
                    <div class="candle-vs">vs</div>
                    <div class="candle-container">
                        <div class="candle-example bearish">
                            <div class="candle-wick-top"></div>
                            <div class="candle-body red"></div>
                            <div class="candle-wick-bottom"></div>
                            <div class="candle-labels right">
                                <span class="label-high">High →</span>
                                <span class="label-open">Open →</span>
                                <span class="label-close">Close →</span>
                                <span class="label-low">Low →</span>
                            </div>
                        </div>
                        <div class="candle-type-label">Bearish Candle</div>
                    </div>
                </div>`
            },
            {
                title: 'Market Participants',
                subtitle: 'Who trades and why',
                content: `<div class="slide-text-content">
                    <p>Markets consist of different types of participants with varying goals:</p>
                    <ul class="slide-list">
                        <li><strong>Retail Investors:</strong> Individual traders like you</li>
                        <li><strong>Institutional Investors:</strong> Mutual funds, pension funds</li>
                        <li><strong>FII/DII:</strong> Foreign and Domestic Institutions</li>
                        <li><strong>Market Makers:</strong> Provide liquidity</li>
                        <li><strong>Algorithmic Traders:</strong> Automated systems</li>
                    </ul>
                </div>`,
                visual: `<div class="slide-visual-participants">
                    <svg viewBox="0 0 200 140" class="participants-svg">
                        <circle cx="100" cy="70" r="55" fill="var(--bg-hover)" stroke="var(--border-bright)" stroke-width="2" class="participant-ring"/>
                        <circle cx="100" cy="70" r="38" fill="var(--cyan-dim)" opacity="0.6" class="participant-ring" style="animation-delay:0.2s"/>
                        <circle cx="100" cy="70" r="22" fill="var(--cyan)" opacity="0.8" class="participant-ring" style="animation-delay:0.4s"/>
                        <text x="100" y="35" text-anchor="middle" fill="var(--text-2)" font-size="11" font-family="var(--font-body)">Institutions</text>
                        <text x="100" y="65" text-anchor="middle" fill="var(--text-1)" font-size="11" font-family="var(--font-body)">Algorithms</text>
                        <text x="100" y="78" text-anchor="middle" fill="var(--text-1)" font-size="12" font-weight="700" font-family="var(--font-body)">Retail</text>
                    </svg>
                    <p class="slide-caption">Market ecosystem layers</p>
                </div>`
            },
            {
                title: 'Bull vs Bear Markets',
                subtitle: 'Understanding market sentiment',
                content: `<div class="slide-text-content">
                    <p><strong>Bull Market:</strong> Sustained upward trend, optimism prevails, prices rising 📈</p>
                    <p><strong>Bear Market:</strong> Sustained downward trend, pessimism prevails, prices falling 📉</p>
                    <p><strong>Why it matters:</strong> Market phase determines strategy. Bulls favor buying, bears favor caution or shorting.</p>
                </div>`,
                visual: `<div class="slide-visual-sentiment">
                    <div class="sentiment-side bull">
                        <div class="sentiment-icon">🐂</div>
                        <div class="sentiment-label">Bull Market</div>
                        <div class="sentiment-arrow-box">
                            <svg viewBox="0 0 60 80" class="sentiment-arrow-svg">
                                <polyline points="10 60, 30 20, 50 60" fill="none" stroke="var(--green)" stroke-width="5" stroke-linecap="round" class="trend-line"/>
                            </svg>
                        </div>
                        <div class="sentiment-desc">Prices Rising ↗</div>
                    </div>
                    <div class="sentiment-divider"></div>
                    <div class="sentiment-side bear">
                        <div class="sentiment-icon">🐻</div>
                        <div class="sentiment-label">Bear Market</div>
                        <div class="sentiment-arrow-box">
                            <svg viewBox="0 0 60 80" class="sentiment-arrow-svg">
                                <polyline points="10 20, 30 60, 50 20" fill="none" stroke="var(--red)" stroke-width="5" stroke-linecap="round" class="trend-line"/>
                            </svg>
                        </div>
                        <div class="sentiment-desc">Prices Falling ↘</div>
                    </div>
                </div>`
            },
            {
                title: 'Types of Orders',
                subtitle: 'How to execute trades',
                content: `<div class="slide-text-content">
                    <p><strong>Market Order:</strong> Buy/sell immediately at current price (instant execution) ⚡</p>
                    <p><strong>Limit Order:</strong> Buy/sell only at your specified price or better 🎯</p>
                    <p><strong>Stop-Loss Order:</strong> Automatic sell trigger to limit losses 🛡️</p>
                    <p><strong>Pro tip:</strong> Use limit orders to control entry price, stop-losses to protect capital.</p>
                </div>`,
                visual: `<div class="slide-visual-orders">
                    <div class="order-card market">
                        <div class="order-icon">⚡</div>
                        <div class="order-name">Market Order</div>
                        <div class="order-desc">Instant @ Current Price</div>
                    </div>
                    <div class="order-card limit">
                        <div class="order-icon">🎯</div>
                        <div class="order-name">Limit Order</div>
                        <div class="order-desc">Your Price or Better</div>
                    </div>
                    <div class="order-card stop">
                        <div class="order-icon">🛡️</div>
                        <div class="order-name">Stop-Loss</div>
                        <div class="order-desc">Auto-Sell Protection</div>
                    </div>
                </div>`
            },
            {
                title: 'Key Takeaways',
                subtitle: 'Stock Market Fundamentals Summary',
                content: `<div class="slide-text-content">
                    <p><strong>You now understand:</strong></p>
                    <ul class="slide-list">
                        <li>✅ What stocks are (ownership stakes)</li>
                        <li>✅ How markets connect buyers and sellers</li>
                        <li>✅ Candlestick anatomy (OHLC)</li>
                        <li>✅ Market participants and their roles</li>
                        <li>✅ Bull vs Bear sentiment</li>
                        <li>✅ Order types for execution</li>
                    </ul>
                    <p><strong>Next step:</strong> Learn Technical Analysis to read charts like a pro 📊</p>
                </div>`,
                visual: `<div class="slide-visual-complete">
                    <div class="complete-icon-box">
                        <svg viewBox="0 0 120 120" class="complete-svg">
                            <circle cx="60" cy="60" r="50" fill="var(--green-dim)" stroke="var(--green)" stroke-width="4" class="complete-circle"/>
                            <polyline points="35 60, 52 77, 85 44" fill="none" stroke="var(--green)" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" class="complete-check"/>
                        </svg>
                    </div>
                    <div class="complete-message">Chapter Complete!</div>
                    <div class="complete-sub">Continue to Technical Analysis →</div>
                </div>`
            }
        ]
    },
    technical: {
        title: 'Technical Analysis Basics',
        slides: [
            {
                title: 'What is Technical Analysis?',
                subtitle: 'Reading price action to forecast future movements',
                content: `<div class="slide-text-content">
                    <p><strong>Technical Analysis (TA)</strong> is the study of past price and volume data to predict future price movement.</p>
                    <p><strong>Core Belief:</strong> All information is reflected in price. Chart patterns repeat because human psychology is consistent.</p>
                    <p><strong>vs Fundamental Analysis:</strong> TA focuses on charts, not company earnings.</p>
                </div>`,
                visual: `<div class="slide-visual-ta-intro">
                    <svg viewBox="0 0 200 120" class="ta-svg">
                        <polyline points="10,90 30,80 50,85 70,65 90,70 110,50 130,55 150,40 170,45 190,30" fill="none" stroke="var(--cyan)" stroke-width="3.5" class="price-line"/>
                        <circle cx="110" cy="50" r="7" fill="var(--green)" class="signal-point" style="animation-delay:0.5s"/>
                        <circle cx="150" cy="40" r="7" fill="var(--red)" class="signal-point" style="animation-delay:0.7s"/>
                        <text x="100" y="110" fill="var(--text-2)" font-size="11" font-family="var(--font-body)" text-anchor="middle">Price over time</text>
                    </svg>
                    <p class="slide-caption">Charts tell stories of market psychology</p>
                </div>`
            },
            {
                title: 'Support & Resistance',
                subtitle: 'Where price tends to bounce or reverse',
                content: `<div class="slide-text-content">
                    <p><strong>Support:</strong> Price level where buying interest is strong enough to prevent further decline 🟢</p>
                    <p><strong>Resistance:</strong> Price level where selling pressure prevents further rise 🔴</p>
                    <p><strong>Why it matters:</strong> These are critical decision points—buy near support, sell near resistance.</p>
                </div>`,
                visual: `<div class="slide-visual-sr">
                    <svg viewBox="0 0 200 140" class="sr-svg">
                        <line x1="10" y1="35" x2="190" y2="35" stroke="var(--red)" stroke-width="2.5" stroke-dasharray="6,4" class="resistance-line"/>
                        <text x="195" y="38" fill="var(--red)" font-size="11" font-weight="600" font-family="var(--font-body)">Resistance</text>
                        <polyline points="20,105 40,85 60,95 80,65 100,80 120,55 140,70 160,50 180,65" fill="none" stroke="var(--cyan)" stroke-width="3" class="price-line"/>
                        <line x1="10" y1="105" x2="190" y2="105" stroke="var(--green)" stroke-width="2.5" stroke-dasharray="6,4" class="support-line"/>
                        <text x="195" y="110" fill="var(--green)" font-size="11" font-weight="600" font-family="var(--font-body)">Support</text>
                    </svg>
                </div>`
            },
            {
                title: 'Trend Lines',
                subtitle: 'Directional bias of the market',
                content: `<div class="slide-text-content">
                    <p><strong>Uptrend:</strong> Series of higher highs and higher lows (bullish) 📈</p>
                    <p><strong>Downtrend:</strong> Series of lower highs and lower lows (bearish) 📉</p>
                    <p><strong>Sideways:</strong> Consolidation, no clear direction ↔️</p>
                    <p><strong>Rule:</strong> Trade with the trend until it clearly reverses.</p>
                </div>`,
                visual: `<div class="slide-visual-trends">
                    <svg viewBox="0 0 200 120" class="trends-svg">
                        <polyline points="15,100 45,80 75,85 105,60 135,65 165,40" fill="none" stroke="var(--green)" stroke-width="3" class="price-line"/>
                        <line x1="15" y1="100" x2="165" y2="50" stroke="var(--green)" stroke-width="2" stroke-dasharray="4,4" opacity="0.6" class="trend-line"/>
                        <text x="15" y="25" fill="var(--green)" font-size="13" font-weight="700" font-family="var(--font-head)">Uptrend</text>
                        <text x="15" y="40" fill="var(--text-3)" font-size="10" font-family="var(--font-body)">Higher Highs + Higher Lows</text>
                    </svg>
                </div>`
            },
            {
                title: 'Chart Patterns',
                subtitle: 'Recognizable formations that signal moves',
                content: `<div class="slide-text-content">
                    <p><strong>Reversal Patterns:</strong></p>
                    <ul class="slide-list">
                        <li>Head & Shoulders (bearish reversal)</li>
                        <li>Double Top/Bottom (trend exhaustion)</li>
                    </ul>
                    <p><strong>Continuation Patterns:</strong></p>
                    <ul class="slide-list">
                        <li>Flags & Pennants (brief pause)</li>
                        <li>Triangles (consolidation before breakout)</li>
                    </ul>
                </div>`,
                visual: `<div class="slide-visual-patterns">
                    <svg viewBox="0 0 200 120" class="patterns-svg">
                        <polyline points="20,80 40,60 60,65 80,40 100,65 120,60 140,80" fill="none" stroke="var(--cyan)" stroke-width="3" class="price-line"/>
                        <text x="70" y="110" fill="var(--text-2)" font-size="11" font-family="var(--font-body)" text-anchor="middle">Head & Shoulders</text>
                        <circle cx="80" cy="40" r="5" fill="var(--red)" class="signal-point"/>
                        <text x="85" y="30" fill="var(--red)" font-size="10" font-weight="600" font-family="var(--font-body)">Head</text>
                    </svg>
                </div>`
            },
            {
                title: 'Moving Averages',
                subtitle: 'Smoothing price data to identify trends',
                content: `<div class="slide-text-content">
                    <p><strong>Simple Moving Average (SMA):</strong> Average price over N periods</p>
                    <p><strong>Common periods:</strong> 20-day (short-term), 50-day (medium), 200-day (long-term)</p>
                    <p><strong>Golden Cross:</strong> 50-day crosses above 200-day (bullish signal) 🟢</p>
                    <p><strong>Death Cross:</strong> 50-day crosses below 200-day (bearish signal) 🔴</p>
                </div>`,
                visual: `<div class="slide-visual-ma">
                    <svg viewBox="0 0 200 120" class="ma-svg">
                        <polyline points="10,70 30,65 50,75 70,60 90,65 110,55 130,60 150,50 170,55 190,45" fill="none" stroke="var(--text-3)" stroke-width="2" opacity="0.4" class="raw-price"/>
                        <polyline points="10,72 30,68 50,70 70,64 90,62 110,58 130,56 150,53 170,51 190,48" fill="none" stroke="var(--cyan)" stroke-width="2.5" class="ma-line"/>
                        <text x="15" y="25" fill="var(--cyan)" font-size="11" font-weight="600" font-family="var(--font-body)">Moving Average smooths noise</text>
                    </svg>
                </div>`
            },
            {
                title: 'Volume Analysis',
                subtitle: 'Confirmation through trading activity',
                content: `<div class="slide-text-content">
                    <p><strong>Volume</strong> measures the number of shares traded. It confirms the strength of a move.</p>
                    <p><strong>Rule:</strong> Breakouts with high volume are more reliable than low-volume breakouts.</p>
                    <p><strong>Divergence:</strong> Price rising but volume falling = weak move (potential reversal)</p>
                </div>`,
                visual: `<div class="slide-visual-volume">
                    <svg viewBox="0 0 200 120" class="volume-svg">
                        <rect x="20" y="70" width="18" height="40" fill="var(--green)" opacity="0.6" class="volume-bar"/>
                        <rect x="48" y="60" width="18" height="50" fill="var(--green)" opacity="0.7" class="volume-bar" style="animation-delay:0.1s"/>
                        <rect x="76" y="50" width="18" height="60" fill="var(--green)" opacity="0.8" class="volume-bar" style="animation-delay:0.2s"/>
                        <rect x="104" y="40" width="18" height="70" fill="var(--green)" class="volume-bar" style="animation-delay:0.3s"/>
                        <rect x="132" y="55" width="18" height="55" fill="var(--green)" opacity="0.7" class="volume-bar" style="animation-delay:0.4s"/>
                        <text x="85" y="25" fill="var(--text-1)" font-size="12" font-weight="700" font-family="var(--font-head)" text-anchor="middle">Volume Bars</text>
                    </svg>
                    <p class="slide-caption">Volume confirms price moves</p>
                </div>`
            },
            {
                title: 'Key Takeaways',
                subtitle: 'Technical Analysis Summary',
                content: `<div class="slide-text-content">
                    <p><strong>You now understand:</strong></p>
                    <ul class="slide-list">
                        <li>✅ TA studies price action, not fundamentals</li>
                        <li>✅ Support & Resistance guide entries/exits</li>
                        <li>✅ Trends define directional bias</li>
                        <li>✅ Chart patterns signal future moves</li>
                        <li>✅ Moving Averages smooth trends</li>
                        <li>✅ Volume confirms price strength</li>
                    </ul>
                    <p><strong>Practice:</strong> Apply these concepts to real charts in MarketIQ puzzles! 🚀</p>
                </div>`,
                visual: `<div class="slide-visual-complete">
                    <div class="complete-icon-box">
                        <svg viewBox="0 0 120 120" class="complete-svg">
                            <circle cx="60" cy="60" r="50" fill="var(--green-dim)" stroke="var(--green)" stroke-width="4" class="complete-circle"/>
                            <polyline points="35 60, 52 77, 85 44" fill="none" stroke="var(--green)" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" class="complete-check"/>
                        </svg>
                    </div>
                    <div class="complete-message">Chapter Complete!</div>
                    <div class="complete-sub">You're now ready to analyze markets 📊</div>
                </div>`
            }
        ]
    }
};

// ===== CHAPTER FUNCTIONS =====
function openChapter(chapterId) {
    currentChapterData = CHAPTERS[chapterId];
    currentSlideIndex = 0;
    
    document.getElementById('notesChapterView').style.display = 'none';
    document.getElementById('notesLessonView').style.display = 'block';
    
    renderSlides();
    updateSlideNav();
}

function closeLesson() {
    document.getElementById('notesChapterView').style.display = 'block';
    document.getElementById('notesLessonView').style.display = 'none';
    currentChapterData = null;
    currentSlideIndex = 0;
}

function renderSlides() {
    if (!currentChapterData) return;
    
    const wrapper = document.getElementById('notesSlideWrapper');
    const totalSlides = currentChapterData.slides.length;
    
    document.getElementById('notesTotalSlides').textContent = totalSlides;
    
    wrapper.innerHTML = currentChapterData.slides.map((slide, idx) => `
        <div class="notes-slide ${idx === 0 ? 'active' : ''}" data-slide-index="${idx}">
            <div class="slide-header">
                <h2 class="slide-title">${slide.title}</h2>
                <p class="slide-subtitle">${slide.subtitle}</p>
            </div>
            <div class="slide-body">
                <div class="slide-content">
                    ${slide.content}
                </div>
                ${slide.visual ? `<div class="slide-visual">${slide.visual}</div>` : ''}
            </div>
        </div>
    `).join('');
    
    // Render progress dots
    const dotsContainer = document.getElementById('notesProgressDots');
    dotsContainer.innerHTML = currentChapterData.slides.map((_, idx) => 
        `<span class="progress-dot ${idx === 0 ? 'active' : ''}" data-dot-index="${idx}"></span>`
    ).join('');
}

function nextSlide() {
    if (!currentChapterData) return;
    if (currentSlideIndex >= currentChapterData.slides.length - 1) return;
    
    const currentSlide = document.querySelector(`.notes-slide[data-slide-index="${currentSlideIndex}"]`);
    currentSlideIndex++;
    const nextSlide = document.querySelector(`.notes-slide[data-slide-index="${currentSlideIndex}"]`);
    
    // Animate out current
    currentSlide.style.animation = 'slideOutLeft 0.4s ease forwards';
    
    // Animate in next
    setTimeout(() => {
        currentSlide.classList.remove('active');
        currentSlide.style.animation = '';
        nextSlide.classList.add('active');
        nextSlide.style.animation = 'slideInRight 0.4s ease forwards';
        updateSlideNav();
    }, 400);
}

function previousSlide() {
    if (!currentChapterData) return;
    if (currentSlideIndex <= 0) return;
    
    const currentSlide = document.querySelector(`.notes-slide[data-slide-index="${currentSlideIndex}"]`);
    currentSlideIndex--;
    const prevSlide = document.querySelector(`.notes-slide[data-slide-index="${currentSlideIndex}"]`);
    
    // Animate out current
    currentSlide.style.animation = 'slideOutRight 0.4s ease forwards';
    
    // Animate in previous
    setTimeout(() => {
        currentSlide.classList.remove('active');
        currentSlide.style.animation = '';
        prevSlide.classList.add('active');
        prevSlide.style.animation = 'slideInLeft 0.4s ease forwards';
        updateSlideNav();
    }, 400);
}

function updateSlideNav() {
    if (!currentChapterData) return;
    
    const prevBtn = document.getElementById('notesPrevBtn');
    const nextBtn = document.getElementById('notesNextBtn');
    const slideNum = document.getElementById('notesSlideNum');
    
    slideNum.textContent = currentSlideIndex + 1;
    
    prevBtn.disabled = currentSlideIndex === 0;
    nextBtn.disabled = currentSlideIndex === currentChapterData.slides.length - 1;
    
    // Update progress dots
    document.querySelectorAll('.progress-dot').forEach((dot, idx) => {
        dot.classList.toggle('active', idx === currentSlideIndex);
        dot.classList.toggle('completed', idx < currentSlideIndex);
    });
    
    // Change Next button text on last slide
    if (currentSlideIndex === currentChapterData.slides.length - 1) {
        nextBtn.innerHTML = `
            Finish
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
                <polyline points="20 6 9 17 4 12"/>
            </svg>
        `;
        nextBtn.onclick = function() {
            showToast('Chapter completed! 🎉', 'success');
            closeLesson();
        };
    } else {
        nextBtn.innerHTML = `
            Next
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
                <polyline points="9 18 15 12 9 6"/>
            </svg>
        `;
        nextBtn.onclick = nextSlide;
    }
}
