// 24. Tiempo real (Ably)
// Las páginas escuchan con un permiso de solo lectura de /api/tiempo-real/token (ver
// web/lib/tiempo-real.ts y public/sesion.js). Sin ABLY_API_KEY (p. ej. en el CI) las
// comprobaciones de entrega se omiten; las de la base de datos corren siempre.
import { api, check, conectarOyente, hayTiempoReal, omitir, seccion, q, B } from '../contexto.mjs';

export default async function correr(ctx) {
    let r;
    seccion('24. Tiempo real (Ably)');
    ctx.conectarSocket = conectarOyente;
    // Sin Ably las comprobaciones de entrega se anotan como omitidas
    ctx.checkTR = (nombre, condicion, detalle) => (hayTiempoReal ? check(nombre, condicion, detalle) : omitir(nombre, 'sin ABLY_API_KEY'));
    // Espera un evento que cumpla la condición (o null si no llega a tiempo)
    ctx.esperarEvento = (s, evento, condicion = () => true, ms = 6000) => (!hayTiempoReal ? Promise.resolve(null) : new Promise((listo) => {
        const alLlegar = (datos) => { if (condicion(datos)) { clearTimeout(reloj); s.off(evento, alLlegar); listo(datos); } };
        const reloj = setTimeout(() => { s.off(evento, alLlegar); listo(null); }, ms);
        s.on(evento, alLlegar);
    }));
    await ctx.reg('emp3@prueba.com', 'Emprendedor', { nombre: 'Zapatería Tres' });
    await ctx.verificar('emp3@prueba.com');
    ctx.e3 = (await ctx.login('emp3@prueba.com', 'Clave123')).data;

    const malo = await ctx.conectarSocket('token-inventado');
    check('Un token inválido no recibe permiso (sesion-invalida)', !malo.ok && malo.error === 'sesion-invalida', malo.error);
    if (!hayTiempoReal) {
        const r503 = await fetch(B + '/api/tiempo-real/token', { headers: { Authorization: 'Bearer ' + ctx.e1.token } });
        check('Sin ABLY_API_KEY el permiso responde 503 (las páginas siguen preguntando cada cierto tiempo)', r503.status === 503);
    }
    ctx.anonimo = await ctx.conectarSocket(null);
    ctx.checkTR('Una página sin sesión se conecta (solo recibe eventos públicos)', ctx.anonimo.ok, ctx.anonimo.error);
    ctx.sP2 = (await ctx.conectarSocket(ctx.p2.token)).socket;
    ctx.sE1 = (await ctx.conectarSocket(ctx.e1.token)).socket;
    ctx.sE3 = (await ctx.conectarSocket(ctx.e3.token)).socket;
    ctx.checkTR('Proveedor y emprendedores se conectan con su token', ctx.sP2.connected && ctx.sE1.connected && ctx.sE3.connected);
    if (hayTiempoReal) {
        // El permiso es de solo lectura: ni publicar ni escuchar el canal de otro usuario
        const ajeno = ctx.sE1.cliente.channels.get(ctx.sP2.canales.usuario);
        const errorAjeno = await ajeno.attach().then(() => null, (e) => e.code);
        check('Nadie puede escuchar el canal privado de otro usuario', errorAjeno === 40160, String(errorAjeno));
        const errorPublicar = await ctx.sE1.cliente.channels.get(ctx.sE1.canales.publico).publish('puja:nueva', { falsa: true }).then(() => null, (e) => e.code);
        check('…ni publicar avisos falsos desde el navegador', errorPublicar === 40160, String(errorPublicar));
        const anonUsuario = ctx.anonimo.socket.canales && ctx.anonimo.socket.canales.usuario;
        check('Sin sesión el permiso solo cubre el canal público', anonUsuario === null, String(anonUsuario));
    }

    let evento = ctx.esperarEvento(ctx.anonimo.socket, 'subastas:cambio', d => d.motivo === 'nueva');
    r = await api('POST', '/api/subastas', { token: ctx.p2.token, body: { tituloLote: 'Hilo encerado tiempo real', categoriaId: 9, precioBase: 100, dias: 1 } });
    ctx.subRT = r.data.subastaId;
    ctx.checkTR('Crear una subasta avisa a todas las páginas (subastas:cambio)', r.status === 201 && (await evento) !== null, JSON.stringify(r));

    evento = ctx.esperarEvento(ctx.anonimo.socket, 'puja:nueva', d => d.subastaId === ctx.subRT);
    const notifProv = ctx.esperarEvento(ctx.sP2, 'notificacion:nueva', x => x.tipo === 'PujaRecibida');
    r = await api('POST', '/api/pujas', { token: ctx.e1.token, body: { subastaId: ctx.subRT, montoPuja: 150 } });
    const datosEvento = await evento;
    ctx.checkTR('Una puja se anuncia al instante con el precio nuevo (puja:nueva)', r.status === 200 && datosEvento && datosEvento.precioActual === 150 && datosEvento.totalPujas === 1, JSON.stringify(datosEvento));
    ctx.checkTR('…sin revelar quién pujó', datosEvento && Object.keys(datosEvento).sort().join() === 'precioActual,subastaId,totalPujas', JSON.stringify(datosEvento));
    let n = await notifProv;
    ctx.checkTR('…y el proveedor recibe la notificación "Nueva puja en tu subasta"', n && /Hilo encerado tiempo real/.test(n.titulo) && n.leida === false, JSON.stringify(n));

    const notifE1 = ctx.esperarEvento(ctx.sE1, 'notificacion:nueva', x => x.tipo === 'PujaSuperada');
    r = await api('POST', '/api/pujas', { token: ctx.e3.token, body: { subastaId: ctx.subRT, montoPuja: 200 } });
    n = await notifE1;
    ctx.checkTR('A quien iba ganando le llega al instante "Te superaron"', r.status === 200 && n && /C\$200/.test(n.mensaje) && n.enlace === 'mercado.html#tab-auctions', JSON.stringify(n));

    await api('POST', '/api/pujas', { token: ctx.e1.token, body: { subastaId: ctx.subRT, montoPuja: 250 } });
    await api('POST', '/api/pujas', { token: ctx.e1.token, body: { subastaId: ctx.subRT, montoPuja: 300 } });
    const superadasE3 = await q(`SELECT count(*)::int n FROM notificaciones WHERE usuario_id = $1 AND tipo = 'PujaSuperada'`, [ctx.e3.id]);
    check('Subir tu propia puja no le avisa a nadie más (solo se avisó una vez a emp3)', superadasE3[0].n === 1, JSON.stringify(superadasE3));
    await api('POST', '/api/pujas', { token: ctx.e3.token, body: { subastaId: ctx.subRT, montoPuja: 350 } });
    const superadasE1 = await q(`SELECT count(*)::int n, MAX(mensaje) m FROM notificaciones WHERE usuario_id = $1 AND tipo = 'PujaSuperada' AND referencia_id = $2`, [ctx.e1.id, ctx.subRT]);
    check('Si ya tenía un "Te superaron" sin leer de esa subasta, se actualiza en vez de repetirse', superadasE1[0].n === 1 && /C\$350/.test(superadasE1[0].m), JSON.stringify(superadasE1));
    const recibidas = await q(`SELECT count(*)::int n FROM notificaciones WHERE usuario_id = $1 AND tipo = 'PujaRecibida' AND referencia_id = $2`, [ctx.p2.id, ctx.subRT]);
    check('…igual con las pujas que recibe el proveedor (una sola notificación)', recibidas[0].n === 1, JSON.stringify(recibidas));

    const chatEvento = ctx.esperarEvento(ctx.sP2, 'chat:mensaje', d => d.remitenteId === ctx.e1.id);
    await api('POST', '/api/chat/enviar', { token: ctx.e1.token, body: { destinatarioId: ctx.p2.id, texto: '¿El hilo es de 1 mm?' } });
    ctx.checkTR('Un mensaje de chat llega al instante al destinatario (chat:mensaje)', (await chatEvento) !== null);
}
