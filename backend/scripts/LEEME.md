# Scripts de la VM de EntreLazados

| Script | Qué hace |
|---|---|
| `respaldo.sh` | Copia la base de datos (`mysql_….sql.gz`) y las fotos subidas (`fotos_….tar.gz`). Borra los respaldos con más de 7 días. |
| `restaurar.sh` | Vuelve a cargar un respaldo. Antes hace un respaldo del estado actual, por si acaso. |
| `instalar_cron.sh` | Programa `respaldo.sh` todos los días a las 3:00 a. m. de Nicaragua. Se puede ejecutar varias veces. |
| `configurar_correo.sh` | Guarda `EMAIL_USER`, `EMAIL_PASS` y `APP_URL` en el `.env` y envía un correo de prueba. |
| `probar_gemini.js` | Comprueba que la clave de Gemini (Kan) funciona, sin mostrarla. |

Los scripts leen el `.env` de `entrelazados-api`. Las contraseñas nunca aparecen en la línea de comandos.

---

## Actualizar a la versión 11

La versión 11 reorganiza el código (no cambia la base de datos ni el `.env`). Si la VM todavía no
tiene la versión 10, haz primero la lista de abajo.

```bash
cd ~/entrelazados
git pull origin main
pm2 restart 0 --update-env
pm2 logs 0 --lines 20
```

Deben aparecer los mismos mensajes de siempre (`Pool de conexiones MySQL`, `Cierre automático de
subastas activo`, `Servidor Backend ejecutándose en el puerto 3000`). PM2 sigue arrancando
`entrelazados-api/index.js`, así que no hay que cambiar su configuración.

Para probar el correo ahora se usa `node servicios/correo.js destino@gmail.com` (desde
`backend/entrelazados-api`) o `npm run probar:correo -- destino@gmail.com` (desde `backend/`).

---

## Actualizar a la versión 10

Todo se ejecuta en la VM (`ssh ericksv07@57.156.69.249`), desde `~/entrelazados`.

**1. Respaldo antes de empezar**

```bash
cd ~/entrelazados
bash backend/scripts/respaldo.sh
```

**2. Traer el código nuevo**

```bash
git pull origin main
cd backend && npm install && cd ..
```

**3. Aplicar la migración v10** (se puede repetir sin daño)

```bash
sudo mysql entrelazadosdb < backend/sql/migracion_v10.sql
```

Al final lista las cuentas con un correo inválido (por ejemplo `erick@gmail`, sin `.com`). Esas personas no pueden iniciar sesión hasta que el administrador corrija su correo (paso 8).

**4. Configurar el correo** (ver [Correo](#correo))

```bash
bash backend/scripts/configurar_correo.sh
```

**5. Cambiar la clave de Gemini** (ver [Clave de Gemini](#clave-de-gemini))

**6. Reiniciar y revisar**

```bash
pm2 restart 0 --update-env
pm2 logs 0 --lines 30
```

Deben aparecer `Correo listo`, `Las cuentas nuevas deben confirmar su correo` y `Cierre automático de subastas activo`.

**7. Programar el respaldo diario**

```bash
bash backend/scripts/instalar_cron.sh --probar
```

**8. Corregir los correos inválidos.** En el panel de administrador aparece un aviso: marca *"Solo cuentas con problemas de correo"* y usa el botón del sobre para escribir el correo correcto (confírmalo antes con la persona).

**9. Limpiar archivos viejos con datos sensibles** (ver [Limpieza](#limpieza)).

**10. En GitHub**, aprueba y mezcla el Pull Request de `main` a `master` para que las dos ramas queden iguales.

---

## Respaldos

### Probarlo a mano

```bash
bash backend/scripts/respaldo.sh
ls -lh ~/respaldos/entrelazados
```

Debe mostrar algo como:

```
[2026-11-03 03:00:01] ✅ Base de datos: /home/ericksv07/respaldos/entrelazados/mysql_2026-11-03_030001.sql.gz (48K)
[2026-11-03 03:00:01] ✅ Fotos: /home/ericksv07/respaldos/entrelazados/fotos_2026-11-03_030001.tar.gz (2.1M)
```

Si dice `No se encontró mysqldump`, instálalo con `sudo apt install mysql-client`.

### Programarlo todos los días

```bash
bash backend/scripts/instalar_cron.sh            # instala (o actualiza) la tarea diaria
bash backend/scripts/instalar_cron.sh --probar   # además hace un respaldo ahora mismo
bash backend/scripts/instalar_cron.sh --quitar   # la desinstala
crontab -l                                       # ver lo que quedó programado
```

Calcula la hora según la zona horaria de la VM (las 3:00 de Nicaragua son las 9:00 en UTC). Para otra hora: `HORA_RESPALDO=1 bash backend/scripts/instalar_cron.sh`.

Revisa que funcione al día siguiente:

```bash
tail -n 20 ~/respaldos/respaldo.log
```

### Restaurar

```bash
ls ~/respaldos/entrelazados                     # elige el respaldo
bash backend/scripts/restaurar.sh ~/respaldos/entrelazados/mysql_2026-11-03_030001.sql.gz
bash backend/scripts/restaurar.sh ~/respaldos/entrelazados/fotos_2026-11-03_030001.tar.gz
pm2 restart 0
```

Pide escribir `SI` antes de reemplazar nada.

### Copia fuera de la VM (recomendado)

Si se pierde la VM, se pierden también sus respaldos. Cada cierto tiempo descarga el más reciente a tu computadora, desde PowerShell:

```powershell
scp ericksv07@57.156.69.249:~/respaldos/entrelazados/mysql_*.sql.gz "$HOME\Documents\respaldos_entrelazados\"
```

⚠️ Los respaldos contienen datos personales y contraseñas cifradas: guárdalos en un lugar privado, nunca en GitHub.

---

## Correo

Sin correo no funcionan la recuperación de contraseña, la confirmación del correo al registrarse ni los avisos de subastas y tratos (los enlaces solo quedan en `pm2 logs`).

1. En la cuenta de Gmail que enviará los correos, activa la **verificación en 2 pasos**.
2. Crea una **contraseña de aplicación** en https://myaccount.google.com/apppasswords (16 letras).
3. En la VM:

   ```bash
   bash backend/scripts/configurar_correo.sh
   ```

   Pregunta la cuenta, la contraseña de aplicación (no se ve al escribirla) y la dirección del sitio (`http://57.156.69.249:3000`), guarda una copia del `.env` anterior y envía un correo de prueba.
4. Si la prueba llegó: `pm2 restart 0 --update-env`.

Con el correo configurado, las **cuentas nuevas deben confirmar su correo** antes de entrar. Para desactivarlo, agrega `VERIFICAR_CORREO=0` al `.env` y reinicia. Si a alguien no le llega el enlace, el administrador puede darlo por confirmado desde el panel.

---

## Clave de Gemini

La clave anterior quedó publicada en el historial de GitHub (dentro de un `.zip` viejo), así que hay que reemplazarla:

1. Entra a https://aistudio.google.com/apikey y crea una clave nueva.
2. En la VM, abre el `.env` y cambia la línea `GEMINI_API_KEY=` por la clave nueva:

   ```bash
   nano backend/entrelazados-api/.env      # Ctrl+O para guardar, Ctrl+X para salir
   ```

3. Comprueba que funciona:

   ```bash
   node backend/scripts/probar_gemini.js
   ```

4. Reinicia: `pm2 restart 0 --update-env`.
5. **Vuelve a AI Studio y borra la clave vieja.** Desde ese momento, la que quedó en el historial ya no sirve para nada.

Si el modelo dejara de existir, cambia `GEMINI_MODELO` en el `.env` (por defecto `gemini-3.8-flash`) y vuelve a probar.

> Borrar la clave vieja del historial de git (`git filter-repo`) es opcional una vez que está desactivada: reescribe todos los commits y obliga a forzar el push.

---

## Limpieza

Archivos que quedaron en la VM de despliegues anteriores y contienen contraseñas o datos personales:

```bash
ls -l ~/env_vm_respaldo ~/entrelazadosdb_respaldo.sql ~/antes_de_v9.sql
shred -u ~/env_vm_respaldo                 # copia vieja del .env (tiene contraseñas)
rm ~/entrelazadosdb_respaldo.sql           # respaldo manual viejo de la base
rm ~/antes_de_v9.sql                       # cuando la versión 10 lleve unos días funcionando bien
```

Los respaldos automáticos de `~/respaldos/entrelazados` los reemplazan.

---

## Opciones (en el `.env`)

| Variable | Por defecto | Para qué |
|---|---|---|
| `CARPETA_RESPALDOS` | `~/respaldos/entrelazados` | Dónde se guardan los respaldos |
| `DIAS_RESPALDO` | `7` | Cuántos días se conservan |
| `UPLOADS_DIR` | `entrelazados-api/uploads` | Carpeta de las fotos |
| `VERIFICAR_CORREO` | según el correo | `1` exige confirmar el correo, `0` no lo exige |
| `GEMINI_MODELO` | `gemini-3.8-flash` | Modelo de Gemini que usa Kan |
