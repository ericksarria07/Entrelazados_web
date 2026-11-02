#!/usr/bin/env bash
# ==========================================================================
# PROGRAMA EL RESPALDO DIARIO (cron) de respaldo.sh
#
# Agrega al crontab del usuario una línea que ejecuta respaldo.sh todos los
# días a las 3:00 a. m. hora de Nicaragua (calcula la hora según la zona
# horaria de la VM). Se puede ejecutar varias veces: no duplica la línea.
#
# Uso (en la VM, desde la carpeta del proyecto):
#   bash backend/scripts/instalar_cron.sh            instala o actualiza
#   bash backend/scripts/instalar_cron.sh --probar   además hace un respaldo ahora
#   bash backend/scripts/instalar_cron.sh --quitar   lo desinstala
#
# Variables opcionales:
#   HORA_RESPALDO   hora de Nicaragua (0-23) a la que se respalda (por defecto 3)
#   CARPETA_LOG     dónde queda respaldo.log (por defecto ~/respaldos)
# ==========================================================================
set -euo pipefail

DIR_SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESPALDO="$DIR_SCRIPT/respaldo.sh"
MARCA="# entrelazados-respaldo"
CARPETA_LOG="${CARPETA_LOG:-$HOME/respaldos}"
HORA_NICARAGUA="${HORA_RESPALDO:-3}"

if ! command -v crontab >/dev/null 2>&1; then
    echo "❌ No está instalado cron. En Ubuntu: sudo apt install cron"
    exit 1
fi
if ! [[ "$HORA_NICARAGUA" =~ ^([0-9]|1[0-9]|2[0-3])$ ]]; then
    echo "❌ HORA_RESPALDO debe ser una hora de 0 a 23."
    exit 1
fi

# Crontab actual sin la línea de EntreLazados (si ya estaba)
actual="$(crontab -l 2>/dev/null | grep -v -F "$MARCA" || true)"

if [ "${1:-}" = "--quitar" ]; then
    if [ -n "$actual" ]; then printf '%s\n' "$actual" | crontab -; else crontab -r 2>/dev/null || true; fi
    echo "✅ Respaldo diario desinstalado."
    exit 0
fi

[ -f "$RESPALDO" ] || { echo "❌ No se encontró $RESPALDO"; exit 1; }

# Nicaragua está en UTC-6 todo el año. "date +%z" da la zona de la VM, p. ej. +0000 o -0600.
desfase="$(date +%z)"
signo="${desfase:0:1}"
horas_vm=$((10#${desfase:1:2}))
[ "$signo" = "-" ] && horas_vm=$((-horas_vm))
hora_vm=$(( ( (HORA_NICARAGUA + 6 + horas_vm) % 24 + 24 ) % 24 ))

mkdir -p "$CARPETA_LOG"
linea="0 $hora_vm * * * /bin/bash $RESPALDO >> $CARPETA_LOG/respaldo.log 2>&1 $MARCA"
{ [ -n "$actual" ] && printf '%s\n' "$actual"; printf '%s\n' "$linea"; } | crontab -

echo "✅ Respaldo diario programado a las $HORA_NICARAGUA:00 de Nicaragua ($hora_vm:00 en la hora de la VM, zona $desfase)."
echo "   Línea en el crontab: $linea"
echo "   Revisa el resultado mañana con: tail -n 20 $CARPETA_LOG/respaldo.log"

if [ "${1:-}" = "--probar" ]; then
    echo
    echo "Haciendo un respaldo de prueba ahora..."
    /bin/bash "$RESPALDO"
fi
