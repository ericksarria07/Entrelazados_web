#!/usr/bin/env bash
# ==========================================================================
# RESPALDO DE ENTRELAZADOS: base de datos MySQL + fotos subidas
#
# Crea en la carpeta de respaldos (por defecto ~/respaldos/entrelazados):
#   mysql_AAAA-MM-DD_HHMMSS.sql.gz   copia completa de la base de datos
#   fotos_AAAA-MM-DD_HHMMSS.tar.gz    copia de entrelazados-api/uploads (si existe)
# y borra los respaldos con más de DIAS_RESPALDO días (por defecto 7).
#
# Lee DB_HOST, DB_USER, DB_PASSWORD y DB_NAME del .env de entrelazados-api.
# La contraseña nunca aparece en la línea de comandos (no se ve con "ps").
#
# Uso manual:     bash backend/scripts/respaldo.sh
# Uso diario:     ver backend/scripts/LEEME.md (cron)
#
# Variables opcionales (en el .env o al ejecutar):
#   CARPETA_RESPALDOS   dónde guardar (por defecto ~/respaldos/entrelazados)
#   DIAS_RESPALDO       cuántos días conservar (por defecto 7)
#   UPLOADS_DIR         carpeta de fotos (por defecto entrelazados-api/uploads)
# ==========================================================================
set -euo pipefail
umask 077   # los respaldos contienen datos personales: solo el dueño puede leerlos

DIR_SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIR_API="$(cd "$DIR_SCRIPT/../entrelazados-api" && pwd)"
ARCHIVO_ENV="${ARCHIVO_ENV:-$DIR_API/.env}"

registrar() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
fallar() { registrar "❌ $*"; exit 1; }

# Lee una variable del .env sin ejecutarlo. Si ya existe en el entorno, se respeta.
leer_env() {
    local nombre="$1" valor
    valor="${!nombre:-}"
    if [ -z "$valor" ] && [ -f "$ARCHIVO_ENV" ]; then
        valor="$(grep -E "^[[:space:]]*${nombre}[[:space:]]*=" "$ARCHIVO_ENV" | tail -n 1 | cut -d '=' -f 2- | tr -d '\r')"
        valor="${valor#"${valor%%[![:space:]]*}"}"   # quita espacios al inicio
        valor="${valor%"${valor##*[![:space:]]}"}"   # y al final
        valor="${valor%\"}"; valor="${valor#\"}"     # y comillas
        valor="${valor%\'}"; valor="${valor#\'}"
    fi
    printf '%s' "$valor"
}

DB_HOST="$(leer_env DB_HOST)"
DB_USER="$(leer_env DB_USER)"
DB_PASSWORD="$(leer_env DB_PASSWORD)"
DB_NAME="$(leer_env DB_NAME)"
CARPETA="$(leer_env CARPETA_RESPALDOS)"; CARPETA="${CARPETA:-$HOME/respaldos/entrelazados}"
DIAS="$(leer_env DIAS_RESPALDO)"; DIAS="${DIAS:-7}"
UPLOADS="$(leer_env UPLOADS_DIR)"; UPLOADS="${UPLOADS:-$DIR_API/uploads}"

[ -n "$DB_USER" ] && [ -n "$DB_NAME" ] || fallar "Faltan DB_USER o DB_NAME en $ARCHIVO_ENV"
[[ "$DIAS" =~ ^[0-9]+$ ]] && [ "$DIAS" -ge 1 ] || fallar "DIAS_RESPALDO debe ser un número mayor que 0 (vale \"$DIAS\")"
command -v mysqldump >/dev/null || fallar "No se encontró mysqldump (en Ubuntu: sudo apt install mysql-client)"

mkdir -p "$CARPETA"
FECHA="$(date '+%Y-%m-%d_%H%M%S')"
DESTINO_SQL="$CARPETA/mysql_$FECHA.sql.gz"

# Credenciales en un archivo temporal privado, que se borra al terminar (pase lo que pase)
CREDENCIALES="$(mktemp)"
TEMPORAL_SQL="$DESTINO_SQL.parcial"
trap 'rm -f "$CREDENCIALES" "$TEMPORAL_SQL"' EXIT
printf '[client]\nhost=%s\nuser=%s\npassword="%s"\n' "${DB_HOST:-localhost}" "$DB_USER" "${DB_PASSWORD//\"/\\\"}" > "$CREDENCIALES"

registrar "Respaldando la base \"$DB_NAME\"..."
# --single-transaction: copia consistente sin bloquear la página mientras se respalda
# --no-tablespaces: no requiere el permiso PROCESS (el usuario de la app no lo tiene)
mysqldump --defaults-extra-file="$CREDENCIALES" \
    --single-transaction --quick --no-tablespaces --triggers \
    --default-character-set=utf8mb4 --set-gtid-purged=OFF \
    "$DB_NAME" | gzip -9 > "$TEMPORAL_SQL"

# Comprobaciones: el archivo se puede descomprimir y el volcado terminó completo
gzip -t "$TEMPORAL_SQL" || fallar "El respaldo quedó dañado"
gzip -dc "$TEMPORAL_SQL" | tail -n 1 | grep -q "Dump completed" || fallar "El respaldo quedó incompleto"
mv "$TEMPORAL_SQL" "$DESTINO_SQL"
registrar "✅ Base de datos: $DESTINO_SQL ($(du -h "$DESTINO_SQL" | cut -f1))"

if [ -d "$UPLOADS" ] && [ -n "$(ls -A "$UPLOADS" 2>/dev/null)" ]; then
    DESTINO_FOTOS="$CARPETA/fotos_$FECHA.tar.gz"
    tar -czf "$DESTINO_FOTOS" -C "$(dirname "$UPLOADS")" "$(basename "$UPLOADS")"
    registrar "✅ Fotos: $DESTINO_FOTOS ($(du -h "$DESTINO_FOTOS" | cut -f1))"
else
    registrar "ℹ️ No hay fotos subidas todavía ($UPLOADS)"
fi

# Rotación: se borran los respaldos más antiguos que DIAS
BORRADOS="$(find "$CARPETA" -maxdepth 1 -type f \( -name 'mysql_*.sql.gz' -o -name 'fotos_*.tar.gz' \) -mtime +"$((DIAS - 1))" -print -delete | wc -l)"
registrar "🧹 Respaldos de más de $DIAS días borrados: $BORRADOS"
registrar "📦 Respaldos guardados: $(find "$CARPETA" -maxdepth 1 -type f -name 'mysql_*.sql.gz' | wc -l) de la base, $(du -sh "$CARPETA" | cut -f1) en total"
