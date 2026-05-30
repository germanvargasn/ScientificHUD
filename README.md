# Scientific HUD v2

Static web app for Meta Ray-Ban Display / browser testing.

## Files

- `index.html`
- `styles.css`
- `app.js`

## Deployment

Upload all three files to GitHub Pages or another HTTPS host.

## Controls for desktop testing

- Enter: request sensors / activate app
- Left / Right arrows: simulated roll
- Up / Down arrows: simulated pitch
- W / S: simulated X acceleration
- A / D: simulated Y acceleration
- Q / E: simulated Z acceleration
- C: recalibrate current pose as neutral

## Notes

The app uses standard browser motion/orientation events:

- `DeviceMotionEvent`
- `DeviceOrientationEvent`
- `requestPermission()` when available

The acceleration readout uses a 0.2-second moving average.
X acceleration is sign-inverted as requested.
