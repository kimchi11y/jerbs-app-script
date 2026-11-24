#!/bin/sh
# Installs or removes a macOS launchd job that runs the scraper at set hours.
# If the Mac is asleep at a scheduled time, launchd runs it once on wake.
#
#   sh scripts/schedule.sh install                     # 08:00, 12:00, 16:00, 20:00
#   SCRAPE_HOURS="9 18" sh scripts/schedule.sh install # custom hours
#   sh scripts/schedule.sh remove
set -eu

LABEL=com.jerbmatcher.scraper
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
HOURS="${SCRAPE_HOURS:-8 12 16 20}"
DOMAIN="gui/$(id -u)"

case "${1:-}" in
install)
  NODE="$(command -v node)" || { echo "node not found on PATH"; exit 1; }
  mkdir -p "$DIR/logs" "$HOME/Library/LaunchAgents"
  {
    cat <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>--env-file-if-exists=.env</string>
    <string>src/index.js</string>
  </array>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>StandardOutPath</key><string>$DIR/logs/scrape.log</string>
  <key>StandardErrorPath</key><string>$DIR/logs/scrape.log</string>
  <key>StartCalendarInterval</key>
  <array>
EOF
    for h in $HOURS; do
      echo "    <dict><key>Hour</key><integer>$h</integer><key>Minute</key><integer>0</integer></dict>"
    done
    cat <<EOF
  </array>
</dict>
</plist>
EOF
  } > "$PLIST"
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  launchctl bootstrap "$DOMAIN" "$PLIST"
  echo "Scheduled at hours: $HOURS. Log: $DIR/logs/scrape.log"
  echo "Run it now with: launchctl kickstart $DOMAIN/$LABEL"
  ;;
remove)
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo "Schedule removed."
  ;;
*)
  echo "usage: sh scripts/schedule.sh install|remove"
  exit 1
  ;;
esac
