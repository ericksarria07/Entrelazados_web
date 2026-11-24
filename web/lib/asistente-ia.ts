// ==========================================================================
// ASISTENTE DE IA PARA PUBLICAR (equivale a servicios/asistenteIA.js)
//
// 1. describirPublicacion: a partir de una foto del material (y/o lo que ya
//    escribió) propone título, descripción, categoría y unidad de medida.
//    Necesita Gemini: si no está configurado o falla, responde 503 con un
//    mensaje claro y el proveedor sigue llenando el formulario a mano.
// 2. sugerirPrecio: busca publicaciones parecidas (misma categoría y, si se puede,
//    la misma unidad) y los tratos cerrados de esa categoría, y calcula el rango
//    de precios. Gemini propone un precio dentro de ese rango; si no responde, se
//    sugiere la mediana. Así esta parte funciona SIEMPRE, con o sin IA.
// La IA nunca guarda nada: solo propone, y el proveedor decide.
// ==========================================================================
import { generateText, Output, type UserContent } from "ai";
import { z } from "zod";
import { obtenerPool } from "@/lib/db";
import type { Foto } from "@/lib/fotos";
import { modeloIA } from "@/lib/gemini";
import { ErrorHttp } from "@/lib/http";
import { LARGO_DESCRIPCION } from "@/lib/ofertas";
import { estadisticas, normalizarUnidad, precioRazonable, redondearPrecio } from "@/lib/reglas-precio";
import { enteroPositivo, textoLimpio } from "@/lib/utilidades";

export const NO_DISPONIBLE =
  "El asistente de IA no está disponible en este momento. Puedes llenar el formulario a mano.";
const MAX_COMPARABLES = 25;

// Lo que tiene que devolver Gemini en cada caso. El AI SDK se lo pasa como esquema
// y valida la respuesta: si no cumple, cuenta como fallo (503 o el respaldo).
const ESQUEMA_PUBLICACION = z.object({
  titulo: z.string(),
  descripcion: z.string(),
  categoriaId: z.number().int(),
  unidad: z.string(),
  esMaterial: z.boolean(),
});
const ESQUEMA_PRECIO = z.object({
  precioSugerido: z.number(),
  explicacion: z.string(),
});

// Pide a Gemini un objeto con el esquema indicado (AI SDK: generateText + Output.object).
// Un solo reintento y 20 s como máximo: si Gemini no responde (o el plan gratis da 429),
// se usa el respaldo en segundos en vez de colgar la función.
async function preguntarObjeto<T>({
  contenido,
  esquema,
  temperatura = 0.4,
}: {
  contenido: UserContent;
  esquema: z.ZodType<T>;
  temperatura?: number;
}): Promise<T> {
  const modelo = modeloIA();
  if (!modelo) throw new ErrorHttp(503, NO_DISPONIBLE);
  try {
    const { output } = await generateText({
      model: modelo,
      messages: [{ role: "user", content: contenido }],
      output: Output.object({ schema: esquema }),
      temperature: temperatura,
      maxOutputTokens: 800,
      maxRetries: 1,
      timeout: { totalMs: 20_000 },
    });
    return output;
  } catch (err) {
    console.error("❌ Asistente de IA (Gemini):", (err as Error).message || err);
    throw new ErrorHttp(503, NO_DISPONIBLE);
  }
}

// foto: la que subió el proveedor (o null). titulo: lo que ya escribió (opcional).
export async function describirPublicacion({
  foto = null,
  titulo = "",
}: {
  foto?: Foto | null;
  titulo?: unknown;
}) {
  const tituloActual = textoLimpio(titulo).slice(0, 120);
  if (!foto && !tituloActual)
    throw new ErrorHttp(
      400,
      "Sube una foto del material o escribe al menos el título.",
    );
  const { rows: categorias } = await obtenerPool().query<{
    categoria_id: number;
    nombre_categoria: string;
  }>(
    "SELECT categoria_id, nombre_categoria FROM categorias_materiales ORDER BY categoria_id",
  );

  const instrucciones = `Eres el asistente de EntreLazados, un mercado de Nicaragua donde proveedores venden materia prima
para calzado y marroquinería (cuero, suelas, herrajes, hilos, pegamentos...) a talleres y emprendedores.
Ayuda a un proveedor a publicar un material. ${foto ? "Mira la foto del material." : ""}
${tituloActual ? `El proveedor ya escribió este título: "${tituloActual}".` : ""}
Responde en español de Nicaragua, sin inventar datos que no se vean o no se digan (no inventes medidas, marcas ni cantidades).
- titulo: corto y concreto (máximo 80 caracteres), p. ej. "Cuero vacuno curtido café, 1.8 mm".
- descripcion: 2 a 4 oraciones útiles para un comprador: material, color, acabado, usos recomendados en calzado o marroquinería. Máximo 500 caracteres.
- categoriaId: el número de la categoría que mejor corresponde de esta lista:
${categorias.map((c) => `  ${c.categoria_id} = ${c.nombre_categoria}`).join("\n")}
- unidad: la unidad de venta más común para ese material, p. ej. "por pie²", "por par", "por docena", "por metro", "por unidad".
- esMaterial: false si la foto no muestra un material o insumo para calzado o marroquinería.`;

  const contenido: UserContent = [{ type: "text", text: instrucciones }];
  if (foto) contenido.unshift({ type: "file", mediaType: foto.tipo, data: foto.buffer });
  const r = await preguntarObjeto({ contenido, esquema: ESQUEMA_PUBLICACION });
  if (r.esMaterial === false) {
    throw new ErrorHttp(
      422,
      "La foto no parece mostrar un material para calzado o marroquinería. Prueba con otra foto.",
    );
  }
  const categoria =
    categorias.find((c) => c.categoria_id === enteroPositivo(r.categoriaId)) ||
    null;
  return {
    titulo: textoLimpio(r.titulo).slice(0, 120) || tituloActual,
    descripcion: textoLimpio(r.descripcion).slice(0, LARGO_DESCRIPCION),
    categoriaId: categoria ? categoria.categoria_id : null,
    categoria: categoria ? categoria.nombre_categoria : null,
    unidad: textoLimpio(r.unidad).slice(0, 30),
  };
}

type Comparable = {
  titulo: string;
  precio: number;
  unidad: string | null;
  fuente: string;
};

// Publicaciones y tratos parecidos para comparar precios
async function buscarComparables({
  categoriaId,
  unidad,
  excluirOfertaId,
}: {
  categoriaId: number;
  unidad: string;
  excluirOfertaId: number | null;
}) {
  const pool = obtenerPool();
  const [{ rows: ofertas }, { rows: tratos }] = await Promise.all([
    pool.query(
      `SELECT oferta_id, titulo_material, precio, unidad_medida FROM ofertas
       WHERE categoria_id = $1 AND oferta_id <> $2 ORDER BY fecha_publicacion DESC LIMIT 200`,
      [categoriaId, excluirOfertaId || 0],
    ),
    pool.query(
      `SELECT t.monto_total, s.titulo_lote, o.unidad_medida
       FROM tratos_cerrados t
       JOIN subastas s ON t.tipo_origen = 'Subasta' AND s.subasta_id = t.origen_id
       JOIN ofertas o ON o.oferta_id = s.oferta_id
       WHERE s.categoria_id = $1 AND t.estado_trato <> 'Cancelado'
       ORDER BY t.fecha_cierre DESC LIMIT 50`,
      [categoriaId],
    ),
  ]);
  const miUnidad = normalizarUnidad(unidad);
  const todos: Comparable[] = [
    ...ofertas.map((o) => ({
      titulo: o.titulo_material,
      precio: Number(o.precio),
      unidad: o.unidad_medida,
      fuente: "publicación",
    })),
    // Un trato solo sirve si su subasta salió de una publicación (así se sabe la unidad de su precio)
    ...tratos
      .filter((t) => t.unidad_medida)
      .map((t) => ({
        titulo: String(t.titulo_lote).replace(/^Lote Subasta:\s*/i, ""),
        precio: Number(t.monto_total),
        unidad: t.unidad_medida,
        fuente: "subasta cerrada",
      })),
  ];
  const mismaUnidad = miUnidad
    ? todos.filter((c) => c.unidad && normalizarUnidad(c.unidad) === miUnidad)
    : [];
  // Con al menos 2 precios de la misma unidad se usan solo esos; si no, toda la categoría (con aviso)
  const usarMismaUnidad = mismaUnidad.length >= 2;
  return {
    comparables: (usarMismaUnidad ? mismaUnidad : todos).slice(0, 200),
    mismaUnidad: usarMismaUnidad,
  };
}

// { titulo, categoriaId, unidad, ofertaId? } -> { sugerido, rango, explicacion, fuente, ... }
export async function sugerirPrecio({
  titulo,
  categoriaId,
  unidad,
  ofertaId,
}: Record<string, unknown>) {
  const categoria = enteroPositivo(categoriaId);
  if (!categoria)
    throw new ErrorHttp(
      400,
      "Elige la categoría del material para comparar precios.",
    );
  const {
    rows: [cat],
  } = await obtenerPool().query<{ nombre_categoria: string }>(
    "SELECT nombre_categoria FROM categorias_materiales WHERE categoria_id = $1",
    [categoria],
  );
  if (!cat) throw new ErrorHttp(400, "La categoría elegida no existe.");
  const tituloLimpio = textoLimpio(titulo).slice(0, 120);
  const unidadLimpia = textoLimpio(unidad).slice(0, 30);

  const { comparables, mismaUnidad } = await buscarComparables({
    categoriaId: categoria,
    unidad: unidadLimpia,
    excluirOfertaId: enteroPositivo(ofertaId),
  });
  const est = estadisticas(comparables.map((c) => c.precio));
  const base = {
    categoria: cat.nombre_categoria,
    muestras: est ? est.muestras : 0,
    rango: est
      ? {
          minimo: est.minimo,
          maximo: est.maximo,
          promedio: est.promedio,
          mediana: est.mediana,
        }
      : null,
    mismaUnidad,
    ejemplos: comparables
      .slice(0, 5)
      .map((c) => ({
        titulo: c.titulo,
        precio: c.precio,
        unidad: c.unidad,
        fuente: c.fuente,
      })),
  };
  if (!est) {
    return {
      ...base,
      sugerido: null,
      fuente: "sin-datos",
      explicacion: `Todavía no hay publicaciones de ${cat.nombre_categoria} para comparar. Pon el precio al que vendes normalmente; cuando haya más publicaciones podremos sugerirte uno.`,
    };
  }
  const avisoUnidad = mismaUnidad
    ? ""
    : " Ojo: algunas publicaciones usan otra unidad de medida, así que tómalo como referencia.";
  const respaldo = {
    ...base,
    sugerido: redondearPrecio(est.mediana),
    fuente: "estadistica",
    explicacion:
      `En ${cat.nombre_categoria} hay ${est.muestras} precio${est.muestras === 1 ? "" : "s"} para comparar, entre C$${est.minimo} y C$${est.maximo}. ` +
      `Te sugerimos el precio del medio (la mediana).${avisoUnidad}`,
  };
  if (!modeloIA()) return respaldo;
  try {
    const lista = comparables
      .slice(0, MAX_COMPARABLES)
      .map(
        (c) =>
          `- ${c.titulo}: C$${c.precio}${c.unidad ? ` ${c.unidad}` : ""} (${c.fuente})`,
      )
      .join("\n");
    const r = await preguntarObjeto({
      temperatura: 0.2,
      esquema: ESQUEMA_PRECIO,
      contenido: [
        {
          type: "text",
          text: `Eres el asistente de precios de EntreLazados (Nicaragua, precios en córdobas C$).
Un proveedor quiere publicar: "${tituloLimpio || "material sin título"}" en la categoría ${cat.nombre_categoria}${unidadLimpia ? `, vendido ${unidadLimpia}` : ""}.
Precios de materiales parecidos en la plataforma (mediana C$${est.mediana}, mínimo C$${est.minimo}, máximo C$${est.maximo}):
${lista}
Propón un precio competitivo DENTRO de ese rango para que se venda pronto sin regalar el material,
y explica en 1 o 2 oraciones sencillas por qué (menciona con qué publicaciones lo comparaste). No inventes otros datos.${mismaUnidad ? "" : " Algunas publicaciones usan otra unidad: dilo en la explicación."}`,
        },
      ],
    });
    if (!precioRazonable(r.precioSugerido, est) || !textoLimpio(r.explicacion))
      return respaldo;
    return {
      ...base,
      sugerido: redondearPrecio(Number(r.precioSugerido)),
      fuente: "ia",
      explicacion: textoLimpio(r.explicacion).slice(0, 500),
    };
  } catch {
    return respaldo; // sin IA, la sugerencia por estadística sigue sirviendo
  }
}
