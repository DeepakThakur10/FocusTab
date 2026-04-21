/**
 * FocusTab – newtab.js  (UI only — no timers here)
 */

'use strict';

const KEYS = {
  TIMER:    'ft_timer',
  SETTINGS: 'ft_settings',
  STREAK:   'ft_streak',
  FOCUS:    'ft_focus',
  PLAYED:   'ft_soundPlayed',
};

const CIRCUMFERENCE = 502.65;

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
  { text: "Energy and persistence conquer all things.", author: "Benjamin Franklin" },
  { text: "What you do today can improve all your tomorrows.", author: "Ralph Marston" },
  { text: "The secret of getting ahead is getting started.", author: "Mark Twain" },
  { text: "Act as if what you do makes a difference. It does.", author: "William James" },
  { text: "Well done is better than well said.", author: "Benjamin Franklin" },
];

let lastQuoteIdx   = -1;
let cachedSettings = {};
let cachedTimer    = {};
let completionPromptShown = false;
let currentTabKey = null;
let completionActionPending = false;

const SESSION_KEYS = {
  DURATION_ASKED: 'ft_durationAsked',
  TAB_KEY: 'ft_tabKey',
};

function hasDurationBeenSet() {
  return sessionStorage.getItem(SESSION_KEYS.DURATION_ASKED) === '1';
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async function() {
  ensureCurrentTabKey();
  startClock();
  await syncFullState();
  setupEventListeners();
  setupStorageWatcher();
  const playedPending = await checkPendingSound();
  if (!playedPending && cachedSettings.enableSound !== false) {
    playTabOpenSound();
  }
  await maybeAskInitialDuration();
  maybeShowCompletionPrompt();
  displayRandomQuote();
});

function ensureCurrentTabKey() {
  var saved = sessionStorage.getItem(SESSION_KEYS.TAB_KEY);
  if (!saved) {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) saved = crypto.randomUUID();
    else saved = String(Date.now()) + '_' + String(Math.floor(Math.random() * 1000000));
    sessionStorage.setItem(SESSION_KEYS.TAB_KEY, saved);
  }
  currentTabKey = saved;
}

// ─── Sync with retries (handles SW cold-start) ────────────────────────────────
async function syncFullState() {
  const MAX_RETRIES = 5;
  const DELAY_MS    = 300;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const resp = await sendMsg({ type: 'GET_STATE' });

      // Validate response has the expected shape
      if (!resp || typeof resp !== 'object' || !resp.timer || !resp.settings) {
        throw new Error('Invalid response shape: ' + JSON.stringify(resp));
      }

      cachedTimer    = resp.timer;
      cachedSettings = resp.settings;
      currentTabKey  = currentTabKey || resp.tabKey || null;

      applySettings(resp.settings);
      renderTimer(resp.timer);
      await syncStreak();
      await loadFocusInput();
      return; // success
    } catch (err) {
      console.warn('FocusTab: syncFullState attempt ' + attempt + ' failed:', err.message);
      if (attempt < MAX_RETRIES) {
        await sleep(DELAY_MS * attempt); // back-off: 300, 600, 900…
      } else {
        console.error('FocusTab: could not reach background after ' + MAX_RETRIES + ' attempts. Applying defaults.');
        // Fall back to hard-coded defaults so UI is still usable
        cachedSettings = { theme: 'dark', timerDuration: 25, showQuotes: true, enableSound: true, enableAnimations: true };
        cachedTimer    = { status: 'idle', timeLeft: 25 * 60, totalTime: 25 * 60, startedAt: null };
        applySettings(cachedSettings);
        renderTimer(cachedTimer);
      }
    }
  }
}

function sleep(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

// ─── Background message listener ─────────────────────────────────────────────
chrome.runtime.onMessage.addListener(function(msg) {
  if (msg.tabKey && currentTabKey && String(msg.tabKey) !== String(currentTabKey)) return;

  if (msg.type === 'TIMER_TICK') {
    cachedTimer.timeLeft = msg.timeLeft;
    renderTimerDisplay(msg.timeLeft, cachedTimer.totalTime);
  } else if (msg.type === 'TIMER_COMPLETE') {
    cachedTimer.status   = 'complete';
    cachedTimer.timeLeft = 0;
    renderTimer(cachedTimer);
    handleCompletionUI();
    checkPendingSound();
    sessionStorage.removeItem(SESSION_KEYS.DURATION_ASKED);
    maybeShowCompletionPrompt();
  }
});

// ─── Storage watcher (cross-tab sync) ────────────────────────────────────────
function setupStorageWatcher() {
  chrome.storage.onChanged.addListener(function(changes, area) {
    if (area !== 'local') return;

    if (changes[KEYS.TIMER] && changes[KEYS.TIMER].newValue) {
      const allTimers = changes[KEYS.TIMER].newValue;
      if (currentTabKey && allTimers && allTimers[currentTabKey]) {
        cachedTimer = allTimers[currentTabKey];
        renderTimer(cachedTimer);
        if (cachedTimer.status !== 'complete') {
          completionPromptShown = false;
          closeCompletionPrompt();
        }
      }
    }
    if (changes[KEYS.SETTINGS] && changes[KEYS.SETTINGS].newValue) {
      cachedSettings = changes[KEYS.SETTINGS].newValue;
      applySettings(cachedSettings);
    }
    if (changes[KEYS.PLAYED] && changes[KEYS.PLAYED].newValue) {
      const playedMap = changes[KEYS.PLAYED].newValue;
      if (currentTabKey && playedMap && playedMap[currentTabKey] === false) {
        checkPendingSound();
      }
    }
  });
}

// ─── Pending sound check ─────────────────────────────────────────────────────
async function checkPendingSound() {
  try {
    const r = await chrome.storage.local.get(KEYS.PLAYED);
    const playedMap = r[KEYS.PLAYED] || {};
    if (currentTabKey && playedMap[currentTabKey] === false && cachedSettings.enableSound !== false) {
      playCompletionSoundUI();
      sendMsg({ type: 'SOUND_PLAYED' }).catch(function() {});
      return true;
    }
  } catch(e) { /* silent */ }
  return false;
}

function playTabOpenSound() {
  playCompletionSoundUI();
}

function maybeShowCompletionPrompt() {
  if (!cachedTimer || cachedTimer.status !== 'complete' || completionPromptShown) return;
  completionPromptShown = true;
  openCompletionPrompt();
}

function openCompletionPrompt() {
  const modal = document.getElementById('completionModal');
  if (modal) modal.classList.add('show');
}

function closeCompletionPrompt() {
  const modal = document.getElementById('completionModal');
  if (modal) modal.classList.remove('show');
}

// ─── UI sound fallback ────────────────────────────────────────────────────────
function playCompletionSoundUI() {
  const audio = new Audio(chrome.runtime.getURL('sounds/complete.mp3'));
  audio.volume = 0.8;
  audio.play().catch(function() { playFaahSoundUI(); });
}

function playFaahSoundUI() {
  try {
    const ctx      = new AudioContext();
    const now      = ctx.currentTime;
    const totalDur = 1.6;

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

    const fNoise = makeNoise(0.2);
    const fHPF   = ctx.createBiquadFilter();
    fHPF.type = 'highpass';
    fHPF.frequency.setValueAtTime(4500, now);
    fHPF.frequency.linearRampToValueAtTime(1200, now + 0.12);
    const fGain = ctx.createGain();
    fGain.gain.setValueAtTime(0, now);
    fGain.gain.linearRampToValueAtTime(0.5, now + 0.03);
    fGain.gain.linearRampToValueAtTime(0.3, now + 0.08);
    fGain.gain.linearRampToValueAtTime(0,   now + 0.15);
    fNoise.connect(fHPF); fHPF.connect(fGain); fGain.connect(master);
    fNoise.start(now); fNoise.stop(now + 0.2);

    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(130, now + 0.1);
    osc.frequency.linearRampToValueAtTime(105, now + totalDur);
    const f1  = ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = 750;  f1.Q.value = 7;
    const f2  = ctx.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = 1150; f2.Q.value = 5;
    const lpf = ctx.createBiquadFilter(); lpf.type = 'lowpass';
    lpf.frequency.setValueAtTime(2200, now + 0.1);
    lpf.frequency.linearRampToValueAtTime(700, now + totalDur);
    const vowelGain = ctx.createGain();
    vowelGain.gain.setValueAtTime(0, now + 0.08);
    vowelGain.gain.linearRampToValueAtTime(0.4, now + 0.28);
    vowelGain.gain.setValueAtTime(0.4, now + totalDur - 0.35);
    vowelGain.gain.linearRampToValueAtTime(0, now + totalDur);
    osc.connect(f1); osc.connect(f2); osc.connect(lpf);
    f1.connect(vowelGain); f2.connect(vowelGain); lpf.connect(vowelGain);
    vowelGain.connect(master);
    osc.start(now + 0.1); osc.stop(now + totalDur);

    const bNoise  = makeNoise(totalDur);
    const bf1     = ctx.createBiquadFilter(); bf1.type = 'bandpass'; bf1.frequency.value = 750;  bf1.Q.value = 4;
    const bf2     = ctx.createBiquadFilter(); bf2.type = 'bandpass'; bf2.frequency.value = 1150; bf2.Q.value = 3;
    const breathGain = ctx.createGain();
    breathGain.gain.setValueAtTime(0, now + 0.1);
    breathGain.gain.linearRampToValueAtTime(0.12, now + 0.3);
    breathGain.gain.linearRampToValueAtTime(0.06, now + totalDur - 0.2);
    breathGain.gain.linearRampToValueAtTime(0, now + totalDur);
    bNoise.connect(bf1); bNoise.connect(bf2);
    bf1.connect(breathGain); bf2.connect(breathGain);
    breathGain.connect(master);
    bNoise.start(now + 0.1); bNoise.stop(now + totalDur);

    setTimeout(function() { ctx.close(); }, (totalDur + 0.5) * 1000);
  } catch(e) { /* silent */ }
}

// ─── Render ───────────────────────────────────────────────────────────────────
function renderTimer(timer) {
  if (!timer) return;
  renderTimerDisplay(timer.timeLeft, timer.totalTime);
  renderButtonStates(timer.status);
  renderHelperText(timer.status);
}

function renderTimerDisplay(timeLeft, totalTime) {
  const m = Math.floor(timeLeft / 60);
  const s = timeLeft % 60;
  document.getElementById('timerDisplay').textContent =
    String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');

  const fraction = (totalTime > 0) ? (timeLeft / totalTime) : 1;
  document.getElementById('timerProgress').style.strokeDashoffset =
    CIRCUMFERENCE * (1 - fraction);
}

function renderButtonStates(status) {
  const startBtn  = document.getElementById('startBtn');
  const pauseBtn  = document.getElementById('pauseBtn');
  const resumeBtn = document.getElementById('resumeBtn');

  const isRunning = status === 'running';
  const isPaused  = status === 'paused';

  startBtn.disabled  = isRunning || isPaused;
  pauseBtn.disabled  = !isRunning;
  resumeBtn.disabled = !isPaused;

  resumeBtn.style.display = isPaused  ? 'inline-flex' : 'none';
  pauseBtn.style.display  = !isPaused ? 'inline-flex' : 'none';

  if (isRunning)             startBtn.innerHTML = '<span class="btn-icon">▶</span> Running…';
  else if (status==='complete') startBtn.innerHTML = '<span class="btn-icon">▶</span> New Session';
  else                       startBtn.innerHTML = '<span class="btn-icon">▶</span> Start Focus';
}

function renderHelperText(status) {
  const map = {
    idle:     'Get ready to focus!',
    running:  'Stay focused — you got this! 💪',
    paused:   'Paused. Resume when ready.',
    complete: 'Session complete! Great work 🎉',
  };
  document.getElementById('timerHelper').textContent = map[status] || 'Get ready to focus!';
}

function handleCompletionUI() {
  const card = document.querySelector('.premium-card');
  card.style.transition = 'box-shadow 0.4s ease';
  card.style.boxShadow  = '0 0 80px rgba(99,102,241,0.7), 0 30px 80px rgba(0,0,0,0.5)';
  setTimeout(function() { card.style.boxShadow = ''; }, 2000);
}

// ─── Settings ─────────────────────────────────────────────────────────────────
function applySettings(settings) {
  document.body.classList.remove('dark-theme','light-theme','ocean-theme','gradient-theme');
  document.body.classList.add(settings.theme + '-theme');

  const STYLE_ID = 'ft-anim-kill';
  let tag = document.getElementById(STYLE_ID);
  if (!settings.enableAnimations) {
    if (!tag) { tag = document.createElement('style'); tag.id = STYLE_ID; document.head.appendChild(tag); }
    tag.textContent = '*, *::before, *::after { animation: none !important; transition: none !important; }';
  } else {
    if (tag) tag.remove();
  }

  const wrapper = document.getElementById('quoteWrapper');
  if (wrapper) wrapper.style.display = settings.showQuotes ? '' : 'none';

  syncSettingsUI(settings);
}

function syncSettingsUI(s) {
  function setEl(id, val) {
    const el = document.getElementById(id);
    if (!el) return;
    if (typeof val === 'boolean') el.checked = val; else el.value = val;
  }
  setEl('animationsToggle', s.enableAnimations);
  setEl('quotesToggle',     s.showQuotes);
  setEl('soundToggle',      s.enableSound);
  setEl('themeSelect',      s.theme);
  setEl('timerDuration',    s.timerDuration);
}

// ─── Event listeners ──────────────────────────────────────────────────────────
function setupEventListeners() {
  document.getElementById('startBtn').addEventListener('click', async function() {
    if (!hasDurationBeenSet()) {
      openInitialDurationPrompt();
      return;
    }

    const status = cachedTimer.status;
    if (status === 'complete') {
      await sendMsg({ type: 'RESET' });
      await sleep(60); // brief pause so storage settles
    }
    await sendMsg({ type: 'START' });
  });

  document.getElementById('pauseBtn').addEventListener('click', function()  { sendMsg({ type: 'PAUSE' });  });
  document.getElementById('resumeBtn').addEventListener('click', function() { sendMsg({ type: 'RESUME' }); });
  document.getElementById('resetBtn').addEventListener('click', function()  { sendMsg({ type: 'RESET' });  });

  const focusInput = document.getElementById('focusInput');
  focusInput.addEventListener('blur',    function() { sendMsg({ type: 'SAVE_FOCUS', value: focusInput.value.trim() }); });
  focusInput.addEventListener('keydown', function(e){ if (e.key === 'Enter') e.target.blur(); });

  document.getElementById('newQuoteBtn').addEventListener('click', displayRandomQuote);

  document.getElementById('settingsBtn').addEventListener('click',      openSettings);
  document.getElementById('closeSettingsBtn').addEventListener('click', closeSettings);
  document.getElementById('settingsModal').addEventListener('click', function(e) {
    if (e.target === e.currentTarget) closeSettings();
  });

  document.getElementById('completionModal').addEventListener('click', function(e) {
    if (e.target === e.currentTarget) closeCompletionPrompt();
  });

  document.getElementById('continueHereBtn').addEventListener('click', async function() {
    if (completionActionPending) return;
    completionActionPending = true;
    closeCompletionPrompt();
    completionPromptShown = false;
    sessionStorage.removeItem(SESSION_KEYS.DURATION_ASKED);
    await sendMsg({ type: 'RESET' });
    await sleep(60);
    openInitialDurationPrompt();
    completionActionPending = false;
  });

  document.getElementById('notNowBtn').addEventListener('click', async function() {
    if (completionActionPending) return;
    completionActionPending = true;
    closeCompletionPrompt();
    completionPromptShown = false;
    sessionStorage.removeItem(SESSION_KEYS.DURATION_ASKED);
    await sendMsg({ type: 'RESET' });
    completionActionPending = false;
  });

  document.getElementById('setDurationBtn').addEventListener('click', async function() {
    const input = document.getElementById('initialDurationInput');
    const val = Math.min(120, Math.max(1, parseInt(input.value, 10) || cachedSettings.timerDuration || 25));
    input.value = val;
    await sendMsg({ type: 'RESET', duration: val });
    await sleep(60);
    await sendMsg({ type: 'START' });
    sessionStorage.setItem(SESSION_KEYS.DURATION_ASKED, '1');
    closeInitialDurationPrompt();
  });

  document.getElementById('initialDurationInput').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      document.getElementById('setDurationBtn').click();
    }
  });

  document.addEventListener('keydown', function(e) {
    if (e.ctrlKey && e.shiftKey && e.key === 'S') { e.preventDefault(); openSettings(); }
    if (e.key === 'Escape') {
      closeSettings();
      closeCompletionPrompt();
    }
  });

  function saveSettings(patch) {
    cachedSettings = Object.assign({}, cachedSettings, patch);
    applySettings(cachedSettings);
    sendMsg({ type: 'SAVE_SETTINGS', settings: cachedSettings });
  }

  document.getElementById('animationsToggle').addEventListener('change', function(e) { saveSettings({ enableAnimations: e.target.checked }); });
  document.getElementById('quotesToggle').addEventListener('change', function(e) {
    if (e.target.checked) displayRandomQuote();
    saveSettings({ showQuotes: e.target.checked });
  });
  document.getElementById('soundToggle').addEventListener('change',  function(e) { saveSettings({ enableSound: e.target.checked }); });
  document.getElementById('themeSelect').addEventListener('change',  function(e) { saveSettings({ theme: e.target.value }); });
  document.getElementById('timerDuration').addEventListener('change', function(e) {
    const val = Math.min(120, Math.max(1, parseInt(e.target.value, 10) || 25));
    e.target.value = val;
    saveSettings({ timerDuration: val });
  });
}

function openSettings()  { document.getElementById('settingsModal').classList.add('show'); }
function closeSettings() { document.getElementById('settingsModal').classList.remove('show'); }

async function maybeAskInitialDuration() {
  if (hasDurationBeenSet()) return;
  const input = document.getElementById('initialDurationInput');
  if (input) input.value = Math.min(120, Math.max(1, parseInt(cachedSettings.timerDuration, 10) || 25));
  openInitialDurationPrompt();
}

function openInitialDurationPrompt() {
  const modal = document.getElementById('initialDurationModal');
  if (modal) modal.classList.add('show');
}

function closeInitialDurationPrompt() {
  const modal = document.getElementById('initialDurationModal');
  if (modal) modal.classList.remove('show');
}

// ─── Clock ────────────────────────────────────────────────────────────────────
function startClock() {
  function tick() {
    const now  = new Date();
    const hh   = String(now.getHours()).padStart(2, '0');
    const mm   = String(now.getMinutes()).padStart(2, '0');
    document.getElementById('clock').textContent = hh + ':' + mm;

    const hour = now.getHours();
    let greeting, message;
    if (hour < 12)      { greeting = 'Good Morning';   message = 'Start your day with purpose!'; }
    else if (hour < 17) { greeting = 'Good Afternoon'; message = "Keep pushing — you're doing great!"; }
    else                { greeting = 'Good Evening';   message = 'Finish strong tonight!'; }
    document.getElementById('greeting').textContent            = greeting;
    document.getElementById('motivationalMessage').textContent = message;
  }
  tick();
  setInterval(tick, 1000);
}

// ─── Quotes ───────────────────────────────────────────────────────────────────
function displayRandomQuote() {
  if (!cachedSettings.showQuotes) return;
  let idx;
  do { idx = Math.floor(Math.random() * QUOTES.length); }
  while (idx === lastQuoteIdx && QUOTES.length > 1);
  lastQuoteIdx = idx;

  const q        = QUOTES[idx];
  const textEl   = document.getElementById('quoteText');
  const authorEl = document.getElementById('quoteAuthor');
  textEl.style.opacity = authorEl.style.opacity = '0';
  setTimeout(function() {
    textEl.textContent   = q.text;
    authorEl.textContent = '— ' + q.author;
    textEl.style.opacity = authorEl.style.opacity = '1';
  }, 220);
}

// ─── Focus input ──────────────────────────────────────────────────────────────
async function loadFocusInput() {
  const r = await chrome.storage.local.get(KEYS.FOCUS);
  if (r[KEYS.FOCUS]) document.getElementById('focusInput').value = r[KEYS.FOCUS];
}

// ─── Streak ───────────────────────────────────────────────────────────────────
async function syncStreak() {
  const today     = new Date().toDateString();
  const d         = new Date(); d.setDate(d.getDate() - 1);
  const yesterday = d.toDateString();

  let data = await sendMsg({ type: 'GET_STREAK' });
  if (!data || data.error) data = { streak: 1, lastSessionDate: today };

  if (data.lastSessionDate !== today) {
    data.streak          = (data.lastSessionDate === yesterday) ? data.streak + 1 : 1;
    data.lastSessionDate = today;
    sendMsg({ type: 'SAVE_STREAK', data: data });
  }
  displayStreak(data.streak);
}

function displayStreak(count) {
  let el = document.getElementById('streakDisplay');
  if (!el) {
    el    = document.createElement('div');
    el.id = 'streakDisplay';
    document.body.appendChild(el);
  }
  el.textContent = '🔥 ' + count + ' day' + (count !== 1 ? 's' : '') + ' streak';
}

// ─── sendMsg helper ───────────────────────────────────────────────────────────
function sendMsg(msg) {
  const payload = Object.assign({}, msg);
  if (currentTabKey) payload.tabKey = currentTabKey;
  return chrome.runtime.sendMessage(payload);
}

console.log('FocusTab UI Ready 🚀');