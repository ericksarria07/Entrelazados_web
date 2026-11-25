// POST /api/login: guarda la sesión (JWT de 8 h) en la cookie httpOnly "sesion" y devuelve
// los datos que guarda la página (id, nombre, rol...) y cuándo vence. El token ya no va en el
// cuerpo: JavaScript de la página no puede leerlo (ROADMAP 2.1).
// Solo los intentos fallidos gastan el límite de LIMITE_LOGIN.
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { after } from "next/server";
import { rondasBcrypt } from "@/lib/config";
import { esHashBcrypt } from "@/lib/cuentas";
import { obtenerPool } from "@/lib/db";
import { ErrorHttp, json, leerCuerpo, ruta } from "@/lib/http";
import { ipDe, limite } from "@/lib/limites";
import { COOKIE_SESION, fechasDelToken, firmarToken, opcionesCookieSesion } from "@/lib/sesion";
import { REGEX_EMAIL, textoLimpio } from "@/lib/utilidades";

export const POST = ruta(async (req) => {
  const intentos = limite("login", ipDe(req));
  await intentos.comprobar();
  try {
    return await iniciarSesion(req);
  } catch (err) {
    await intentos.sumarFallo();
    throw err;
  }
});

let hashFalso: Promise<string> | undefined;
const hashDeMentira = () => (hashFalso ??= bcrypt.hash("cuenta-que-no-existe", rondasBcrypt));

async function iniciarSesion(req: Request) {
  const b = await leerCuerpo(req);
  const emailLimpio = textoLimpio(b.email);
  const passIngresada = b.password || b.contrasena;

  if (!emailLimpio || !REGEX_EMAIL.test(emailLimpio)) throw new ErrorHttp(400, "Ingresa un correo electrónico válido.");
  if (!passIngresada) throw new ErrorHttp(400, "Ingresa tu contraseña.");

  const pool = obtenerPool();
  const {
    rows: [usuario],
  } = await pool.query(
    `SELECT u.usuario_id, u.contrasena_hash, u.tipo_rol, u.estado_cuenta, u.correo_verificado, u.version_sesion,
            p.nombre_razon_social, d.nombre_departamento
     FROM usuarios u
     LEFT JOIN perfiles_usuarios p ON u.usuario_id = p.usuario_id
     LEFT JOIN departamentos d ON p.departamento_id = d.departamento_id
     WHERE u.correo_electronico = $1`,
    [emailLimpio]
  );

  const incorrecto = new ErrorHttp(401, "Correo o contraseña incorrectos.");
  if (!usuario) {
    // Se compara igual contra un hash de mentira: así la respuesta tarda lo mismo exista o
    // no la cuenta, y medir el tiempo no revela qué correos están registrados
    await bcrypt.compare(String(passIngresada), await hashDeMentira());
    throw incorrecto;
  }

  const hashGuardado: string = usuario.contrasena_hash || "";
  const cifrada = esHashBcrypt(hashGuardado);
  // Compatibilidad: las cuentas antiguas tienen la contraseña en texto plano.
  // Si coincide, se cifra con bcrypt en ese momento (migración automática).
  const coincide = cifrada
    ? await bcrypt.compare(String(passIngresada), hashGuardado)
    : hashGuardado === String(passIngresada);
  if (!coincide) throw incorrecto;

  if ((usuario.estado_cuenta || "").toLowerCase() === "suspendido") {
    throw new ErrorHttp(403, "Tu cuenta ha sido suspendida por el administrador.");
  }

  if (!cifrada) {
    after(() =>
      bcrypt
        .hash(String(passIngresada), rondasBcrypt)
        .then((nuevoHash) =>
          pool.query("UPDATE usuarios SET contrasena_hash = $1 WHERE usuario_id = $2", [nuevoHash, usuario.usuario_id])
        )
        .catch((err) => console.error("⚠️ No se pudo migrar la contraseña a bcrypt:", err.message))
    );
  }

  // Cuenta nueva que todavía no abrió el enlace de confirmación
  if (usuario.correo_verificado === false) {
    throw new ErrorHttp(
      403,
      "Antes de entrar, confirma tu correo: abre el enlace que te enviamos al registrarte. Si no te llegó (revisa también Spam), pide otro aquí.",
      { verificacionPendiente: true }
    );
  }

  const token = firmarToken(usuario);
  (await cookies()).set(COOKIE_SESION, token, opcionesCookieSesion());
  return json({
    id: usuario.usuario_id,
    nombre: usuario.nombre_razon_social || "Usuario",
    rol: usuario.tipo_rol,
    departamento: usuario.nombre_departamento || "Managua",
    estado: usuario.estado_cuenta || "Activo",
    sesion: fechasDelToken(token),
  });
}
