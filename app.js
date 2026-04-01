// ============================================================
//  MARKETIQ — Main Application Logic
//  Firebase Firestore + Full Game Logic
// ============================================================

// Firebase is initialized in firebase-config.js — db is already available globally

// ===== STATE =====
let currentUser   = null;
let currentPuzzle = null;
let selectedOption = null;
let thrillTimer    = null;
let thrillRemaining = 60;
let leaderboardUnsubscribe = null;

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

                // Legacy account check
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

// ===== SIDEBAR TOGGLE =====
function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    const hamburger = document.getElementById('hamburgerBtn');

    if (!sidebar) return;

    const isOpen = sidebar.classList.toggle('active');
    if (overlay) overlay.classList.toggle('active', isOpen);

    if (hamburger) {
        hamburger.classList.toggle('is-open', isOpen);
    }
}

function closeSidebarOnMobile() {
    if (window.innerWidth < 1024) {
        const sidebar = document.getElementById('sidebar');
        const overlay = document.getElementById('sidebarOverlay');
        const hamburger = document.getElementById('hamburgerBtn');
        if (sidebar) sidebar.classList.remove('active');
        if (overlay) overlay.classList.remove('active');
        if (hamburger) hamburger.classList.remove('is-open');
    }
}

// ===== NAVIGATION =====
function showSection(name) {
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    const el = document.getElementById(name + 'Section');
    if (el) el.classList.add('active');

    updateMobileNav(name);
    updateSidebarActive(name);

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

function updateSidebarActive(active) {
    document.querySelectorAll('.sidebar-link').forEach(link => {
        link.classList.toggle('active', link.dataset.section === active);
    });
}

function navTo(section) {
    if (!currentUser && !['login', 'leaderboard'].includes(section)) {
        showToast("Sign in first to access this section.", 'info');
        showSection('login');
        closeSidebarOnMobile();
        return false;
    }
    showSection(section);
    closeSidebarOnMobile();
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
    const sidebarFooter = document.getElementById('sidebarFooter');
    if (sidebarFooter) {
        sidebarFooter.style.display = currentUser ? 'flex' : 'none';
    }
}

function updateNavUser() {
    const navUser = document.getElementById('navUser');
    if (!navUser) return;

    if (currentUser) {
        navUser.innerHTML = `
            <div class="nav-user-right">
                <span class="nav-rating-badge mono">${currentUser.rating}</span>
                <span class="nav-username">${currentUser.username}</span>
                <button class="nav-profile-btn" onclick="navTo('profile')" title="View Profile" aria-label="Profile">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" width="22" height="22">
                        <circle cx="12" cy="8" r="4"/>
                        <path d="M4 20c0-4 3.582-7 8-7s8 3 8 7"/>
                    </svg>
                </button>
            </div>`;
    } else {
        navUser.innerHTML = `<button class="btn-primary btn-sm" onclick="showSection('login')">Sign In</button>`;
    }

    const sidebarFooter = document.getElementById('sidebarFooter');
    if (sidebarFooter) {
        sidebarFooter.style.display = currentUser ? 'flex' : 'none';
    }
}

// ===== PASSWORD UTILITIES =====
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

let _pendingModalUser = null;
let _pendingRegUsername = null;

// ===== MULTI-STEP AUTH FLOW =====
function showAuthStep(stepName) {
    const map = {
        'gate':              'authGate',
        'login':             'authLogin',
        'register-username': 'authRegisterUsername',
        'register-password': 'authRegisterPassword',
    };
    document.querySelectorAll('.auth-step').forEach(el => el.classList.remove('active'));
    const target = document.getElementById(map[stepName]);
    if (target) {
        target.classList.add('active');
        setTimeout(() => {
            const first = target.querySelector('input');
            if (first) first.focus();
        }, 80);
    }
    ['regUsernameError','regPasswordError'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = '';
    });
}

async function handleCheckUsername(event) {
    event.preventDefault();
    const input   = document.getElementById('regUsernameInput');
    const errEl   = document.getElementById('regUsernameError');
    const btn     = document.getElementById('checkUsernameBtn');
    const username = input.value.trim();

    errEl.textContent = '';

    if (username.length < 3) { errEl.textContent = 'Username must be at least 3 characters.'; return; }
    if (username.length > 20) { errEl.textContent = 'Username must be 20 characters or fewer.'; return; }
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
        errEl.textContent = 'Only letters, numbers, and underscores allowed.';
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Checking...';

    try {
        const snap = await db.collection(USERS_COL).doc(username).get();
        if (snap.exists) {
            errEl.textContent = `"${username}" is already taken — please choose another.`;
            input.focus();
            input.select();
        } else {
            _pendingRegUsername = username;
            const confirm = document.getElementById('regUsernameConfirm');
            if (confirm) confirm.textContent = username;
            showAuthStep('register-password');
        }
    } catch (err) {
        console.error('Username check error:', err);
        errEl.textContent = 'Connection failed. Check Firebase config.';
    } finally {
        btn.disabled = false;
        btn.textContent = 'Check Availability →';
    }
}

async function handleRegister(event) {
    event.preventDefault();
    const password  = document.getElementById('regPasswordInput').value;
    const confirm   = document.getElementById('regConfirmPasswordInput').value;
    const errEl     = document.getElementById('regPasswordError');
    const btn       = document.getElementById('registerBtn');
    const username  = _pendingRegUsername;

    errEl.textContent = '';

    if (!username) { showAuthStep('register-username'); return; }
    if (password.length < 4) {
        errEl.textContent = 'Password must be at least 4 characters.';
        return;
    }
    if (password !== confirm) {
        errEl.textContent = 'Passwords do not match.';
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Creating account...';

    try {
        const snapCheck = await db.collection(USERS_COL).doc(username).get();
        if (snapCheck.exists) {
            showToast(`"${username}" was just taken. Please choose another username.`, 'error');
            _pendingRegUsername = null;
            showAuthStep('register-username');
            return;
        }

        const hash    = await hashPassword(password);
        const newUser = { ...buildNewUser(username), passwordHash: hash };
        await db.collection(USERS_COL).doc(username).set(newUser);
        currentUser = newUser;
        showToast(`Welcome to MarketIQ, ${username}! Starting rating: 1200`, 'success');
        finalizeLogin(username);

    } catch (err) {
        console.error('Registration error:', err);
        errEl.textContent = 'Registration failed. Check Firebase config.';
    } finally {
        btn.disabled = false;
        btn.textContent = 'Create Account & Start Competing';
    }
}

function updateRegPasswordStrength(value) {
    const wrap  = document.getElementById('regStrengthWrap');
    const bar   = document.getElementById('regStrengthBar');
    const label = document.getElementById('regStrengthLabel');
    if (!wrap) return;
    if (!value) { wrap.style.display = 'none'; return; }
    wrap.style.display = 'flex';

    let score = 0;
    if (value.length >= 4)  score++;
    if (value.length >= 8)  score++;
    if (/[A-Z]/.test(value)) score++;
    if (/[0-9]/.test(value)) score++;
    if (/[^a-zA-Z0-9]/.test(value)) score++;

    const levels = [
        { pct: '20%', cls: 'strength-weak',   text: 'Weak' },
        { pct: '40%', cls: 'strength-weak',   text: 'Weak' },
        { pct: '60%', cls: 'strength-fair',   text: 'Fair' },
        { pct: '80%', cls: 'strength-good',   text: 'Good' },
        { pct: '100%',cls: 'strength-strong', text: 'Strong' },
    ];
    const lvl = levels[Math.min(score - 1, 4)] || levels[0];
    bar.style.width = lvl.pct;
    bar.className   = 'password-strength-bar ' + lvl.cls;
    label.textContent = lvl.text;
}

async function handleLogin(event) {
    event.preventDefault();
    const username = document.getElementById('usernameInput').value.trim();
    const password = document.getElementById('passwordInput').value;

    if (!username) return;
    if (username.length < 3) {
        showToast("Username must be at least 3 characters.", 'error');
        return;
    }

    const btn = document.getElementById('loginBtn');
    btn.disabled = true;
    btn.textContent = "Signing in...";

    try {
        const ref  = db.collection(USERS_COL).doc(username);
        const snap = await ref.get();

        if (snap.exists) {
            const userData = snap.data();

            if (userData.passwordHash) {
                if (!password) {
                    showToast("Please enter your password.", 'error');
                    const pwInput = document.getElementById('passwordInput');
                    if (pwInput) pwInput.focus();
                    btn.disabled = false;
                    btn.textContent = "Sign In";
                    return;
                }
                const inputHash = await hashPassword(password);
                if (inputHash !== userData.passwordHash) {
                    showToast("Incorrect password. Try again.", 'error');
                    const pwInput = document.getElementById('passwordInput');
                    if (pwInput) {
                        pwInput.value = '';
                        pwInput.focus();
                    }
                    btn.disabled = false;
                    btn.textContent = "Sign In";
                    return;
                }
                currentUser = userData;
                showToast(`Welcome back, ${username}! Rating: ${currentUser.rating}`, 'success');
                finalizeLogin(username);

            } else {
                currentUser = userData;
                finalizeLogin(username, false);
                handleLegacyPassword(userData, ref, username);
            }

        } else {
            showToast("No account found with that username. Create one instead?", 'error');
            btn.disabled = false;
            btn.textContent = "Sign In";
        }

    } catch (err) {
        console.error("Login error:", err);
        showToast("Connection failed. Check Firebase config.", 'error');
        btn.disabled = false;
        btn.textContent = "Sign In";
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
    _pendingRegUsername = null;
    localStorage.setItem('miq_session', username);
    updateNavUser();
    updateMobileNav('home');
    resetDailyIfNeeded();
    showSection('home');
    const uInput = document.getElementById('usernameInput');
    const pInput = document.getElementById('passwordInput');
    if (uInput) uInput.value = '';
    if (pInput) pInput.value = '';
    const btn = document.getElementById('loginBtn');
    if (btn) { btn.disabled = false; btn.textContent = "Sign In"; }
    showAuthStep("gate");
}

// ===== SET PASSWORD MODAL =====
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

    showToast(`Welcome back, ${username}! Please set a password to continue.`, 'info');
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

    if (newPw.length < 4) {
        showToast("Password must be at least 4 characters.", 'error');
        return;
    }
    if (newPw !== confPw) {
        showToast("Passwords don't match.", 'error');
        return;
    }

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
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    if (sidebar) sidebar.classList.remove('active');
    if (overlay) overlay.classList.remove('active');
    showAuthStep("gate"); showSection("login");
    showToast("Signed out. See you tomorrow!", 'info');
}

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
    openSetPasswordModal(false);
}

// ===== HOME STATS =====
function updateHomeStats() {
    if (!currentUser) return;

    const ratingEl = document.getElementById('userRating');
    if (ratingEl) ratingEl.textContent = currentUser.rating;

    const accuracyEl = document.getElementById('userAccuracy');
    if (accuracyEl && currentUser.puzzlesSolved > 0) {
        accuracyEl.textContent = currentUser.accuracy + '%';
    } else if (accuracyEl) {
        accuracyEl.textContent = '—';
    }

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

    const gridId = `optGrid_${isThrill ? 'thrill' : 'daily'}`;
    document.querySelectorAll(`#${gridId} .option-btn`).forEach(btn => {
        btn.disabled = true;
        if (btn.dataset.quality === 'optimal') btn.classList.add('reveal-optimal');
        else if (btn.classList.contains('selected'))  btn.classList.add('reveal-wrong');
    });
    const submitId = `submitBtn_${isThrill ? 'thrill' : 'daily'}`;
    const submitBtn = document.getElementById(submitId);
    if (submitBtn) submitBtn.style.display = 'none';

    const ratingDelta = isThrill ? THRILL_RATING_CHANGES[selectedOption] : RATING_CHANGES[selectedOption];
    const isGoodChoice = selectedOption === 'optimal' || selectedOption === 'good';

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

    updateNavUser();
    updateProgressDots(currentUser.dailyPuzzlesCompleted);
    setEl('dailyRemaining', Math.max(0, 5 - currentUser.dailyPuzzlesCompleted));

    spawnFloatRating(ratingDelta);

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
    if (body) {
        body.innerHTML = '<div class="lb-loading">Loading rankings...</div>';
    }

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

    body.classList.remove('skeleton-loading');

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

    const rankSnap = await db.collection(USERS_COL)
        .where('rating', '>', u.rating).get().catch(() => null);
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

function getCalibrationTier(score) {
    if (score == null) return 'Beginner';
    if (score >= 0.9) return 'Expert';
    if (score >= 0.7) return 'Skilled';
    if (score >= 0.5) return 'Learning';
    return 'Beginner';
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

// ===== PREDICTIONS MODULE =====

const WEEKLY_PREDICTIONS = [
    {
        id: "pred_w1_q1",
        question: "Will the S&P 500 close higher than it opened on Friday?",
        category: "Equities",
        description: "Based on the current macro environment and weekly momentum, predict whether the S&P 500 will have a positive close on Friday.",
        resolves: "end of week"
    },
    {
        id: "pred_w1_q2",
        question: "Will Bitcoin remain above $60,000 through the weekend?",
        category: "Crypto",
        description: "Track BTC's price action into the weekend. Will it hold the $60K support level through Sunday midnight UTC?",
        resolves: "end of week"
    },
    {
        id: "pred_w1_q3",
        question: "Will the VIX index stay below 20 for the entire week?",
        category: "Volatility",
        description: "The VIX is a key fear gauge. Predict whether market volatility stays calm (below 20) throughout the trading week.",
        resolves: "end of week"
    }
];

let predUserSliders = {};
let predSubmitted = false;

function loadPredictions() {
    if (!currentUser) { showSection('login'); return; }

    predSubmitted = !!(currentUser.lastPredictionWeek && currentUser.lastPredictionWeek === currentWeekKey());

    updatePredTimer();

    const forecastView = document.getElementById('predForecastView');
    const resultsView  = document.getElementById('predResultsView');

    if (predSubmitted) {
        if (forecastView) forecastView.style.display = 'none';
        if (resultsView)  resultsView.style.display  = 'block';
        renderPredResults();
    } else {
        if (forecastView) forecastView.style.display = 'block';
        if (resultsView)  resultsView.style.display  = 'none';
        renderPredQuestions();
    }
}

function currentWeekKey() {
    const d = new Date();
    const startOfYear = new Date(d.getFullYear(), 0, 1);
    const weekNum = Math.ceil(((d - startOfYear) / 86400000 + startOfYear.getDay() + 1) / 7);
    return `${d.getFullYear()}-W${weekNum}`;
}

function updatePredTimer() {
    const now = new Date();
    const friday = new Date(now);
    friday.setDate(now.getDate() + ((5 - now.getDay() + 7) % 7 || 7));
    friday.setHours(16, 0, 0, 0);
    const diff = friday - now;
    const days  = Math.floor(diff / 86400000);
    const hours = Math.floor((diff % 86400000) / 3600000);
    const mins  = Math.floor((diff % 3600000) / 60000);
    const el = document.getElementById('predTimeRemaining');
    if (el) el.textContent = `${days}d ${hours}h ${mins}m`;
}

function renderPredQuestions() {
    const container = document.getElementById('predQuestionsContainer');
    if (!container) return;

    container.innerHTML = WEEKLY_PREDICTIONS.map(q => `
        <div class="pred-question-card" id="pqc_${q.id}">
            <div class="pred-q-header">
                <span class="pred-category-badge">${q.category}</span>
                <span class="pred-resolves">Resolves: ${q.resolves}</span>
            </div>
            <h3 class="pred-q-title">${q.question}</h3>
            <p class="pred-q-desc">${q.description}</p>
            <div class="pred-slider-wrap">
                <div class="pred-slider-labels">
                    <span class="pred-slider-no">No (0%)</span>
                    <div class="pred-value-pill" id="pill_${q.id}">—</div>
                    <span class="pred-slider-yes">Yes (100%)</span>
                </div>
                <input type="range" class="pred-range-input" min="0" max="100" value="50"
                    id="slider_${q.id}"
                    oninput="onPredSliderChange('${q.id}', this.value)"
                    onchange="onPredSliderChange('${q.id}', this.value)">
                <div class="pred-confidence-hint" id="hint_${q.id}">Move the slider to set your probability</div>
            </div>
        </div>
    `).join('');

    checkPredSubmitReady();
}

function onPredSliderChange(questionId, value) {
    const pct = parseInt(value);
    predUserSliders[questionId] = pct;

    const pill = document.getElementById(`pill_${questionId}`);
    if (pill) {
        pill.textContent = `${pct}%`;
        pill.className = 'pred-value-pill ' + (pct >= 70 ? 'prob-high' : pct <= 30 ? 'prob-low' : '');
    }

    const hint = document.getElementById(`hint_${questionId}`);
    if (hint) {
        if (pct >= 80)      hint.textContent = "Very confident YES";
        else if (pct >= 60) hint.textContent = "Leaning YES";
        else if (pct >= 45 && pct <= 55) hint.textContent = "Very uncertain";
        else if (pct <= 20) hint.textContent = "Very confident NO";
        else                hint.textContent = "Leaning NO";
    }

    checkPredSubmitReady();
}

function checkPredSubmitReady() {
    const allMoved = WEEKLY_PREDICTIONS.every(q => predUserSliders[q.id] !== undefined);
    const btn = document.getElementById('predSubmitBtn');
    const hint = document.querySelector('.pred-submit-hint');
    if (btn) btn.disabled = !allMoved;
    if (hint) hint.textContent = allMoved
        ? "All forecasts set — ready to submit!"
        : `Move all ${WEEKLY_PREDICTIONS.length} sliders to unlock submission`;
}

async function submitPredictions() {
    if (!currentUser) return;
    const allMoved = WEEKLY_PREDICTIONS.every(q => predUserSliders[q.id] !== undefined);
    if (!allMoved) { showToast("Please set all three sliders first.", 'warning'); return; }

    const btn = document.getElementById('predSubmitBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Submitting...'; }

    const weekKey = currentWeekKey();
    const predictions = {};
    WEEKLY_PREDICTIONS.forEach(q => { predictions[q.id] = predUserSliders[q.id]; });

    try {
        await db.collection(USERS_COL).doc(currentUser.username).update({
            lastPredictionWeek: weekKey,
            predictions: firebase.firestore.FieldValue.arrayUnion({
                week: weekKey,
                answers: predictions,
                ts: Date.now()
            })
        });
        currentUser.lastPredictionWeek = weekKey;
        predSubmitted = true;
        showToast("Forecasts submitted! Results update as the week closes.", 'success');

        const forecastView = document.getElementById('predForecastView');
        const resultsView  = document.getElementById('predResultsView');
        if (forecastView) forecastView.style.display = 'none';
        if (resultsView)  { resultsView.style.display = 'block'; renderPredResults(); }
    } catch (err) {
        console.error("Prediction submit error:", err);
        showToast("Failed to save. Try again.", 'error');
        if (btn) { btn.disabled = false; btn.textContent = 'Submit Forecasts'; }
    }
}

function renderPredResults() {
    const container = document.getElementById('predResultsContainer');
    if (!container) return;

    container.innerHTML = WEEKLY_PREDICTIONS.map(q => {
        const myPct = predUserSliders[q.id] ?? 50;
        return `
            <div class="pred-result-card">
                <div class="pred-q-header">
                    <span class="pred-category-badge">${q.category}</span>
                    <span class="pred-resolves pending-badge">Pending resolution</span>
                </div>
                <h3 class="pred-q-title">${q.question}</h3>
                <div class="pred-result-row">
                    <span class="pred-result-label">Your forecast:</span>
                    <span class="pred-result-val">${myPct}% YES</span>
                </div>
                <div class="pred-crowd-bar-wrap">
                    <div class="pred-crowd-bar" style="width:${myPct}%"></div>
                </div>
                <p class="pred-pending-note">Results and calibration score will update when this closes.</p>
            </div>
        `;
    }).join('');
}

// ===== NOTES MODULE =====

const NOTES_CONTENT = {
    fundamentals: {
        title: "Stock Market Fundamentals",
        slides: [
            {
                title: "What is a Stock?",
                content: `
                    <div class="slide-icon">📈</div>
                    <h2>What is a Stock?</h2>
                    <p>A <strong>stock</strong> (or share) represents a unit of ownership in a company. When you buy a stock, you become a partial owner — a shareholder — of that company.</p>
                    <div class="slide-example">
                        <div class="slide-example-label">Example</div>
                        <p>If Apple has 1 billion shares and you own 1,000 shares, you own 0.0001% of Apple. As the company grows, so does your share's value.</p>
                    </div>
                    <div class="slide-key-points">
                        <div class="skp">🔹 Stocks are traded on exchanges like NYSE and NASDAQ</div>
                        <div class="skp">🔹 Prices move based on supply and demand</div>
                        <div class="skp">🔹 Companies issue stock to raise capital</div>
                    </div>
                `
            },
            {
                title: "How Markets Work",
                content: `
                    <div class="slide-icon">🏛️</div>
                    <h2>How Markets Work</h2>
                    <p>Stock markets are <strong>auction systems</strong> where buyers and sellers meet. Every trade requires both a buyer and a seller agreeing on a price.</p>
                    <div class="slide-two-col">
                        <div class="slide-col green-col">
                            <div class="col-label">Buyers (Bid)</div>
                            <p>Want to pay as little as possible</p>
                        </div>
                        <div class="slide-col red-col">
                            <div class="col-label">Sellers (Ask)</div>
                            <p>Want to receive as much as possible</p>
                        </div>
                    </div>
                    <p>The difference between the highest bid and lowest ask is called the <strong>spread</strong>. When they meet — a trade happens.</p>
                `
            },
            {
                title: "Reading a Candlestick",
                content: `
                    <div class="slide-icon">🕯️</div>
                    <h2>Reading a Candlestick</h2>
                    <p>Each candle shows 4 data points for a time period — Open, High, Low, Close (OHLC).</p>
                    <div class="candle-diagram">
                        <div class="candle-diagram-inner">
                            <div class="c-wick-top"></div>
                            <div class="c-body green">Body = Open to Close</div>
                            <div class="c-wick-bot"></div>
                        </div>
                        <div class="candle-labels">
                            <span>← High (top wick)</span>
                            <span>← Green = Close > Open (bullish)</span>
                            <span>← Low (bottom wick)</span>
                        </div>
                    </div>
                    <div class="slide-key-points">
                        <div class="skp">🟢 Green/White candle = price went UP</div>
                        <div class="skp">🔴 Red/Black candle = price went DOWN</div>
                        <div class="skp">📏 Long wicks = lots of price rejection</div>
                    </div>
                `
            },
            {
                title: "Market Hours & Sessions",
                content: `
                    <div class="slide-icon">⏰</div>
                    <h2>Market Hours & Sessions</h2>
                    <p>US equity markets have specific trading hours. Understanding them helps you know when prices move most.</p>
                    <div class="slide-timeline">
                        <div class="tl-item pre">
                            <div class="tl-time">4:00 AM – 9:30 AM ET</div>
                            <div class="tl-label">Pre-Market</div>
                            <div class="tl-desc">Lower volume, news reactions, earnings plays</div>
                        </div>
                        <div class="tl-item main">
                            <div class="tl-time">9:30 AM – 4:00 PM ET</div>
                            <div class="tl-label">Regular Session ⭐</div>
                            <div class="tl-desc">Highest volume & liquidity. Best for most traders</div>
                        </div>
                        <div class="tl-item after">
                            <div class="tl-time">4:00 PM – 8:00 PM ET</div>
                            <div class="tl-label">After-Hours</div>
                            <div class="tl-desc">Earnings announcements, lower volume</div>
                        </div>
                    </div>
                `
            },
            {
                title: "Market Cap & Company Size",
                content: `
                    <div class="slide-icon">🏢</div>
                    <h2>Market Cap & Company Size</h2>
                    <p><strong>Market Cap = Share Price × Total Shares Outstanding</strong></p>
                    <p>It's the total value the market assigns to a company right now.</p>
                    <div class="mcap-tiers">
                        <div class="mcap-tier mega">Mega Cap · $200B+ · Apple, Microsoft</div>
                        <div class="mcap-tier large">Large Cap · $10B–$200B · FedEx, Marriott</div>
                        <div class="mcap-tier mid">Mid Cap · $2B–$10B · Crocs, Five Below</div>
                        <div class="mcap-tier small">Small Cap · $300M–$2B · Higher risk, higher reward</div>
                    </div>
                `
            },
            {
                title: "Bulls vs Bears",
                content: `
                    <div class="slide-icon">🐂</div>
                    <h2>Bull vs Bear Markets</h2>
                    <div class="slide-two-col">
                        <div class="slide-col green-col">
                            <div class="col-label">🐂 Bull Market</div>
                            <p>Prices are rising. Optimism is high. Investors are buying.</p>
                            <p><strong>+20% from recent low</strong></p>
                        </div>
                        <div class="slide-col red-col">
                            <div class="col-label">🐻 Bear Market</div>
                            <p>Prices are falling. Pessimism is high. Investors are selling.</p>
                            <p><strong>−20% from recent high</strong></p>
                        </div>
                    </div>
                    <div class="slide-example">
                        <div class="slide-example-label">Pro Tip</div>
                        <p>Bear markets create the best buying opportunities — if you have conviction and patience. Most great wealth is made by buying when others are fearful.</p>
                    </div>
                `
            },
            {
                title: "Dividends & Returns",
                content: `
                    <div class="slide-icon">💰</div>
                    <h2>How You Make Money in Stocks</h2>
                    <div class="slide-key-points">
                        <div class="skp"><strong>Capital Gains:</strong> Buy low, sell high. Profit from price appreciation.</div>
                        <div class="skp"><strong>Dividends:</strong> Some companies share profits with shareholders quarterly.</div>
                        <div class="skp"><strong>Short Selling:</strong> Borrow and sell a stock, buy it back cheaper. Profit from decline.</div>
                    </div>
                    <div class="slide-example">
                        <div class="slide-example-label">Example</div>
                        <p>You buy 100 shares at $50 = $5,000 invested. Stock rises to $65. You sell → $6,500. <strong>Gain: $1,500 (30%).</strong></p>
                    </div>
                `
            },
            {
                title: "Risk & Portfolio Basics",
                content: `
                    <div class="slide-icon">⚖️</div>
                    <h2>Risk & Portfolio Basics</h2>
                    <p>Every reward comes with risk. Managing risk is the difference between professional traders and gamblers.</p>
                    <div class="slide-key-points">
                        <div class="skp">📊 <strong>Diversification:</strong> Don't put all eggs in one basket</div>
                        <div class="skp">🛑 <strong>Stop Losses:</strong> Pre-planned exits to limit downside</div>
                        <div class="skp">📐 <strong>Position Sizing:</strong> Never risk more than 1-2% per trade</div>
                        <div class="skp">🧠 <strong>Risk/Reward:</strong> Aim for at least 2:1 (risk $1 to make $2)</div>
                    </div>
                    <div class="slide-congrats">You've completed Stock Market Fundamentals! 🎉</div>
                `
            }
        ]
    },
    technical: {
        title: "Technical Analysis Basics",
        slides: [
            {
                title: "What is Technical Analysis?",
                content: `
                    <div class="slide-icon">📊</div>
                    <h2>What is Technical Analysis?</h2>
                    <p><strong>Technical Analysis (TA)</strong> is the study of price charts and patterns to forecast future price movements. It assumes that all known information is already priced in.</p>
                    <div class="slide-two-col">
                        <div class="slide-col green-col">
                            <div class="col-label">TA Believers Say</div>
                            <p>"History repeats. Patterns work because human psychology is consistent."</p>
                        </div>
                        <div class="slide-col red-col">
                            <div class="col-label">Critics Say</div>
                            <p>"Markets are random. Past prices don't predict future prices."</p>
                        </div>
                    </div>
                    <p style="margin-top:16px">The truth? TA works because enough people believe in it — creating self-fulfilling patterns.</p>
                `
            },
            {
                title: "Support & Resistance",
                content: `
                    <div class="slide-icon">🧱</div>
                    <h2>Support & Resistance</h2>
                    <p>These are the most fundamental concepts in technical analysis.</p>
                    <div class="slide-key-points">
                        <div class="skp">🟢 <strong>Support:</strong> A price level where buyers repeatedly step in, stopping declines. Think of it as a floor.</div>
                        <div class="skp">🔴 <strong>Resistance:</strong> A price level where sellers repeatedly appear, stopping rallies. Think of it as a ceiling.</div>
                        <div class="skp">🔄 <strong>Role Reversal:</strong> When price breaks above resistance, that level often becomes support — and vice versa.</div>
                    </div>
                    <div class="slide-example">
                        <div class="slide-example-label">Key Insight</div>
                        <p>The more times a level is tested without breaking, the more significant it is — but also the weaker it becomes over time.</p>
                    </div>
                `
            },
            {
                title: "Trend Types",
                content: `
                    <div class="slide-icon">📈</div>
                    <h2>Understanding Trends</h2>
                    <p>Markets move in trends. Identifying the trend direction is step one of any trade decision.</p>
                    <div class="trend-types">
                        <div class="trend-item up">
                            <div class="trend-arrow">↗</div>
                            <div>
                                <strong>Uptrend</strong>
                                <p>Series of Higher Highs (HH) and Higher Lows (HL)</p>
                            </div>
                        </div>
                        <div class="trend-item down">
                            <div class="trend-arrow">↘</div>
                            <div>
                                <strong>Downtrend</strong>
                                <p>Series of Lower Highs (LH) and Lower Lows (LL)</p>
                            </div>
                        </div>
                        <div class="trend-item side">
                            <div class="trend-arrow">→</div>
                            <div>
                                <strong>Sideways (Ranging)</strong>
                                <p>Price bouncing between support and resistance</p>
                            </div>
                        </div>
                    </div>
                    <p style="margin-top:12px"><strong>"The trend is your friend — until it bends."</strong></p>
                `
            },
            {
                title: "Moving Averages",
                content: `
                    <div class="slide-icon">〰️</div>
                    <h2>Moving Averages</h2>
                    <p>A moving average smooths out price noise to show the overall trend direction.</p>
                    <div class="slide-key-points">
                        <div class="skp"><strong>SMA (Simple):</strong> Average closing price over N periods. Equal weight to all.</div>
                        <div class="skp"><strong>EMA (Exponential):</strong> More weight to recent prices. Reacts faster.</div>
                        <div class="skp"><strong>Common periods:</strong> 20 (short-term), 50 (mid), 200 (long-term trend)</div>
                    </div>
                    <div class="slide-example">
                        <div class="slide-example-label">Golden & Death Cross</div>
                        <p>When the 50-day MA crosses <strong>above</strong> the 200-day → Golden Cross (bullish). Crosses <strong>below</strong> → Death Cross (bearish).</p>
                    </div>
                `
            },
            {
                title: "Chart Patterns",
                content: `
                    <div class="slide-icon">🔷</div>
                    <h2>Key Chart Patterns</h2>
                    <div class="patterns-grid">
                        <div class="pattern-item bullish">
                            <div class="pattern-name">Head & Shoulders ↓</div>
                            <div class="pattern-type">Bearish Reversal</div>
                        </div>
                        <div class="pattern-item bullish">
                            <div class="pattern-name">Inverse H&S ↑</div>
                            <div class="pattern-type">Bullish Reversal</div>
                        </div>
                        <div class="pattern-item neutral">
                            <div class="pattern-name">Ascending Triangle</div>
                            <div class="pattern-type">Bullish Continuation</div>
                        </div>
                        <div class="pattern-item neutral">
                            <div class="pattern-name">Descending Triangle</div>
                            <div class="pattern-type">Bearish Continuation</div>
                        </div>
                        <div class="pattern-item bullish">
                            <div class="pattern-name">Double Bottom</div>
                            <div class="pattern-type">Bullish Reversal</div>
                        </div>
                        <div class="pattern-item bearish">
                            <div class="pattern-name">Double Top</div>
                            <div class="pattern-type">Bearish Reversal</div>
                        </div>
                    </div>
                `
            },
            {
                title: "RSI — Relative Strength Index",
                content: `
                    <div class="slide-icon">⚡</div>
                    <h2>RSI — Relative Strength Index</h2>
                    <p>RSI is a momentum oscillator that measures the speed and magnitude of price changes. It ranges from 0 to 100.</p>
                    <div class="rsi-gauge">
                        <div class="rsi-zone red">Overbought &gt;70</div>
                        <div class="rsi-zone neutral">Neutral 30–70</div>
                        <div class="rsi-zone green">Oversold &lt;30</div>
                    </div>
                    <div class="slide-key-points">
                        <div class="skp">📉 RSI above 70 → asset may be <strong>overbought</strong>, potential reversal down</div>
                        <div class="skp">📈 RSI below 30 → asset may be <strong>oversold</strong>, potential reversal up</div>
                        <div class="skp">⚠️ In strong trends, RSI can stay overbought/oversold for a long time</div>
                    </div>
                `
            },
            {
                title: "Volume Analysis",
                content: `
                    <div class="slide-icon">📊</div>
                    <h2>Volume Analysis</h2>
                    <p>Volume is the number of shares traded in a period. It confirms or questions price moves.</p>
                    <div class="volume-rules">
                        <div class="vol-rule good">
                            <div class="vol-icon">✅</div>
                            <div><strong>Price up + Volume up</strong> → Strong bullish move. Conviction behind the rise.</div>
                        </div>
                        <div class="vol-rule bad">
                            <div class="vol-icon">⚠️</div>
                            <div><strong>Price up + Volume down</strong> → Weak move. May not sustain. Potential trap.</div>
                        </div>
                        <div class="vol-rule bad">
                            <div class="vol-icon">🔴</div>
                            <div><strong>Price down + Volume up</strong> → Strong selling pressure. Bearish conviction.</div>
                        </div>
                        <div class="vol-rule good">
                            <div class="vol-icon">✅</div>
                            <div><strong>Price down + Volume down</strong> → Weak selling. Possible exhaustion soon.</div>
                        </div>
                    </div>
                `
            }
        ]
    }
};

let currentChapter = null;
let currentSlideIndex = 0;

function openChapter(chapterId) {
    currentChapter = NOTES_CONTENT[chapterId];
    if (!currentChapter) return;
    currentSlideIndex = 0;

    const chapterView = document.getElementById('notesChapterView');
    const lessonView  = document.getElementById('notesLessonView');
    if (chapterView) chapterView.style.display = 'none';
    if (lessonView)  lessonView.style.display  = 'block';

    const totalEl = document.getElementById('notesTotalSlides');
    if (totalEl) totalEl.textContent = currentChapter.slides.length;

    renderSlide();
    renderProgressDots();
}

function closeLesson() {
    currentChapter    = null;
    currentSlideIndex = 0;

    const chapterView = document.getElementById('notesChapterView');
    const lessonView  = document.getElementById('notesLessonView');
    if (chapterView) chapterView.style.display = 'block';
    if (lessonView)  lessonView.style.display  = 'none';
}

function renderSlide() {
    if (!currentChapter) return;
    const slide   = currentChapter.slides[currentSlideIndex];
    const wrapper = document.getElementById('notesSlideWrapper');
    const numEl   = document.getElementById('notesSlideNum');
    const prevBtn = document.getElementById('notesPrevBtn');
    const nextBtn = document.getElementById('notesNextBtn');

    if (wrapper) wrapper.innerHTML = `<div class="notes-slide">${slide.content}</div>`;
    if (numEl)   numEl.textContent = currentSlideIndex + 1;
    if (prevBtn) prevBtn.disabled  = currentSlideIndex === 0;
    if (nextBtn) {
        const isLast = currentSlideIndex === currentChapter.slides.length - 1;
        nextBtn.innerHTML = isLast
            ? `Finish <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><polyline points="20 6 9 17 4 12"/></svg>`
            : `Next <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><polyline points="9 18 15 12 9 6"/></svg>`;
    }
    updateDotHighlight();
}

function nextSlide() {
    if (!currentChapter) return;
    if (currentSlideIndex >= currentChapter.slides.length - 1) {
        closeLesson();
        showToast("Chapter complete! Great work.", 'success');
        return;
    }
    currentSlideIndex++;
    renderSlide();
    document.getElementById('notesLessonView')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function previousSlide() {
    if (!currentChapter || currentSlideIndex === 0) return;
    currentSlideIndex--;
    renderSlide();
}

function renderProgressDots() {
    const dotsEl = document.getElementById('notesProgressDots');
    if (!dotsEl || !currentChapter) return;
    dotsEl.innerHTML = currentChapter.slides.map((_, i) =>
        `<div class="notes-dot ${i === currentSlideIndex ? 'active' : ''}" onclick="goToSlide(${i})"></div>`
    ).join('');
}

function goToSlide(index) {
    currentSlideIndex = index;
    renderSlide();
    updateDotHighlight();
}

function updateDotHighlight() {
    const dotsEl = document.getElementById('notesProgressDots');
    if (!dotsEl) return;
    dotsEl.querySelectorAll('.notes-dot').forEach((dot, i) => {
        dot.classList.toggle('active', i === currentSlideIndex);
        dot.classList.toggle('done', i < currentSlideIndex);
    });
}
