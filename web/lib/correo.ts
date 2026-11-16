// ==========================================================================
// ENVÍO DE CORREOS (equivale a backend/entrelazados-api/servicios/correo.js)
//
// Variables de entorno:
//   EMAIL_USER  cuenta remitente, p. ej. entrelazados.soporte@gmail.com
//   EMAIL_PASS  "contraseña de aplicación" de Google (16 letras), con o sin espacios
//   EMAIL_HOST / EMAIL_PORT  (opcionales) otro proveedor SMTP en lugar de Gmail
//
// Las rutas mandan los correos con enviarDespues(): la respuesta sale sin esperar
// y el envío termina con after() (en Vercel la función sigue viva hasta acabar).
// Sin correo configurado, el enlace se escribe en el log.
// ==========================================================================
import fs from "node:fs";
import path from "node:path";
import { after } from "next/server";
import nodemailer, { type Transporter } from "nodemailer";

// El logo va adjunto dentro del correo (cid:) para que se vea aunque el cliente
// bloquee imágenes externas. next.config.ts lo incluye en las funciones de Vercel.
const RUTA_LOGO = path.join(process.cwd(), "public", "logo.png");

function leerConfiguracion() {
  const usuario = (process.env.EMAIL_USER ?? "").trim();
  // Google muestra la contraseña de aplicación como "abcd efgh ijkl mnop": se quitan los espacios
  const clave = (process.env.EMAIL_PASS ?? "").replace(/\s+/g, "");
  return { usuario, clave, configurado: Boolean(usuario && clave) };
}

export const correoConfigurado = () => leerConfiguracion().configurado;

let transporte: Transporter | undefined;

function obtenerTransporte() {
  const { usuario, clave, configurado } = leerConfiguracion();
  if (!configurado) throw new Error("El correo no está configurado.");
  if (!transporte) {
    const host = (process.env.EMAIL_HOST ?? "").trim();
    const auth = { user: usuario, pass: clave };
    if (host) {
      const puerto = Number(process.env.EMAIL_PORT) || 587;
      transporte = nodemailer.createTransport({ host, port: puerto, secure: puerto === 465, auth });
    } else {
      transporte = nodemailer.createTransport({ service: "gmail", auth });
    }
  }
  return { transporte, remitente: usuario };
}

// Traduce los errores más comunes de SMTP a una explicación en español
export function explicarError(error: unknown): string {
  const e = error as { code?: string; responseCode?: number; message?: string } | null;
  const texto = `${e?.code} ${e?.responseCode} ${e?.message}`;
  if (/EAUTH|535|Username and Password not accepted|BadCredentials/i.test(texto)) {
    return (
      'Gmail rechazó el usuario o la contraseña. EMAIL_PASS debe ser una "contraseña de aplicación" ' +
      "(https://myaccount.google.com/apppasswords, requiere verificación en 2 pasos), no la contraseña normal."
    );
  }
  if (/534|Application-specific password required/i.test(texto)) {
    return "La cuenta tiene verificación en 2 pasos: crea una contraseña de aplicación y ponla en EMAIL_PASS.";
  }
  if (/ETIMEDOUT|ECONNECTION|ECONNREFUSED|ENOTFOUND|ESOCKET/i.test(texto)) {
    return "No se pudo conectar con el servidor de correo. Revisa la conexión a internet o que el firewall permita los puertos 465 / 587.";
  }
  if (/550|5\.1\.1|does not exist|User unknown|recipient/i.test(texto)) {
    return "El correo de destino no existe o lo rechazó el servidor.";
  }
  return e?.message || "Error desconocido al enviar el correo.";
}

// Los textos pueden traer datos escritos por usuarios: se escapan antes de meterlos en el HTML
const escaparHtml = (texto: unknown) =>
  String(texto ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!
  );

function plantillaRecuperacion(enlace: string, base: string, logo: boolean) {
  return `
    <div style="background:#f5efe9;padding:24px 12px;font-family:Arial,Helvetica,sans-serif">
      <div style="max-width:480px;margin:0 auto;background:#ffffff;border-top:4px solid #993D24;border-radius:8px;padding:28px 24px;color:#3D170A">
        <img src="${logo ? "cid:logo@entrelazados" : base + "/logo.png"}" alt="EntreLazados" height="48" style="display:block;margin:0 auto 16px">
        <h1 style="font-size:20px;text-align:center;margin:0 0 12px">Restablece tu contraseña</h1>
        <p style="font-size:15px;line-height:1.5;margin:0 0 20px">Recibimos una solicitud para cambiar la contraseña de tu cuenta en EntreLazados. Presiona el botón para elegir una nueva:</p>
        <p style="text-align:center;margin:0 0 20px">
          <a href="${enlace}" style="display:inline-block;background:#7D381B;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 24px;border-radius:4px">Restablecer contraseña</a>
        </p>
        <p style="font-size:13px;line-height:1.5;color:#6b5b53;margin:0 0 8px">El enlace vence en <strong>1 hora</strong> y solo se puede usar una vez.</p>
        <p style="font-size:13px;line-height:1.5;color:#6b5b53;margin:0 0 8px">Si el botón no funciona, copia esta dirección en tu navegador:<br><span style="word-break:break-all">${enlace}</span></p>
        <p style="font-size:13px;line-height:1.5;color:#6b5b53;margin:0">Si no pediste este cambio, ignora este correo: tu contraseña seguirá siendo la misma.</p>
      </div>
    </div>`;
}

export type Aviso = { asunto: string; titulo: string; parrafos: string[]; boton?: { texto: string; enlace: string } | null };

function plantillaAviso({ titulo, parrafos, boton }: Aviso, logo: boolean) {
  const cuerpo = parrafos.map((p) => `<p style="font-size:15px;line-height:1.5;margin:0 0 14px">${escaparHtml(p)}</p>`).join("");
  const htmlBoton = boton
    ? `
        <p style="text-align:center;margin:20px 0 4px">
          <a href="${escaparHtml(boton.enlace)}" style="display:inline-block;background:#7D381B;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 24px;border-radius:4px">${escaparHtml(boton.texto)}</a>
        </p>`
    : "";
  return `
    <div style="background:#f5efe9;padding:24px 12px;font-family:Arial,Helvetica,sans-serif">
      <div style="max-width:480px;margin:0 auto;background:#ffffff;border-top:4px solid #993D24;border-radius:8px;padding:28px 24px;color:#3D170A">
        ${logo ? '<img src="cid:logo@entrelazados" alt="EntreLazados" height="48" style="display:block;margin:0 auto 16px">' : ""}
        <h1 style="font-size:20px;text-align:center;margin:0 0 16px">${escaparHtml(titulo)}</h1>
        ${cuerpo}${htmlBoton}
      </div>
    </div>`;
}

async function enviar(destino: string, asunto: string, texto: string, html: (logo: boolean) => string) {
  const { transporte, remitente } = obtenerTransporte();
  const hayLogo = fs.existsSync(RUTA_LOGO);
  try {
    return await transporte.sendMail({
      from: `"EntreLazados" <${remitente}>`,
      to: destino,
      subject: `${asunto} - EntreLazados`,
      text: texto,
      html: html(hayLogo),
      attachments: hayLogo
        ? [{ filename: "logo.png", path: RUTA_LOGO, cid: "logo@entrelazados", contentDisposition: "inline" as const }]
        : [],
    });
  } catch (error) {
    throw new Error(explicarError(error), { cause: error });
  }
}

export function enviarRecuperacion(destino: string, enlace: string, base: string) {
  return enviar(
    destino,
    "Restablece tu contraseña",
    "Recibimos una solicitud para cambiar la contraseña de tu cuenta en EntreLazados.\n\n" +
      `Para elegir una nueva abre este enlace (vence en 1 hora y solo sirve una vez):\n${enlace}\n\n` +
      "Si no pediste este cambio, ignora este correo.",
    (logo) => plantillaRecuperacion(enlace, base, logo)
  );
}

// Aviso general: { asunto, titulo, parrafos: [...], boton: { texto, enlace } | null }
export function enviarAviso(destino: string, aviso: Aviso) {
  const texto = [aviso.titulo, "", ...aviso.parrafos, ...(aviso.boton ? ["", `${aviso.boton.texto}: ${aviso.boton.enlace}`] : [])].join("\n");
  return enviar(destino, aviso.asunto, texto, (logo) => plantillaAviso(aviso, logo));
}

// Confirmación del correo al registrarse (el enlace vence en 24 horas)
export function enviarVerificacion(destino: string, enlace: string) {
  return enviarAviso(destino, {
    asunto: "Confirma tu correo",
    titulo: "¡Bienvenido a EntreLazados!",
    parrafos: [
      "Solo falta un paso: confirma que este correo es tuyo para activar tu cuenta.",
      "El enlace vence en 24 horas. Si no creaste una cuenta en EntreLazados, ignora este correo.",
    ],
    boton: { texto: "Confirmar mi correo", enlace },
  });
}

// Manda un correo después de responder; el resultado queda en el log
export function enviarDespues(descripcion: string, destino: string, envio: () => Promise<unknown>) {
  after(() =>
    envio().then(
      () => console.log(`📧 ${descripcion} enviado a ${destino}`),
      (err) => console.error(`❌ No se pudo enviar ${descripcion.toLowerCase()} a ${destino}: ${(err as Error).message}`)
    )
  );
}
