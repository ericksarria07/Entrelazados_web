// ==========================================================================
// LÍMITES DE INTENTOS (protección contra fuerza bruta y abuso)
// Equivale a middlewares/limites.js, sin express-rate-limit.
//
// Cada límite cuenta las peticiones de una misma clave (IP o usuario) dentro
// de una ventana de tiempo. Al pasarse responde 429 "Demasiados intentos"
// hasta que la ventana termina. Los valores se cambian con variables de entorno:
//   LIMITE_LOGIN          intentos FALLIDOS de login por IP cada 15 min (10)
//   LIMITE_REGISTRO       cuentas nuevas por IP cada hora                (5)
//   LIMITE_RECUPERACION   solicitudes de recuperación por IP cada 15 min (5)
//   LIMITE_KAN_MINUTO     preguntas a Kan por usuario cada minuto       (10)
//   LIMITE_KAN_DIA        preguntas a Kan por usuario cada día         (150)
//   LIMITE_FOTOS          publicaciones por usuario cada hora           (20)
//   LIMITE_IA             consultas al asistente de IA por usuario cada hora (30)
//   LIMITE_CORREO         correos de recuperación o confirmación por dirección cada minuto (1)
//
//   await limite('registro', ipDe(req)).consumir();        // cuenta y, si se pasó, 429
//   const l = limite('login', ipDe(req));
//   await l.comprobar();  ...  if (fallo) await l.sumarFallo();  // solo los fallidos
//
// Los contadores viven en la tabla limites_uso de Postgres, así todas las instancias
// de Vercel cuentan juntas y un despliegue nuevo no los reinicia (antes vivían en la
// memoria de cada instancia y el límite era aproximado). Cuesta una consulta por
// petición limitada. Si la base no responde, el límite no bloquea (falla abierto).
// ==========================================================================
import { ipAddress } from "@vercel/functions";
import { obtenerPool } from "@/lib/db";
import { ErrorHttp } from "@/lib/http";

const MINUTO = 60 * 1000;

function numeroEnv(nombre: string, porDefecto: number): number {
  const valor = Number(process.env[nombre]);
  return Number.isInteger(valor) && valor > 0 ? valor : porDefecto;
}

const DEFINICIONES = {
  login: { ventanaMs: 15 * MINUTO, env: "LIMITE_LOGIN", porDefecto: 10, mensaje: "Demasiados intentos fallidos de inicio de sesión." },
  registro: { ventanaMs: 60 * MINUTO, env: "LIMITE_REGISTRO", porDefecto: 5, mensaje: "Se crearon demasiadas cuentas desde esta conexión." },
  recuperacion: { ventanaMs: 15 * MINUTO, env: "LIMITE_RECUPERACION", porDefecto: 5, mensaje: "Demasiadas solicitudes para recuperar la contraseña." },
  // Por usuario (la clave es `u${usuario.id}`)
  kanMinuto: { ventanaMs: MINUTO, env: "LIMITE_KAN_MINUTO", porDefecto: 10, mensaje: "Le estás escribiendo muy rápido a Kan." },
  kanDia: { ventanaMs: 24 * 60 * MINUTO, env: "LIMITE_KAN_DIA", porDefecto: 150, mensaje: "Llegaste al máximo de preguntas a Kan por hoy." },
  fotos: { ventanaMs: 60 * MINUTO, env: "LIMITE_FOTOS", porDefecto: 20, mensaje: "Publicaste demasiadas ofertas en poco tiempo." },
  ia: { ventanaMs: 60 * MINUTO, env: "LIMITE_IA", porDefecto: 30, mensaje: "Usaste mucho el asistente de IA en poco tiempo." },
  // Por dirección de correo: 1 correo de recuperación o confirmación por minuto (lib/cuentas.ts)
  correo: { ventanaMs: MINUTO, env: "LIMITE_CORREO", porDefecto: 1, mensaje: "Ya te enviamos un correo hace poco." },
} as const;

type NombreLimite = keyof typeof DEFINICIONES;
type Ventana = { cuenta: number; vence: number };

// Suma `cuanto` al contador de la clave en un solo paso atómico: si la ventana ya venció
// (o no existe) empieza una nueva; si no, suma a la que está abierta. Con cuanto = 0
// solo la lee (para comprobar sin contar).
const SQL_SUMAR = `
  INSERT INTO limites_uso (clave, cuenta, vence)
  VALUES ($1, $2, now() + $3 * interval '1 millisecond')
  ON CONFLICT (clave) DO UPDATE SET
    cuenta = CASE WHEN limites_uso.vence <= now() THEN EXCLUDED.cuenta ELSE limites_uso.cuenta + EXCLUDED.cuenta END,
    vence  = CASE WHEN limites_uso.vence <= now() THEN EXCLUDED.vence  ELSE limites_uso.vence END
  RETURNING cuenta, (extract(epoch FROM vence) * 1000)::float8 AS vence`;

async function sumar(clave: string, cuanto: number, ventanaMs: number): Promise<Ventana | null> {
  try {
    const { rows } = await obtenerPool().query<{ cuenta: number; vence: number }>(SQL_SUMAR, [clave, cuanto, ventanaMs]);
    return { cuenta: Number(rows[0].cuenta), vence: Number(rows[0].vence) };
  } catch (error) {
    // Si la base falla, no se bloquea a nadie: el límite es un freno, no un requisito
    console.error(`❌ No se pudo leer el límite ${clave}:`, (error as Error)?.message || error);
    return null;
  }
}

export function limite(nombre: NombreLimite, clave: string) {
  const def = DEFINICIONES[nombre];
  const maximo = numeroEnv(def.env, def.porDefecto);
  const llave = `${nombre}:${clave}`.slice(0, 200);

  const bloquear = (v: Ventana) => {
    const segundos = Math.max(1, Math.ceil((v.vence - Date.now()) / 1000));
    const minutos = Math.max(1, Math.ceil(segundos / 60));
    console.warn(`⚠️ Límite "${nombre}" alcanzado por ${clave}`);
    return new ErrorHttp(429, `${def.mensaje} Intenta de nuevo en ${minutos} minuto${minutos === 1 ? "" : "s"}.`, {
      reintentarEnSegundos: segundos,
    });
  };

  return {
    // Cuenta esta petición; si pasa del máximo responde 429
    async consumir() {
      const v = await sumar(llave, 1, def.ventanaMs);
      if (v && v.cuenta > maximo) throw bloquear(v);
    },
    // Sin contar: 429 si ya se llegó al máximo (para límites que solo cuentan fallos)
    async comprobar() {
      const v = await sumar(llave, 0, def.ventanaMs);
      if (v && v.cuenta >= maximo) throw bloquear(v);
    },
    async sumarFallo() {
      await sumar(llave, 1, def.ventanaMs);
    },
  };
}

// Borra las ventanas vencidas (lo llama la corrida de cada hora, /api/cron/cerrar-subastas)
export async function limpiarLimitesVencidos(): Promise<number> {
  const { rowCount } = await obtenerPool().query("DELETE FROM limites_uso WHERE vence < now()");
  return rowCount ?? 0;
}

// IP del cliente: en Vercel viene en x-real-ip / x-forwarded-for
export function ipDe(req: Request): string {
  return ipAddress(req) ?? req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "local";
}
