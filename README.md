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
- **Live bus strip.** Tap **Track** on a bus to see it on a straight line of stops, tagged with its route number, with the distance to your stop.

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
