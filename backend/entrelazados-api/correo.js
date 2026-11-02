// ==========================================================================
// ENVÍO DE CORREOS DE ENTRELAZADOS (recuperación de contraseña)
//
// Variables del .env:
//   EMAIL_USER  cuenta remitente, p. ej. entrelazados.soporte@gmail.com
//   EMAIL_PASS  "contraseña de aplicación" de Google (16 letras). Se puede pegar
//               con o sin espacios. NO sirve la contraseña normal de Gmail.
//   EMAIL_HOST / EMAIL_PORT  (opcionales) para usar otro proveedor SMTP en
//               lugar de Gmail, p. ej. smtp.office365.com y 587.
//
// Para comprobar la configuración sin usar la página:
//   node correo.js destino@gmail.com
// ==========================================================================
const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs');

// El logo va adjunto dentro del correo (cid:) para que se vea aunque el
// cliente de correo bloquee imágenes externas o el sitio no tenga HTTPS
const RUTA_LOGO = path.join(__dirname, 'public', 'logo.png');

function leerConfiguracion() {
    const usuario = (process.env.EMAIL_USER || '').trim();
    // Google muestra la contraseña de aplicación como "abcd efgh ijkl mnop": se quitan los espacios
    const clave = (process.env.EMAIL_PASS || '').replace(/\s+/g, '');
    return { usuario, clave, configurado: Boolean(usuario && clave) };
}

function crearTransporte({ usuario, clave }) {
    const host = (process.env.EMAIL_HOST || '').trim();
    if (host) {
        const puerto = Number(process.env.EMAIL_PORT) || 587;
        return nodemailer.createTransport({ host, port: puerto, secure: puerto === 465, auth: { user: usuario, pass: clave } });
    }
    return nodemailer.createTransport({ service: 'gmail', auth: { user: usuario, pass: clave } });
}

// Traduce los errores más comunes de SMTP a una explicación en español
function explicarError(error) {
    const texto = `${error && error.code} ${error && error.responseCode} ${error && error.message}`;
    if (/EAUTH|535|Username and Password not accepted|BadCredentials/i.test(texto)) {
        return 'Gmail rechazó el usuario o la contraseña. EMAIL_PASS debe ser una "contraseña de aplicación" ' +
            '(https://myaccount.google.com/apppasswords, requiere verificación en 2 pasos), no la contraseña normal.';
    }
    if (/534|Application-specific password required/i.test(texto)) {
        return 'La cuenta tiene verificación en 2 pasos: crea una contraseña de aplicación y ponla en EMAIL_PASS.';
    }
    if (/ETIMEDOUT|ECONNECTION|ECONNREFUSED|ENOTFOUND|ESOCKET/i.test(texto)) {
        return 'No se pudo conectar con el servidor de correo. Revisa la conexión a internet o que el firewall permita los puertos 465 / 587.';
    }
    if (/550|5\.1\.1|does not exist|User unknown|recipient/i.test(texto)) {
        return 'El correo de destino no existe o lo rechazó el servidor.';
    }
    return (error && error.message) || 'Error desconocido al enviar el correo.';
}

function plantillaRecuperacion(enlace, base, logo) {
    return `
    <div style="background:#f5efe9;padding:24px 12px;font-family:Arial,Helvetica,sans-serif">
      <div style="max-width:480px;margin:0 auto;background:#ffffff;border-top:4px solid #993D24;border-radius:8px;padding:28px 24px;color:#3D170A">
        <img src="${logo ? 'cid:logo@entrelazados' : base + '/logo.png'}" alt="EntreLazados" height="48" style="display:block;margin:0 auto 16px">
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

// Los textos de los avisos pueden traer datos escritos por usuarios (p. ej. el
// nombre de un lote), así que se escapan antes de meterlos en el HTML
const escaparHtml = (texto) => String(texto ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function plantillaAviso({ titulo, parrafos, boton }, logo) {
    const cuerpo = parrafos.map(p => `<p style="font-size:15px;line-height:1.5;margin:0 0 14px">${escaparHtml(p)}</p>`).join('');
    const htmlBoton = boton ? `
        <p style="text-align:center;margin:20px 0 4px">
          <a href="${escaparHtml(boton.enlace)}" style="display:inline-block;background:#7D381B;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 24px;border-radius:4px">${escaparHtml(boton.texto)}</a>
        </p>` : '';
    return `
    <div style="background:#f5efe9;padding:24px 12px;font-family:Arial,Helvetica,sans-serif">
      <div style="max-width:480px;margin:0 auto;background:#ffffff;border-top:4px solid #993D24;border-radius:8px;padding:28px 24px;color:#3D170A">
        ${logo ? '<img src="cid:logo@entrelazados" alt="EntreLazados" height="48" style="display:block;margin:0 auto 16px">' : ''}
        <h1 style="font-size:20px;text-align:center;margin:0 0 16px">${escaparHtml(titulo)}</h1>
        ${cuerpo}${htmlBoton}
      </div>
    </div>`;
}

function crearServicioCorreo() {
    const config = leerConfiguracion();
    const transporte = config.configurado ? crearTransporte(config) : null;

    return {
        configurado: config.configurado,
        remitente: config.usuario,

        // Comprueba que el usuario y la contraseña sean aceptados (no envía nada)
        async verificar() {
            if (!transporte) return { ok: false, motivo: 'EMAIL_USER / EMAIL_PASS no están en el .env.' };
            try {
                await transporte.verify();
                return { ok: true };
            } catch (error) {
                return { ok: false, motivo: explicarError(error) };
            }
        },

        async enviarRecuperacion(destino, enlace, base) {
            if (!transporte) throw new Error('El correo no está configurado.');
            const hayLogo = fs.existsSync(RUTA_LOGO);
            try {
                return await transporte.sendMail({
                    from: `"EntreLazados" <${config.usuario}>`,
                    to: destino,
                    subject: 'Restablece tu contraseña - EntreLazados',
                    text: `Recibimos una solicitud para cambiar la contraseña de tu cuenta en EntreLazados.\n\n` +
                        `Para elegir una nueva abre este enlace (vence en 1 hora y solo sirve una vez):\n${enlace}\n\n` +
                        `Si no pediste este cambio, ignora este correo.`,
                    html: plantillaRecuperacion(enlace, base, hayLogo),
                    attachments: hayLogo ? [{ filename: 'logo.png', path: RUTA_LOGO, cid: 'logo@entrelazados', contentDisposition: 'inline' }] : []
                });
            } catch (error) {
                const e = new Error(explicarError(error));
                e.original = error;
                throw e;
            }
        },

        // Aviso general (p. ej. cierre de subastas): { asunto, titulo, parrafos: [...], boton: { texto, enlace } | null }
        async enviarAviso(destino, aviso) {
            if (!transporte) throw new Error('El correo no está configurado.');
            const hayLogo = fs.existsSync(RUTA_LOGO);
            const texto = [aviso.titulo, '', ...aviso.parrafos, ...(aviso.boton ? ['', `${aviso.boton.texto}: ${aviso.boton.enlace}`] : [])].join('\n');
            try {
                return await transporte.sendMail({
                    from: `"EntreLazados" <${config.usuario}>`,
                    to: destino,
                    subject: `${aviso.asunto} - EntreLazados`,
                    text: texto,
                    html: plantillaAviso(aviso, hayLogo),
                    attachments: hayLogo ? [{ filename: 'logo.png', path: RUTA_LOGO, cid: 'logo@entrelazados', contentDisposition: 'inline' }] : []
                });
            } catch (error) {
                const e = new Error(explicarError(error));
                e.original = error;
                throw e;
            }
        }
    };
}

module.exports = { crearServicioCorreo, explicarError };

// Prueba manual desde la terminal: node correo.js destino@gmail.com
if (require.main === module) {
    require('dotenv').config({ path: require('path').join(__dirname, '.env'), quiet: true });
    const destino = process.argv[2];
    const servicio = crearServicioCorreo();
    (async () => {
        if (!destino) {
            console.log('Uso: node correo.js destino@gmail.com');
            process.exit(1);
        }
        console.log(`Remitente: ${servicio.remitente || '(sin configurar)'}`);
        const prueba = await servicio.verificar();
        if (!prueba.ok) {
            console.error('❌ ' + prueba.motivo);
            process.exit(1);
        }
        console.log('✅ Gmail aceptó el usuario y la contraseña.');
        const base = (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
        const info = await servicio.enviarRecuperacion(destino, `${base}/restablecer.html?token=PRUEBA-DE-CORREO`, base);
        console.log(`📧 Correo de prueba enviado a ${destino} (id ${info.messageId}). Revisa la bandeja de entrada y la carpeta Spam.`);
        console.log('   El enlace de este correo es de prueba y no cambia ninguna contraseña.');
    })().catch((error) => {
        console.error('❌ ' + error.message);
        process.exit(1);
    });
}
