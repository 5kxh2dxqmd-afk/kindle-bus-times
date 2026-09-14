#!/bin/sh
# Name: London Bus Times
# Author: Local user
# DontUseFBInk

# Illusion Generic launcher. Install this file alongside the LondonBusTimes
# directory in the Kindle's /mnt/us/documents directory.
SOURCE_DIR="/mnt/us/documents/LondonBusTimes"
TARGET_DIR="/var/local/mesquite/LondonBusTimes"
DB="/var/local/appreg.db"
APP_ID="uk.bustimes.london"

if [ ! -d "$SOURCE_DIR" ]; then
    echo "LondonBusTimes folder was not found in documents."
    exit 1
fi

# Mesquite runs from /var/local, so copy the complete local web app there.
if [ -d "$TARGET_DIR" ]; then
    rm -rf "$TARGET_DIR"
fi
cp -r "$SOURCE_DIR" "$TARGET_DIR"

sqlite3 "$DB" <<EOF
INSERT OR IGNORE INTO interfaces(interface) VALUES('application');
INSERT OR IGNORE INTO handlerIds(handlerId) VALUES('$APP_ID');
INSERT OR REPLACE INTO properties(handlerId,name,value)
  VALUES('$APP_ID','lipcId','$APP_ID');
INSERT OR REPLACE INTO properties(handlerId,name,value)
  VALUES('$APP_ID','command','/usr/bin/mesquite -l $APP_ID -c file://$TARGET_DIR/');
INSERT OR REPLACE INTO properties(handlerId,name,value)
  VALUES('$APP_ID','supportedOrientation','U');
EOF

nohup lipc-set-prop com.lab126.appmgrd start app://$APP_ID >/dev/null 2>&1 &
