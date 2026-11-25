// POST /registro: crea una cuenta de Proveedor o Emprendedor (nunca de administrador).
// Si hay que confirmar el correo, la cuenta nace sin verificar y con un enlace de 24 h.
import bcrypt from "bcryptjs";
import { rondasBcrypt, urlPublica, verificarCorreo } from "@/lib/config";
import { LARGO_MINIMO_CONTRASENA, enviarEnlaceVerificacion, hashToken, nuevoToken } from "@/lib/cuentas";
import { enTransaccion } from "@/lib/db";
import { ErrorHttp, json, leerCuerpo, ruta } from "@/lib/http";
import { ipDe, limite } from "@/lib/limites";
import { REGEX_EMAIL, textoLimpio } from "@/lib/utilidades";

const ERROR_REGISTRO = "El correo ya está registrado o hubo un error.";
const opcional = (valor: unknown) => (valor === undefined || valor === null || valor === "" ? null : valor);

export const POST = ruta(async (req) => {
  await limite("registro", ipDe(req)).consumir();
  const b = await leerCuerpo(req);
  const nombreDepartamento = textoLimpio(b.deptoId);
  const passwordPlano = b.password || b.contrasena;
  const emailLimpio = textoLimpio(b.email);
  const rol = String(b.rol || "");

  if (!nombreDepartamento || !emailLimpio || !b.nombre || !rol || !passwordPlano) {
    throw new ErrorHttp(400, "Por favor, completa todos los campos obligatorios.");
  }
  if (typeof passwordPlano !== "string" || passwordPlano.length < LARGO_MINIMO_CONTRASENA) {
    throw new ErrorHttp(400, `La contraseña debe tener al menos ${LARGO_MINIMO_CONTRASENA} caracteres.`);
  }
  const rolMinus = rol.toLowerCase();
  if (!["proveedor", "emprendedor"].includes(rolMinus)) {
    throw new ErrorHttp(400, "Rol no válido.");
  }
  if (!REGEX_EMAIL.test(emailLimpio)) {
    throw new ErrorHttp(
      400,
      "El correo electrónico no es válido. Debe incluir el dominio completo (ejemplo: usuario@gmail.com)."
    );
  }

  // La contraseña se guarda cifrada con bcrypt, nunca en texto plano
  const passwordHash = await bcrypt.hash(passwordPlano, rondasBcrypt);
  const confirmar = verificarCorreo();
  const tokenVerificacion = confirmar ? nuevoToken() : null;

  try {
    await enTransaccion(async (c) => {
      // El departamento se crea si todavía no existe
      const {
        rows: [depto],
      } = await c.query(
        `INSERT INTO departamentos (nombre_departamento) VALUES ($1)
         ON CONFLICT (nombre_departamento) DO UPDATE SET nombre_departamento = EXCLUDED.nombre_departamento
         RETURNING departamento_id`,
        [nombreDepartamento]
      );

      const {
        rows: [usuario],
      } = await c.query(
        `INSERT INTO usuarios (correo_electronico, contrasena_hash, tipo_rol, estado_cuenta,
                               correo_verificado, token_verificacion, expiracion_verificacion)
         VALUES ($1, $2, $3, 'Activo', $4::boolean, $5, CASE WHEN $4::boolean THEN NULL ELSE now() + interval '24 hours' END)
         RETURNING usuario_id`,
        [emailLimpio, passwordHash, rol, !confirmar, tokenVerificacion && hashToken(tokenVerificacion)]
      );
      const usuarioId = usuario.usuario_id;

      await c.query(
        "INSERT INTO perfiles_usuarios (usuario_id, nombre_razon_social, telefono_whatsapp, departamento_id) VALUES ($1, $2, $3, $4)",
        [usuarioId, String(b.nombre), String(b.telefono || ""), depto.departamento_id]
      );

      if (rolMinus === "proveedor") {
        await c.query(
          `INSERT INTO proveedores (usuario_id, numero_ruc, nombre_comercial, tipo_materia_prima_principal, descripcion_empresa)
           VALUES ($1, $2, $3, $4, $5)`,
          [usuarioId, opcional(b.numeroRuc), b.nombreComercial || b.nombre, opcional(b.tipoMateriaPrimaPrincipal), opcional(b.descripcionEmpresa)]
        );
      } else {
        const capacidad = parseInt(String(b.capacidadProduccionMensual), 10);
        await c.query(
          `INSERT INTO emprendedores (usuario_id, nombre_marca, especialidad_calzado, capacidad_produccion_mensual)
           VALUES ($1, $2, $3, $4)`,
          [usuarioId, b.nombreMarca || b.nombre, opcional(b.especialidadCalzado), Number.isNaN(capacidad) ? null : capacidad]
        );
      }
    });
  } catch (err) {
    // Correo duplicado (23505) o cualquier otro fallo: el mismo mensaje que Express
    if ((err as { code?: string }).code !== "23505") console.error("❌ Error en el registro:", (err as Error).message);
    throw new ErrorHttp(500, ERROR_REGISTRO);
  }

  if (!confirmar) return json({ message: "¡Registro exitoso en la plataforma!" });
  enviarEnlaceVerificacion(emailLimpio, tokenVerificacion!, urlPublica(req));
  return json({
    message: `¡Registro exitoso! Te enviamos un correo a ${emailLimpio} para confirmar tu cuenta. Abre el enlace antes de iniciar sesión.`,
    verificacionPendiente: true,
  });
});
