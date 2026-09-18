#!/bin/bash
# Двойной клик по этому файлу запускает прототип Pot в браузере.
# Закрыть — Ctrl+C в этом окне или просто закрыть окно Терминала.

cd "$(dirname "$0")" || exit 1

export PATH="$HOME/.local/node/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

if ! command -v node >/dev/null 2>&1; then
  echo "❌ Node.js не найден."
  echo "   Он должен лежать в ~/.local/node/bin — проверь, на месте ли папка."
  echo
  read -r -p "Нажми Enter, чтобы закрыть."
  exit 1
fi

PORT=6420
URL="http://localhost:$PORT"
LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)"

# Сервер уже запущен (например, из прошлого окна) — просто открываем браузер.
if lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "🪴 Прототип уже запущен — открываю $URL"
  open "$URL"
  sleep 2
  exit 0
fi

echo "🪴 Запускаю прототип Pot на $URL"
if [ -n "$LAN_IP" ]; then
  echo
  echo "   📱 С телефона (та же Wi-Fi сеть):  http://$LAN_IP:$PORT"
fi
echo
echo "   Браузер откроется сам."
echo "   Чтобы остановить — нажми Ctrl+C или закрой это окно."
echo

( sleep 1; open "$URL" ) &

node serve.mjs "$PORT"
