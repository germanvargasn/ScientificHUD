# Scientific HUD v4

A 600x600 web HUD prototype for Meta Ray-Ban Display-style web apps.

## Files

- `index.html`
- `styles.css`
- `app.js`

## Sensor mapping

Uses the standard `DeviceOrientationEvent` fields described by web orientation APIs and Meta's web-app docs pattern:

- `event.alpha` = heading
- `event.beta` = tilt / pitch
- `event.gamma` = roll

Uses `DeviceMotionEvent` for acceleration.

## Controls

On startup, press/pinch **ENABLE** to request motion sensor access.

After startup:

- **SET ZERO** button / Enter / C = calibrate current pose as neutral.
- Left/Right arrows = simulated roll.
- Up/Down arrows = simulated pitch.
- [ / ] = simulated heading.
- W/S = simulated X acceleration.
- A/D = simulated Y acceleration.
- Q/E = simulated Z acceleration.

## v3 changes

- Removed bottom-right LIVE/debug status text.
- Added neutral calibration button.
- Added top compass tape with N, NE, E, SE, S, SW, W, NW.
- Uses alpha/beta/gamma explicitly.
- Removed acceleration smoothing.
- Displays acceleration with one decimal place.
- Reverses A-X sign.
- Subtracts gravity from A-Y when using accelerationIncludingGravity.


## v4 changes

- Calibration control is now a subtle bottom-right message: "Pinch to reset horizontal position".
- The app still reads `event.alpha` as heading, `event.beta` as tilt/pitch, and `event.gamma` as roll.
- The displayed artificial-horizon roll now prefers `DeviceMotionEvent.accelerationIncludingGravity` and computes roll from the gravity vector using `atan2(x, y)`. This is intended to avoid the instability seen with `gamma` near neutral pitch and around ~40 degrees.
- If the horizon appears mirrored on the glasses, change `visualRollSign` in `app.js` from `1` to `-1`.
