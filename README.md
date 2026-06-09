# Scientific HUD v8

Version 7 focuses on the fighter-jet-style sky-dome pitch ladder.

## Main changes from v6

- Pitch ladder is now anchored to the sky dome instead of being screen-fixed.
- Horizon is treated as the 0° pitch line.
- Horizon and pitch lines rotate with roll.
- Center crosshair remains screen-aligned and uses `CrosshairLength = 50`.
- Horizon and pitch lines have a center gap equal to `CrosshairLength`.
- Pitch lines are drawn every 10° from -90° to +90°.
- Pitch line geometry uses:
  - `pitchLineLength = 120`
  - `sidePitchLineLength = (pitchLineLength - crosshairLength) / 2`
- Color interpolation is green at 0°, yellow at 30°, red at 60°, and red through 90°.
- Pitch is derived from the gravity vector when available to reduce roll/pitch coupling.
- Horizon/roll and pitch use light exponential smoothing to reduce jitter.
- HUD menu supports up/down selection while in HUD mode.

## Desktop simulation keys

- Left / Right: roll
- I / K: pitch
- H / J: heading
- Enter / Space: activate selected item
- Escape / Backspace: go back

On the glasses, thumb up/down should move menu selection and pinch should activate.

## Tuning variables

At the top of `app.js`:

```js
crosshairLength: 50,
pitchLineLength: 120,
pitchStepDeg: 10,
maxPitchLabelDeg: 90,
pitchPixelsPerDeg: 7.5,
colorYellowDeg: 30,
colorRedDeg: 60,
rollSmoothing: 0.12,
pitchSmoothing: 0.12,
visualRollSign: 1,
visualPitchSign: 1
```

If the pitch direction is reversed on the glasses, flip `visualPitchSign` from `1` to `-1`.
If the roll direction is reversed, flip `visualRollSign` from `1` to `-1`.


## v8 update
- Reversed pitch sign so looking up reports positive pitch and looking down reports negative pitch.
