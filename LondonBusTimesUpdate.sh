#!/bin/sh
# Name: London Bus Times - Update
# Author: Local user
# Icon: data:image/png;base64,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
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
