// ============================================================
//  MARKETIQ — Main Application Logic
//  Firebase Firestore + Full Game Logic
// ============================================================

// ===== STATE =====
let currentUser   = null;   // { username, ...firestoreData }
let pendingLegacyUser = null; // Temp holder for legacy users missing passwords
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

                // Intercept legacy users missing a password
                if (!userData.password) {
                    pendingLegacyUser = userData;
                    hideLoading();
                    showSection('login');
                    document.getElementById('legacyPasswordModal').classList.remove('hidden');
                    return;
                }

                currentUser = userData;
                hideLoading();
                showSection('home');
                updateNavUser();
                updateMobileNav('home');
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

// ===== LOGIN =====
async function handleLogin(event) {
    event.preventDefault();
    const username = document.getElementById('usernameInput').value.trim();
    const password = document.getElementById('passwordInput').value.trim();
    
    if (!username) return;
    if (username.length < 3) { showToast("Username must be at least 3 characters.", 'error'); return; }

    const btn = document.getElementById('loginBtn');
    btn.disabled = true;
    btn.textContent = "Connecting...";

    try {
        const ref = db.collection(USERS_COL).doc(username);
        const snap = await ref.get();

        if (snap.exists) {
            // Returning user
            const userData = snap.data();
            
            // Check if it's a legacy user without a password
            if (!userData.password) {
                pendingLegacyUser = userData;
                document.getElementById('legacyPasswordModal').classList.remove('hidden');
                btn.disabled = false;
                btn.textContent = "Start Competing";
                return; // Stop flow here
            }

            // Verify password
            if (!password) {
                showToast("Password is required to log in.", 'error');
                btn.disabled = false; btn.textContent = "Start Competing"; return;
            }
            if (userData.password !== password) {
                showToast("Incorrect password.", 'error');
                btn.disabled = false; btn.textContent = "Start Competing"; return;
            }

            currentUser = userData;
            showToast(`Welcome back, ${username}! Rating: ${currentUser.rating}`, 'success');
        } else {
            // New user - Password is required
            if (!password || password.length < 4) {
                showToast("Password must be at least 4 characters for a new account.", 'error');
                btn.disabled = false; btn.textContent = "Start Competing"; return;
            }

            const newUser = {
                username,
                password, // Store password
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
            await ref.set(newUser);
            currentUser = newUser;
            showToast(`Welcome to MarketIQ, ${username}! Starting rating: 1200`, 'success');
        }

        finalizeLoginFlow();

    } catch (err) {
        console.error("Login error:", err);
        showToast("Connection failed. Check Firebase config.", 'error');
        btn.disabled = false;
        btn.textContent = "Start Competing";
    }
}

async function handleLegacyPassword(event) {
    event.preventDefault();
    const newPassword = document.getElementById('newPasswordInput').value.trim();
    if (newPassword.length < 4) {
        showToast("Password must be at least 4 characters.", 'error');
        return;
    }

    const btn = document.getElementById('legacyPwdBtn');
    btn.disabled = true;
    btn.textContent = "Saving...";

    try {
        await db.collection(USERS_COL).doc(pendingLegacyUser.username).update({
            password: newPassword
        });

        // Update local object
        pendingLegacyUser.password = newPassword;
        currentUser = pendingLegacyUser;
        pendingLegacyUser = null; // Clear pending state
        
        document.getElementById('legacyPasswordModal').classList.add('hidden');
        document.getElementById('newPasswordInput').value = '';
        
        showToast("Password set successfully! Welcome back.", 'success');
        finalizeLoginFlow();

    } catch (err) {
        console.error("Error setting legacy password:", err);
        showToast("Failed to save password.", 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = "Save & Continue";
    }
}

function finalizeLoginFlow() {
    localStorage.setItem('miq_session', currentUser.username);
    updateNavUser();
    updateMobileNav('home');
    resetDailyIfNeeded();
    showSection('home');
    
    // Clear inputs
    document.getElementById('usernameInput').value = '';
    const pwdInput = document.getElementById('passwordInput');
    if(pwdInput) pwdInput.value = '';
    
    // Reset login button state
    const btn = document.getElementById('loginBtn');
    if (btn) {
        btn.disabled = false;
        btn.textContent = "Start Competing";
    }
}

function logout() {
    if (leaderboardUnsubscribe) { leaderboardUnsubscribe(); leaderboardUnsubscribe = null; }
    currentUser = null;
    pendingLegacyUser = null;
    localStorage.removeItem('miq_session');
    updateNavUser();
    updateMobileNav('login');
    document.getElementById('mobileNav').style.display = 'none';
    showSection('login');
    showToast("Signed out. See you tomorrow!", 'info');
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
