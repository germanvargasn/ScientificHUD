'use strict';

/*
  Scientific HUD for Meta Ray-Ban Display Web Apps

  Expected sensor inputs:
  - DeviceOrientationEvent for roll/pitch style orientation.
  - DeviceMotionEvent for acceleration x/y/z.

  Keyboard simulation for desktop testing:
  - ArrowLeft / ArrowRight: roll
  - ArrowUp / ArrowDown: pitch
  - W / S: acceleration X
  - A / D: acceleration Y
  - Q / E: acceleration Z
  - R: reset simulation
  - Enter: request permission / start
*/

const CONFIG = {
  canvasSize: 600,

  // Line positions as fractions of the 600x600 display.
  horizonStartX: 0.10,
  horizonEndX: 0.90,
  rollReferenceStartX: 0.20,
  rollReferenceEndX: 0.80,
  pitchLineStartX: 0.40,
  pitchLineEndX: 0.60,

  // Visual styling.
  horizonLineWidth: 7,
  rollReferenceLineWidth: 3,
  pitchLineWidth: 2,
  pitchLineAlpha: 0.58,
  centerY: 300,

  // Roll color thresholds, in degrees.
  rollYellowDeg: 20,
  rollRedDeg: 40,

  // Pitch line behavior.
  pitchSpacingNeutralPx: 70,
  pitchSpacingMinPx: 25,
  pitchSpacingMaxPx: 105,
  pitchShiftPxPerDeg: 3.5,
  pitchCompressionMaxDeg: 45,
  pitchReferenceLinesEachSide: 5,

  // Smoothing. 0 = no movement, 1 = immediate.
  smoothing: 0.18,

  // Fallback simulation when real sensors are unavailable.
  simulationStepDeg: 2,
  simulationAccelStep: 0.15,
  decimals: 2
};

const state = {
  hasStarted: false,
  hasSensorEvents: false,
  usingSimulation: false,

  raw: {
    roll: 0,
    pitch: 0,
    ax: 0,
    ay: 0,
    az: 0
  },

  smooth: {
    roll: 0,
    pitch: 0,
    ax: 0,
    ay: 0,
    az: 0
  }
};

const canvas = document.getElementById('hudCanvas');
const ctx = canvas.getContext('2d');
const permissionOverlay = document.getElementById('permissionOverlay');
const permissionButton = document.getElementById('permissionButton');
const statusOverlay = document.getElementById('statusOverlay');

const axValue = document.getElementById('axValue');
const ayValue = document.getElementById('ayValue');
const azValue = document.getElementById('azValue');

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerpColor(c1, c2, t) {
  const u = clamp(t, 0, 1);
  const r = Math.round(lerp(c1[0], c2[0], u));
  const g = Math.round(lerp(c1[1], c2[1], u));
  const b = Math.round(lerp(c1[2], c2[2], u));
  return `rgb(${r}, ${g}, ${b})`;
}

function rollColorFromDegrees(rollDeg) {
  const a = Math.abs(rollDeg);
  const green = [0, 255, 0];
  const yellow = [255, 255, 0];
  const red = [255, 0, 0];

  if (a <= CONFIG.rollYellowDeg) {
    return lerpColor(green, yellow, a / CONFIG.rollYellowDeg);
  }

  if (a <= CONFIG.rollRedDeg) {
    return lerpColor(
      yellow,
      red,
      (a - CONFIG.rollYellowDeg) / (CONFIG.rollRedDeg - CONFIG.rollYellowDeg)
    );
  }

  return 'rgb(255, 0, 0)';
}

function degreesToRadians(deg) {
  return (deg * Math.PI) / 180;
}

function smoothValue(current, target) {
  return lerp(current, target, CONFIG.smoothing);
}

function updateSmoothedState() {
  state.smooth.roll = smoothValue(state.smooth.roll, state.raw.roll);
  state.smooth.pitch = smoothValue(state.smooth.pitch, state.raw.pitch);
  state.smooth.ax = smoothValue(state.smooth.ax, state.raw.ax);
  state.smooth.ay = smoothValue(state.smooth.ay, state.raw.ay);
  state.smooth.az = smoothValue(state.smooth.az, state.raw.az);
}

function clearCanvas() {
  ctx.clearRect(0, 0, CONFIG.canvasSize, CONFIG.canvasSize);
}

function drawLine(x1, y1, x2, y2, color, width, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.restore();
}

function drawRotatingHorizon() {
  const y = CONFIG.centerY;
  const x1 = CONFIG.canvasSize * CONFIG.horizonStartX;
  const x2 = CONFIG.canvasSize * CONFIG.horizonEndX;
  const cx = CONFIG.canvasSize / 2;
  const cy = CONFIG.centerY;

  ctx.save();
  ctx.translate(cx, cy);
  // Negative sign makes the horizon visually counter-rotate to remain world-level as head rolls.
  ctx.rotate(degreesToRadians(-state.smooth.roll));
  drawLine(x1 - cx, y - cy, x2 - cx, y - cy, 'rgb(0, 255, 0)', CONFIG.horizonLineWidth, 0.95);
  ctx.restore();
}

function drawScreenAlignedRollReference() {
  const y = CONFIG.centerY;
  const x1 = CONFIG.canvasSize * CONFIG.rollReferenceStartX;
  const x2 = CONFIG.canvasSize * CONFIG.rollReferenceEndX;
  const color = rollColorFromDegrees(state.smooth.roll);
  drawLine(x1, y, x2, y, color, CONFIG.rollReferenceLineWidth, 1);
}

function getPitchSpacing(pitchDeg) {
  const amount = clamp(Math.abs(pitchDeg) / CONFIG.pitchCompressionMaxDeg, 0, 1);
  return lerp(CONFIG.pitchSpacingNeutralPx, CONFIG.pitchSpacingMinPx, amount);
}

function drawPitchReferenceLines() {
  const x1 = CONFIG.canvasSize * CONFIG.pitchLineStartX;
  const x2 = CONFIG.canvasSize * CONFIG.pitchLineEndX;
  const centerY = CONFIG.centerY;

  const spacing = getPitchSpacing(state.smooth.pitch);
  const offset = -state.smooth.pitch * CONFIG.pitchShiftPxPerDeg;

  for (let i = -CONFIG.pitchReferenceLinesEachSide; i <= CONFIG.pitchReferenceLinesEachSide; i += 1) {
    if (i === 0) continue;

    const y = centerY + offset + i * spacing;
    if (y < -20 || y > CONFIG.canvasSize + 20) continue;

    const alpha = CONFIG.pitchLineAlpha * (1 - Math.min(Math.abs(i) * 0.08, 0.45));
    drawLine(x1, y, x2, y, 'rgb(255, 255, 255)', CONFIG.pitchLineWidth, alpha);
  }
}

function updateReadouts() {
  axValue.textContent = state.smooth.ax.toFixed(CONFIG.decimals);
  ayValue.textContent = state.smooth.ay.toFixed(CONFIG.decimals);
  azValue.textContent = state.smooth.az.toFixed(CONFIG.decimals);
}

function render() {
  updateSmoothedState();
  clearCanvas();

  // Layering: pitch references first, horizon next, screen-aligned roll reference last.
  drawPitchReferenceLines();
  drawRotatingHorizon();
  drawScreenAlignedRollReference();
  updateReadouts();

  requestAnimationFrame(render);
}

function showStatus(message) {
  statusOverlay.textContent = message;
  statusOverlay.classList.remove('hidden');
}

function hideStatus() {
  statusOverlay.textContent = '';
  statusOverlay.classList.add('hidden');
}

function startHud({ simulation = false } = {}) {
  state.hasStarted = true;
  state.usingSimulation = simulation;
  permissionOverlay.classList.add('hidden');

  if (simulation) {
    showStatus('SIM MODE');
  } else {
    hideStatus();
  }
}

async function requestSensorPermission() {
  try {
    // iOS-style permission flow for motion/orientation APIs.
    if (
      typeof DeviceMotionEvent !== 'undefined' &&
      typeof DeviceMotionEvent.requestPermission === 'function'
    ) {
      const motionPermission = await DeviceMotionEvent.requestPermission();
      if (motionPermission !== 'granted') {
        showStatus('Motion permission denied. Using simulation.');
        startHud({ simulation: true });
        return;
      }
    }

    if (
      typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function'
    ) {
      const orientationPermission = await DeviceOrientationEvent.requestPermission();
      if (orientationPermission !== 'granted') {
        showStatus('Orientation permission denied. Using simulation.');
        startHud({ simulation: true });
        return;
      }
    }

    attachSensorListeners();
    startHud({ simulation: false });

    // If the device never sends events, fall back visibly after a short delay.
    setTimeout(() => {
      if (!state.hasSensorEvents) {
        state.usingSimulation = true;
        showStatus('No sensor events yet. SIM MODE active.');
      }
    }, 2500);
  } catch (error) {
    console.error('Sensor permission request failed:', error);
    showStatus('Sensor request failed. Using simulation.');
    startHud({ simulation: true });
  }
}

function attachSensorListeners() {
  window.addEventListener('deviceorientation', handleDeviceOrientation, true);
  window.addEventListener('devicemotion', handleDeviceMotion, true);
}

function handleDeviceOrientation(event) {
  state.hasSensorEvents = true;
  state.usingSimulation = false;
  hideStatus();

  // Standard DeviceOrientationEvent values:
  // beta: front/back tilt, roughly pitch, range -180..180
  // gamma: left/right tilt, roughly roll, range -90..90
  // alpha: compass/yaw, not used yet
  if (typeof event.gamma === 'number') {
    state.raw.roll = clamp(event.gamma, -90, 90);
  }

  if (typeof event.beta === 'number') {
    state.raw.pitch = clamp(event.beta, -90, 90);
  }
}

function handleDeviceMotion(event) {
  state.hasSensorEvents = true;
  state.usingSimulation = false;
  hideStatus();

  const a = event.acceleration || event.accelerationIncludingGravity;
  if (!a) return;

  if (typeof a.x === 'number') state.raw.ax = a.x;
  if (typeof a.y === 'number') state.raw.ay = a.y;
  if (typeof a.z === 'number') state.raw.az = a.z;
}

function handleKeyboard(event) {
  if (event.key === 'Enter' && !state.hasStarted) {
    requestSensorPermission();
    return;
  }

  if (!state.hasStarted) return;

  const key = event.key.toLowerCase();
  const deg = CONFIG.simulationStepDeg;
  const acc = CONFIG.simulationAccelStep;

  switch (key) {
    case 'arrowleft':
      state.raw.roll -= deg;
      state.usingSimulation = true;
      showStatus('SIM MODE');
      event.preventDefault();
      break;
    case 'arrowright':
      state.raw.roll += deg;
      state.usingSimulation = true;
      showStatus('SIM MODE');
      event.preventDefault();
      break;
    case 'arrowup':
      state.raw.pitch += deg;
      state.usingSimulation = true;
      showStatus('SIM MODE');
      event.preventDefault();
      break;
    case 'arrowdown':
      state.raw.pitch -= deg;
      state.usingSimulation = true;
      showStatus('SIM MODE');
      event.preventDefault();
      break;
    case 'w':
      state.raw.ax += acc;
      state.usingSimulation = true;
      showStatus('SIM MODE');
      break;
    case 's':
      state.raw.ax -= acc;
      state.usingSimulation = true;
      showStatus('SIM MODE');
      break;
    case 'a':
      state.raw.ay -= acc;
      state.usingSimulation = true;
      showStatus('SIM MODE');
      break;
    case 'd':
      state.raw.ay += acc;
      state.usingSimulation = true;
      showStatus('SIM MODE');
      break;
    case 'q':
      state.raw.az -= acc;
      state.usingSimulation = true;
      showStatus('SIM MODE');
      break;
    case 'e':
      state.raw.az += acc;
      state.usingSimulation = true;
      showStatus('SIM MODE');
      break;
    case 'r':
      state.raw.roll = 0;
      state.raw.pitch = 0;
      state.raw.ax = 0;
      state.raw.ay = 0;
      state.raw.az = 0;
      state.usingSimulation = true;
      showStatus('SIM MODE');
      break;
    default:
      break;
  }

  state.raw.roll = clamp(state.raw.roll, -90, 90);
  state.raw.pitch = clamp(state.raw.pitch, -90, 90);
}

permissionButton.addEventListener('click', requestSensorPermission);
window.addEventListener('keydown', handleKeyboard);

// Start render loop immediately so the permission screen overlays a live black/transparent canvas.
requestAnimationFrame(render);
