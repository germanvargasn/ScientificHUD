# Scientific HUD v5

A 600 x 600 web HUD prototype for Meta Ray-Ban Display-style web apps.

## Files

- `index.html`
- `styles.css`
- `app.js`
- `icon.svg`

## v5 features

- Copyright / attribution startup screen
- Sensor permission screen
- Main menu: Start HUD, Settings, Exit
- Settings page with locally saved preferences using `localStorage`
- HUD controls: Recenter, Settings, Main Menu
- Optional subtle recenter hint
- Compass strip with cardinal/intercardinal labels
- Acceleration display, one decimal place
- Pitch ladder with visible degree labels
- Roll reference line with color-coded angle display
- Recenter preserves heading; only tilt/roll neutral references are reset

## Sensor mapping

The app uses the standard web orientation mapping described in Meta's web app guidance:

- `event.alpha` = heading
- `event.beta` = tilt / pitch
- `event.gamma` = roll fallback

For the artificial horizon, v5 preserves the v4 strategy: it prefers `DeviceMotionEvent.accelerationIncludingGravity` to derive visual roll from the gravity vector and falls back to `gamma` when gravity is unavailable.

## Keyboard simulation

- Arrow left/right: roll
- Arrow up/down: pitch
- W/S: acceleration X
- A/D: acceleration Y
- Q/E: acceleration Z
- H/J: heading
- Enter: pinch / activate
- Escape or Backspace: back

## Notes

If the artificial horizon appears mirrored on the glasses, open `app.js` and change:

```js
visualRollSign: 1
```

to:

```js
visualRollSign: -1
```
