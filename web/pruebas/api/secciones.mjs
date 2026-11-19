// ==========================================================================
// SECCIONES DE LAS PRUEBAS DE LA API, EN EL ORDEN EN QUE CORREN
//
// activa: true  -> la sección corre en npm run test:api (y en el CI).
// Se activa en la rama que porta sus rutas a Next.js (ROADMAP 1.3/1.5).
//
// requiere: secciones que crean variables que esta usa (ctx.p1, ctx.subP1...).
// El corredor no deja activar una sección si alguna de las que requiere está inactiva.
// Además, casi todas usan datos que crearon las anteriores (cuentas, ofertas),
// así que conviene activarlas en orden. La 33 (sesión en cookie) corre antes de la 31,
// que borra cuentas, y de la 32, que agota el límite de intentos de login.
// ==========================================================================
export const SECCIONES = [
    { archivo: "01-registro.mjs", titulo: "1. Registro", activa: true },
    { archivo: "02-confirmar-el-correo.mjs", titulo: "1b. Confirmar el correo (VERIFICAR_CORREO=1)", activa: true },
    { archivo: "03-inicio-de-sesion.mjs", titulo: "2. Inicio de sesión", activa: true, requiere: ["02-confirmar-el-correo.mjs"] },
    { archivo: "04-tokens.mjs", titulo: "3. Tokens", activa: true, requiere: ["03-inicio-de-sesion.mjs"] },
    { archivo: "05-ofertas.mjs", titulo: "4. Ofertas", activa: true, requiere: ["03-inicio-de-sesion.mjs"] },
    { archivo: "06-subastas-y-pujas.mjs", titulo: "5. Subastas y pujas", activa: true, requiere: ["03-inicio-de-sesion.mjs","05-ofertas.mjs"] },
    { archivo: "07-borrar-ofertas.mjs", titulo: "6. Borrar ofertas", activa: true, requiere: ["03-inicio-de-sesion.mjs","05-ofertas.mjs","06-subastas-y-pujas.mjs"] },
    { archivo: "08-chat.mjs", titulo: "7. Chat", activa: true, requiere: ["03-inicio-de-sesion.mjs"] },
    { archivo: "09-perfil.mjs", titulo: "8. Perfil", activa: true, requiere: ["03-inicio-de-sesion.mjs"] },
    { archivo: "10-panel-de-administrador.mjs", titulo: "9. Panel de administrador", activa: true, requiere: ["02-confirmar-el-correo.mjs","03-inicio-de-sesion.mjs"] },
    { archivo: "11-restablecer-contrasena.mjs", titulo: "10. Restablecer contraseña", activa: true, requiere: ["02-confirmar-el-correo.mjs","03-inicio-de-sesion.mjs"] },
    { archivo: "12-rutas-publicas-y-errores.mjs", titulo: "11. Rutas públicas y errores", activa: true, requiere: ["03-inicio-de-sesion.mjs"] },
    { archivo: "13-fotos-de-las-ofertas.mjs", titulo: "13. Fotos de las ofertas", activa: true, requiere: ["03-inicio-de-sesion.mjs"] },
    { archivo: "14-crear-subastas-desde-el.mjs", titulo: "16. Crear subastas desde el Mercado", activa: true, requiere: ["03-inicio-de-sesion.mjs","05-ofertas.mjs","13-fotos-de-las-ofertas.mjs"] },
    { archivo: "15-cierre-automatico-de-subastas.mjs", titulo: "14. Cierre automático de subastas", activa: true, requiere: ["03-inicio-de-sesion.mjs","06-subastas-y-pujas.mjs"] },
    { archivo: "16-seguimiento-de-tratos.mjs", titulo: "17. Seguimiento de tratos", activa: true, requiere: ["03-inicio-de-sesion.mjs","15-cierre-automatico-de-subastas.mjs"] },
    { archivo: "17-editar-publicaciones.mjs", titulo: "18. Editar publicaciones", activa: true, requiere: ["01-registro.mjs","02-confirmar-el-correo.mjs","03-inicio-de-sesion.mjs","13-fotos-de-las-ofertas.mjs"] },
    { archivo: "18-paginacion-y-filtros.mjs", titulo: "19. Paginación y filtros", activa: true, requiere: ["03-inicio-de-sesion.mjs","17-editar-publicaciones.mjs"] },
    { archivo: "19-mensajes-no-leidos.mjs", titulo: "20. Mensajes no leídos", activa: true, requiere: ["03-inicio-de-sesion.mjs","17-editar-publicaciones.mjs"] },
    { archivo: "20-calificaciones-de-los-tratos.mjs", titulo: "21. Calificaciones de los tratos", activa: true, requiere: ["03-inicio-de-sesion.mjs","15-cierre-automatico-de-subastas.mjs","16-seguimiento-de-tratos.mjs"] },
    { archivo: "21-avisar-a-quienes-pujaron.mjs", titulo: "22. Avisar a quienes pujaron si se cancela una subasta", activa: true, requiere: ["03-inicio-de-sesion.mjs","17-editar-publicaciones.mjs"] },
    { archivo: "22-correos-invalidos-y-confirmacion.mjs", titulo: "23. Correos inválidos y confirmación por el admin", activa: true, requiere: ["01-registro.mjs","02-confirmar-el-correo.mjs","03-inicio-de-sesion.mjs","17-editar-publicaciones.mjs"] },
    { archivo: "23-tiempo-real.mjs", titulo: "24. Tiempo real (Ably)", activa: true, requiere: ["01-registro.mjs","02-confirmar-el-correo.mjs","03-inicio-de-sesion.mjs"] },
    { archivo: "24-notificaciones.mjs", titulo: "25. Notificaciones (campana)", activa: true, requiere: ["03-inicio-de-sesion.mjs","23-tiempo-real.mjs"] },
    { archivo: "25-reportes.mjs", titulo: "26. Reportes", activa: true, requiere: ["03-inicio-de-sesion.mjs","23-tiempo-real.mjs"] },
    { archivo: "26-favoritos-y-alertas-de.mjs", titulo: "27. Favoritos y alertas de búsqueda", activa: true, requiere: ["03-inicio-de-sesion.mjs","17-editar-publicaciones.mjs","23-tiempo-real.mjs"] },
    { archivo: "27-comprobante-de-un-trato.mjs", titulo: "28. Comprobante de un trato", activa: true, requiere: ["03-inicio-de-sesion.mjs","23-tiempo-real.mjs"] },
    { archivo: "28-mapa-de-proveedores.mjs", titulo: "29. Mapa de proveedores", activa: true, requiere: ["03-inicio-de-sesion.mjs","17-editar-publicaciones.mjs"] },
    { archivo: "29-asistente-de-ia-para.mjs", titulo: "30. Asistente de IA para publicar", activa: true, requiere: ["03-inicio-de-sesion.mjs","13-fotos-de-las-ofertas.mjs","17-editar-publicaciones.mjs","26-favoritos-y-alertas-de.mjs"] },
    { archivo: "30-perfil-publico-y-paginacion.mjs", titulo: "31. Perfil público y paginación", activa: true, requiere: ["03-inicio-de-sesion.mjs","17-editar-publicaciones.mjs","23-tiempo-real.mjs","26-favoritos-y-alertas-de.mjs"] },
    { archivo: "33-sesion-con-cookie.mjs", titulo: "32. Sesión en cookie httpOnly y CSRF", activa: true, requiere: ["02-confirmar-el-correo.mjs","03-inicio-de-sesion.mjs"] },
    { archivo: "31-eliminar-usuarios.mjs", titulo: "12. Eliminar usuarios (admin)", activa: true, requiere: ["03-inicio-de-sesion.mjs","13-fotos-de-las-ofertas.mjs"] },
    { archivo: "32-limites-de-intentos.mjs", titulo: "15. Límites de intentos", activa: true, requiere: ["01-registro.mjs","02-confirmar-el-correo.mjs","03-inicio-de-sesion.mjs"] },
];
