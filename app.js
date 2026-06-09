(() => {
  'use strict';

  const W = 600;
  const H = 600;
  const CX = W / 2;
  const CY = H / 2;

  const SETTINGS_KEY = 'scientificHud.v5.settings';
  const ACCEPT_KEY = 'scientificHud.v5.acceptedCopyright';

  const cfg = {
    rollYellowDeg: 20,
    rollRedDeg: 40,
    pitchYellowDeg: 20,
    pitchRedDeg: 40,
    pitchStepDeg: 10,
    maxPitchLabelDeg: 40,
    pitchPixelsPerDeg: 7.5,
    horizonLengthPct: [0.10, 0.90],
    rollRefLengthPct: [0.20, 0.80],
    pitchLineLengthPct: [0.40, 0.60],
    visualRollSign: 1,
    rollDeadbandForNumber: 5,
    headingLabelY: 38,
    compassRadiusPx: 210
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
    showHudControls: false
  };

  let settings = loadSettings();
  let screen = localStorage.getItem(ACCEPT_KEY) === 'true' ? 'permission' : 'copyright';
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
    menuIndex: 0,
    settingsIndex: 0,
    hudControlIndex: 0,
    usingGravityRoll: false
  };

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
    exit: document.getElementById('exitScreen')
  };

  const hudOverlay = document.getElementById('hudOverlay');
  const accelBox = document.getElementById('accelBox');
  const axEl = document.getElementById('ax');
  const ayEl = document.getElementById('ay');
  const azEl = document.getElementById('az');
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

  function colorForMagnitude(deg, yellowDeg, redDeg) {
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
    if (next !== 'hud') clearCanvas();
    if (next === 'settings') renderSettings();
    if (next === 'hud') applyVisibilitySettings();
    if (next === 'menu') updateMenuSelection();
  }

  function clearCanvas() { ctx.clearRect(0, 0, W, H); }

  function applyVisibilitySettings() {
    accelBox.style.display = (settings.showAccelerations && (settings.showAccelX || settings.showAccelY || settings.showAccelZ)) ? 'block' : 'none';
    axEl.style.display = settings.showAccelX ? 'block' : 'none';
    ayEl.style.display = settings.showAccelY ? 'block' : 'none';
    azEl.style.display = settings.showAccelZ ? 'block' : 'none';
    document.body.classList.toggle('show-controls', !!settings.showHudControls);
  }

  function updateMenuSelection() {
    document.querySelectorAll('#mainMenu .menu-button').forEach((btn, i) => {
      btn.classList.toggle('selected', i === state.menuIndex);
    });
  }

  function renderSettings() {
    settingsList.innerHTML = '';
    settingItems.forEach(([key, label], i) => {
      const row = document.createElement('button');
      row.className = 'setting-row' + (i === state.settingsIndex ? ' selected' : '');
      row.dataset.settingKey = key;
      row.innerHTML = `<span class="setting-check">${settings[key] ? '✓' : ''}</span><span>${label}</span>`;
      row.addEventListener('click', () => toggleSetting(i));
      settingsList.appendChild(row);
    });
    document.getElementById('settingsBack').classList.toggle('selected', state.settingsIndex === settingItems.length);
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

  function currentPitch() {
    return wrap180(state.beta - state.zeroBeta);
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

  function drawPitchLadder(pitch) {
    if (!settings.showPitch) return;
    ctx.save();
    ctx.font = 'bold 20px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.lineCap = 'round';
    ctx.shadowColor = '#000';
    ctx.shadowBlur = 4;

    const lineLen = W * (cfg.pitchLineLengthPct[1] - cfg.pitchLineLengthPct[0]);
    const x1 = W * cfg.pitchLineLengthPct[0];
    const x2 = W * cfg.pitchLineLengthPct[1];

    for (let deg = -cfg.maxPitchLabelDeg; deg <= cfg.maxPitchLabelDeg; deg += cfg.pitchStepDeg) {
      const y = CY - (deg - pitch) * cfg.pitchPixelsPerDeg;
      if (y < 95 || y > H - 70) continue;
      const color = colorForMagnitude(deg, cfg.pitchYellowDeg, cfg.pitchRedDeg);
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = deg === 0 ? 3 : 2;
      ctx.beginPath();
      ctx.moveTo(x1, y);
      ctx.lineTo(x2, y);
      ctx.stroke();
      if (settings.showPitchDegrees) {
        const label = deg === 0 ? '0' : `${deg > 0 ? '+' : ''}${deg}`;
        ctx.textAlign = 'right';
        ctx.fillText(label, x1 - 12, y);
        ctx.textAlign = 'left';
        ctx.fillText(label, x2 + 12, y);
      }
    }
    ctx.restore();
  }

  function drawRollAndHorizon(roll, pitch) {
    if (!settings.showRoll) return;
    const horizonLen = W * (cfg.horizonLengthPct[1] - cfg.horizonLengthPct[0]);
    const refLen = W * (cfg.rollRefLengthPct[1] - cfg.rollRefLengthPct[0]);
    const color = colorForMagnitude(roll, cfg.rollYellowDeg, cfg.rollRedDeg);

    // True horizon: rotates opposite the measured roll so it remains aligned to the external horizon.
    drawLine(CX, CY, horizonLen, -roll, 'rgba(255,255,255,0.96)', 6);

    // Screen-aligned roll reference: fixed horizontal line, color-coded by roll magnitude.
    drawLine(CX, CY, refLen, 0, color, 3);

    if (settings.showRollDegrees && Math.abs(roll) >= cfg.rollDeadbandForNumber) {
      drawRollDegreeLabels(roll, color);
    }
  }

  function drawRollDegreeLabels(roll, color) {
    const label = `${Math.round(Math.abs(roll))}°`;
    const leftX = W * cfg.rollRefLengthPct[0] + 18;
    const rightX = W * cfg.rollRefLengthPct[1] - 18;
    const y = CY;
    const offset = 28;

    // Put each number between the fixed screen line and the rotating horizon.
    // With positive roll, left horizon/reference separation places label below on left and above on right.
    const leftAbove = roll < 0;
    const rightAbove = roll > 0;

    ctx.save();
    ctx.font = 'bold 26px system-ui, sans-serif';
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

  function renderHud() {
    clearCanvas();
    const pitch = currentPitch();
    const roll = currentVisualRoll();
    drawCompass(state.heading);
    drawPitchLadder(pitch);
    drawRollAndHorizon(roll, pitch);
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
      state.settingsIndex = clamp(state.settingsIndex + delta, 0, settingItems.length);
      renderSettings();
    } else if (screen === 'hud' && settings.showHudControls) {
      state.hudControlIndex = clamp(state.hudControlIndex + delta, 0, 2);
      document.querySelectorAll('.hud-button').forEach((b, i) => b.classList.toggle('selected', i === state.hudControlIndex));
    }
  }

  function activateCurrent() {
    if (screen === 'copyright') {
      localStorage.setItem(ACCEPT_KEY, 'true');
      showScreen('permission');
    } else if (screen === 'permission') {
      requestSensors();
    } else if (screen === 'menu') {
      if (state.menuIndex === 0) showScreen('hud');
      if (state.menuIndex === 1) { priorScreen = 'menu'; showScreen('settings'); }
      if (state.menuIndex === 2) showScreen('exit');
    } else if (screen === 'settings') {
      toggleSetting(state.settingsIndex);
    } else if (screen === 'hud') {
      if (!settings.showHudControls) {
        recenter();
      } else if (state.hudControlIndex === 0) {
        recenter();
      } else if (state.hudControlIndex === 1) {
        priorScreen = 'hud';
        showScreen('settings');
      } else if (state.hudControlIndex === 2) {
        showScreen('menu');
      }
    } else if (screen === 'exit') {
      showScreen('menu');
    }
  }

  function goBack() {
    if (screen === 'settings') showScreen(priorScreen === 'hud' ? 'hud' : 'menu');
    else if (screen === 'hud') showScreen('menu');
    else if (screen === 'exit') showScreen('menu');
  }

  function simulateKey(e) {
    const stepAngle = e.shiftKey ? 5 : 1;
    const stepAccel = e.shiftKey ? 1 : 0.2;
    switch (e.key.toLowerCase()) {
      case 'arrowleft': state.gamma -= stepAngle; break;
      case 'arrowright': state.gamma += stepAngle; break;
      case 'arrowup': state.beta += stepAngle; break;
      case 'arrowdown': state.beta -= stepAngle; break;
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

  document.addEventListener('keydown', (e) => {
    if (['ArrowUp', 'ArrowDown'].includes(e.key) && screen !== 'hud') {
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
  document.getElementById('settingsBack').addEventListener('click', () => showScreen(priorScreen === 'hud' ? 'hud' : 'menu'));
  document.getElementById('exitReturn').addEventListener('click', () => showScreen('menu'));
  document.getElementById('hudRecenter').addEventListener('click', recenter);
  document.getElementById('hudSettings').addEventListener('click', () => { priorScreen = 'hud'; showScreen('settings'); });
  document.getElementById('hudMainMenu').addEventListener('click', () => showScreen('menu'));

  showScreen(screen);
  applyVisibilitySettings();
  loop();
})();
