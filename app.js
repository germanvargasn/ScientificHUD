/* Scientific HUD v2
   Meta Ray-Ban Display web-app prototype.
   - Standard DeviceMotionEvent / DeviceOrientationEvent sensor hooks.
   - Enter/pinch permission request.
   - Keyboard simulation fallback.
*/

(() => {
  'use strict';

  const CONFIG = Object.freeze({
    canvasSize: 600,

    // Line geometry
    horizonStartPct: 0.10,
    horizonEndPct: 0.90,
    rollReferenceStartPct: 0.20,
    rollReferenceEndPct: 0.80,
    pitchLineStartPct: 0.40,
    pitchLineEndPct: 0.60,

    horizonLineWidth: 7,
    rollReferenceLineWidth: 3,
    pitchLineWidth: 2,
    zeroPitchLineWidth: 4,

    // Color thresholds, degrees.
    yellowAngleDeg: 20,
    redAngleDeg: 40,

    // Pitch ladder.
    pitchSpacingDeg: 10,
    pitchMinDeg: -80,
    pitchMaxDeg: 80,
    pitchPixelsPerDegree: 10,
    pitchLabelFont: '22px Arial, Helvetica, sans-serif',
    pitchLabelOffsetPx: 10,

    // Accelerometer.
    accelDisplayDecimals: 2,
    accelSmoothingWindowMs: 200,
    invertAccelX: true,

    // Sensor smoothing for attitude. Small smoothing reduces visible jitter.
    attitudeSmoothingAlpha: 0.18,

    // Keyboard simulation increments.
    simAngleStepDeg: 2,
    simAccelStep: 0.10,
    simAccelDecay: 0.94,
  });

  const canvas = document.getElementById('hudCanvas');
  const ctx = canvas.getContext('2d');
  const permissionOverlay = document.getElementById('permissionOverlay');
  const enableButton = document.getElementById('enableSensorsButton');
  const statusText = document.getElementById('statusText');
  const modeLabel = document.getElementById('modeLabel');
  const axEl = document.getElementById('ax');
  const ayEl = document.getElementById('ay');
  const azEl = document.getElementById('az');

  const state = {
    sensorMode: false,
    permissionRequested: false,
    orientationSeen: false,
    motionSeen: false,

    rawPitchDeg: 0,
    rawRollDeg: 0,
    pitchDeg: 0,
    rollDeg: 0,
    pitchBaselineDeg: null,
    rollBaselineDeg: null,

    accelX: 0,
    accelY: 0,
    accelZ: 0,
    accelSamples: [],

    simPitchDeg: 0,
    simRollDeg: 0,
    simAccelX: 0,
    simAccelY: 0,
    simAccelZ: 0,
  };

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function lerp(a, b, t) {
    return a + (b - a) * clamp(t, 0, 1);
  }

  function rgb(r, g, b, alpha = 1) {
    return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${alpha})`;
  }

  function angleColor(angleDeg, alpha = 1) {
    const a = Math.abs(angleDeg);

    if (a <= CONFIG.yellowAngleDeg) {
      const t = a / CONFIG.yellowAngleDeg;
      // Green -> Yellow.
      return rgb(lerp(0, 255, t), 255, 0, alpha);
    }

    const t = (a - CONFIG.yellowAngleDeg) / (CONFIG.redAngleDeg - CONFIG.yellowAngleDeg);
    // Yellow -> Red.
    return rgb(255, lerp(255, 0, t), 0, alpha);
  }

  function normalizeAngle180(deg) {
    let out = deg;
    while (out > 180) out -= 360;
    while (out < -180) out += 360;
    return out;
  }

  function smoothAngle(previous, next, alpha) {
    const delta = normalizeAngle180(next - previous);
    return normalizeAngle180(previous + delta * alpha);
  }

  function resetCalibration() {
    state.pitchBaselineDeg = state.rawPitchDeg;
    state.rollBaselineDeg = state.rawRollDeg;
    state.pitchDeg = 0;
    state.rollDeg = 0;
    setStatus('Calibrated neutral attitude');
  }

  function addAccelSample(x, y, z) {
    const now = performance.now();
    state.accelSamples.push({ t: now, x, y, z });

    const cutoff = now - CONFIG.accelSmoothingWindowMs;
    while (state.accelSamples.length && state.accelSamples[0].t < cutoff) {
      state.accelSamples.shift();
    }

    let sx = 0, sy = 0, sz = 0;
    for (const sample of state.accelSamples) {
      sx += sample.x;
      sy += sample.y;
      sz += sample.z;
    }
    const n = Math.max(1, state.accelSamples.length);
    state.accelX = sx / n;
    state.accelY = sy / n;
    state.accelZ = sz / n;
  }

  function formatNumber(value) {
    if (Math.abs(value) < 0.005) return '0.00';
    return value.toFixed(CONFIG.accelDisplayDecimals);
  }

  function updateAccelerationReadout() {
    axEl.textContent = `A-X: ${formatNumber(state.accelX)}`;
    ayEl.textContent = `A-Y: ${formatNumber(state.accelY)}`;
    azEl.textContent = `A-Z: ${formatNumber(state.accelZ)}`;
  }

  function setStatus(message, mode = null) {
    statusText.textContent = message;
    if (mode) modeLabel.textContent = mode;
  }

  function clearCanvas() {
    ctx.clearRect(0, 0, CONFIG.canvasSize, CONFIG.canvasSize);
  }

  function drawCenteredRotatedLine(x1, x2, y, angleDeg, strokeStyle, lineWidth) {
    const cx = CONFIG.canvasSize / 2;
    const cy = y;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((angleDeg * Math.PI) / 180);
    ctx.beginPath();
    ctx.moveTo(x1 - cx, 0);
    ctx.lineTo(x2 - cx, 0);
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.restore();
  }

  function drawScreenAlignedLine(x1, x2, y, strokeStyle, lineWidth, alpha = 1) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.moveTo(x1, y);
    ctx.lineTo(x2, y);
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.restore();
  }

  function drawPitchLadder() {
    const centerY = CONFIG.canvasSize / 2;
    const x1 = CONFIG.canvasSize * CONFIG.pitchLineStartPct;
    const x2 = CONFIG.canvasSize * CONFIG.pitchLineEndPct;
    const labelLeftX = x1 - CONFIG.pitchLabelOffsetPx;
    const labelRightX = x2 + CONFIG.pitchLabelOffsetPx;

    ctx.save();
    ctx.font = CONFIG.pitchLabelFont;
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';

    for (let angle = CONFIG.pitchMinDeg; angle <= CONFIG.pitchMaxDeg; angle += CONFIG.pitchSpacingDeg) {
      const y = centerY - (angle - state.pitchDeg) * CONFIG.pitchPixelsPerDegree;
      if (y < -40 || y > CONFIG.canvasSize + 40) continue;

      const color = angleColor(angle, 0.92);
      const isZero = angle === 0;
      const lineWidth = isZero ? CONFIG.zeroPitchLineWidth : CONFIG.pitchLineWidth;
      const halfGap = isZero ? 18 : 12;
      const midX = CONFIG.canvasSize / 2;

      // Split the line to leave a tiny center gap, like aircraft-style pitch ladders.
      drawScreenAlignedLine(x1, midX - halfGap, y, color, lineWidth, 0.88);
      drawScreenAlignedLine(midX + halfGap, x2, y, color, lineWidth, 0.88);

      const label = angle > 0 ? `+${angle}` : `${angle}`;
      ctx.fillStyle = color;
      ctx.textAlign = 'right';
      ctx.fillText(label, labelLeftX, y);
      ctx.textAlign = 'left';
      ctx.fillText(label, labelRightX, y);
    }

    ctx.restore();
  }

  function drawHorizonAndRollReference() {
    const centerY = CONFIG.canvasSize / 2;
    const horizonX1 = CONFIG.canvasSize * CONFIG.horizonStartPct;
    const horizonX2 = CONFIG.canvasSize * CONFIG.horizonEndPct;
    const rollX1 = CONFIG.canvasSize * CONFIG.rollReferenceStartPct;
    const rollX2 = CONFIG.canvasSize * CONFIG.rollReferenceEndPct;

    // World horizon: thick line, rotates opposite the user's head roll so it feels fixed in space.
    drawCenteredRotatedLine(
      horizonX1,
      horizonX2,
      centerY,
      -state.rollDeg,
      'rgba(255, 255, 255, 0.94)',
      CONFIG.horizonLineWidth
    );

    // Screen-fixed roll reference: thin line, never rotates, color indicates roll magnitude.
    drawScreenAlignedLine(
      rollX1,
      rollX2,
      centerY,
      angleColor(state.rollDeg, 0.96),
      CONFIG.rollReferenceLineWidth,
      1
    );
  }

  function drawDebugText() {
    ctx.save();
    ctx.font = '18px Arial, Helvetica, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`P ${state.pitchDeg.toFixed(1)}°  R ${state.rollDeg.toFixed(1)}°`, 4, CONFIG.canvasSize - 4);
    ctx.restore();
  }

  function drawHUD() {
    clearCanvas();
    drawPitchLadder();
    drawHorizonAndRollReference();
    drawDebugText();
  }

  function updateAttitudeFromRaw() {
    if (state.pitchBaselineDeg === null) state.pitchBaselineDeg = state.rawPitchDeg;
    if (state.rollBaselineDeg === null) state.rollBaselineDeg = state.rawRollDeg;

    const targetPitch = normalizeAngle180(state.rawPitchDeg - state.pitchBaselineDeg);
    const targetRoll = normalizeAngle180(state.rawRollDeg - state.rollBaselineDeg);

    state.pitchDeg = smoothAngle(state.pitchDeg, targetPitch, CONFIG.attitudeSmoothingAlpha);
    state.rollDeg = smoothAngle(state.rollDeg, targetRoll, CONFIG.attitudeSmoothingAlpha);
  }

  function handleOrientation(event) {
    state.orientationSeen = true;

    // Standard web orientation:
    // beta: front/back tilt, gamma: left/right tilt.
    // We calibrate initial pose to zero to avoid sign and mounting surprises.
    const beta = Number.isFinite(event.beta) ? event.beta : 0;
    const gamma = Number.isFinite(event.gamma) ? event.gamma : 0;

    state.rawPitchDeg = beta;
    state.rawRollDeg = gamma;
  }

  function handleMotion(event) {
    state.motionSeen = true;
    const a = event.accelerationIncludingGravity || event.acceleration || { x: 0, y: 0, z: 0 };

    let x = Number.isFinite(a.x) ? a.x : 0;
    let y = Number.isFinite(a.y) ? a.y : 0;
    let z = Number.isFinite(a.z) ? a.z : 0;

    if (CONFIG.invertAccelX) x *= -1;
    addAccelSample(x, y, z);
  }

  async function requestMotionAccess() {
    state.permissionRequested = true;
    setStatus('Requesting sensors...', 'REQ');

    try {
      const permissionResults = [];

      if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
        permissionResults.push(await DeviceMotionEvent.requestPermission());
      }

      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        permissionResults.push(await DeviceOrientationEvent.requestPermission());
      }

      if (permissionResults.includes('denied')) {
        setStatus('Permission denied; simulation active', 'SIM');
        state.sensorMode = false;
        permissionOverlay.classList.add('hidden');
        return;
      }

      window.addEventListener('deviceorientation', handleOrientation, true);
      window.addEventListener('devicemotion', handleMotion, true);

      state.sensorMode = true;
      permissionOverlay.classList.add('hidden');
      setStatus('Sensors active; press C to recalibrate', 'LIVE');

      // Give the first real reading a moment, then calibrate neutral if present.
      setTimeout(() => {
        if (state.orientationSeen) resetCalibration();
        if (!state.orientationSeen && !state.motionSeen) {
          setStatus('No sensor events yet; keyboard simulation active', 'SIM');
        }
      }, 500);
    } catch (error) {
      console.error(error);
      permissionOverlay.classList.add('hidden');
      state.sensorMode = false;
      setStatus('Sensor request failed; simulation active', 'SIM');
    }
  }

  function handleKeyboard(event) {
    const key = event.key;

    if (!permissionOverlay.classList.contains('hidden') && key === 'Enter') {
      event.preventDefault();
      requestMotionAccess();
      return;
    }

    let handled = true;
    switch (key) {
      case 'ArrowLeft':
        state.simRollDeg -= CONFIG.simAngleStepDeg;
        break;
      case 'ArrowRight':
        state.simRollDeg += CONFIG.simAngleStepDeg;
        break;
      case 'ArrowUp':
        state.simPitchDeg += CONFIG.simAngleStepDeg;
        break;
      case 'ArrowDown':
        state.simPitchDeg -= CONFIG.simAngleStepDeg;
        break;
      case 'w':
      case 'W':
        state.simAccelX += CONFIG.simAccelStep;
        break;
      case 's':
      case 'S':
        state.simAccelX -= CONFIG.simAccelStep;
        break;
      case 'a':
      case 'A':
        state.simAccelY -= CONFIG.simAccelStep;
        break;
      case 'd':
      case 'D':
        state.simAccelY += CONFIG.simAccelStep;
        break;
      case 'q':
      case 'Q':
        state.simAccelZ += CONFIG.simAccelStep;
        break;
      case 'e':
      case 'E':
        state.simAccelZ -= CONFIG.simAccelStep;
        break;
      case 'c':
      case 'C':
        resetCalibration();
        break;
      default:
        handled = false;
    }

    if (handled) {
      event.preventDefault();
      if (!state.sensorMode || !state.orientationSeen) {
        setStatus('Keyboard simulation active', 'SIM');
      }
    }
  }

  function updateSimulation() {
    if (!state.sensorMode || !state.orientationSeen) {
      state.pitchDeg = smoothAngle(state.pitchDeg, state.simPitchDeg, CONFIG.attitudeSmoothingAlpha);
      state.rollDeg = smoothAngle(state.rollDeg, state.simRollDeg, CONFIG.attitudeSmoothingAlpha);
    } else {
      updateAttitudeFromRaw();
    }

    if (!state.sensorMode || !state.motionSeen) {
      addAccelSample(state.simAccelX, state.simAccelY, state.simAccelZ);
      state.simAccelX *= CONFIG.simAccelDecay;
      state.simAccelY *= CONFIG.simAccelDecay;
      state.simAccelZ *= CONFIG.simAccelDecay;
    }
  }

  function animationLoop() {
    updateSimulation();
    updateAccelerationReadout();
    drawHUD();
    requestAnimationFrame(animationLoop);
  }

  function init() {
    enableButton.addEventListener('click', requestMotionAccess);
    window.addEventListener('keydown', handleKeyboard);
    enableButton.focus();
    setStatus('Press Enter to enable sensors', 'READY');
    animationLoop();
  }

  init();
})();
