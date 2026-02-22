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
                currentUser = snap.data();
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
            currentUser = snap.data();
            showToast(`Welcome back, ${username}! Rating: ${currentUser.rating}`, 'success');
        } else {
            // New user
            const newUser = {
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
            await ref.set(newUser);
            currentUser = newUser;
            showToast(`Welcome to MarketIQ, ${username}! Starting rating: 1200`, 'success');
        }

        localStorage.setItem('miq_session', username);
        updateNavUser();
        updateMobileNav('home');
        resetDailyIfNeeded();
        showSection('home');
        document.getElementById('usernameInput').value = '';

    } catch (err) {
        console.error("Login error:", err);
        showToast("Connection failed. Check Firebase config.", 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = "Start Competing";
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
//  PREDICTIONS ENGINE — Probabilistic Forecasting
//  Brier Score · Calibration · Crowd Consensus
// ============================================================

// ===== PREDICTION EVENTS DATA =====
// In production these would come from Firestore `predictionEvents` collection.
// Seeded here as static data; the schema mirrors the Firestore document shape.
const PREDICTION_EVENTS = [
    {
        id: "pe_nifty_5pct_mar25",
        category: "Index",
        title: "Nifty 50 falls ≥5% before end of March 2025",
        context: "Nifty trading near all-time highs with RSI divergence. FII outflows accelerating. Fed policy uncertainty remains.",
        deadline: "2025-03-31T23:59:00Z",
        resolved: false,
        outcome: null,
        resolvedAt: null,
        crowdForecasts: []
    },
    {
        id: "pe_btc_80k_q2",
        category: "Crypto",
        title: "Bitcoin exceeds $80,000 at any point in Q2 2025",
        context: "Post-halving supply crunch combined with ETF inflows. Macro conditions uncertain. Historical Q2 patterns mixed.",
        deadline: "2025-06-30T23:59:00Z",
        resolved: true,
        outcome: true,
        resolvedAt: "2025-04-12T10:00:00Z",
        crowdForecasts: [72, 65, 80, 55, 78, 82, 60, 71, 68, 74, 77, 63]
    },
    {
        id: "pe_fed_cut_jun25",
        category: "Macro",
        title: "Federal Reserve cuts rates at June 2025 FOMC meeting",
        context: "CPI trending down but still above 2% target. Labor market resilient. Market pricing ~40% cut probability.",
        deadline: "2025-06-18T20:00:00Z",
        resolved: false,
        outcome: null,
        crowdForecasts: [38, 42, 35, 50, 30, 45, 40, 33, 47, 38, 55, 29, 43]
    },
    {
        id: "pe_gold_3000_h1",
        category: "Commodity",
        title: "Gold (XAUUSD) trades above $3,000/oz in H1 2025",
        context: "Central bank buying remains elevated. Geopolitical tensions supporting safe-haven demand. USD weakening trend.",
        deadline: "2025-06-30T23:59:00Z",
        resolved: true,
        outcome: true,
        resolvedAt: "2025-03-14T00:00:00Z",
        crowdForecasts: [65, 70, 58, 72, 80, 55, 75, 68, 60, 77, 63, 71]
    },
    {
        id: "pe_sensex_85k_may25",
        category: "Index",
        title: "Sensex closes above 85,000 before May 31, 2025",
        context: "Domestic flows via SIPs remain strong. Election uncertainty resolved. Earnings season broadly positive vs estimates.",
        deadline: "2025-05-31T23:59:00Z",
        resolved: false,
        outcome: null,
        crowdForecasts: [55, 48, 62, 70, 45, 58, 52, 66, 60, 50]
    },
    {
        id: "pe_crude_60_q2",
        category: "Commodity",
        title: "WTI Crude falls below $60/barrel in Q2 2025",
        context: "OPEC+ supply discipline fraying. US shale production at record highs. Demand outlook weakening on China slowdown.",
        deadline: "2025-06-30T23:59:00Z",
        resolved: false,
        outcome: null,
        crowdForecasts: [30, 25, 38, 22, 35, 28, 41, 20, 32, 27]
    }
];

// ===== BRIER SCORE ENGINE =====

/**
 * Calculates a single Brier Score contribution.
 * Formula: BS = (forecast_probability - outcome)^2
 * Range: 0 (perfect) → 1 (worst). Lower = better.
 * @param {number} forecastPct  - User's probability (1–99)
 * @param {boolean} outcome     - True event resolution
 * @returns {number} brierScore - 0 to 1
 */
function calculateBrierScore(forecastPct, outcome) {
    const p = forecastPct / 100;
    const o = outcome ? 1 : 0;
    return Math.pow(p - o, 2);
}

/**
 * Calibration Score = 1 - mean Brier Score across all resolved forecasts.
 * Higher is better. Perfect calibration = 1.0. Naive (50% always) ≈ 0.75.
 * @param {Array<{forecastPct: number, outcome: boolean}>} forecasts
 * @returns {number|null} calibrationScore - 0 to 1
 */
function calculateCalibrationScore(forecasts) {
    if (!forecasts || forecasts.length === 0) return null;
    const meanBS = forecasts.reduce((sum, f) =>
        sum + calculateBrierScore(f.forecastPct, f.outcome), 0
    ) / forecasts.length;
    return parseFloat((1 - meanBS).toFixed(4));
}

/**
 * Weighted Crowd Consensus.
 * Averages forecasts, optionally weighted by forecaster calibration score.
 * @param {Array<number>} forecasts    - Probabilities (1–99)
 * @param {Array<number>|null} weights - Calibration scores (0–1), optional
 * @returns {number|null} consensusPct
 */
function calculateConsensus(forecasts, weights = null) {
    if (!forecasts || forecasts.length === 0) return null;
    if (!weights || weights.length !== forecasts.length) {
        return Math.round(forecasts.reduce((a, b) => a + b, 0) / forecasts.length);
    }
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    const weightedSum = forecasts.reduce((sum, f, i) => sum + f * weights[i], 0);
    return Math.round(weightedSum / totalWeight);
}

/**
 * Converts a Calibration Score to a human-readable tier label.
 */
function getCalibrationTier(score) {
    if (score == null) return 'Unranked';
    if (score >= 0.92) return 'Expert';
    if (score >= 0.82) return 'Skilled';
    if (score >= 0.72) return 'Learning';
    return 'Developing';
}

/**
 * Brier delta vs naive forecaster (0.25 reference).
 * Positive delta = better than naive.
 */
function brierDeltaVsNaive(forecastPct, outcome) {
    const bs    = calculateBrierScore(forecastPct, outcome);
    const naive = 0.25; // (0.5 - 0)^2 = naive benchmark
    return parseFloat((naive - bs).toFixed(4));
}

// ===== PREDICTIONS STATE =====
let userForecasts     = {};  // { eventId: { forecastPct, submittedAt, brierScore } }
let resolvedForecasts = [];  // resolved { forecastPct, outcome } for calibration calc

// ===== LOAD PREDICTIONS =====
async function loadPredictions() {
    if (!currentUser) return;

    const grid = document.getElementById('predictionsGrid');
    if (!grid) return;

    grid.innerHTML = `
        <div class="pred-loading">
            <div class="pred-loading-spinner"></div>
            Loading forecasts...
        </div>`;

    try {
        await loadUserForecasts();

        const calibScore = calculateCalibrationScore(resolvedForecasts);
        if (currentUser) {
            currentUser.calibrationScore         = calibScore;
            currentUser.calibrationForecastCount = resolvedForecasts.length;
        }

        updateCalibrationDisplay(calibScore);
        renderPredictions(grid);

    } catch (err) {
        console.error("Predictions load error:", err);
        grid.innerHTML = `
            <div class="pred-loading" style="color:var(--red)">
                ⚠️ Could not load predictions. Check your Firebase setup.
            </div>`;
    }
}

async function loadUserForecasts() {
    if (!currentUser) return;
    userForecasts     = {};
    resolvedForecasts = [];

    try {
        const snap = await db
            .collection('users')
            .doc(currentUser.username)
            .collection('predictions')
            .get();

        snap.forEach(doc => {
            const d = doc.data();
            userForecasts[doc.id] = d;

            const event = PREDICTION_EVENTS.find(e => e.id === doc.id);
            if (event && event.resolved && event.outcome !== null) {
                resolvedForecasts.push({ forecastPct: d.forecastPct, outcome: event.outcome });
            }
        });
    } catch (err) {
        console.warn("Could not fetch user forecasts:", err);
    }
}

// ===== RENDER PREDICTIONS =====
function renderPredictions(grid) {
    if (PREDICTION_EVENTS.length === 0) {
        grid.innerHTML = `<div class="pred-loading">No prediction events available yet. Check back soon.</div>`;
        return;
    }
    grid.innerHTML = PREDICTION_EVENTS.map(event => renderPredCard(event)).join('');
    animatePredBars();
}

function renderPredCard(event) {
    const userF           = userForecasts[event.id] || null;
    const consensus       = calculateConsensus(event.crowdForecasts);
    const forecasterCount = event.crowdForecasts.length + (userF && !event.crowdForecasts.includes(userF.forecastPct) ? 1 : 0);
    const deadlineDate    = new Date(event.deadline);
    const deadlineStr     = deadlineDate.toLocaleDateString('en-US', { day:'numeric', month:'short', year:'numeric' });
    const isResolved      = event.resolved;
    const hasUserForecast = userF != null;

    let cardClass = 'pred-card';
    if (isResolved) {
        cardClass += event.outcome ? ' resolved resolved-true' : ' resolved resolved-false';
    } else if (hasUserForecast) {
        cardClass += ' submitted';
    }

    const sliderVal    = hasUserForecast ? userF.forecastPct : 50;
    const consensusHtml = consensus !== null ? `
        <div class="pred-consensus">
            <div class="pred-consensus-label">
                <span class="pred-consensus-title">Crowd Consensus</span>
                <span class="pred-consensus-val mono">${consensus}%</span>
            </div>
            <div class="pred-consensus-track">
                <div class="pred-consensus-fill" style="width:${consensus}%"></div>
            </div>
            <div class="pred-forecasters">${forecasterCount} forecaster${forecasterCount !== 1 ? 's' : ''}</div>
        </div>` : '';

    let footerHtml = '';
    if (isResolved) {
        footerHtml = renderResolvedFooter(event, userF);
    } else if (hasUserForecast) {
        footerHtml = renderSubmittedFooter(event, userF);
    } else {
        footerHtml = `
            <button class="pred-submit-btn"
                onclick="submitForecast('${event.id}', document.getElementById('slider-${event.id}').value)">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="16" height="16">
                    <polyline points="20 6 9 17 4 12"/>
                </svg>
                Submit Forecast
            </button>`;
    }

    return `
    <div class="${cardClass}" id="predcard-${event.id}">
        <div class="pred-card-head">
            <div class="pred-card-meta">
                <span class="pred-category">${event.category}</span>
                <span class="pred-deadline">
                    ${isResolved ? '' : '<span class="pred-deadline-dot"></span>'}
                    ${isResolved
                        ? '✓ Resolved ' + new Date(event.resolvedAt).toLocaleDateString('en-US', { day:'numeric', month:'short' })
                        : 'Closes ' + deadlineStr}
                </span>
            </div>
            <h3>${event.title}</h3>
            <p class="pred-context">${event.context}</p>
        </div>
        <div class="pred-card-body">
            <div class="pred-slider-wrap">
                <div class="pred-slider-label">
                    <span class="pred-slider-question">Probability this occurs</span>
                    <span class="pred-prob-display" id="prob-${event.id}">${sliderVal}%</span>
                </div>
                <div class="pred-range-track">
                    <div class="pred-range-fill" id="fill-${event.id}" style="width:${sliderVal}%"></div>
                    <input type="range" class="pred-range-input"
                        id="slider-${event.id}"
                        min="1" max="99" value="${sliderVal}"
                        ${isResolved || hasUserForecast ? 'disabled' : ''}
                        oninput="onSliderMove('${event.id}', this.value)"
                    />
                </div>
                <div class="pred-range-ticks">
                    <span>1%</span><span>25%</span><span>50%</span><span>75%</span><span>99%</span>
                </div>
            </div>
            ${consensusHtml}
        </div>
        <div class="pred-card-foot">
            ${footerHtml}
        </div>
    </div>`;
}

function renderSubmittedFooter(event, userF) {
    const submittedDate = userF.submittedAt
        ? new Date(userF.submittedAt).toLocaleDateString('en-US', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })
        : 'Recently';
    return `
        <div class="pred-submitted-badge">
            <div>
                <div style="font-size:.72rem;color:var(--text-3);margin-bottom:2px;">Your Forecast</div>
                <span class="pred-submitted-prob">${userF.forecastPct}%</span>
            </div>
            <div style="text-align:right">
                <div class="pred-submitted-time">Submitted ${submittedDate}</div>
                <button class="pred-edit-btn" onclick="editForecast('${event.id}')">Edit</button>
            </div>
        </div>`;
}

function renderResolvedFooter(event, userF) {
    const outcomeLabel = event.outcome ? '✓ Happened' : '✗ Did Not Happen';
    const outcomeClass = event.outcome ? 'true' : 'false';
    const panelClass   = event.outcome ? 'result-true' : 'result-false';

    if (!userF) {
        return `
            <div class="pred-result-panel ${panelClass}">
                <div class="pred-result-row">
                    <span class="pred-result-outcome ${outcomeClass}">${outcomeLabel}</span>
                </div>
            </div>
            <div class="pred-no-forecast">You had no forecast for this event</div>`;
    }

    const bs         = calculateBrierScore(userF.forecastPct, event.outcome);
    const delta      = brierDeltaVsNaive(userF.forecastPct, event.outcome);
    const deltaSign  = delta >= 0 ? '+' : '';
    const deltaClass = delta >= 0 ? 'gain' : 'loss';
    const correct    = event.outcome ? 100 : 0;
    const errorPct   = Math.abs(userF.forecastPct - correct);
    const accuracyPct = 100 - errorPct;
    const barClass   = accuracyPct >= 70 ? 'good-call' : 'poor-call';

    return `
        <div class="pred-result-panel ${panelClass}">
            <div class="pred-result-row">
                <span class="pred-result-outcome ${outcomeClass}">${outcomeLabel}</span>
                <span class="pred-brier-delta ${deltaClass}">
                    ${deltaSign}${delta.toFixed(3)} vs naive
                </span>
            </div>
            <div class="pred-result-details">
                Your forecast: <strong>${userF.forecastPct}%</strong> ·
                Brier Score: <strong>${bs.toFixed(3)}</strong>
            </div>
        </div>
        <div class="pred-accuracy-bar">
            <div class="pred-accuracy-label">
                <span>Forecast Accuracy</span>
                <span>${accuracyPct.toFixed(0)}%</span>
            </div>
            <div class="pred-accuracy-track">
                <div class="pred-accuracy-fill ${barClass}" style="width:0%"
                    data-target="${accuracyPct}"></div>
            </div>
        </div>`;
}

// ===== SLIDER INTERACTIVITY =====
function onSliderMove(eventId, value) {
    const val    = parseInt(value);
    const probEl = document.getElementById(`prob-${eventId}`);
    const fillEl = document.getElementById(`fill-${eventId}`);

    if (probEl) {
        probEl.textContent = val + '%';
        probEl.className   = 'pred-prob-display';
        if (val >= 85)      probEl.classList.add('very-high');
        else if (val >= 70) probEl.classList.add('high');
    }
    if (fillEl) fillEl.style.width = val + '%';
}

// ===== SUBMIT FORECAST =====
async function submitForecast(eventId, rawValue) {
    if (!currentUser) {
        showToast("Sign in first to submit forecasts.", 'info');
        return;
    }

    const forecastPct = parseInt(rawValue);
    if (isNaN(forecastPct) || forecastPct < 1 || forecastPct > 99) {
        showToast("Probability must be between 1% and 99%.", 'error');
        return;
    }

    const event = PREDICTION_EVENTS.find(e => e.id === eventId);
    if (!event) return;
    if (event.resolved) { showToast("This event is already resolved.", 'warning'); return; }
    if (userForecasts[eventId]) {
        showToast("You have already submitted. Use Edit to update.", 'warning');
        return;
    }

    const card = document.getElementById(`predcard-${eventId}`);
    const btn  = card?.querySelector('.pred-submit-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Submitting...'; }

    const forecast = {
        eventId,
        forecastPct,
        submittedAt:              Date.now(),
        eventTitle:               event.title,
        eventCategory:            event.category,
        eventDeadline:            event.deadline,
        brierScore:               null,
        calibrationContribution:  null
    };

    try {
        await db
            .collection('users')
            .doc(currentUser.username)
            .collection('predictions')
            .doc(eventId)
            .set(forecast);

        userForecasts[eventId] = forecast;
        event.crowdForecasts.push(forecastPct);

        showToast(`Forecast of ${forecastPct}% submitted! ✓`, 'success');
        spawnFloatRating(forecastPct);

        if (card) card.outerHTML = renderPredCard(event);
        animatePredBars();

    } catch (err) {
        console.error("Forecast submit error:", err);
        showToast("Could not save forecast. Check connection.", 'error');
        if (btn) { btn.disabled = false; btn.textContent = 'Submit Forecast'; }
    }
}

// ===== EDIT FORECAST =====
async function editForecast(eventId) {
    const event = PREDICTION_EVENTS.find(e => e.id === eventId);
    if (!event || event.resolved) return;

    delete userForecasts[eventId];

    try {
        await db
            .collection('users')
            .doc(currentUser.username)
            .collection('predictions')
            .doc(eventId)
            .delete();
    } catch (err) {
        console.warn("Could not delete old forecast:", err);
    }

    const card = document.getElementById(`predcard-${eventId}`);
    if (card) card.outerHTML = renderPredCard(event);
    showToast("Forecast cleared. Set a new probability.", 'info');
}

// ===== CALIBRATION DISPLAY =====
function updateCalibrationDisplay(score) {
    const headerChipVal = document.getElementById('calibrationScoreHeader');
    if (headerChipVal) {
        headerChipVal.textContent = score != null ? score.toFixed(3) : '—';
    }
    const navChip = document.getElementById('navCalibrationScore');
    if (navChip) navChip.textContent = score != null ? score.toFixed(3) : '—';
}

// ===== ANIMATE ACCURACY BARS =====
function animatePredBars() {
    setTimeout(() => {
        document.querySelectorAll('.pred-accuracy-fill[data-target]').forEach(el => {
            el.style.width = parseFloat(el.dataset.target) + '%';
        });
    }, 200);
}

// ===== RESOLVE EVENT (Admin / Cloud Function Utility) =====
/**
 * Resolves an event and batch-updates all forecasters' Brier scores.
 * In production this runs as a Firestore-triggered Cloud Function.
 * @param {string} eventId
 * @param {boolean} outcome
 */
async function resolveEventAndScore(eventId, outcome) {
    const event = PREDICTION_EVENTS.find(e => e.id === eventId);
    if (!event) throw new Error(`Event ${eventId} not found`);

    await db.collection('predictionEvents').doc(eventId).update({
        resolved:   true,
        outcome,
        resolvedAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    const allUsers = await db.collection('users').get();
    const batch    = db.batch();

    for (const userDoc of allUsers.docs) {
        const forecastRef  = db.collection('users').doc(userDoc.id).collection('predictions').doc(eventId);
        const forecastSnap = await forecastRef.get();
        if (!forecastSnap.exists) continue;

        const forecast   = forecastSnap.data();
        const brierScore = calculateBrierScore(forecast.forecastPct, outcome);
        const delta      = brierDeltaVsNaive(forecast.forecastPct, outcome);

        batch.update(forecastRef, {
            brierScore,
            calibrationContribution: delta,
            outcome,
            resolvedAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        const allForecasts   = await db.collection('users').doc(userDoc.id).collection('predictions')
            .where('outcome', '!=', null).get();
        const resolvedData   = allForecasts.docs.map(d => ({ forecastPct: d.data().forecastPct, outcome: d.data().outcome }));
        resolvedData.push({ forecastPct: forecast.forecastPct, outcome });

        const newCalibration = calculateCalibrationScore(resolvedData);
        const tier           = getCalibrationTier(newCalibration);

        batch.update(db.collection('users').doc(userDoc.id), {
            calibrationScore:         newCalibration,
            calibrationForecastCount: resolvedData.length,
            calibrationTier:          tier
        });
    }

    await batch.commit();
    console.log(`✅ Event ${eventId} resolved. All Brier scores updated.`);
}

// ===== SKILL-WEIGHTED TIME SERIES EXPORT =====
/**
 * Returns forecasters for an event ranked by calibration score,
 * with a skill-weighted consensus probability — for institutional export.
 * @param {string} eventId
 * @returns {Promise<Object>}
 */
async function getSkillWeightedTimeSeries(eventId) {
    const forecasts = [];
    const allUsers  = await db.collection('users').get();

    for (const userDoc of allUsers.docs) {
        const u            = userDoc.data();
        const forecastSnap = await db.collection('users').doc(userDoc.id)
            .collection('predictions').doc(eventId).get();
        if (!forecastSnap.exists) continue;

        const f   = forecastSnap.data();
        const cal = u.calibrationScore ?? 0.5;

        forecasts.push({
            username:         userDoc.id,
            forecastPct:      f.forecastPct,
            calibrationScore: cal,
            calibrationTier:  getCalibrationTier(cal),
            weight:           cal,
            submittedAt:      f.submittedAt,
            brierScore:       f.brierScore ?? null
        });
    }

    forecasts.sort((a, b) => b.calibrationScore - a.calibrationScore);

    const totalWeight  = forecasts.reduce((s, f) => s + f.weight, 0);
    const weightedProb = totalWeight > 0
        ? Math.round(forecasts.reduce((s, f) => s + f.forecastPct * f.weight, 0) / totalWeight)
        : calculateConsensus(forecasts.map(f => f.forecastPct));

    return {
        eventId,
        skillWeightedConsensus: weightedProb,
        forecasterCount:        forecasts.length,
        forecasters:            forecasts
    };
}
