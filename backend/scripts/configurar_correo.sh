#!/usr/bin/env bash
# ==========================================================================
# CONFIGURA EL CORREO DE ENTRELAZADOS (Gmail) Y LO PRUEBA
#
# Pregunta la cuenta, la "contraseña de aplicación" y la dirección pública del
# sitio, las guarda en entrelazados-api/.env (EMAIL_USER, EMAIL_PASS, APP_URL)
# y envía un correo de prueba. La contraseña no se muestra en pantalla ni
# queda en el historial de la terminal.
#
# Antes: crea la contraseña de aplicación en https://myaccount.google.com/apppasswords
# (la cuenta de Gmail necesita la verificación en 2 pasos activada).
#
# Uso (en la VM, desde la carpeta del proyecto):
#   bash backend/scripts/configurar_correo.sh
#   bash backend/scripts/configurar_correo.sh --sin-probar   (solo guarda)
# Después: pm2 restart 0 --update-env
# ==========================================================================
set -euo pipefail
umask 077

DIR_SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIR_API="$(cd "$DIR_SCRIPT/../entrelazados-api" && pwd)"
ARCHIVO_ENV="${ARCHIVO_ENV:-$DIR_API/.env}"
URL_POR_DEFECTO="${URL_POR_DEFECTO:-http://57.156.69.249:3000}"
REGEX_CORREO='^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$'

[ -f "$ARCHIVO_ENV" ] || { echo "❌ No existe $ARCHIVO_ENV"; exit 1; }

read -rp "Cuenta de Gmail que enviará los correos: " usuario
[[ "$usuario" =~ $REGEX_CORREO ]] || { echo "❌ \"$usuario\" no es un correo válido."; exit 1; }

read -rsp "Contraseña de aplicación de Google (16 letras, no se mostrará): " clave
echo
clave="${clave// /}"
[ ${#clave} -eq 16 ] || { echo "❌ La contraseña de aplicación tiene 16 letras (sin contar espacios). Recibí ${#clave}."; exit 1; }

read -rp "Dirección pública del sitio [$URL_POR_DEFECTO]: " url
url="${url:-$URL_POR_DEFECTO}"
url="${url%/}"
[[ "$url" =~ ^https?://[^[:space:]]+$ ]] || { echo "❌ La dirección debe empezar con http:// o https://"; exit 1; }

# Copia del .env antes de tocarlo
copia="$ARCHIVO_ENV.respaldo-$(date +%Y%m%d-%H%M%S)"
cp "$ARCHIVO_ENV" "$copia"
chmod 600 "$copia"

# Cambia (o agrega) NOMBRE=valor. El valor viaja por el entorno: awk no interpreta sus caracteres.
poner_variable() {
    local nombre="$1"
    VALOR="$2" NOMBRE="$nombre" awk '
        BEGIN { hecho = 0 }
        index($0, ENVIRON["NOMBRE"] "=") == 1 { if (!hecho) print ENVIRON["NOMBRE"] "=" ENVIRON["VALOR"]; hecho = 1; next }
        { print }
        END { if (!hecho) print ENVIRON["NOMBRE"] "=" ENVIRON["VALOR"] }
    ' "$ARCHIVO_ENV" > "$ARCHIVO_ENV.nuevo"
    mv "$ARCHIVO_ENV.nuevo" "$ARCHIVO_ENV"
}
poner_variable EMAIL_USER "$usuario"
poner_variable EMAIL_PASS "$clave"
poner_variable APP_URL "$url"
chmod 600 "$ARCHIVO_ENV"
unset clave

echo "✅ Guardado en $ARCHIVO_ENV (copia anterior: $copia)"

if [ "${1:-}" = "--sin-probar" ]; then
    echo "   Reinicia el servidor para usarlo: pm2 restart 0 --update-env"
    exit 0
fi

read -rp "¿A qué correo enviamos una prueba? [$usuario]: " destino
destino="${destino:-$usuario}"
cd "$DIR_API"
if node correo.js "$destino"; then
    echo
    echo "✅ Si el correo llegó (revisa también Spam), reinicia el servidor:"
    echo "   pm2 restart 0 --update-env"
    echo "   En el log debe aparecer: \"Correo listo\" y \"Las cuentas nuevas deben confirmar su correo\"."
else
    echo
    echo "❌ La prueba falló (arriba está el motivo). Corrige y vuelve a ejecutar este script."
    echo "   Para volver al .env anterior: cp \"$copia\" \"$ARCHIVO_ENV\""
    exit 1
fi
