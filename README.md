# London Bus Times for Kindle Illusion

This is a scriptlet-invoked Illusion application that shows live arrivals from TfL's public, anonymous API. It makes no request for, and contains no, TfL app key or personal data. Once a stop is configured, it refreshes its arrivals in-place; **Refresh now** is available for an immediate update.

## Install

1. Copy both `LondonBusTimes.sh` and the complete `LondonBusTimes/` folder to the top level of the Kindle's `documents` directory.
2. Eject the Kindle, then run **London Bus Times** from its library. The scriptlet copies the app to Mesquite, registers `uk.bustimes.london`, and launches it.
3. Connect Wi-Fi. Search by bus-stop name or 5-digit Countdown code, or enter a TfL NaPTAN bus-stop ID (for example, `490008660N`) and tap **Show stop**. The selected ID is remembered by the Kindle.

The app resolves every search candidate before saving it. If TfL returns a **stop group**, it displays its individual boarding stops and their directions; it never uses the group ID for arrivals. A stop ID refers to one side of a road, so choose the stop in the direction you want to travel.

Tap **Settings** at the bottom of the arrivals board to choose a saved refresh interval of 30 seconds, 1, 2, 5, or 10 minutes. Short intervals are more current but use more Wi-Fi and battery.

## Features

- **Recent stops and + Add new stop.** Search by name, 5-digit code or stop ID. Only individual stops are ever saved, never stop groups.
- **Route filter.** Tap **Routes** under the arrivals status to show only the routes you use. The choice is remembered per stop.
- **Service alerts.** If TfL reports disruption on the routes you are watching, a boxed banner shows it above the arrivals.
- **Last arrivals kept.** If the network drops, the last arrivals stay on screen with their time ("as of 07:58"), and the due times keep counting down. The app also retries once automatically.
- **Tube and rail.** Switch **Add new stop** to **Tube & rail** to add a station (Tube, DLR, Overground or Elizabeth line). See below.
- **Live bus strip.** Tap **Track** on a bus to see it on a straight line of stops, tagged with its route number, with the distance to your stop.

## Tube and rail

Use **+ Add new stop**, tap **Tube & rail**, and search for a station by name or by its ID (for example `940GZZLUVIC`). The app saves the **station** ID (`940G...` for Tube/DLR, `910G...` for Overground and Elizabeth line), so you see every platform and line at that station in one list. Use **Routes** to show only the lines you use, and the service-alert banner works for Tube lines too.

Each row shows the line, the destination and the platform. Tap **Info** on a row for the train's platform, last reported location (for example "At Green Park Platform 3") and due time; it updates whenever the arrivals refresh, and says when the train has gone. Tube and rail trains have no GPS and no registration plate, so there is no map strip for them; that is TfL's data, not a limit of the app.

Tube arrivals use the same TfL endpoint as buses, but I could only test them against recorded-style sample data, not the live service. Overground and Elizabeth line predictions are the least tested.

## Changes in 1.2.0

Bug fixes:

- A network failure used to be reported as "HTTP 0" and could fire two error handlers at once. It is now one clear "Network problem" message with a single automatic retry.
- Requests that never finished could freeze auto-refresh forever; every request now times out after 20 seconds.
- Changing stop left the old stop refreshing in the background and its bus tracker polling every 30 seconds. Changing stop now stops the refresh, tracker, alerts and route filter bar for the old stop.
- **Refresh now** with no stop chosen explains itself instead of doing nothing.
- If the bus's GPS position is old, the map says so ("Last GPS update was 12 min ago") and the vehicle panel shows when it was reported.
- Timestamps are parsed by hand so they work on the Kindle's old browser.
- Service alerts no longer repeat the route name twice, including for Tube lines.
- The header no longer flips between TfL's per-line station names at Tube interchanges.
- Removed unused code.

## Library icons

Both scriptlets carry a library icon through the `# Icon:` header line (a base64 PNG read by the Kindle's scriptlet loader). The icons use the same shape as the official KOReader example: a 600x600 PNG with a portrait, book-cover-shaped artwork (about 488x598, rounded corners) centred on a transparent background. A full-square image looks wrong in the library.

The artwork is in `assets/` (SVG source plus the PNG). To change an icon, edit the SVG, export a 600x600 PNG that keeps the transparent sides, and replace the base64 on the `# Icon:` line: `base64 -w0 icon.png` on Linux, or `base64 -i icon.png | tr -d '\n'` on macOS. The line must stay a single line, and the data type must match the image (`image/png` for a PNG). New icons may need a library refresh or a restart to show.

## Updating

Install `LondonBusTimesUpdate.sh` next to `LondonBusTimes.sh` in `documents`. When you want the latest version, close the app and run **London Bus Times - Update** from the library. It downloads the app's web files from this repository, checks them, keeps a backup of the previous version in `/mnt/us/.londonbustimes-backup`, and relaunches the app. If anything fails, nothing is changed. A log is written to `LondonBusTimes-update.log` at the top level of the Kindle (visible over USB).

The update only replaces `index.html`, `script.js`, `style.css` and `config.xml`; it never replaces the two launcher scripts. **Settings > Check for updates** compares the installed version with `version.json` on GitHub and tells you if a newer one is available. Bump `version.json` and `APP_VERSION` in `script.js` together when you publish a release.

To update manually instead, replace the installed items and run the main scriptlet again. If Mesquite still shows an old page, switch to another app and back, or restart the Kindle.

## Layout

```text
documents/
├── LondonBusTimes.sh
├── LondonBusTimesUpdate.sh
└── LondonBusTimes/
    ├── config.xml
    ├── index.html
    ├── script.js
    └── style.css
```
