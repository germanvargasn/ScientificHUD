# Scientific HUD v11

Scientific HUD is a 600 × 600 web app prototype for Meta Ray-Ban Display-style web apps.

## v11 additions

- Local recording mode.
- Red recording dot at the top of the HUD while recording.
- HUD menu button changes from **Start Recording** to **Stop Recording**.
- **Silent Mode** hides all HUD elements except the red recording dot.
- In Silent Mode, one pinch / Enter exits Silent Mode and returns to the full HUD.
- Samples are captured every 0.1 seconds.
- CSV export is generated locally in the browser.
- Export screen provides **Share CSV** and **Download CSV** options.
- Recording sessions receive a session code like `SCI-8K42`.

## CSV format

The CSV column order is:

```csv
date,time,ax,ay,az,pitch,roll,heading
```

Example row:

```csv
2026-06-13,14:32:18.4,0.123,-0.042,0.005,2.157,-1.834,86.000
```

The recorded values are the HUD-adjusted values:

- adjusted acceleration X
- adjusted acceleration Y
- adjusted acceleration Z
- calibrated/smoothed pitch
- calibrated/smoothed roll
- displayed heading

## Export behavior

The app builds the CSV in memory using a browser `Blob`.

- **Share CSV** tries to use the device/browser native file sharing flow.
- **Download CSV** uses a standard browser download fallback.

Support may vary depending on the Meta web-app shell and the connected phone/browser.

## Notes

This version does not require a backend server. The recording is kept locally in memory during the session, with a lightweight localStorage backup while recording. Export before closing or refreshing the app.


## v12 export workflow

Scientific HUD v12 records locally at 0.1 second intervals and creates a CSV with this column order:

```csv
date,time,ax,ay,az,pitch,roll,heading
```

After stopping a recording, the export screen offers:

1. **Share CSV** — tries the device/browser native file share flow. If native file sharing is unavailable or fails, it automatically sends the CSV to the configured upload endpoint. If the user cancels the share sheet, the CSV is not uploaded automatically.
2. **Download CSV** — attempts a standard browser download. If the glasses runtime does not expose a downloads UI, use Upload CSV.
3. **Upload CSV** — manually sends the CSV to the configured Google Apps Script endpoint.

Configured upload endpoint:

```text
https://script.google.com/macros/s/AKfycbwKGzakLKeFzxxRHkTegUSkdt1mGwFhAzSaqOaxH-em2_tBTTlFDmDYYtxm9gWv9XjGqA/exec
```

Configured upload secret:

```text
CHANGE_THIS_TO_A_RANDOM_PASSWORD
```

The upload uses `fetch(..., { mode: "no-cors" })` so it can work from GitHub Pages with a simple Apps Script receiver. The tradeoff is that the response is opaque, so the HUD can show that the upload was sent, but it cannot prove from inside the glasses runtime that the CSV was written successfully.
