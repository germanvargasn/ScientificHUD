/* Scientific HUD v3
   Meta Ray-Ban Display web-app prototype.

   Sensor mapping follows the standard DeviceOrientationEvent fields:
   - event.alpha: heading / yaw, degrees around Z axis, usually 0..360
   - event.beta:  tilt / pitch, degrees, usually -180..180
   - event.gamma: roll, degrees, usually -90..90

   DeviceMotionEvent acceleration:
   - Prefer event.acceleration when available because gravity is already removed.
   - Fall back to event.accelerationIncludingGravity and subtract an estimated gravity value
     from Y because the glasses showed ~9.7 m/s^2 on A-Y when still.
*/

(() => {
  'use strict';

  const CONFIG = Object.freeze({
    canvasSize: 600,

    // HUD geometry.
    horizonStartPct: 0.10,
    horizonEndPct: 0.90,
    rollReferenceStartPct: 0.20,
    rollReferenceEndPct: 0.80,
    pitchLineStartPct: 0.34,
    pitchLineEndPct: 0.66,

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
    pitchPixelsPerDegree: 8,
    pitchLabelFont: '22px Arial, Helvetica, sans-serif',
    pitchLabelOffsetPx: 8,

    // Compass.
    compassFont: '24px Arial, Helvetica, sans-serif',
    compassY: 26,
    compassPixelsPerDegree: 7,
    compassTickHeight: 8,

    // Accelerometer.
    accelDisplayDecimals: 1,
    invertAccelX: true,
    gravityMetersPerSecond2: 9.81,

    // Keep attitude smoothing very low but not zero to avoid shimmer.
    attitudeSmoothingAlpha: 0.35,

    // Keyboard simulation increments.
    simAngleStepDeg: 2,
    simHeadingStepDeg: 5,
    simAccelStep: 0.10,
    simAccelDecay: 0.90,
  });

  const canvas = document.getElementById('hudCanvas');
  const ctx = canvas.getContext('2d');
  const permissionOverlay = document.getElementById('permissionOverlay');
  const enableButton = document.getElementById('enableSensorsButton');
  const calibrateButton = document.getElementById('calibrateButton');
  const compassStrip = document.getElementById('compassStrip');
  const axEl = document.getElementById('ax');
  const ayEl = document.getElementById('ay');
  const azEl = document.getElementById('az');

  const state = {
    sensorMode: false,
    orientationSeen: false,
    motionSeen: false,

    rawHeadingDeg: 0,
    rawPitchDeg: 0,
    rawRollDeg: 0,

    headingDeg: 0,
    pitchDeg: 0,
    rollDeg: 0,

    headingBaselineDeg: 0,
    pitchBaselineDeg: null,
    rollBaselineDeg: null,

    accelX: 0,
    accelY: 0,
    accelZ: 0,

    simHeadingDeg: 0,
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

  function normalize360(deg) {
    let out = deg % 360;
    if (out < 0) out += 360;
    return out;
  }

  function normalize180(deg) {
    let out = normalize360(deg);
    if (out > 180) out -= 360;
    return out;
  }

  function smoothLinear(previous, next, alpha) {
    return previous + (next - previous) * alpha;
  }

  function smoothHeading(previous, next, alpha) {
    const delta = normalize180(next - previous);
    return normalize360(previous + delta * alpha);
  }

  function setNeutral() {
    state.pitchBaselineDeg = state.rawPitchDeg;
    state.rollBaselineDeg = state.rawRollDeg;
    state.headingBaselineDeg = state.rawHeadingDeg;
    state.pitchDeg = 0;
    state.rollDeg = 0;
    state.headingDeg = 0;
  }

  function formatNumber(value) {
    if (Math.abs(value) < 0.05) return '0.0';
    return value.toFixed(CONFIG.accelDisplayDecimals);
  }

  function updateAccelerationReadout() {
    axEl.textContent = `A-X: ${formatNumber(state.accelX)}`;
    ayEl.textContent = `A-Y: ${formatNumber(state.accelY)}`;
    azEl.textContent = `A-Z: ${formatNumber(state.accelZ)}`;
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
      // A fixed-angle ladder: each ladder line represents a pitch angle in the outside world.
      // If the user pitches up, positive ladder angles move toward/through the center.
      const y = centerY - (angle - state.pitchDeg) * CONFIG.pitchPixelsPerDegree;
      if (y < -45 || y > CONFIG.canvasSize + 45) continue;

      const color = angleColor(angle, 0.92);
      const isZero = angle === 0;
      const lineWidth = isZero ? CONFIG.zeroPitchLineWidth : CONFIG.pitchLineWidth;
      const halfGap = isZero ? 20 : 14;
      const midX = CONFIG.canvasSize / 2;

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

    // Thick world-horizon line. It rotates opposite the head roll to look world-stable.
    drawCenteredRotatedLine(
      horizonX1,
      horizonX2,
      centerY,
      -state.rollDeg,
      'rgba(255, 255, 255, 0.94)',
      CONFIG.horizonLineWidth
    );

    // Thin screen-fixed roll reference, color-coded by roll magnitude.
    drawScreenAlignedLine(
      rollX1,
      rollX2,
      centerY,
      angleColor(state.rollDeg, 0.96),
      CONFIG.rollReferenceLineWidth,
      1
    );
  }

  function compassLabelFor(angle) {
    const labels = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const index = Math.round(normalize360(angle) / 45) % 8;
    return labels[index];
  }

  function drawCompass() {
    const centerX = CONFIG.canvasSize / 2;
    const heading = normalize360(state.headingDeg);
    const marks = [];

    // Draw a virtual compass tape. Current heading stays centered; surrounding headings slide.
    for (let deg = -720; deg <= 720; deg += 15) {
      const absolute = normalize360(deg);
      const delta = normalize180(absolute - heading);
      const x = centerX + delta * CONFIG.compassPixelsPerDegree;
      if (x < -70 || x > CONFIG.canvasSize + 70) continue;

      const isCardinal = absolute % 90 === 0;
      const isIntercardinal = absolute % 45 === 0;
      let label = '';
      if (isIntercardinal) label = compassLabelFor(absolute);
      else if (absolute % 30 === 0) label = String(absolute);

      marks.push({ x, absolute, isCardinal, isIntercardinal, label });
    }

    ctx.save();
    ctx.font = CONFIG.compassFont;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.lineWidth = 2;

    for (const mark of marks) {
      const alpha = mark.isCardinal ? 0.95 : mark.isIntercardinal ? 0.78 : 0.45;
      ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
      ctx.fillStyle = `rgba(255,255,255,${alpha})`;
      const tickTop = 3;
      const tickBottom = tickTop + (mark.isCardinal ? 14 : mark.isIntercardinal ? 11 : CONFIG.compassTickHeight);
      ctx.beginPath();
      ctx.moveTo(mark.x, tickTop);
      ctx.lineTo(mark.x, tickBottom);
      ctx.stroke();

      if (mark.label) {
        ctx.fillText(mark.label, mark.x, 20);
      }
    }

    // Center lubber line / current heading marker.
    ctx.strokeStyle = 'rgba(255,255,255,0.98)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(centerX, 0);
    ctx.lineTo(centerX, 50);
    ctx.stroke();

    ctx.fillStyle = 'rgba(255,255,255,0.98)';
    ctx.font = '20px Arial, Helvetica, sans-serif';
    ctx.fillText(compassLabelFor(heading), centerX, 54);
    ctx.restore();
  }

  function drawHUD() {
    clearCanvas();
    drawCompass();
    drawPitchLadder();
    drawHorizonAndRollReference();
  }

  function updateAttitudeFromRaw() {
    if (state.pitchBaselineDeg === null || state.rollBaselineDeg === null) {
      setNeutral();
    }

    const targetPitch = clamp(state.rawPitchDeg - state.pitchBaselineDeg, -85, 85);
    const targetRoll = clamp(state.rawRollDeg - state.rollBaselineDeg, -85, 85);
    const targetHeading = normalize360(state.rawHeadingDeg - state.headingBaselineDeg);

    state.pitchDeg = smoothLinear(state.pitchDeg, targetPitch, CONFIG.attitudeSmoothingAlpha);
    state.rollDeg = smoothLinear(state.rollDeg, targetRoll, CONFIG.attitudeSmoothingAlpha);
    state.headingDeg = smoothHeading(state.headingDeg, targetHeading, CONFIG.attitudeSmoothingAlpha);
  }

  function handleOrientation(event) {
    state.orientationSeen = true;

    // Meta docs describe standard fields as:
    // alpha = heading, beta = tilt, gamma = roll.
    const alpha = Number.isFinite(event.alpha) ? event.alpha : state.rawHeadingDeg;
    const beta = Number.isFinite(event.beta) ? event.beta : state.rawPitchDeg;
    const gamma = Number.isFinite(event.gamma) ? event.gamma : state.rawRollDeg;

    state.rawHeadingDeg = alpha;
    state.rawPitchDeg = beta;
    state.rawRollDeg = gamma;
  }

  function handleMotion(event) {
    state.motionSeen = true;

    const noGravity = event.acceleration;
    const withGravity = event.accelerationIncludingGravity;
    const source = noGravity || withGravity || { x: 0, y: 0, z: 0 };

    let x = Number.isFinite(source.x) ? source.x : 0;
    let y = Number.isFinite(source.y) ? source.y : 0;
    let z = Number.isFinite(source.z) ? source.z : 0;

    // On the glasses test, A-Y was around +9.7 at rest. If the browser only gives
    // accelerationIncludingGravity, subtract gravity from Y so neutral is close to zero.
    if (!noGravity && withGravity) {
      y -= CONFIG.gravityMetersPerSecond2;
    }

    if (CONFIG.invertAccelX) x *= -1;

    state.accelX = x;
    state.accelY = y;
    state.accelZ = z;
  }

  async function requestMotionAccess() {
    try {
      const permissionResults = [];

      if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
        permissionResults.push(await DeviceMotionEvent.requestPermission());
      }

      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        permissionResults.push(await DeviceOrientationEvent.requestPermission());
      }

      if (permissionResults.includes('denied')) {
        permissionOverlay.classList.add('hidden');
        calibrateButton.classList.remove('hidden');
        calibrateButton.focus();
        state.sensorMode = false;
        return;
      }

      window.addEventListener('deviceorientation', handleOrientation, true);
      window.addEventListener('devicemotion', handleMotion, true);

      state.sensorMode = true;
      permissionOverlay.classList.add('hidden');
      calibrateButton.classList.remove('hidden');
      calibrateButton.focus();

      // Auto-zero once the first real orientation events have arrived.
      setTimeout(() => {
        if (state.orientationSeen) setNeutral();
      }, 500);
    } catch (error) {
      console.error(error);
      permissionOverlay.classList.add('hidden');
      calibrateButton.classList.remove('hidden');
      calibrateButton.focus();
      state.sensorMode = false;
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
      case '[':
        state.simHeadingDeg -= CONFIG.simHeadingStepDeg;
        break;
      case ']':
        state.simHeadingDeg += CONFIG.simHeadingStepDeg;
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
      case 'Enter':
        if (!calibrateButton.classList.contains('hidden')) setNeutral();
        break;
      default:
        handled = false;
    }

    if (handled) event.preventDefault();
  }

  function updateSimulation() {
    if (!state.sensorMode || !state.orientationSeen) {
      state.pitchDeg = smoothLinear(state.pitchDeg, state.simPitchDeg, CONFIG.attitudeSmoothingAlpha);
      state.rollDeg = smoothLinear(state.rollDeg, state.simRollDeg, CONFIG.attitudeSmoothingAlpha);
      state.headingDeg = smoothHeading(state.headingDeg, state.simHeadingDeg, CONFIG.attitudeSmoothingAlpha);
    } else {
      updateAttitudeFromRaw();
    }

    if (!state.sensorMode || !state.motionSeen) {
      state.accelX = state.simAccelX;
      state.accelY = state.simAccelY;
      state.accelZ = state.simAccelZ;
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
    calibrateButton.addEventListener('click', setNeutral);
    window.addEventListener('keydown', handleKeyboard);
    enableButton.focus();
    animationLoop();
  }

  init();
})();
