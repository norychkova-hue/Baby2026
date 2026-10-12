#!/bin/sh
# Запуск «Сонного помощника» с автоперезапуском при сбое.
cd "$(dirname "$0")/.." || exit 1
while true; do
  npm start
  echo "Бот остановился, перезапуск через 10 секунд..."
  sleep 10
done
