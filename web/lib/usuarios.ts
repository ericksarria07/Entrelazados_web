// ==========================================================================
// PERFILES Y REPUTACIÓN: piezas compartidas (de rutas/usuarios.js y servicios/tratos.js)
// El perfil público nunca trae correo, teléfono, dirección ni RUC. Solo existe para
// proveedores y emprendedores con la cuenta activa (a cualquier otro se le responde 404).
// ==========================================================================
import { enTransaccion, obtenerPool } from "@/lib/db";
import { ubicarDepartamento } from "@/lib/departamentos";
import { ErrorHttp } from "@/lib/http";
import { enteroPositivo, redondearCalificacion, textoLimpio } from "@/lib/utilidades";

const NO_ENCONTRADO = "Ese perfil no existe o no está disponible.";

export type UsuarioPublico = {
  usuario_id: number;
  tipo_rol: string;
  fecha_registro: Date;
  nombre_razon_social: string | null;
  nombre_departamento: string | null;
  nombre_comercial: string | null;
  descripcion_empresa: string | null;
  tipo_materia_prima_principal: string | null;
  nombre_marca: string | null;
  especialidad_calzado: string | null;
};

// Proveedor o emprendedor con la cuenta activa; si no, 404 (no se dice si existe)
export async function usuarioPublico(id: unknown): Promise<UsuarioPublico> {
  const usuarioId = enteroPositivo(id);
  if (!usuarioId) throw new ErrorHttp(404, NO_ENCONTRADO);
  const {
    rows: [u],
  } = await obtenerPool().query<UsuarioPublico>(
    `SELECT u.usuario_id, u.tipo_rol, u.fecha_registro, p.nombre_razon_social, d.nombre_departamento,
            prov.nombre_comercial, prov.descripcion_empresa, prov.tipo_materia_prima_principal,
            emp.nombre_marca, emp.especialidad_calzado
     FROM usuarios u
     LEFT JOIN perfiles_usuarios p ON p.usuario_id = u.usuario_id
     LEFT JOIN departamentos d ON d.departamento_id = p.departamento_id
     LEFT JOIN proveedores prov ON prov.usuario_id = u.usuario_id
     LEFT JOIN emprendedores emp ON emp.usuario_id = u.usuario_id
     WHERE u.usuario_id = $1 AND u.estado_cuenta = 'Activo'
       AND lower(u.tipo_rol) IN ('proveedor', 'emprendedor')
     LIMIT 1`,
    [usuarioId]
  );
  if (!u) throw new ErrorHttp(404, NO_ENCONTRADO);
  return u;
}

// Perfiles públicos para el sitemap: los mismos que muestra /perfil-publico (cuenta activa,
// proveedor o emprendedor). Solo el id y la fecha de registro.
export async function listarPerfilesPublicos(): Promise<{ id: number; desde: Date }[]> {
  const { rows } = await obtenerPool().query<{ id: number; desde: Date }>(
    `SELECT usuario_id AS id, fecha_registro AS desde FROM usuarios
     WHERE estado_cuenta = 'Activo' AND lower(tipo_rol) IN ('proveedor', 'emprendedor')
     ORDER BY usuario_id
     LIMIT 5000`
  );
  return rows;
}

// Promedio, total y últimas 5 calificaciones recibidas (de servicios/tratos.js)
export async function reputacion(usuarioId: number) {
  const pool = obtenerPool();
  const [
    {
      rows: [resumen],
    },
    { rows: ultimas },
  ] = await Promise.all([
    pool.query("SELECT count(*)::int AS total, avg(puntuacion) AS promedio FROM calificaciones WHERE calificado_id = $1", [usuarioId]),
    pool.query(
      `SELECT c.puntuacion, c.comentario, c.fecha_calificacion AS fecha, COALESCE(p.nombre_razon_social, 'Usuario') AS autor
       FROM calificaciones c LEFT JOIN perfiles_usuarios p ON p.usuario_id = c.autor_id
       WHERE c.calificado_id = $1
       ORDER BY c.fecha_calificacion DESC, c.calificacion_id DESC
       LIMIT 5`,
      [usuarioId]
    ),
  ]);
  const total = resumen.total as number;
  return { usuarioId, total, promedio: total ? redondearCalificacion(resumen.promedio) : null, ultimas };
}

// Perfil completo de un usuario (correo, teléfono, RUC...): GET /api/perfil/[id] y /perfil
export type PerfilCompleto = {
  UsuarioID: number;
  CorreoElectronico: string;
  TipoRol: string;
  EstadoCuenta: string | null;
  NombreRazonSocial: string | null;
  TelefonoWhatsApp: string | null;
  NombreDepartamento: string | null;
  NumeroRUC: string | null;
  NombreComercial: string | null;
  TipoMateriaPrimaPrincipal: string | null;
  DescripcionEmpresa: string | null;
  NombreMarca: string | null;
  EspecialidadCalzado: string | null;
  CapacidadProduccionMensual: number | null;
  NivelAcceso: string | null;
};

export async function perfilCompleto(usuarioId: number): Promise<PerfilCompleto | undefined> {
  const {
    rows: [perfil],
  } = await obtenerPool().query<PerfilCompleto>(
    `SELECT u.usuario_id AS "UsuarioID", u.correo_electronico AS "CorreoElectronico", u.tipo_rol AS "TipoRol",
            u.estado_cuenta AS "EstadoCuenta", p.nombre_razon_social AS "NombreRazonSocial",
            p.telefono_whatsapp AS "TelefonoWhatsApp", d.nombre_departamento AS "NombreDepartamento",
            prov.numero_ruc AS "NumeroRUC", prov.nombre_comercial AS "NombreComercial",
            prov.tipo_materia_prima_principal AS "TipoMateriaPrimaPrincipal", prov.descripcion_empresa AS "DescripcionEmpresa",
            emp.nombre_marca AS "NombreMarca", emp.especialidad_calzado AS "EspecialidadCalzado",
            emp.capacidad_produccion_mensual AS "CapacidadProduccionMensual", adm.nivel_acceso AS "NivelAcceso"
     FROM usuarios u
     LEFT JOIN perfiles_usuarios p ON u.usuario_id = p.usuario_id
     LEFT JOIN departamentos d ON p.departamento_id = d.departamento_id
     LEFT JOIN proveedores prov ON u.usuario_id = prov.usuario_id
     LEFT JOIN emprendedores emp ON u.usuario_id = emp.usuario_id
     LEFT JOIN administradores adm ON u.usuario_id = adm.usuario_id
     WHERE u.usuario_id = $1
     LIMIT 1`,
    [usuarioId]
  );
  return perfil;
}

// Perfil PÚBLICO (sin sesión): GET /api/usuarios/[id]/publico y /perfil-publico. Nunca trae
// correo ni teléfono. Lanza 404 si no existe o la cuenta no está activa.
export async function perfilPublico(idTexto: unknown) {
  const u = await usuarioPublico(idTexto);
  const id = u.usuario_id;
  const esProveedor = u.tipo_rol.toLowerCase() === "proveedor";
  const pool = obtenerPool();
  const [
    {
      rows: [cuentas],
    },
    { rows: estrellas },
  ] = await Promise.all([
    pool.query(
      `SELECT (SELECT count(*)::int FROM ofertas WHERE proveedor_id = $1) AS publicaciones,
              (SELECT count(*)::int FROM subastas WHERE proveedor_id = $1 AND estado = 'Activa' AND fecha_fin > now()) AS "subastasActivas",
              (SELECT count(*)::int FROM tratos_cerrados
                WHERE (proveedor_id = $1 OR emprendedor_id = $1) AND estado_trato = 'Completado') AS "tratosCompletados"`,
      [id]
    ),
    pool.query<{ puntuacion: number; total: number }>(
      "SELECT puntuacion, count(*)::int AS total FROM calificaciones WHERE calificado_id = $1 GROUP BY puntuacion",
      [id]
    ),
  ]);
  // Cuántas calificaciones hay de cada estrella (5 a 1), para las barras de la página
  const distribucion: Record<number, number> = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  let total = 0;
  let suma = 0;
  for (const e of estrellas) {
    distribucion[e.puntuacion] = e.total;
    total += e.total;
    suma += e.total * e.puntuacion;
  }
  return {
    id,
    rol: esProveedor ? "Proveedor" : "Emprendedor",
    nombre: u.nombre_razon_social || "Usuario",
    departamento: u.nombre_departamento || null,
    miembroDesde: u.fecha_registro,
    // Proveedor: nombre comercial, qué vende y la descripción de su empresa
    nombreComercial: esProveedor ? u.nombre_comercial || null : null,
    materiaPrincipal: esProveedor ? u.tipo_materia_prima_principal || null : null,
    descripcion: esProveedor ? u.descripcion_empresa || null : null,
    // Emprendedor: su marca y qué calzado hace
    marca: esProveedor ? null : u.nombre_marca || null,
    especialidad: esProveedor ? null : u.especialidad_calzado || null,
    estadisticas: {
      publicaciones: esProveedor ? cuentas.publicaciones : 0,
      subastasActivas: esProveedor ? cuentas.subastasActivas : 0,
      tratosCompletados: cuentas.tratosCompletados,
    },
    reputacion: { total, promedio: total ? redondearCalificacion(suma / total) : null, distribucion },
  };
}

// ==========================================================================
// EDITAR MI PERFIL: PUT /api/perfil/[id] y el formulario de /perfil
// Datos generales para todos; los del proveedor o del emprendedor según su rol.
// El correo, la contraseña y el rol no se cambian aquí.
// ==========================================================================
const TELEFONO = /^[0-9+\-() ]+$/;

// Texto opcional: vacío → null; más largo que el máximo → 400 con el nombre del campo
function opcional(valor: unknown, maximo: number, campo: string): string | null {
  const texto = textoLimpio(valor);
  if (!texto) return null;
  if (texto.length > maximo) throw new ErrorHttp(400, `${campo}: máximo ${maximo} caracteres.`);
  return texto;
}

export async function actualizarPerfil(usuarioId: number, rol: string, cuerpo: Record<string, unknown>): Promise<void> {
  const nombre = textoLimpio(cuerpo.nombre);
  if (nombre.length < 2 || nombre.length > 150) throw new ErrorHttp(400, "El nombre debe tener entre 2 y 150 caracteres.");
  const telefono = textoLimpio(cuerpo.telefono);
  if (!telefono || telefono.length > 20 || !TELEFONO.test(telefono)) {
    throw new ErrorHttp(400, "Escribe un teléfono válido (solo números, espacios y + - ( ), hasta 20 caracteres).");
  }
  // Uno de los 17 departamentos; se guarda con su nombre oficial ("leon" → "León")
  const departamento = ubicarDepartamento(textoLimpio(cuerpo.departamento));
  if (!departamento) throw new ErrorHttp(400, "Elige uno de los departamentos de Nicaragua.");

  const rolMinus = rol.toLowerCase();
  let datosRol: unknown[] | null = null;
  if (rolMinus === "proveedor") {
    datosRol = [
      opcional(cuerpo.numeroRuc, 50, "Número RUC"),
      opcional(cuerpo.nombreComercial, 150, "Nombre comercial"),
      opcional(cuerpo.tipoMateriaPrimaPrincipal, 100, "Materia prima principal"),
      opcional(cuerpo.descripcionEmpresa, 2000, "Descripción de la empresa"),
    ];
  } else if (rolMinus === "emprendedor") {
    const capacidadTexto = textoLimpio(String(cuerpo.capacidadProduccionMensual ?? ""));
    let capacidad: number | null = null;
    if (capacidadTexto) {
      capacidad = Number(capacidadTexto);
      if (!Number.isInteger(capacidad) || capacidad < 0 || capacidad > 1_000_000) {
        throw new ErrorHttp(400, "La capacidad mensual debe ser un número entero entre 0 y 1.000.000.");
      }
    }
    datosRol = [opcional(cuerpo.nombreMarca, 150, "Nombre de la marca"), opcional(cuerpo.especialidadCalzado, 100, "Especialidad de calzado"), capacidad];
  }

  await enTransaccion(async (c) => {
    // El departamento se crea si todavía no existe (igual que al registrarse)
    const {
      rows: [depto],
    } = await c.query<{ departamento_id: number }>(
      `INSERT INTO departamentos (nombre_departamento) VALUES ($1)
       ON CONFLICT (nombre_departamento) DO UPDATE SET nombre_departamento = EXCLUDED.nombre_departamento
       RETURNING departamento_id`,
      [departamento.nombre]
    );
    // Un admin creado a mano puede no tener fila de perfil: se crea
    await c.query(
      `INSERT INTO perfiles_usuarios (usuario_id, nombre_razon_social, telefono_whatsapp, departamento_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (usuario_id) DO UPDATE SET nombre_razon_social = EXCLUDED.nombre_razon_social,
         telefono_whatsapp = EXCLUDED.telefono_whatsapp, departamento_id = EXCLUDED.departamento_id`,
      [usuarioId, nombre, telefono, depto.departamento_id]
    );
    if (rolMinus === "proveedor" && datosRol) {
      await c.query(
        `INSERT INTO proveedores (usuario_id, numero_ruc, nombre_comercial, tipo_materia_prima_principal, descripcion_empresa)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (usuario_id) DO UPDATE SET numero_ruc = EXCLUDED.numero_ruc, nombre_comercial = EXCLUDED.nombre_comercial,
           tipo_materia_prima_principal = EXCLUDED.tipo_materia_prima_principal, descripcion_empresa = EXCLUDED.descripcion_empresa`,
        [usuarioId, ...datosRol]
      );
    } else if (rolMinus === "emprendedor" && datosRol) {
      await c.query(
        `INSERT INTO emprendedores (usuario_id, nombre_marca, especialidad_calzado, capacidad_produccion_mensual)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (usuario_id) DO UPDATE SET nombre_marca = EXCLUDED.nombre_marca,
           especialidad_calzado = EXCLUDED.especialidad_calzado, capacidad_produccion_mensual = EXCLUDED.capacidad_produccion_mensual`,
        [usuarioId, ...datosRol]
      );
    }
  });
}
