#!/bin/bash
# ApexShift Pro - startet einen oeffentlichen HTTPS-Tunnel (Cloudflare Quick Tunnel)
# und veroeffentlicht die Adresse als server.json auf GitHub Pages (Branch gh-pages).
PAGES=/home/noel/apexshift-pages
LOG=/tmp/cloudflared.log

[ -d "$PAGES/.git" ] || git clone -q -b gh-pages git@github.com:noel190427-oss/apexshift-pro.git "$PAGES"
git -C "$PAGES" config user.name "ApexShift Pi"
git -C "$PAGES" config user.email "pi@apexshift.local"

: > "$LOG"
/home/noel/cloudflared tunnel --no-autoupdate --url http://localhost:5305 > "$LOG" 2>&1 &
CF=$!

URL=""
for i in $(seq 1 90); do
  URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$LOG" | head -1)
  [ -n "$URL" ] && break
  sleep 1
done

if [ -n "$URL" ]; then
  PUB=$(curl -s --max-time 10 https://api.ipify.org)
  cd "$PAGES" || exit 1
  git pull -q --rebase origin gh-pages
  printf '{"url":"%s","publicIp":"%s","udpPort":5300}\n' "$URL" "$PUB" > server.json
  git add server.json
  git commit -qm "Update server address" && git push -q origin gh-pages
  echo "Veroeffentlicht: $URL"
fi

wait $CF
