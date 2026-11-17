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
//
//   limite('registro', ipDe(req)).consumir();        // cuenta y, si se pasó, 429
//   const l = limite('login', ipDe(req));
//   l.comprobar();  ...  if (fallo) l.sumarFallo();  // solo cuentan los fallidos
//
// Los contadores viven en la memoria de cada instancia de la función: en Vercel
// el límite es aproximado (cada instancia cuenta por su lado y empieza de cero
// al arrancar). Es una decisión consciente para no agregar otro servicio.
// ==========================================================================
import { ipAddress } from "@vercel/functions";
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
} as const;

type NombreLimite = keyof typeof DEFINICIONES;
type Ventana = { cuenta: number; vence: number };

const contadores = new Map<string, Ventana>();

function ventanaDe(clave: string, ventanaMs: number): Ventana {
  const ahora = Date.now();
  let v = contadores.get(clave);
  if (!v || v.vence <= ahora) {
    v = { cuenta: 0, vence: ahora + ventanaMs };
    contadores.set(clave, v);
    // Limpieza de ventanas vencidas para que el mapa no crezca sin fin
    if (contadores.size > 5000) for (const [c, x] of contadores) if (x.vence <= ahora) contadores.delete(c);
  }
  return v;
}

export function limite(nombre: NombreLimite, clave: string) {
  const def = DEFINICIONES[nombre];
  const maximo = numeroEnv(def.env, def.porDefecto);
  const v = ventanaDe(`${nombre}:${clave}`, def.ventanaMs);

  const bloquear = () => {
    const segundos = Math.max(1, Math.ceil((v.vence - Date.now()) / 1000));
    const minutos = Math.max(1, Math.ceil(segundos / 60));
    console.warn(`⚠️ Límite "${nombre}" alcanzado por ${clave}`);
    return new ErrorHttp(429, `${def.mensaje} Intenta de nuevo en ${minutos} minuto${minutos === 1 ? "" : "s"}.`, {
      reintentarEnSegundos: segundos,
    });
  };

  return {
    // Cuenta esta petición; si pasa del máximo responde 429
    consumir() {
      v.cuenta++;
      if (v.cuenta > maximo) throw bloquear();
    },
    // Sin contar: 429 si ya se llegó al máximo (para límites que solo cuentan fallos)
    comprobar() {
      if (v.cuenta >= maximo) throw bloquear();
    },
    sumarFallo() {
      v.cuenta++;
    },
  };
}

// IP del cliente: en Vercel viene en x-real-ip / x-forwarded-for
export function ipDe(req: Request): string {
  return ipAddress(req) ?? req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "local";
}
