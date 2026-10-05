#!/bin/sh
# Name: London Bus Times - Update
# Author: Local user
# DontUseFBInk

# Downloads the latest London Bus Times web files from GitHub, then relaunches
# the app. Only the web files are replaced; the two launcher scripts are not.
# A log is written to /mnt/us/LondonBusTimes-update.log (visible over USB).
# The paths and repo URL can be overridden with environment variables for testing.

REPO_RAW="${REPO_RAW:-https://raw.githubusercontent.com/5kxh2dxqmd-afk/kindle-bus-times/master}"
DOCS="${DOCS:-/mnt/us/documents}"
APP_DIR="$DOCS/LondonBusTimes"
LAUNCHER="$DOCS/LondonBusTimes.sh"
WORK="${WORK:-/tmp/londonbustimes-update}"
BACKUP="${BACKUP:-/mnt/us/.londonbustimes-backup}"
LOG="${LOG:-/mnt/us/LondonBusTimes-update.log}"
FILES="index.html script.js style.css config.xml"

log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOG"
}

fetch() {
    # fetch URL DEST
    if command -v curl >/dev/null 2>&1; then
        curl -fsSL --connect-timeout 10 --max-time 40 -o "$2" "$1"
    elif command -v wget >/dev/null 2>&1; then
        wget -q -T 30 -O "$2" "$1"
    else
        return 127
    fi
}

valid() {
    # valid FILE PATTERN: non-trivial size and contains the expected marker
    [ -s "$1" ] && [ "$(wc -c < "$1")" -gt 100 ] && grep -q "$2" "$1"
}

: > "$LOG"
log "Update started"

if command -v curl >/dev/null 2>&1; then
    log "Using curl"
elif command -v wget >/dev/null 2>&1; then
    log "Using wget"
else
    log "Neither curl nor wget was found on this Kindle. Nothing was changed."
    exit 1
fi

rm -rf "$WORK"
mkdir -p "$WORK/LondonBusTimes" || { log "Could not create $WORK. Nothing was changed."; exit 1; }

for f in $FILES; do
    log "Downloading $f"
    if ! fetch "$REPO_RAW/LondonBusTimes/$f" "$WORK/LondonBusTimes/$f"; then
        log "FAILED to download $f (offline, or HTTPS not supported). Nothing was changed."
        rm -rf "$WORK"
        exit 1
    fi
done

fetch "$REPO_RAW/version.json" "$WORK/version.json" >/dev/null 2>&1
NEW_VERSION="$(grep -o '"version"[^,}]*' "$WORK/version.json" 2>/dev/null | head -n 1)"
log "Latest on GitHub: ${NEW_VERSION:-unknown version}"

if ! valid "$WORK/LondonBusTimes/index.html" "</html>" ||
   ! valid "$WORK/LondonBusTimes/script.js" "londonBusTimes" ||
   ! valid "$WORK/LondonBusTimes/style.css" "{" ||
   ! valid "$WORK/LondonBusTimes/config.xml" "<widget"; then
    log "Downloaded files failed the sanity checks. Nothing was changed."
    rm -rf "$WORK"
    exit 1
fi

mkdir -p "$APP_DIR"
rm -rf "$BACKUP"
mkdir -p "$BACKUP"
cp "$APP_DIR"/* "$BACKUP"/ 2>/dev/null
log "Previous version backed up to $BACKUP"

for f in $FILES; do
    if ! cp "$WORK/LondonBusTimes/$f" "$APP_DIR/$f"; then
        log "Could not write $f. Restoring the backup."
        cp "$BACKUP"/* "$APP_DIR"/
        rm -rf "$WORK"
        exit 1
    fi
done

rm -rf "$WORK"
log "Update installed"

if [ -f "$LAUNCHER" ]; then
    log "Relaunching London Bus Times"
    sh "$LAUNCHER" >> "$LOG" 2>&1
else
    log "LondonBusTimes.sh was not found in documents; run London Bus Times manually."
fi
