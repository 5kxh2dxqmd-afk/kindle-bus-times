# London Bus Times for Kindle Illusion

This is a scriptlet-invoked Illusion application that shows live arrivals from TfL's public, anonymous API. It makes no request for, and contains no, TfL app key or personal data. Once a stop is configured, it refreshes its arrivals in-place; **Refresh now** is available for an immediate update.

## Install

1. Copy both `LondonBusTimes.sh` and the complete `LondonBusTimes/` folder to the top level of the Kindle's `documents` directory.
2. Eject the Kindle, then run **London Bus Times** from its library. The scriptlet copies the app to Mesquite, registers `uk.bustimes.london`, and launches it.
3. Connect Wi-Fi. Search by bus-stop name or 5-digit Countdown code, or enter a TfL NaPTAN bus-stop ID (for example, `490008660N`) and tap **Show stop**. The selected ID is remembered by the Kindle.

The app resolves every search candidate before saving it. If TfL returns a **stop group**, it displays its individual boarding stops and their directions; it never uses the group ID for arrivals. A stop ID refers to one side of a road, so choose the stop in the direction you want to travel.

Tap **Settings** at the bottom of the arrivals board to choose a saved refresh interval of 30 seconds, 1, 2, 5, or 10 minutes. Short intervals are more current but use more Wi-Fi and battery.

To update the app, replace both installed items and run the scriptlet again. If Mesquite still shows an old page, switch to another app and back, or restart the Kindle.

## Layout

```text
documents/
├── LondonBusTimes.sh
└── LondonBusTimes/
    ├── config.xml
    ├── index.html
    ├── script.js
    └── style.css
```
