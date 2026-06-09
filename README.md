# Scientific HUD v6

A 600 x 600 web HUD prototype for Meta Ray-Ban Display-style web apps.

## Files

- `index.html`
- `styles.css`
- `app.js`
- `icon.svg`

## v6 features

- Copyright / attribution startup screen
- Sensor permission screen
- Main menu: Start HUD, Settings, Exit
- Paged settings page with locally saved preferences using `localStorage`
- HUD controls: Recenter, Settings, Main Menu, enabled by default
- Optional subtle recenter hint
- Compass strip with cardinal/intercardinal labels
- Acceleration display, one decimal place
- Pitch ladder with visible degree labels from -90° to +90° in 10° increments
- Roll reference line with color-coded whole-degree angle display
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


## v6 changes from v5

- Copyright screen appears on every app launch.
- Pitch ladder extends to ±90°. Lines beyond ±40° remain red.
- Horizon roll drawing sign restored toward the v4 behavior after real-device testing.
- Settings are paged to stay within the 600 x 600 viewport.
- Exit attempts to close the web app shell with `window.close()` and falls back to browser navigation.
- Web App Manifest added with PNG app icons (`icon-192.png`, `icon-512.png`) plus SVG source icon.

## Meta web app manifest

The private Meta documentation page requires login, so this package uses standard Web App Manifest structure: `manifest.json` linked from `index.html`, with PNG icons and standalone display mode.
