// 34. Buscadores y compartir: robots.txt, sitemap.xml y las etiquetas Open Graph
// (lo que leen Google y WhatsApp/Facebook al compartir un enlace).
import { B, check, q, seccion } from '../contexto.mjs';

const meta = (html, propiedad) => html.match(new RegExp(`<meta (?:property|name)="${propiedad}" content="([^"]*)"`))?.[1];
const texto = async (ruta) => {
    const r = await fetch(B + ruta);
    return { status: r.status, tipo: r.headers.get('content-type') ?? '', cuerpo: await r.text() };
};

export default async function correr(ctx) {
    let r;
    seccion('34. Buscadores y compartir');

    r = await texto('/robots.txt');
    check('/robots.txt responde texto', r.status === 200 && r.tipo.includes('text/plain'), `${r.status} ${r.tipo}`);
    check('…deja leer la portada y los perfiles públicos', /Allow: \/\n/.test(r.cuerpo) && r.cuerpo.includes('Allow: /perfil-publico'));
    check('…y bloquea la API, el panel y las páginas con sesión',
        ['/api/', '/admin', '/chat', '/dashboard', '/mercado', '/perfil$', '/comprobante'].every((ruta) => r.cuerpo.includes(`Disallow: ${ruta}\n`)), r.cuerpo);
    check('…y dice dónde está el sitemap', /Sitemap: https?:\/\/\S+\/sitemap\.xml/.test(r.cuerpo));

    // Una cuenta suspendida no debe salir en el sitemap (se suspende y se reactiva aquí mismo)
    await q("UPDATE usuarios SET estado_cuenta = 'Suspendido' WHERE usuario_id = $1", [ctx.e2.id]);
    try {
        r = await texto('/sitemap.xml');
    } finally {
        await q("UPDATE usuarios SET estado_cuenta = 'Activo' WHERE usuario_id = $1", [ctx.e2.id]);
    }
    check('/sitemap.xml responde XML', r.status === 200 && r.tipo.includes('xml') && r.cuerpo.includes('<urlset'), `${r.status} ${r.tipo}`);
    check('…con la portada y el registro', /<loc>[^<]*\/<\/loc>/.test(r.cuerpo) && r.cuerpo.includes('/unirse</loc>'));
    check('…con el perfil público de un proveedor activo', r.cuerpo.includes(`/perfil-publico?id=${ctx.p1.id}</loc>`));
    check('…sin el administrador ni las cuentas suspendidas',
        !r.cuerpo.includes(`/perfil-publico?id=${ctx.admin.id}</loc>`) && !r.cuerpo.includes(`/perfil-publico?id=${ctx.e2.id}</loc>`));

    r = await texto('/');
    check('Portada: título, descripción e imagen para compartir',
        Boolean(meta(r.cuerpo, 'og:title')) && Boolean(meta(r.cuerpo, 'description')) && /^https?:\/\/.+\/opengraph-image/.test(meta(r.cuerpo, 'og:image') ?? ''),
        `${meta(r.cuerpo, 'og:title')} | ${meta(r.cuerpo, 'og:image')}`);
    check('…con el nombre del sitio y tarjeta grande', meta(r.cuerpo, 'og:site_name') === 'EntreLazados' && meta(r.cuerpo, 'twitter:card') === 'summary_large_image');

    r = await texto(`/perfil-publico?id=${ctx.p1.id}`);
    check('Perfil público: og:title con el nombre y og:type profile',
        /en EntreLazados$/.test(meta(r.cuerpo, 'og:title') ?? '') && meta(r.cuerpo, 'og:type') === 'profile', meta(r.cuerpo, 'og:title'));
    check('…con su dirección canónica (con el ?id) y la imagen',
        r.cuerpo.includes(`/perfil-publico?id=${ctx.p1.id}"`) && Boolean(meta(r.cuerpo, 'og:image')));

    const img = await fetch(B + '/opengraph-image');
    const bytes = new Uint8Array(await img.arrayBuffer());
    check('/opengraph-image es un PNG', img.status === 200 && (img.headers.get('content-type') ?? '').includes('image/png') && bytes[1] === 0x50 && bytes[2] === 0x4e,
        `${img.status} ${img.headers.get('content-type')}`);
}
