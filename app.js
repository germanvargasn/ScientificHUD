(() => {
  'use strict';

  const W = 600;
  const H = 600;
  const CX = W / 2;
  const CY = H / 2;

  const SETTINGS_KEY = 'scientificHud.v12.settings';
  const RECORDING_BACKUP_KEY = 'scientificHud.v12.lastRecording';

  const cfg = {
    // Easy-to-adjust HUD geometry
    crosshairLength: 50,        // px; screen-aligned center line
    pitchLineLength: 120,       // px; total length including center gap
    pitchStepDeg: 10,
    maxPitchLabelDeg: 90,
    pitchPixelsPerDeg: 7.5,        // base px/deg for sky-dome projection
    pitchVisualScale: 1.35,       // stretches pitch ladder line spacing visually
    pitchMotionScale: 1.75,       // moves the sky-dome faster so measured pitch aligns visually after spacing stretch
    horizonLengthPct: [0.10, 0.90],

    // Smooth color transition: 0=green, 30=yellow, 60+=red
    colorYellowDeg: 30,
    colorRedDeg: 60,

    // Horizon / attitude tuning
    visualRollSign: 1,
    visualPitchSign: -1,
    rollSmoothing: 0.12,
    pitchSmoothing: 0.12,
    rollDeadbandForNumber: 5,

    headingLabelY: 38,
    compassRadiusPx: 210,

    // Local recording
    recordingIntervalMs: 100,

    // CSV upload fallback. The app attempts local sharing first; if local
    // sharing is not available or fails, it can send the CSV to this endpoint.
    uploadEnabled: true,
    uploadEndpoint: 'https://script.google.com/macros/s/AKfycbwKGzakLKeFzxxRHkTegUSkdt1mGwFhAzSaqOaxH-em2_tBTTlFDmDYYtxm9gWv9XjGqA/exec',
    uploadSecret: 'CHANGE_THIS_TO_A_RANDOM_PASSWORD'
  };

  const defaultSettings = {
    showAccelX: true,
    showAccelY: true,
    showAccelZ: true,
    showAccelerations: true,
    showCompass: true,
    showRoll: true,
    showRollDegrees: true,
    showPitch: true,
    showPitchDegrees: true,
    showHudControls: true
  };

  let settings = loadSettings();
  let screen = 'copyright';
  let priorScreen = 'menu';
  let sensorsEnabled = false;
  let simulationMode = true;

  const state = {
    heading: 0, // alpha
    beta: 0,   // tilt / pitch
    gamma: 0,  // roll fallback
    rawAx: 0,
    rawAy: 0,
    rawAz: 0,
    gravityX: null,
    gravityY: null,
    gravityZ: null,
    accelX: 0,
    accelY: 0,
    accelZ: 0,
    zeroBeta: 0,
    zeroGamma: 0,
    zeroGravityRoll: 0,
    zeroGravityPitch: 0,
    smoothRoll: 0,
    smoothPitch: 0,
    smoothingInitialized: false,
    menuIndex: 0,
    settingsIndex: 0,
    settingsPage: 0,
    hudControlIndex: 0,
    usingGravityRoll: false,
    exportIndex: 0,
    recording: false,
    silentMode: false,
    sessionCode: '',
    recordRows: [],
    recordingStartedAt: null,
    recordingStoppedAt: null,
    recordingTimer: null,
    samplesSinceBackup: 0,
    lastCsvText: '',
    lastCsvBlob: null,
    lastCsvFileName: ''
  };

  const SETTINGS_ROWS_PER_PAGE = 6;

  const settingItems = [
    ['showAccelerations', 'Show accelerations'],
    ['showAccelX', 'Acceleration X'],
    ['showAccelY', 'Acceleration Y'],
    ['showAccelZ', 'Acceleration Z'],
    ['showRoll', 'Show roll'],
    ['showRollDegrees', 'Show roll degrees'],
    ['showPitch', 'Show tilt ladder'],
    ['showPitchDegrees', 'Show tilt degrees'],
    ['showCompass', 'Show compass'],
    ['showHudControls', 'Show HUD controls']
  ];

  const canvas = document.getElementById('hudCanvas');
  const ctx = canvas.getContext('2d');

  const screens = {
    copyright: document.getElementById('copyrightScreen'),
    permission: document.getElementById('permissionScreen'),
    menu: document.getElementById('mainMenu'),
    settings: document.getElementById('settingsScreen'),
    exit: document.getElementById('exitScreen'),
    export: document.getElementById('exportScreen')
  };

  const hudOverlay = document.getElementById('hudOverlay');
  const accelBox = document.getElementById('accelBox');
  const axEl = document.getElementById('ax');
  const ayEl = document.getElementById('ay');
  const azEl = document.getElementById('az');
  const recordingDot = document.getElementById('recordingDot');
  const hudRecordBtn = document.getElementById('hudRecord');
  const exportSessionEl = document.getElementById('exportSession');
  const exportSummaryEl = document.getElementById('exportSummary');
  const exportMessageEl = document.getElementById('exportMessage');
  const settingsList = document.getElementById('settingsList');

  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      return raw ? { ...defaultSettings, ...JSON.parse(raw) } : { ...defaultSettings };
    } catch {
      return { ...defaultSettings };
    }
  }

  function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    applyVisibilitySettings();
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function degToRad(d) { return d * Math.PI / 180; }
  function radToDeg(r) { return r * 180 / Math.PI; }
  function wrap180(deg) {
    let d = ((deg + 180) % 360 + 360) % 360 - 180;
    return d;
  }
  function normalize360(deg) { return ((deg % 360) + 360) % 360; }
  function lerp(a, b, t) { return a + (b - a) * t; }

  function colorForMagnitude(deg, yellowDeg = cfg.colorYellowDeg, redDeg = cfg.colorRedDeg) {
    const x = Math.abs(deg);
    let r, g, b = 0;
    if (x <= yellowDeg) {
      const t = clamp(x / yellowDeg, 0, 1);
      r = Math.round(lerp(0, 255, t));
      g = 255;
    } else {
      const t = clamp((x - yellowDeg) / (redDeg - yellowDeg), 0, 1);
      r = 255;
      g = Math.round(lerp(255, 0, t));
    }
    return `rgb(${r},${g},${b})`;
  }

  function showScreen(next) {
    screen = next;
    Object.entries(screens).forEach(([name, el]) => el.classList.toggle('active', name === next));
    hudOverlay.classList.toggle('hidden', next !== 'hud');
    canvas.style.display = next === 'hud' ? 'block' : 'none';
    document.body.classList.toggle('silent-mode', next === 'hud' && state.silentMode);
    if (next !== 'hud') clearCanvas();
    if (next === 'settings') renderSettings();
    if (next === 'hud') applyVisibilitySettings();
    if (next === 'menu') updateMenuSelection();
    if (next === 'export') updateExportSelection();
    updateRecordingUi();
  }

  function clearCanvas() { ctx.clearRect(0, 0, W, H); }

  function applyVisibilitySettings() {
    accelBox.style.display = (settings.showAccelerations && (settings.showAccelX || settings.showAccelY || settings.showAccelZ)) ? 'block' : 'none';
    axEl.style.display = settings.showAccelX ? 'block' : 'none';
    ayEl.style.display = settings.showAccelY ? 'block' : 'none';
    azEl.style.display = settings.showAccelZ ? 'block' : 'none';
    document.body.classList.toggle('show-controls', !!settings.showHudControls);
    document.body.classList.toggle('silent-mode', screen === 'hud' && state.silentMode);
    updateRecordingUi();
  }

  function updateMenuSelection() {
    document.querySelectorAll('#mainMenu .menu-button').forEach((btn, i) => {
      btn.classList.toggle('selected', i === state.menuIndex);
    });
  }

  function hudButtons() {
    return Array.from(document.querySelectorAll('.hud-button'));
  }

  function updateHudControlSelection() {
    const buttons = hudButtons();
    state.hudControlIndex = clamp(state.hudControlIndex, 0, buttons.length - 1);
    buttons.forEach((b, i) => b.classList.toggle('selected', i === state.hudControlIndex));
  }

  function updateExportSelection() {
    document.querySelectorAll('#exportScreen .menu-button').forEach((btn, i) => {
      btn.classList.toggle('selected', i === state.exportIndex);
    });
  }

  function updateRecordingUi() {
    if (recordingDot) recordingDot.classList.toggle('hidden', !state.recording);
    if (hudRecordBtn) hudRecordBtn.textContent = state.recording ? 'Stop Recording' : 'Start Recording';
    updateHudControlSelection();
  }

  function totalSettingsRows() {
    return settingItems.length + 1; // + Return row
  }

  function totalSettingsPages() {
    return Math.ceil(totalSettingsRows() / SETTINGS_ROWS_PER_PAGE);
  }

  function visibleSettingsRows() {
    const rows = settingItems.map(([key, label], index) => ({ type: 'setting', key, label, index }));
    rows.push({ type: 'back', label: priorScreen === 'hud' ? 'Return to HUD' : 'Return to Menu', index: settingItems.length });
    const start = state.settingsPage * SETTINGS_ROWS_PER_PAGE;
    return rows.slice(start, start + SETTINGS_ROWS_PER_PAGE);
  }

  function clampSettingsIndexToPage() {
    const pageCount = totalSettingsPages();
    state.settingsPage = clamp(state.settingsPage, 0, pageCount - 1);
    const visible = visibleSettingsRows();
    if (!visible.some(row => row.index === state.settingsIndex)) {
      state.settingsIndex = visible[0]?.index ?? 0;
    }
  }

  function renderSettings() {
    clampSettingsIndexToPage();
    settingsList.innerHTML = '';
    const visible = visibleSettingsRows();
    visible.forEach((item) => {
      const row = document.createElement('button');
      row.className = 'setting-row' + (item.index === state.settingsIndex ? ' selected' : '');
      if (item.type === 'setting') {
        row.dataset.settingKey = item.key;
        row.innerHTML = `<span class="setting-check">${settings[item.key] ? '✓' : ''}</span><span>${item.label}</span>`;
      } else {
        row.classList.add('setting-back-row');
        row.innerHTML = `<span class="setting-check">↩</span><span>${item.label}</span>`;
      }
      row.addEventListener('click', () => {
        state.settingsIndex = item.index;
        toggleSetting(item.index);
      });
      settingsList.appendChild(row);
    });

    const pageIndicator = document.getElementById('settingsPageIndicator');
    if (pageIndicator) pageIndicator.textContent = `Page ${state.settingsPage + 1} of ${totalSettingsPages()}`;
  }

  function toggleSetting(index) {
    if (index >= settingItems.length) {
      showScreen(priorScreen === 'hud' ? 'hud' : 'menu');
      return;
    }
    const key = settingItems[index][0];
    settings[key] = !settings[key];
    saveSettings();
    renderSettings();
  }

  async function requestSensors() {
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        const response = await DeviceOrientationEvent.requestPermission();
        if (response !== 'granted') throw new Error('Orientation permission denied');
      }
      if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
        const response = await DeviceMotionEvent.requestPermission();
        if (response !== 'granted') throw new Error('Motion permission denied');
      }
      window.addEventListener('deviceorientation', handleOrientation, true);
      window.addEventListener('devicemotion', handleMotion, true);
      sensorsEnabled = true;
      simulationMode = false;
      showScreen('menu');
    } catch (err) {
      console.warn('Sensor permission not available or denied. Using simulation mode.', err);
      sensorsEnabled = false;
      simulationMode = true;
      showScreen('menu');
    }
  }

  function handleOrientation(e) {
    // Meta web app documentation describes alpha = heading, beta = tilt, gamma = roll.
    if (typeof e.alpha === 'number') state.heading = normalize360(e.alpha);
    if (typeof e.beta === 'number') state.beta = e.beta;
    if (typeof e.gamma === 'number') state.gamma = e.gamma;
  }

  function handleMotion(e) {
    const a = e.acceleration || {};
    const ag = e.accelerationIncludingGravity || {};

    const gx = typeof ag.x === 'number' ? ag.x : null;
    const gy = typeof ag.y === 'number' ? ag.y : null;
    const gz = typeof ag.z === 'number' ? ag.z : null;
    state.gravityX = gx;
    state.gravityY = gy;
    state.gravityZ = gz;

    const axRaw = typeof a.x === 'number' ? a.x : (gx ?? 0);
    const ayRaw = typeof a.y === 'number' ? a.y : ((gy ?? 9.81) - 9.81);
    const azRaw = typeof a.z === 'number' ? a.z : (gz ?? 0);

    state.rawAx = axRaw;
    state.rawAy = ayRaw;
    state.rawAz = azRaw;

    // User requested reversed X and gravity compensation so AY rests near zero.
    state.accelX = -axRaw;
    state.accelY = ayRaw;
    state.accelZ = azRaw;

    if (typeof a.y !== 'number' && typeof gy === 'number') state.accelY = gy - 9.81;
  }

  function gravityRollDeg() {
    if (typeof state.gravityX === 'number' && typeof state.gravityY === 'number') {
      state.usingGravityRoll = true;
      return radToDeg(Math.atan2(state.gravityX, state.gravityY));
    }
    state.usingGravityRoll = false;
    return state.gamma;
  }

  function gravityPitchDeg() {
    if (typeof state.gravityX === 'number' && typeof state.gravityY === 'number' && typeof state.gravityZ === 'number') {
      // Roll-independent pitch estimate from the gravity vector. The horizontal magnitude
      // sqrt(x^2+y^2) removes the cross-coupling that beta showed during head roll.
      const horizontalG = Math.hypot(state.gravityX, state.gravityY);
      return radToDeg(Math.atan2(state.gravityZ, horizontalG));
    }
    return state.beta;
  }

  function currentPitch() {
    const raw = gravityPitchDeg();
    return wrap180((raw - state.zeroGravityPitch) * cfg.visualPitchSign);
  }

  function currentVisualRoll() {
    const raw = gravityRollDeg();
    return wrap180((raw - state.zeroGravityRoll) * cfg.visualRollSign);
  }

  function currentFallbackRoll() {
    return wrap180((state.gamma - state.zeroGamma) * cfg.visualRollSign);
  }

  function recenter() {
    state.zeroBeta = state.beta;
    state.zeroGamma = state.gamma;
    state.zeroGravityRoll = gravityRollDeg();
    state.zeroGravityPitch = gravityPitchDeg();
    state.smoothRoll = 0;
    state.smoothPitch = 0;
    state.smoothingInitialized = true;
    // Do not reset heading. North remains north.
  }

  function drawLine(cx, cy, len, angleDeg, color, width) {
    const a = degToRad(angleDeg);
    const dx = Math.cos(a) * len / 2;
    const dy = Math.sin(a) * len / 2;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - dx, cy - dy);
    ctx.lineTo(cx + dx, cy + dy);
    ctx.stroke();
    ctx.restore();
  }


  function drawGappedLine(cx, cy, totalLen, gapLen, angleDeg, color, width) {
    const sideLen = Math.max(0, (totalLen - gapLen) / 2);
    if (sideLen <= 0) return;
    const a = degToRad(angleDeg);
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const leftOuter = -totalLen / 2;
    const leftInner = -gapLen / 2;
    const rightInner = gapLen / 2;
    const rightOuter = totalLen / 2;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx + ux * leftOuter, cy + uy * leftOuter);
    ctx.lineTo(cx + ux * leftInner, cy + uy * leftInner);
    ctx.moveTo(cx + ux * rightInner, cy + uy * rightInner);
    ctx.lineTo(cx + ux * rightOuter, cy + uy * rightOuter);
    ctx.stroke();
    ctx.restore();
  }

  function drawCompass(heading) {
    if (!settings.showCompass) return;
    const labels = [
      ['N', 0], ['NE', 45], ['E', 90], ['SE', 135], ['S', 180], ['SW', 225], ['W', 270], ['NW', 315]
    ];
    ctx.save();
    ctx.font = 'bold 26px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = '#000';
    ctx.shadowBlur = 4;

    labels.forEach(([label, bearing]) => {
      const delta = wrap180(bearing - heading);
      const x = CX + (delta / 90) * cfg.compassRadiusPx;
      if (x < -40 || x > W + 40) return;
      const opacity = clamp(1 - Math.abs(delta) / 130, 0.25, 1);
      ctx.globalAlpha = opacity;
      ctx.fillStyle = label === 'N' ? 'rgb(255,255,255)' : 'rgba(255,255,255,0.82)';
      ctx.fillText(label, x, cfg.headingLabelY);
      ctx.beginPath();
      ctx.moveTo(x, cfg.headingLabelY + 18);
      ctx.lineTo(x, cfg.headingLabelY + 30);
      ctx.lineWidth = label.length === 1 ? 3 : 2;
      ctx.strokeStyle = ctx.fillStyle;
      ctx.stroke();
    });

    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(0,220,255,0.95)';
    ctx.font = 'bold 18px system-ui, sans-serif';
    ctx.fillText(`${Math.round(normalize360(heading))}°`, CX, 72);
    ctx.restore();
  }

  function drawPitchLadder(pitch, roll) {
    if (!settings.showPitch) return;
    ctx.save();
    ctx.font = 'bold 20px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.lineCap = 'round';
    ctx.shadowColor = '#000';
    ctx.shadowBlur = 4;

    const horizonLen = W * (cfg.horizonLengthPct[1] - cfg.horizonLengthPct[0]);
    const pitchLineLen = cfg.pitchLineLength;
    const gapLen = cfg.crosshairLength;
    const normalAngle = roll - 90; // positive pitch appears above the horizon when roll is zero
    const na = degToRad(normalAngle);
    const nx = Math.cos(na);
    const ny = Math.sin(na);

    for (let deg = -cfg.maxPitchLabelDeg; deg <= cfg.maxPitchLabelDeg; deg += cfg.pitchStepDeg) {
      // Sky-dome projection: line spacing and sky-dome motion are independently
      // tunable. This does not change the measured pitch value; it only controls
      // where fixed-angle pitch lines are drawn on the small display.
      const offset = (deg * cfg.pitchVisualScale - pitch * cfg.pitchMotionScale) * cfg.pitchPixelsPerDeg;
      const x = CX + nx * offset;
      const y = CY + ny * offset;
      if (x < -120 || x > W + 120 || y < 80 || y > H - 60) continue;

      const color = colorForMagnitude(deg);
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      const label = deg === 0 ? '0' : `${deg > 0 ? '+' : ''}${deg}`;

      if (deg === 0) {
        // Sky-dome horizon: long, thick, and gapped by CrosshairLength so the
        // screen-fixed crosshair completes it at neutral roll/pitch.
        drawGappedLine(x, y, horizonLen, gapLen, roll, 'rgba(255,255,255,0.96)', 6);
      } else {
        drawGappedLine(x, y, pitchLineLen, gapLen, roll, color, 2);
      }

      if (settings.showPitchDegrees) {
        const a = degToRad(roll);
        const ux = Math.cos(a);
        const uy = Math.sin(a);
        const labelGap = 14;
        const halfLen = (deg === 0 ? horizonLen : pitchLineLen) / 2;
        const lx = x - ux * (halfLen + labelGap);
        const ly = y - uy * (halfLen + labelGap);
        const rx = x + ux * (halfLen + labelGap);
        const ry = y + uy * (halfLen + labelGap);
        ctx.textAlign = 'center';
        ctx.fillText(label, lx, ly);
        ctx.fillText(label, rx, ry);
      }
    }
    ctx.restore();
  }

  function drawRollCrosshair(roll) {
    if (!settings.showRoll) return;
    const color = colorForMagnitude(roll);

    // Screen-aligned crosshair: stays centered and horizontal on the display.
    drawLine(CX, CY, cfg.crosshairLength, 0, color, 3);

    if (settings.showRollDegrees && Math.abs(roll) >= cfg.rollDeadbandForNumber) {
      drawRollDegreeLabels(roll, color);
    }
  }

  function drawRollDegreeLabels(roll, color) {
    const label = `${Math.round(Math.abs(roll))}°`;
    const leftX = CX - cfg.crosshairLength / 2 - 28;
    const rightX = CX + cfg.crosshairLength / 2 + 28;
    const y = CY;
    const offset = 24;

    // Flipped from v6: place the numbers between the sky-dome horizon and
    // the screen-fixed crosshair for the real-device sign convention.
    const leftAbove = roll > 0;
    const rightAbove = roll < 0;

    ctx.save();
    ctx.font = 'bold 24px system-ui, sans-serif';
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = '#000';
    ctx.shadowBlur = 4;
    ctx.fillText(label, leftX, y + (leftAbove ? -offset : offset));
    ctx.fillText(label, rightX, y + (rightAbove ? -offset : offset));
    ctx.restore();
  }

  function updateAccelReadout() {
    axEl.textContent = `A-X: ${state.accelX.toFixed(1)}`;
    ayEl.textContent = `A-Y: ${state.accelY.toFixed(1)}`;
    azEl.textContent = `A-Z: ${state.accelZ.toFixed(1)}`;
  }


  function generateSessionCode() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = 'SCI-';
    const cryptoObj = window.crypto || window.msCrypto;
    if (cryptoObj?.getRandomValues) {
      const arr = new Uint8Array(4);
      cryptoObj.getRandomValues(arr);
      arr.forEach(v => { code += alphabet[v % alphabet.length]; });
    } else {
      for (let i = 0; i < 4; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return code;
  }

  function pad2(n) { return String(n).padStart(2, '0'); }

  function timestampParts(date = new Date()) {
    const yyyy = date.getFullYear();
    const mm = pad2(date.getMonth() + 1);
    const dd = pad2(date.getDate());
    const hh = pad2(date.getHours());
    const mi = pad2(date.getMinutes());
    const ss = pad2(date.getSeconds());
    const tenth = Math.floor(date.getMilliseconds() / 100);
    return { date: `${yyyy}-${mm}-${dd}`, time: `${hh}:${mi}:${ss}.${tenth}` };
  }

  function safeFixed(value, digits = 3) {
    const n = Number(value);
    return Number.isFinite(n) ? n.toFixed(digits) : '';
  }

  function adjustedTelemetrySnapshot() {
    // Record the same adjusted/calibrated values being used in the HUD.
    const pitch = state.smoothingInitialized ? state.smoothPitch : currentPitch();
    const roll = state.smoothingInitialized ? state.smoothRoll : currentVisualRoll();
    return {
      ax: state.accelX,
      ay: state.accelY,
      az: state.accelZ,
      pitch,
      roll,
      heading: normalize360(state.heading)
    };
  }

  function recordSample() {
    if (!state.recording) return;
    const now = new Date();
    const ts = timestampParts(now);
    const t = adjustedTelemetrySnapshot();
    state.recordRows.push({
      date: ts.date,
      time: ts.time,
      ax: Number(t.ax),
      ay: Number(t.ay),
      az: Number(t.az),
      pitch: Number(t.pitch),
      roll: Number(t.roll),
      heading: Number(t.heading)
    });
    state.samplesSinceBackup += 1;
    if (state.samplesSinceBackup >= 10) {
      backupRecording();
      state.samplesSinceBackup = 0;
    }
  }

  function backupRecording() {
    if (!state.recording && !state.recordRows.length) return;
    try {
      localStorage.setItem(RECORDING_BACKUP_KEY, JSON.stringify({
        sessionCode: state.sessionCode,
        startedAt: state.recordingStartedAt?.toISOString?.() || null,
        stoppedAt: state.recordingStoppedAt?.toISOString?.() || null,
        rows: state.recordRows
      }));
    } catch (err) {
      console.warn('Recording backup skipped:', err);
    }
  }

  function startRecording() {
    if (state.recording) return;
    state.sessionCode = generateSessionCode();
    state.recordRows = [];
    state.recordingStartedAt = new Date();
    state.recordingStoppedAt = null;
    state.samplesSinceBackup = 0;
    state.lastCsvText = '';
    state.lastCsvBlob = null;
    state.lastCsvFileName = '';
    state.recording = true;
    try { localStorage.removeItem(RECORDING_BACKUP_KEY); } catch {}
    recordSample();
    state.recordingTimer = window.setInterval(recordSample, cfg.recordingIntervalMs);
    updateRecordingUi();
  }

  function stopRecording() {
    if (!state.recording) return;
    state.recording = false;
    state.silentMode = false;
    if (state.recordingTimer) {
      window.clearInterval(state.recordingTimer);
      state.recordingTimer = null;
    }
    state.recordingStoppedAt = new Date();
    backupRecording();
    prepareCsvExport();
    updateRecordingUi();
    showExportScreen();
  }

  function toggleRecording() {
    if (state.recording) stopRecording();
    else startRecording();
  }

  function enterSilentMode() {
    if (!state.recording) startRecording();
    state.silentMode = true;
    clearCanvas();
    applyVisibilitySettings();
  }

  function exitSilentMode() {
    state.silentMode = false;
    applyVisibilitySettings();
  }

  function csvEscape(value) {
    const s = String(value ?? '');
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function buildCsvText() {
    const header = ['date', 'time', 'ax', 'ay', 'az', 'pitch', 'roll', 'heading'];
    const lines = [header.join(',')];
    state.recordRows.forEach(row => {
      lines.push([
        row.date,
        row.time,
        safeFixed(row.ax, 3),
        safeFixed(row.ay, 3),
        safeFixed(row.az, 3),
        safeFixed(row.pitch, 3),
        safeFixed(row.roll, 3),
        safeFixed(row.heading, 3)
      ].map(csvEscape).join(','));
    });
    return lines.join('\n');
  }

  function prepareCsvExport() {
    state.lastCsvText = buildCsvText();
    state.lastCsvBlob = new Blob([state.lastCsvText], { type: 'text/csv;charset=utf-8' });
    const start = state.recordingStartedAt || new Date();
    const stamp = timestampParts(start);
    const compactTime = stamp.time.replace(/[:.]/g, '');
    state.lastCsvFileName = `scientific-hud_${state.sessionCode}_${stamp.date}_${compactTime}.csv`;
  }

  function showExportScreen() {
    const start = state.recordingStartedAt;
    const stop = state.recordingStoppedAt || new Date();
    const durationSec = start ? Math.max(0, (stop - start) / 1000) : 0;
    exportSessionEl.textContent = `Session: ${state.sessionCode || '--'}`;
    exportSummaryEl.innerHTML = `Samples: ${state.recordRows.length}<br/>Duration: ${durationSec.toFixed(1)} sec`;
    exportMessageEl.textContent = '';
    state.exportIndex = 0;
    showScreen('export');
  }

  async function shareCsv() {
    if (!state.lastCsvBlob) prepareCsvExport();
    const file = new File([state.lastCsvBlob], state.lastCsvFileName || 'scientific-hud.csv', { type: 'text/csv' });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
        await navigator.share({
          title: `Scientific HUD ${state.sessionCode}`,
          text: `Scientific HUD recording session ${state.sessionCode}`,
          files: [file]
        });
        exportMessageEl.textContent = 'CSV shared locally.';
      } else {
        exportMessageEl.textContent = 'Local share unavailable. Uploading...';
        await uploadCsv('Share unavailable');
      }
    } catch (err) {
      if (err?.name === 'AbortError') {
        exportMessageEl.textContent = 'Share cancelled. CSV not uploaded.';
      } else {
        exportMessageEl.textContent = 'Local share failed. Uploading...';
        await uploadCsv(`Share failed: ${err?.message || err}`);
      }
    }
  }

  function downloadCsv() {
    if (!state.lastCsvBlob) prepareCsvExport();
    const url = URL.createObjectURL(state.lastCsvBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = state.lastCsvFileName || 'scientific-hud.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    exportMessageEl.textContent = 'CSV download requested. If no file appears, choose Upload CSV.';
  }

  async function uploadCsv(reason = 'Manual upload') {
    if (!cfg.uploadEnabled || !cfg.uploadEndpoint) {
      exportMessageEl.textContent = 'Upload endpoint is not configured.';
      return;
    }
    if (!state.lastCsvText) prepareCsvExport();

    const payload = {
      secret: cfg.uploadSecret,
      sessionCode: state.sessionCode || generateSessionCode(),
      fileName: state.lastCsvFileName || 'scientific-hud.csv',
      reason,
      csv: state.lastCsvText
    };

    try {
      // no-cors keeps this compatible with simple Apps Script web apps from a
      // static GitHub Pages origin. The tradeoff is that the response is opaque,
      // so success cannot be confirmed from the HUD runtime.
      await fetch(cfg.uploadEndpoint, {
        method: 'POST',
        mode: 'no-cors',
        headers: {
          'Content-Type': 'text/plain;charset=utf-8'
        },
        body: JSON.stringify(payload)
      });
      exportMessageEl.textContent = `Upload sent. Session: ${payload.sessionCode}`;
    } catch (err) {
      exportMessageEl.textContent = 'Upload failed. Try again later.';
      console.warn('CSV upload failed:', err);
    }
  }

  function smoothAngle(previous, measured, alpha) {
    const delta = wrap180(measured - previous);
    return wrap180(previous + alpha * delta);
  }

  function renderHud() {
    clearCanvas();
    if (state.silentMode) {
      updateRecordingUi();
      return;
    }
    const measuredPitch = currentPitch();
    const measuredRoll = currentVisualRoll();
    if (!state.smoothingInitialized) {
      state.smoothPitch = measuredPitch;
      state.smoothRoll = measuredRoll;
      state.smoothingInitialized = true;
    } else {
      state.smoothPitch = smoothAngle(state.smoothPitch, measuredPitch, cfg.pitchSmoothing);
      state.smoothRoll = smoothAngle(state.smoothRoll, measuredRoll, cfg.rollSmoothing);
    }
    const pitch = state.smoothPitch;
    const roll = state.smoothRoll;
    drawCompass(state.heading);
    drawPitchLadder(pitch, roll);
    drawRollCrosshair(roll);
    updateAccelReadout();
  }

  function loop() {
    if (screen === 'hud') renderHud();
    requestAnimationFrame(loop);
  }

  function moveSelection(delta) {
    if (screen === 'menu') {
      state.menuIndex = clamp(state.menuIndex + delta, 0, 2);
      updateMenuSelection();
    } else if (screen === 'settings') {
      const nextIndex = state.settingsIndex + delta;
      if (nextIndex < 0) {
        if (state.settingsPage > 0) {
          state.settingsPage -= 1;
          const visible = visibleSettingsRows();
          state.settingsIndex = visible[visible.length - 1].index;
        } else {
          state.settingsIndex = 0;
        }
      } else if (nextIndex >= totalSettingsRows()) {
        state.settingsIndex = totalSettingsRows() - 1;
      } else {
        state.settingsIndex = nextIndex;
        const pageForIndex = Math.floor(state.settingsIndex / SETTINGS_ROWS_PER_PAGE);
        state.settingsPage = clamp(pageForIndex, 0, totalSettingsPages() - 1);
      }
      renderSettings();
    } else if (screen === 'hud' && settings.showHudControls && !state.silentMode) {
      const count = hudButtons().length;
      state.hudControlIndex = clamp(state.hudControlIndex + delta, 0, count - 1);
      updateHudControlSelection();
    } else if (screen === 'export') {
      state.exportIndex = clamp(state.exportIndex + delta, 0, 3);
      updateExportSelection();
    }
  }

  function activateCurrent() {
    if (screen === 'copyright') {
      showScreen('permission');
    } else if (screen === 'permission') {
      requestSensors();
    } else if (screen === 'menu') {
      if (state.menuIndex === 0) showScreen('hud');
      if (state.menuIndex === 1) { priorScreen = 'menu'; state.settingsPage = 0; state.settingsIndex = 0; showScreen('settings'); }
      if (state.menuIndex === 2) attemptExitApp();
    } else if (screen === 'settings') {
      toggleSetting(state.settingsIndex);
    } else if (screen === 'hud') {
      if (state.silentMode) {
        exitSilentMode();
      } else if (!settings.showHudControls) {
        recenter();
      } else if (state.hudControlIndex === 0) {
        recenter();
      } else if (state.hudControlIndex === 1) {
        priorScreen = 'hud';
        state.settingsPage = 0;
        state.settingsIndex = 0;
        showScreen('settings');
      } else if (state.hudControlIndex === 2) {
        showScreen('menu');
      } else if (state.hudControlIndex === 3) {
        toggleRecording();
      } else if (state.hudControlIndex === 4) {
        enterSilentMode();
      }
    } else if (screen === 'export') {
      if (state.exportIndex === 0) shareCsv();
      else if (state.exportIndex === 1) downloadCsv();
      else if (state.exportIndex === 2) uploadCsv('Manual upload');
      else if (state.exportIndex === 3) showScreen('hud');
    } else if (screen === 'exit') {
      attemptExitApp();
    }
  }

  function goBack() {
    if (screen === 'settings') showScreen(priorScreen === 'hud' ? 'hud' : 'menu');
    else if (screen === 'hud') {
      if (state.silentMode) return;
      showScreen('menu');
    }
    else if (screen === 'export') showScreen('hud');
    else if (screen === 'exit') showScreen('menu');
  }

  function simulateKey(e) {
    const stepAngle = e.shiftKey ? 5 : 1;
    const stepAccel = e.shiftKey ? 1 : 0.2;
    switch (e.key.toLowerCase()) {
      case 'arrowleft': state.gamma -= stepAngle; break;
      case 'arrowright': state.gamma += stepAngle; break;
      case 'i': state.beta += stepAngle; break;
      case 'k': state.beta -= stepAngle; break;
      case 'w': state.accelX += stepAccel; break;
      case 's': state.accelX -= stepAccel; break;
      case 'a': state.accelY -= stepAccel; break;
      case 'd': state.accelY += stepAccel; break;
      case 'q': state.accelZ -= stepAccel; break;
      case 'e': state.accelZ += stepAccel; break;
      case 'h': state.heading = normalize360(state.heading - 5); break;
      case 'j': state.heading = normalize360(state.heading + 5); break;
      default: return false;
    }
    // In simulation, use gamma fallback by clearing gravity vector.
    state.gravityX = null;
    state.gravityY = null;
    state.gravityZ = null;
    return true;
  }


  function attemptExitApp() {
    // In browser contexts, scripts can only close windows they opened. Meta web-app shells may honor
    // window.close(); if not, fall back to navigating away rather than showing an in-app paused screen.
    try { window.close(); } catch {}
    setTimeout(() => {
      try {
        if (history.length > 1) history.back();
        else window.location.replace('about:blank');
      } catch {
        window.location.href = 'about:blank';
      }
    }, 80);
  }

  document.addEventListener('keydown', (e) => {
    if (['ArrowUp', 'ArrowDown'].includes(e.key) && (screen !== 'hud' || settings.showHudControls)) {
      e.preventDefault();
      moveSelection(e.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      activateCurrent();
      return;
    }
    if (e.key === 'Escape' || e.key === 'Backspace') {
      e.preventDefault();
      goBack();
      return;
    }
    if (screen === 'hud') simulateKey(e);
  });

  document.getElementById('copyrightOk').addEventListener('click', activateCurrent);
  document.getElementById('enableSensors').addEventListener('click', requestSensors);
  document.getElementById('startHud').addEventListener('click', () => { state.menuIndex = 0; activateCurrent(); });
  document.getElementById('openSettings').addEventListener('click', () => { state.menuIndex = 1; activateCurrent(); });
  document.getElementById('exitApp').addEventListener('click', () => { state.menuIndex = 2; activateCurrent(); });
  document.getElementById('settingsBack')?.addEventListener('click', () => showScreen(priorScreen === 'hud' ? 'hud' : 'menu'));
  document.getElementById('exitReturn')?.addEventListener('click', () => showScreen('menu'));
  document.getElementById('hudRecenter').addEventListener('click', recenter);
  document.getElementById('hudSettings').addEventListener('click', () => { priorScreen = 'hud'; state.settingsPage = 0; state.settingsIndex = 0; showScreen('settings'); });
  document.getElementById('hudMainMenu').addEventListener('click', () => showScreen('menu'));
  document.getElementById('hudRecord').addEventListener('click', toggleRecording);
  document.getElementById('hudSilent').addEventListener('click', enterSilentMode);
  document.getElementById('shareCsv').addEventListener('click', () => { state.exportIndex = 0; shareCsv(); updateExportSelection(); });
  document.getElementById('downloadCsv').addEventListener('click', () => { state.exportIndex = 1; downloadCsv(); updateExportSelection(); });
  document.getElementById('uploadCsv').addEventListener('click', () => { state.exportIndex = 2; uploadCsv('Manual upload'); updateExportSelection(); });
  document.getElementById('returnHud').addEventListener('click', () => { state.exportIndex = 3; showScreen('hud'); });

  showScreen(screen);
  applyVisibilitySettings();
  loop();
})();
