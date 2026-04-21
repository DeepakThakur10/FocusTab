/**
 * FocusTab – offscreen.js
 * Runs inside offscreen.html. Receives PLAY_SOUND messages and plays audio.
 * This document has full audio access even when the new-tab page is closed.
 */

'use strict';

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'PLAY_SOUND') {
    playCompletionSound();
  }
});

/**
 * Try to play sounds/complete.mp3 first.
 * Falls back to a synthesized "Faah" breath via Web Audio API.
 */
function playCompletionSound() {
  const audio = new Audio(chrome.runtime.getURL('sounds/complete.mp3'));
  audio.volume = 0.8;
  audio.play().catch(() => playFaahSound());
}

function playFaahSound() {
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

    // 'F' fricative
    const fNoise = makeNoise(0.2);
    const fHPF   = ctx.createBiquadFilter();
    fHPF.type = 'highpass';
    fHPF.frequency.setValueAtTime(4500, now);
    fHPF.frequency.linearRampToValueAtTime(1200, now + 0.12);
    const fGain = ctx.createGain();
    fGain.gain.setValueAtTime(0, now);
    fGain.gain.linearRampToValueAtTime(0.5,  now + 0.03);
    fGain.gain.linearRampToValueAtTime(0.3,  now + 0.08);
    fGain.gain.linearRampToValueAtTime(0,    now + 0.15);
    fNoise.connect(fHPF); fHPF.connect(fGain); fGain.connect(master);
    fNoise.start(now); fNoise.stop(now + 0.2);

    // 'aah' vowel
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(130, now + 0.1);
    osc.frequency.linearRampToValueAtTime(105, now + totalDur);
    const f1 = ctx.createBiquadFilter();
    f1.type = 'bandpass'; f1.frequency.value = 750;  f1.Q.value = 7;
    const f2 = ctx.createBiquadFilter();
    f2.type = 'bandpass'; f2.frequency.value = 1150; f2.Q.value = 5;
    const lpf = ctx.createBiquadFilter();
    lpf.type = 'lowpass';
    lpf.frequency.setValueAtTime(2200, now + 0.1);
    lpf.frequency.linearRampToValueAtTime(700, now + totalDur);
    const vowelGain = ctx.createGain();
    vowelGain.gain.setValueAtTime(0,   now + 0.08);
    vowelGain.gain.linearRampToValueAtTime(0.4, now + 0.28);
    vowelGain.gain.setValueAtTime(0.4, now + totalDur - 0.35);
    vowelGain.gain.linearRampToValueAtTime(0,   now + totalDur);
    osc.connect(f1); osc.connect(f2); osc.connect(lpf);
    f1.connect(vowelGain); f2.connect(vowelGain); lpf.connect(vowelGain);
    vowelGain.connect(master);
    osc.start(now + 0.1); osc.stop(now + totalDur);

    // Breathiness layer
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

    // Close context after sound finishes
    setTimeout(() => ctx.close(), (totalDur + 0.5) * 1000);
  } catch (e) {
    console.warn('FocusTab offscreen: audio fallback failed', e);
  }
}