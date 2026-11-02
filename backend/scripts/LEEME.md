# Respaldos de EntreLazados

Dos scripts para la VM (Ubuntu):

| Script | Qué hace |
|---|---|
| `respaldo.sh` | Copia la base de datos (`mysql_….sql.gz`) y las fotos subidas (`fotos_….tar.gz`). Borra los respaldos con más de 7 días. |
| `restaurar.sh` | Vuelve a cargar un respaldo. Antes hace un respaldo del estado actual, por si acaso. |

Los dos leen `DB_HOST`, `DB_USER`, `DB_PASSWORD` y `DB_NAME` del `.env` de `entrelazados-api`. La contraseña nunca aparece en la línea de comandos.

## 1. Probarlo a mano (una vez)

```bash
cd ~/entrelazados
bash backend/scripts/respaldo.sh
ls -lh ~/respaldos/entrelazados
```

Debe mostrar algo como:

```
[2026-11-03 03:00:01] ✅ Base de datos: /home/ericksv07/respaldos/entrelazados/mysql_2026-11-03_030001.sql.gz (48K)
[2026-11-03 03:00:01] ✅ Fotos: /home/ericksv07/respaldos/entrelazados/fotos_2026-11-03_030001.tar.gz (2.1M)
```

Si dice `No se encontró mysqldump`, instálalo con `sudo apt install mysql-client`.

## 2. Programarlo todos los días (cron)

```bash
crontab -e
```

Agrega esta línea al final (todos los días a las 03:00, hora de Nicaragua, si la VM está en UTC):

```
0 9 * * * /bin/bash /home/ericksv07/entrelazados/backend/scripts/respaldo.sh >> /home/ericksv07/respaldos/respaldo.log 2>&1
```

Para ver la zona horaria de la VM: `timedatectl`. Si ya está en `America/Managua`, usa `0 3 * * *`.

Revisa que funcione al día siguiente:

```bash
tail -n 20 ~/respaldos/respaldo.log
```

## 3. Restaurar

```bash
ls ~/respaldos/entrelazados                     # elige el respaldo
bash backend/scripts/restaurar.sh ~/respaldos/entrelazados/mysql_2026-11-03_030001.sql.gz
bash backend/scripts/restaurar.sh ~/respaldos/entrelazados/fotos_2026-11-03_030001.tar.gz
pm2 restart 0
```

Pide escribir `SI` antes de reemplazar nada.

## 4. Copia fuera de la VM (recomendado)

Si se pierde la VM, se pierden también sus respaldos. Cada cierto tiempo descarga el más reciente a tu computadora, desde PowerShell:

```powershell
scp ericksv07@57.156.69.249:~/respaldos/entrelazados/mysql_*.sql.gz "$HOME\Documents\respaldos_entrelazados\"
```

⚠️ Los respaldos contienen datos personales y contraseñas cifradas: guárdalos en un lugar privado, nunca en GitHub.

## Opciones (en el `.env`)

| Variable | Por defecto | Para qué |
|---|---|---|
| `CARPETA_RESPALDOS` | `~/respaldos/entrelazados` | Dónde se guardan |
| `DIAS_RESPALDO` | `7` | Cuántos días se conservan |
| `UPLOADS_DIR` | `entrelazados-api/uploads` | Carpeta de las fotos |
