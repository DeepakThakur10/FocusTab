/**
 * FocusTab – newtab.js (Production-ready)
 */

'use strict';

// ─────────────────────────────────────────────
//  QUOTES
// ─────────────────────────────────────────────
const QUOTES = [
    { text: "The only way to do great work is to love what you do.", author: "Steve Jobs" },
    { text: "Don't watch the clock; do what it does. Keep going.", author: "Sam Levenson" },
    { text: "The future depends on what you do today.", author: "Mahatma Gandhi" },
    { text: "Believe you can and you're halfway there.", author: "Theodore Roosevelt" },
    { text: "It does not matter how slowly you go, as long as you do not stop.", author: "Confucius" },
    { text: "Everything you've ever wanted is on the other side of fear.", author: "George Addair" },
    { text: "Success is not final, failure is not fatal: it is the courage to continue that counts.", author: "Winston Churchill" },
    { text: "Hardships often prepare ordinary people for an extraordinary destiny.", author: "C.S. Lewis" },
    { text: "Believe in yourself. You are braver than you think.", author: "Roy T. Bennett" },
    { text: "Your time is limited, so don't waste it living someone else's life.", author: "Steve Jobs" },
];

// ─────────────────────────────────────────────
//  STATE
// ─────────────────────────────────────────────
const CIRCUMFERENCE = 502.65; // 2π × r(80)

let state = {
    timerInterval: null,
    timeLeft:      25 * 60,
    totalTime:     25 * 60,
    isRunning:     false,
    settings: {
        theme:          'dark',
        timerDuration:  25,
        showQuotes:     true,
        enableSound:    true,
        enableAnimations: true,
    },
};

// ─────────────────────────────────────────────
//  INIT
// ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    loadSettings(() => {
        applyTheme();
        applyAnimations();
        syncSettingsUI();
        updateClock();
        updateGreeting();
        updateTimerDisplay();
        updateTimerRing(1);
        setQuoteVisible(state.settings.showQuotes);
        displayRandomQuote();
        loadFocusInput();
        setupEventListeners();
        initializeStreak();
    });

    // Clock ticks every second
    setInterval(() => {
        updateClock();
        updateGreeting();
    }, 1000);
});

// ─────────────────────────────────────────────
//  CHROME STORAGE HELPERS
// ─────────────────────────────────────────────
function loadSettings(callback) {
    chrome.storage.local.get('focusTabSettings', (res) => {
        if (res.focusTabSettings) {
            state.settings = { ...state.settings, ...res.focusTabSettings };
        }
        state.totalTime = state.settings.timerDuration * 60;
        state.timeLeft  = state.totalTime;
        callback && callback();
    });
}

function saveSettings() {
    chrome.storage.local.set({ focusTabSettings: state.settings });
}

function loadFocusInput() {
    chrome.storage.local.get('todaysFocus', (res) => {
        if (res.todaysFocus) {
            document.getElementById('focusInput').value = res.todaysFocus;
        }
    });
}

function saveFocusInput() {
    const val = document.getElementById('focusInput').value.trim();
    chrome.storage.local.set({ todaysFocus: val });
}

// ─────────────────────────────────────────────
//  CLOCK & GREETING
// ─────────────────────────────────────────────
function updateClock() {
    const now = new Date();
    const hh  = String(now.getHours()).padStart(2, '0');
    const mm  = String(now.getMinutes()).padStart(2, '0');
    document.getElementById('clock').textContent = `${hh}:${mm}`;
}

function updateGreeting() {
    const hour = new Date().getHours();
    let greeting, message;

    if (hour < 12) {
        greeting = 'Good Morning';
        message  = 'Start your day with purpose!';
    } else if (hour < 17) {
        greeting = 'Good Afternoon';
        message  = "Keep pushing — you're doing great!";
    } else {
        greeting = 'Good Evening';
        message  = 'Finish strong tonight!';
    }

    document.getElementById('greeting').textContent          = greeting;
    document.getElementById('motivationalMessage').textContent = message;
}

// ─────────────────────────────────────────────
//  QUOTES
// ─────────────────────────────────────────────
let lastQuoteIndex = -1;

/** Show or hide the entire quote block (section + its divider). */
function setQuoteVisible(visible) {
    const wrapper = document.getElementById('quoteWrapper');
    if (wrapper) wrapper.style.display = visible ? '' : 'none';
}

function displayRandomQuote() {
    if (!state.settings.showQuotes) return; // guard: don't update hidden content

    let idx;
    do { idx = Math.floor(Math.random() * QUOTES.length); }
    while (idx === lastQuoteIndex && QUOTES.length > 1);
    lastQuoteIndex = idx;

    const q = QUOTES[idx];
    const textEl   = document.getElementById('quoteText');
    const authorEl = document.getElementById('quoteAuthor');

    textEl.style.transition   = 'opacity 0.4s ease';
    authorEl.style.transition = 'opacity 0.4s ease';
    textEl.style.opacity   = '0';
    authorEl.style.opacity = '0';

    setTimeout(() => {
        textEl.textContent   = q.text;
        authorEl.textContent = `\u2014 ${q.author}`;
        textEl.style.opacity   = '1';
        authorEl.style.opacity = '1';
    }, 220);
}

// ─────────────────────────────────────────────
//  TIMER
// ─────────────────────────────────────────────
function updateTimerDisplay() {
    const m = Math.floor(state.timeLeft / 60);
    const s = state.timeLeft % 60;
    document.getElementById('timerDisplay').textContent =
        `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Update the SVG progress ring.
 * @param {number} fraction – 1 = full, 0 = empty
 */
function updateTimerRing(fraction) {
    const offset = CIRCUMFERENCE * (1 - fraction);
    document.getElementById('timerProgress').style.strokeDashoffset = offset;
}

function updateButtonStates() {
    const startBtn = document.getElementById('startBtn');
    const pauseBtn = document.getElementById('pauseBtn');

    startBtn.disabled = state.isRunning;
    pauseBtn.disabled = !state.isRunning;

    startBtn.innerHTML = state.isRunning
        ? '<span class="btn-icon">▶</span> Running…'
        : '<span class="btn-icon">▶</span> Start Focus';
}

function setTimerHelper(text) {
    document.getElementById('timerHelper').textContent = text;
}

function startTimer() {
    if (state.isRunning) return;
    state.isRunning = true;
    updateButtonStates();
    setTimerHelper('Stay focused — you got this! 💪');

    state.timerInterval = setInterval(() => {
        if (state.timeLeft > 0) {
            state.timeLeft--;
            updateTimerDisplay();
            updateTimerRing(state.timeLeft / state.totalTime);
        } else {
            completeTimer();
        }
    }, 1000);
}

function pauseTimer() {
    if (!state.isRunning) return;
    state.isRunning = false;
    clearInterval(state.timerInterval);
    updateButtonStates();
    setTimerHelper('Paused. Resume when ready.');
}

function resetTimer() {
    state.isRunning = false;
    clearInterval(state.timerInterval);
    state.timeLeft = state.totalTime;
    updateTimerDisplay();
    updateTimerRing(1);
    updateButtonStates();
    setTimerHelper('Get ready to focus!');
}

function completeTimer() {
    state.isRunning = false;
    clearInterval(state.timerInterval);
    updateButtonStates();
    setTimerHelper('Session complete! Great work 🎉');

    // Play sound if enabled
    if (state.settings.enableSound) {
        playCompletionSound();
    }

    // Visual flash
    const card = document.querySelector('.premium-card');
    card.style.boxShadow = '0 0 80px rgba(99,102,241,0.7), 0 30px 80px rgba(0,0,0,0.5)';
    setTimeout(() => {
        card.style.boxShadow = '';
        // Reset after 3 s so user can start a new session
        setTimeout(resetTimer, 3000);
    }, 2000);
}

/**
 * Play completion sound.
 * Tries your MP3 first (sounds/complete.mp3).
 * Falls back to synthesized "Faah" breath if the file isn't found.
 */
function playCompletionSound() {
    const audio = new Audio('sounds/complete.mp3');
    audio.volume = 0.8;
    audio.play().catch(() => {
        // File missing or blocked — use synthesized Faah breath
        playFaahSound();
    });
}

/**
 * Synthesized "Faah" breath via Web Audio API.
 * 'F' fricative (0–120ms) + 'aah' vowel with formant filters (100ms–1.6s).
 */
function playFaahSound() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const now = ctx.currentTime;
        const totalDur = 1.6;

        // ── shared noise buffer ──
        function makeNoise(dur) {
            const buf  = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
            const data = buf.getChannelData(0);
            for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
            const src = ctx.createBufferSource();
            src.buffer = buf;
            return src;
        }

        const master = ctx.createGain();
        master.gain.value = 0.75;
        master.connect(ctx.destination);

        // ── 'F' fricative: sharp high-pass noise burst ──
        const fNoise = makeNoise(0.2);
        const fHPF   = ctx.createBiquadFilter();
        fHPF.type = 'highpass';
        fHPF.frequency.setValueAtTime(4500, now);
        fHPF.frequency.linearRampToValueAtTime(1200, now + 0.12);
        const fGain = ctx.createGain();
        fGain.gain.setValueAtTime(0,    now);
        fGain.gain.linearRampToValueAtTime(0.5,  now + 0.03);
        fGain.gain.linearRampToValueAtTime(0.3,  now + 0.08);
        fGain.gain.linearRampToValueAtTime(0,    now + 0.15);
        fNoise.connect(fHPF); fHPF.connect(fGain); fGain.connect(master);
        fNoise.start(now); fNoise.stop(now + 0.2);

        // ── 'aah' voiced layer: sawtooth → formant filters ──
        // F1 ≈ 750 Hz, F2 ≈ 1150 Hz for open 'aah' vowel
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(130, now + 0.1);
        osc.frequency.linearRampToValueAtTime(105, now + totalDur); // natural pitch fall

        const f1 = ctx.createBiquadFilter();
        f1.type = 'bandpass'; f1.frequency.value = 750;  f1.Q.value = 7;
        const f2 = ctx.createBiquadFilter();
        f2.type = 'bandpass'; f2.frequency.value = 1150; f2.Q.value = 5;
        const lpf = ctx.createBiquadFilter();
        lpf.type = 'lowpass';
        lpf.frequency.setValueAtTime(2200, now + 0.1);
        lpf.frequency.linearRampToValueAtTime(700, now + totalDur);

        const vowelGain = ctx.createGain();
        vowelGain.gain.setValueAtTime(0,    now + 0.08);
        vowelGain.gain.linearRampToValueAtTime(0.4,  now + 0.28);   // open vowel
        vowelGain.gain.setValueAtTime(0.4,  now + totalDur - 0.35);
        vowelGain.gain.linearRampToValueAtTime(0,    now + totalDur);

        osc.connect(f1); osc.connect(f2); osc.connect(lpf);
        f1.connect(vowelGain); f2.connect(vowelGain); lpf.connect(vowelGain);
        vowelGain.connect(master);
        osc.start(now + 0.1); osc.stop(now + totalDur);

        // ── breathiness layer: band-limited noise through same formants ──
        const bNoise = makeNoise(totalDur);
        const bf1 = ctx.createBiquadFilter();
        bf1.type = 'bandpass'; bf1.frequency.value = 750;  bf1.Q.value = 4;
        const bf2 = ctx.createBiquadFilter();
        bf2.type = 'bandpass'; bf2.frequency.value = 1150; bf2.Q.value = 3;
        const breathGain = ctx.createGain();
        breathGain.gain.setValueAtTime(0,    now + 0.1);
        breathGain.gain.linearRampToValueAtTime(0.12, now + 0.3);
        breathGain.gain.linearRampToValueAtTime(0.06, now + totalDur - 0.2);
        breathGain.gain.linearRampToValueAtTime(0,    now + totalDur);
        bNoise.connect(bf1); bNoise.connect(bf2);
        bf1.connect(breathGain); bf2.connect(breathGain);
        breathGain.connect(master);
        bNoise.start(now + 0.1); bNoise.stop(now + totalDur);

    } catch (e) {
        // AudioContext blocked before gesture — silent fail
    }
}

// ─────────────────────────────────────────────
//  THEME & ANIMATIONS
// ─────────────────────────────────────────────

// FIXED: was setting body.className = 'dark' (no suffix) — CSS classes are 'dark-theme' etc.
function applyTheme() {
    // Remove all theme classes, keep any other classes intact
    document.body.classList.remove('dark-theme', 'light-theme', 'ocean-theme', 'gradient-theme');
    document.body.classList.add(`${state.settings.theme}-theme`);
}

/**
 * Inject / remove a <style> tag that kills every animation.
 * This is the only approach that reliably stops mid-run CSS animations in
 * Chrome extensions — class-based overrides can lose the cascade race.
 */
function applyAnimations() {
    const STYLE_ID = 'ft-anim-kill';
    let tag = document.getElementById(STYLE_ID);

    if (!state.settings.enableAnimations) {
        if (!tag) {
            tag = document.createElement('style');
            tag.id = STYLE_ID;
            document.head.appendChild(tag);
        }
        tag.textContent = `*, *::before, *::after {
            animation: none !important;
            animation-play-state: paused !important;
            transition: none !important;
        }`;
    } else {
        if (tag) tag.remove();
    }
}

// ─────────────────────────────────────────────
//  SETTINGS UI SYNC
// ─────────────────────────────────────────────
function syncSettingsUI() {
    document.getElementById('animationsToggle').checked = state.settings.enableAnimations;
    document.getElementById('quotesToggle').checked     = state.settings.showQuotes;
    document.getElementById('soundToggle').checked      = state.settings.enableSound;
    document.getElementById('themeSelect').value        = state.settings.theme;
    document.getElementById('timerDuration').value      = state.settings.timerDuration;
}

// ─────────────────────────────────────────────
//  EVENT LISTENERS
// ─────────────────────────────────────────────
function setupEventListeners() {

    // ── Timer controls ──
    document.getElementById('startBtn').addEventListener('click', startTimer);
    document.getElementById('pauseBtn').addEventListener('click', pauseTimer);
    document.getElementById('resetBtn').addEventListener('click', resetTimer);

    // ── Focus input ──
    document.getElementById('focusInput').addEventListener('blur',  saveFocusInput);
    document.getElementById('focusInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.target.blur(); }
    });

    // ── Quote ──
    document.getElementById('newQuoteBtn').addEventListener('click', displayRandomQuote);

    // ── Settings modal open / close ──
    document.getElementById('settingsBtn').addEventListener('click', openSettings);
    document.getElementById('closeSettingsBtn').addEventListener('click', closeSettings);
    document.getElementById('settingsModal').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeSettings();
    });

    // ── Keyboard shortcut: Ctrl+Shift+S ──
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.shiftKey && e.key === 'S') {
            e.preventDefault();
            openSettings();
        }
        if (e.key === 'Escape') closeSettings();
    });

    // ── Animations toggle ──
    document.getElementById('animationsToggle').addEventListener('change', (e) => {
        state.settings.enableAnimations = e.target.checked;
        applyAnimations();
        saveSettings();
    });

    // ── Quotes toggle ──
    document.getElementById('quotesToggle').addEventListener('change', (e) => {
        state.settings.showQuotes = e.target.checked;
        setQuoteVisible(state.settings.showQuotes);   // instant show/hide
        if (state.settings.showQuotes) displayRandomQuote(); // refresh content when re-shown
        saveSettings();
    });

    // ── Sound toggle ──
    document.getElementById('soundToggle').addEventListener('change', (e) => {
        state.settings.enableSound = e.target.checked;
        saveSettings();
    });

    // ── Theme select ──
    document.getElementById('themeSelect').addEventListener('change', (e) => {
        state.settings.theme = e.target.value;
        applyTheme();
        saveSettings();
    });

    // ── Timer duration ──
    document.getElementById('timerDuration').addEventListener('change', (e) => {
        const val = Math.min(120, Math.max(1, parseInt(e.target.value, 10) || 25));
        e.target.value              = val;
        state.settings.timerDuration = val;
        state.totalTime             = val * 60;
        // Only reset if timer is not running
        if (!state.isRunning) {
            state.timeLeft = state.totalTime;
            updateTimerDisplay();
            updateTimerRing(1);
        }
        saveSettings();
    });
}

function openSettings() {
    document.getElementById('settingsModal').classList.add('show');
}

function closeSettings() {
    document.getElementById('settingsModal').classList.remove('show');
}

// ─────────────────────────────────────────────
//  STREAK
// ─────────────────────────────────────────────
function getYesterdayStr() {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toDateString();
}

function initializeStreak() {
    const today = new Date().toDateString();

    chrome.storage.local.get('focusTabStreak', (result) => {
        let data = result.focusTabStreak || { streak: 1, lastSessionDate: today };

        if (data.lastSessionDate !== today) {
            data.streak = (data.lastSessionDate === getYesterdayStr())
                ? data.streak + 1
                : 1;
            data.lastSessionDate = today;
            chrome.storage.local.set({ focusTabStreak: data });
        }

        displayStreak(data.streak);
    });
}

function displayStreak(count) {
    let el = document.getElementById('streakDisplay');
    if (!el) {
        el = document.createElement('div');
        el.id = 'streakDisplay';
        document.body.appendChild(el);
    }
    el.textContent = `🔥 ${count} day${count !== 1 ? 's' : ''} streak`;
}

// ─────────────────────────────────────────────
console.log('FocusTab Ready 🚀');