// ── Radio Arkana · Shared audio module ─────────────────────────────────────
// Generadores de ruido (white/pink/brown), capa binaural (osciladores L/R con
// channel-merger) y factorías de knob UI compartidas entre index.html y
// remoteview.html. Sin dependencias externas. Expone window.ArkanaAudio.
;(function () {
  'use strict';

  // ── NOISE BUFFER FACTORIES ───────────────────────────────────────────────
  function makeWhiteBuffer(ctx) {
    const buf = ctx.createBuffer(1, 2 * ctx.sampleRate, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }
  function makePinkBuffer(ctx) {
    const buf = ctx.createBuffer(1, 2 * ctx.sampleRate, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0=0,b1=0,b2=0,b3=0,b4=0,b5=0,b6=0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886*b0 + w*0.0555179;
      b1 = 0.99332*b1 + w*0.0750759;
      b2 = 0.96900*b2 + w*0.1538520;
      b3 = 0.86650*b3 + w*0.3104856;
      b4 = 0.55000*b4 + w*0.5329522;
      b5 = -0.7616*b5 - w*0.0168980;
      d[i] = (b0+b1+b2+b3+b4+b5+b6 + w*0.5362) * 0.11;
      b6 = w * 0.115926;
    }
    return buf;
  }
  function makeBrownBuffer(ctx) {
    const buf = ctx.createBuffer(1, 2 * ctx.sampleRate, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    }
    return buf;
  }
  function noiseGainForType(type, vol) {
    if (type === 'white') return [vol * 0.015, 0, 0];
    if (type === 'pink')  return [0, vol * 0.025, 0];
    if (type === 'brown') return [0, 0, vol * 0.022];
    return [0, 0, 0];
  }

  // ── BINAURAL MATH ────────────────────────────────────────────────────────
  const BANDS = [
    { name: 'OFF',   color: 'var(--gray)' },
    { name: 'DELTA', color: '#6b8cff' },
    { name: 'THETA', color: '#a855f7' },
    { name: 'ALPHA', color: '#22c55e' },
    { name: 'BETA',  color: '#f59e0b' },
    { name: 'GAMMA', color: '#ef4444' }
  ];
  const OFF_THRESHOLD = 0.08;
  const ANG_MIN = -135, ANG_MAX = 135;

  function posToFreq(pos) {
    if (pos < OFF_THRESHOLD) return 0;
    const t = (pos - OFF_THRESHOLD) / (1 - OFF_THRESHOLD);
    return 0.5 * Math.pow(40 / 0.5, t);
  }
  function freqToBand(hz) {
    if (!hz) return BANDS[0];
    if (hz < 4)  return BANDS[1];
    if (hz < 8)  return BANDS[2];
    if (hz < 12) return BANDS[3];
    if (hz < 30) return BANDS[4];
    return BANDS[5];
  }
  function hzToPos(hz) {
    if (hz <= 0) return 0;
    const t = Math.log(hz / 0.5) / Math.log(40 / 0.5);
    return OFF_THRESHOLD + t * (1 - OFF_THRESHOLD);
  }
  function posToAngle(pos) { return ANG_MIN + pos * (ANG_MAX - ANG_MIN); }

  // ── AUDIO NODE FACTORIES ────────────────────────────────────────────────
  // Devuelven arrays con orden fijo para preservar el patrón posicional
  // existente en index.html (noiseNodes[1/3/5/6/7/8]).
  function createNoiseLayer(audioCtx, destination, initialGains) {
    const [gW, gP, gB] = initialGains || [0, 0, 0];
    const srcW = audioCtx.createBufferSource(); srcW.buffer = makeWhiteBuffer(audioCtx); srcW.loop = true;
    const gainW = audioCtx.createGain(); gainW.gain.value = gW;
    srcW.connect(gainW).connect(destination); srcW.start();
    const srcP = audioCtx.createBufferSource(); srcP.buffer = makePinkBuffer(audioCtx); srcP.loop = true;
    const gainP = audioCtx.createGain(); gainP.gain.value = gP;
    srcP.connect(gainP).connect(destination); srcP.start();
    const srcB = audioCtx.createBufferSource(); srcB.buffer = makeBrownBuffer(audioCtx); srcB.loop = true;
    const gainB = audioCtx.createGain(); gainB.gain.value = gB;
    srcB.connect(gainB).connect(destination); srcB.start();
    return [srcW, gainW, srcP, gainP, srcB, gainB];
  }

  function createBinauralLayer(audioCtx, destination, initialGain) {
    const oscL = audioCtx.createOscillator();
    const oscR = audioCtx.createOscillator();
    const merger = audioCtx.createChannelMerger(2);
    const gain = audioCtx.createGain();
    gain.gain.value = initialGain || 0;
    oscL.frequency.value = 200;
    oscR.frequency.value = 208;
    oscL.connect(merger, 0, 0);
    oscR.connect(merger, 0, 1);
    merger.connect(gain).connect(destination);
    oscL.start(); oscR.start();
    return [oscL, oscR, gain];
  }

  // ── UI KNOB FACTORIES ───────────────────────────────────────────────────
  function attachBinauralKnob(opts) {
    const { wrap, marker, valLabel, icon, dragPx = 100, onChange, beforeChange } = opts;
    let knobPos = 0, dragging = false, startY = 0, startPos = 0;

    function applyPos(pos) {
      if (beforeChange) beforeChange();
      knobPos = Math.min(1, Math.max(0, pos));
      const hz = posToFreq(knobPos);
      const band = freqToBand(hz);
      marker.style.transform = `translateX(-50%) rotate(${posToAngle(knobPos)}deg)`;
      marker.style.background = band.color;
      valLabel.textContent = band.name;
      valLabel.style.color = band.name === 'OFF' ? 'var(--gray)' : band.color;
      if (icon) icon.style.color = band.name === 'OFF' ? 'var(--gray)' : band.color;
      if (onChange) onChange(hz, knobPos, band);
    }
    function setFromHz(hz) { applyPos(hzToPos(hz)); }

    function onDown(e) {
      dragging = true;
      startY = e.touches ? e.touches[0].clientY : e.clientY;
      startPos = knobPos;
      wrap.classList.add('dragging');
      e.preventDefault();
    }
    function onMove(e) {
      if (!dragging) return;
      const y = e.touches ? e.touches[0].clientY : e.clientY;
      applyPos(startPos + (startY - y) / dragPx);
      e.preventDefault();
    }
    function onUp() {
      if (!dragging) return;
      dragging = false;
      wrap.classList.remove('dragging');
    }

    wrap.addEventListener('mousedown', onDown);
    wrap.addEventListener('touchstart', onDown, { passive: false });
    document.addEventListener('mousemove', onMove);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('mouseup', onUp);
    document.addEventListener('touchend', onUp);

    applyPos(0);
    return { applyPos, setFromHz, getKnobPos: () => knobPos };
  }

  function attachNoiseKnob(opts) {
    const { wrap, marker, valLabel, icon, dragPx = 80, onChange, beforeChange } = opts;
    const ZONES = [
      { type: 'off',   label: 'OFF',   color: 'var(--gray)' },
      { type: 'white', label: 'WHITE', color: '#e0dbd0' },
      { type: 'pink',  label: 'PINK',  color: '#e88fa0' },
      { type: 'brown', label: 'BROWN', color: '#a0704a' }
    ];
    function posToZone(pos) { return ZONES[Math.min(3, Math.floor(pos * 4))]; }
    let knobPos = 0, dragging = false, startY = 0, startPos = 0;

    function applyPos(pos) {
      if (beforeChange) beforeChange();
      knobPos = Math.min(0.9999, Math.max(0, pos));
      const zone = posToZone(knobPos);
      marker.style.transform = `translateX(-50%) rotate(${posToAngle(knobPos)}deg)`;
      marker.style.background = zone.color;
      valLabel.textContent = zone.label;
      valLabel.style.color = zone.color;
      if (icon) icon.style.color = zone.color;
      if (onChange) onChange(zone.type, knobPos, zone);
    }

    function onDown(e) {
      dragging = true;
      startY = e.touches ? e.touches[0].clientY : e.clientY;
      startPos = knobPos;
      wrap.classList.add('dragging');
      e.preventDefault();
    }
    function onMove(e) {
      if (!dragging) return;
      const y = e.touches ? e.touches[0].clientY : e.clientY;
      applyPos(startPos + (startY - y) / dragPx);
      e.preventDefault();
    }
    function onUp() {
      if (!dragging) return;
      dragging = false;
      wrap.classList.remove('dragging');
    }

    wrap.addEventListener('mousedown', onDown);
    wrap.addEventListener('touchstart', onDown, { passive: false });
    document.addEventListener('mousemove', onMove);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('mouseup', onUp);
    document.addEventListener('touchend', onUp);

    applyPos(0);
    return { applyPos, getKnobPos: () => knobPos };
  }

  window.ArkanaAudio = {
    makeWhiteBuffer, makePinkBuffer, makeBrownBuffer, noiseGainForType,
    BANDS, OFF_THRESHOLD, ANG_MIN, ANG_MAX,
    posToFreq, freqToBand, hzToPos, posToAngle,
    createNoiseLayer, createBinauralLayer,
    attachBinauralKnob, attachNoiseKnob
  };
})();
