#!/usr/bin/env bash
# ==========================================================================
# RESTAURAR UN RESPALDO DE ENTRELAZADOS
#
# Uso:
#   bash backend/scripts/restaurar.sh ~/respaldos/entrelazados/mysql_2026-11-02_030000.sql.gz
#   bash backend/scripts/restaurar.sh ~/respaldos/entrelazados/fotos_2026-11-02_030000.tar.gz
#
# ⚠️ Reemplaza los datos actuales por los del respaldo. Antes de restaurar se
#    hace automáticamente un respaldo de lo que hay ahora, por si acaso.
# ==========================================================================
set -euo pipefail

DIR_SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIR_API="$(cd "$DIR_SCRIPT/../entrelazados-api" && pwd)"
ARCHIVO_ENV="${ARCHIVO_ENV:-$DIR_API/.env}"
ARCHIVO="${1:-}"

registrar() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
fallar() { registrar "❌ $*"; exit 1; }

leer_env() {
    local nombre="$1" valor
    valor="${!nombre:-}"
    if [ -z "$valor" ] && [ -f "$ARCHIVO_ENV" ]; then
        valor="$(grep -E "^[[:space:]]*${nombre}[[:space:]]*=" "$ARCHIVO_ENV" | tail -n 1 | cut -d '=' -f 2- | tr -d '\r')"
        valor="${valor#"${valor%%[![:space:]]*}"}"
        valor="${valor%"${valor##*[![:space:]]}"}"
        valor="${valor%\"}"; valor="${valor#\"}"
        valor="${valor%\'}"; valor="${valor#\'}"
    fi
    printf '%s' "$valor"
}

[ -n "$ARCHIVO" ] && [ -f "$ARCHIVO" ] || fallar "Indica un archivo de respaldo existente. Ejemplo: bash $0 ~/respaldos/entrelazados/mysql_AAAA-MM-DD_HHMMSS.sql.gz"
gzip -t "$ARCHIVO" || fallar "El archivo está dañado: $ARCHIVO"

# Se trabaja sobre una copia: el respaldo de seguridad previo (y su limpieza de
# archivos viejos) nunca puede tocar el archivo que se está restaurando
COPIA="$(mktemp -d)"
trap 'rm -rf "$COPIA"' EXIT
cp "$ARCHIVO" "$COPIA/"
NOMBRE="$(basename "$ARCHIVO")"
ARCHIVO="$COPIA/$NOMBRE"

confirmar() {
    if [ "${CONFIRMAR:-}" = "si" ]; then return 0; fi   # para usarlo sin preguntar
    read -r -p "$1 Escribe SI para continuar: " respuesta
    [ "$respuesta" = "SI" ] || fallar "Cancelado, no se cambió nada."
}

case "$NOMBRE" in
    mysql_*.sql.gz)
        DB_HOST="$(leer_env DB_HOST)"; DB_USER="$(leer_env DB_USER)"
        DB_PASSWORD="$(leer_env DB_PASSWORD)"; DB_NAME="$(leer_env DB_NAME)"
        [ -n "$DB_USER" ] && [ -n "$DB_NAME" ] || fallar "Faltan DB_USER o DB_NAME en $ARCHIVO_ENV"
        command -v mysql >/dev/null || fallar "No se encontró el cliente mysql"

        confirmar "Se reemplazará TODA la base \"$DB_NAME\" por el respaldo $NOMBRE."
        registrar "Respaldo de seguridad del estado actual antes de restaurar..."
        bash "$DIR_SCRIPT/respaldo.sh"

        CREDENCIALES="$COPIA/credenciales.cnf"
        (umask 077; : > "$CREDENCIALES")
        printf '[client]\nhost=%s\nuser=%s\npassword="%s"\n' "${DB_HOST:-localhost}" "$DB_USER" "${DB_PASSWORD//\"/\\\"}" > "$CREDENCIALES"

        registrar "Restaurando \"$DB_NAME\"..."
        gzip -dc "$ARCHIVO" | mysql --defaults-extra-file="$CREDENCIALES" --default-character-set=utf8mb4 "$DB_NAME"
        registrar "✅ Base de datos restaurada. Reinicia la app: pm2 restart 0"
        ;;
    fotos_*.tar.gz)
        UPLOADS="$(leer_env UPLOADS_DIR)"; UPLOADS="${UPLOADS:-$DIR_API/uploads}"
        confirmar "Se reemplazará la carpeta de fotos $UPLOADS por la del respaldo."
        if [ -d "$UPLOADS" ]; then
            ANTERIOR="${UPLOADS}_antes_de_restaurar_$(date '+%Y%m%d%H%M%S')"
            mv "$UPLOADS" "$ANTERIOR"
            registrar "La carpeta actual se guardó como $ANTERIOR"
        fi
        mkdir -p "$(dirname "$UPLOADS")"
        mkdir "$COPIA/extraido"
        tar -xzf "$ARCHIVO" -C "$COPIA/extraido"
        mv "$COPIA/extraido"/* "$UPLOADS"
        registrar "✅ Fotos restauradas en $UPLOADS"
        ;;
    *)
        fallar "No reconozco el archivo: debe llamarse mysql_*.sql.gz o fotos_*.tar.gz"
        ;;
esac
