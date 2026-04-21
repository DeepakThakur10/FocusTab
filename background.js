/**
 * FocusTab – background.js (Service Worker, Manifest V3)
 * Plain script (no type:module) for maximum Chrome/Edge compatibility.
 */

'use strict';

const KEYS = {
  TIMER:    'ft_timer',
  SETTINGS: 'ft_settings',
  STREAK:   'ft_streak',
  FOCUS:    'ft_focus',
  PLAYED:   'ft_soundPlayed',
};

const ALARM_TICK_PREFIX = 'ft_tick_';

const DEFAULT_SETTINGS = {
  theme:            'dark',
  timerDuration:    25,
  showQuotes:       true,
  enableSound:      true,
  enableAnimations: true,
};

const DEFAULT_TIMER = {
  status:    'idle',
  timeLeft:  25 * 60,
  totalTime: 25 * 60,
  startedAt: null,
};

let _stateOp = Promise.resolve();

function withStateLock(task) {
  const run = _stateOp.then(task, task);
  _stateOp = run.catch(function() {});
  return run;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getAlarmName(tabKey) {
  return ALARM_TICK_PREFIX + tabKey;
}

function isLegacyTimerObject(value) {
  return !!value && typeof value === 'object' &&
    Object.prototype.hasOwnProperty.call(value, 'status') &&
    Object.prototype.hasOwnProperty.call(value, 'timeLeft') &&
    Object.prototype.hasOwnProperty.call(value, 'totalTime');
}

async function getAllTimersRaw() {
  const r = await chrome.storage.local.get(KEYS.TIMER);
  const stored = r[KEYS.TIMER];

  if (!stored) return {};
  if (isLegacyTimerObject(stored)) {
    return { legacy: stored };
  }
  return stored;
}

async function getAllPlayedMap() {
  return withStateLock(async function() {
    const r = await chrome.storage.local.get(KEYS.PLAYED);
    const stored = r[KEYS.PLAYED];
    if (!stored || typeof stored !== 'object') return {};
    return stored;
  });
}

async function setSoundPlayedForTab(tabKey, played) {
  await withStateLock(async function() {
    const r = await chrome.storage.local.get(KEYS.PLAYED);
    const map = (r[KEYS.PLAYED] && typeof r[KEYS.PLAYED] === 'object') ? r[KEYS.PLAYED] : {};
    map[String(tabKey || 'unknown')] = !!played;
    await chrome.storage.local.set({ [KEYS.PLAYED]: map });
  });
}

async function getSettings() {
  const r = await chrome.storage.local.get(KEYS.SETTINGS);
  return r[KEYS.SETTINGS] || Object.assign({}, DEFAULT_SETTINGS);
}

async function buildDefaultTimer() {
  const settings = await getSettings();
  const total = Math.max(1, parseInt(settings.timerDuration, 10) || 25) * 60;
  return { status: 'idle', timeLeft: total, totalTime: total, startedAt: null };
}

async function getTimerForTab(tabKey) {
  return withStateLock(async function() {
    const timers = await getAllTimersRaw();
    const key = String(tabKey || 'unknown');
    if (!timers[key]) {
      timers[key] = await buildDefaultTimer();
      await chrome.storage.local.set({ [KEYS.TIMER]: timers });
    }
    return timers[key];
  });
}

async function setTimerForTab(tabKey, timer) {
  return withStateLock(async function() {
    const timers = await getAllTimersRaw();
    const key = String(tabKey || 'unknown');
    timers[key] = timer;
    await chrome.storage.local.set({ [KEYS.TIMER]: timers });
    return timer;
  });
}

async function updateTimerForTab(tabKey, updater) {
  return withStateLock(async function() {
    const timers = await getAllTimersRaw();
    const key = String(tabKey || 'unknown');
    const current = timers[key] || await buildDefaultTimer();
    const next = updater(current);
    timers[key] = next;
    await chrome.storage.local.set({ [KEYS.TIMER]: timers });
    return next;
  });
}

async function ensureDefaults() {
  const r = await chrome.storage.local.get([KEYS.TIMER, KEYS.SETTINGS, KEYS.PLAYED]);
  const writes = {};
  if (!r[KEYS.TIMER])               writes[KEYS.TIMER]    = {};
  else if (isLegacyTimerObject(r[KEYS.TIMER])) writes[KEYS.TIMER] = { legacy: r[KEYS.TIMER] };
  if (!r[KEYS.SETTINGS])            writes[KEYS.SETTINGS] = Object.assign({}, DEFAULT_SETTINGS);
  if (r[KEYS.PLAYED] === undefined) writes[KEYS.PLAYED]   = {};
  else if (typeof r[KEYS.PLAYED] !== 'object') writes[KEYS.PLAYED] = { legacy: !!r[KEYS.PLAYED] };
  if (Object.keys(writes).length > 0) await chrome.storage.local.set(writes);
}

function broadcast(msg) {
  chrome.runtime.sendMessage(msg).catch(function() {});
}

// ─── Alarm tick ───────────────────────────────────────────────────────────────
chrome.alarms.onAlarm.addListener(function(alarm) {
  if (!alarm.name || !alarm.name.startsWith(ALARM_TICK_PREFIX)) return;
  const tabKey = alarm.name.slice(ALARM_TICK_PREFIX.length);
  tickTimer(tabKey);
});

async function tickTimer(tabKey) {
  const timer = await getTimerForTab(tabKey);
  if (timer.status !== 'running') {
    chrome.alarms.clear(getAlarmName(tabKey));
    return;
  }

  const newTimeLeft = timer.timeLeft - 1;

  if (newTimeLeft <= 0) {
    chrome.alarms.clear(getAlarmName(tabKey));
    await updateTimerForTab(tabKey, function(cur) {
      return Object.assign({}, cur, { status: 'complete', timeLeft: 0, startedAt: null });
    });

    await setSoundPlayedForTab(tabKey, false);
    broadcast({ type: 'TIMER_COMPLETE', tabKey: String(tabKey) });
  } else {
    await updateTimerForTab(tabKey, function(cur) {
      return Object.assign({}, cur, { timeLeft: newTimeLeft });
    });
    broadcast({ type: 'TIMER_TICK', timeLeft: newTimeLeft, tabKey: String(tabKey) });
  }
}

// ─── Message handler ──────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
  handleMessage(msg, sender)
    .then(sendResponse)
    .catch(function(err) { sendResponse({ error: err.message }); });
  return true; // keep port open for async response
});

async function handleMessage(msg, sender) {
  await ensureDefaults(); // always safe to call; no-ops if storage already populated
  const tabKeyFromMsg = (msg && msg.tabKey !== undefined && msg.tabKey !== null)
    ? String(msg.tabKey)
    : '';
  const tabKey = tabKeyFromMsg || ((sender && sender.tab && sender.tab.id !== undefined)
    ? String(sender.tab.id)
    : 'legacy');

  switch (msg.type) {

    case 'GET_STATE': {
      const timer    = await getTimerForTab(tabKey);
      const settings = await getSettings();
      return { timer: timer, settings: settings, tabKey: tabKey };
    }

    case 'START': {
      const timer = await getTimerForTab(tabKey);
      if (timer.status === 'running') return { ok: true };
      await updateTimerForTab(tabKey, function(cur) {
        return Object.assign({}, cur, { status: 'running', startedAt: Date.now() });
      });
      await chrome.alarms.clear(getAlarmName(tabKey));
      chrome.alarms.create(getAlarmName(tabKey), { periodInMinutes: 1 / 60 }); // ~1s
      return { ok: true };
    }

    case 'PAUSE': {
      const timer = await getTimerForTab(tabKey);
      if (timer.status !== 'running') return { ok: true };
      await chrome.alarms.clear(getAlarmName(tabKey));
      await updateTimerForTab(tabKey, function(cur) {
        return Object.assign({}, cur, { status: 'paused', startedAt: null });
      });
      return { ok: true };
    }

    case 'RESUME': {
      const timer = await getTimerForTab(tabKey);
      if (timer.status !== 'paused') return { ok: true };
      await updateTimerForTab(tabKey, function(cur) {
        return Object.assign({}, cur, { status: 'running', startedAt: Date.now() });
      });
      await chrome.alarms.clear(getAlarmName(tabKey));
      chrome.alarms.create(getAlarmName(tabKey), { periodInMinutes: 1 / 60 });
      return { ok: true };
    }

    case 'RESET': {
      await chrome.alarms.clear(getAlarmName(tabKey));
      const settings = await getSettings();
      const duration = Math.max(1, Math.min(120, parseInt(msg.duration, 10) || settings.timerDuration));
      const total    = duration * 60;
      await setTimerForTab(tabKey, { status: 'idle', timeLeft: total, totalTime: total, startedAt: null });
      await setSoundPlayedForTab(tabKey, true);
      return { ok: true };
    }

    case 'SAVE_SETTINGS': {
      await chrome.storage.local.set({ [KEYS.SETTINGS]: msg.settings });
      const timer = await getTimerForTab(tabKey);
      if (timer.status === 'idle' || timer.status === 'complete') {
        const total = msg.settings.timerDuration * 60;
        await updateTimerForTab(tabKey, function(cur) {
          return Object.assign({}, cur, { timeLeft: total, totalTime: total });
        });
      }
      return { ok: true };
    }

    case 'SAVE_FOCUS': {
      await chrome.storage.local.set({ [KEYS.FOCUS]: msg.value });
      return { ok: true };
    }

    case 'SOUND_PLAYED': {
      await setSoundPlayedForTab(tabKey, true);
      return { ok: true };
    }

    case 'GET_STREAK': {
      const r = await chrome.storage.local.get(KEYS.STREAK);
      return r[KEYS.STREAK] || { streak: 1, lastSessionDate: new Date().toDateString() };
    }

    case 'SAVE_STREAK': {
      await chrome.storage.local.set({ [KEYS.STREAK]: msg.data });
      return { ok: true };
    }

    default:
      return { error: 'Unknown message: ' + msg.type };
  }
}

// ─── Offscreen sound ──────────────────────────────────────────────────────────
var _offscreenCreating = false;

async function triggerSound() {
  if (!chrome.offscreen) return; // API not available — newtab.js handles via checkPendingSound
  try {
    var hasDoc = false;
    try { hasDoc = await chrome.offscreen.hasDocument(); } catch(e) {}
    if (hasDoc) {
      chrome.runtime.sendMessage({ type: 'PLAY_SOUND' }).catch(function() {});
      return;
    }
    if (_offscreenCreating) return;
    _offscreenCreating = true;
    await chrome.offscreen.createDocument({
      url:           chrome.runtime.getURL('offscreen.html'),
      reasons:       ['AUDIO_PLAYBACK'],
      justification: 'Play timer completion sound',
    });
    _offscreenCreating = false;
    setTimeout(function() {
      chrome.runtime.sendMessage({ type: 'PLAY_SOUND' }).catch(function() {});
    }, 350);
  } catch(e) {
    _offscreenCreating = false;
    console.warn('FocusTab offscreen:', e.message);
  }
}

// ─── Startup ──────────────────────────────────────────────────────────────────
ensureDefaults().then(function() {
  console.log('FocusTab Service Worker loaded');
});

chrome.runtime.onInstalled.addListener(function() {
  ensureDefaults();
});