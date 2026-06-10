# Scientific HUD v9

Version 9 keeps the working v8 attitude/HUD behavior and adds a visual-only pitch ladder scaling factor.

## Main v9 change

- Added `pitchVisualScale` at the top of `app.js`.
- Default value: `1.35`.
- This stretches the spacing of the sky-dome pitch ladder and horizon projection so the pitch lines feel less compressed on the small Meta Ray-Ban Display field of view.
- The actual measured pitch angle is **not changed**. Only the drawing/projection spacing is scaled.

## Key tuning variables

At the top of `app.js`:

```js
crosshairLength: 50,
pitchLineLength: 120,
pitchStepDeg: 10,
maxPitchLabelDeg: 90,
pitchPixelsPerDeg: 7.5,
pitchVisualScale: 1.35,
colorYellowDeg: 30,
colorRedDeg: 60,
rollSmoothing: 0.12,
pitchSmoothing: 0.12,
visualRollSign: 1,
visualPitchSign: -1
```

## How to tune the new scale

- Increase `pitchVisualScale` if the pitch lines still feel too compressed.
- Decrease it if the horizon/pitch lines move out of view too quickly.
- Start with small changes, for example:
  - `1.20`
  - `1.35`
  - `1.50`

## Desktop simulation keys

- Left / Right: roll
- I / K: pitch
- H / J: heading
- Enter / Space: activate selected item
- Escape / Backspace: go back

On the glasses, thumb up/down should move menu selection and pinch should activate.
