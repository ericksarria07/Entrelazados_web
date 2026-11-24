// POST /api/ia/publicacion (proveedores): multipart con una foto en "fotos" y/o "titulo"
// -> { titulo, descripcion, categoriaId, categoria, unidad }. Nada se guarda: solo se propone.
import { describirPublicacion } from "@/lib/asistente-ia";
import { leerArchivos, revisarArchivos, validarFotos } from "@/lib/fotos";
import { ErrorHttp, json, leerFormulario, ruta } from "@/lib/http";
import { limite } from "@/lib/limites";
import { exigirRoles, exigirSesion } from "@/lib/sesion";

export const POST = ruta(async (req) => {
  const usuario = await exigirSesion(req);
  exigirRoles(usuario, "proveedor");
  await limite("ia", `u${usuario.id}`).consumir();
  const { campos, archivos } = await leerFormulario(req);
  const errorArchivos = revisarArchivos(archivos);
  if (errorArchivos) throw new ErrorHttp(400, errorArchivos);
  if (archivos.length > 1) throw new ErrorHttp(400, "Envía una sola foto para que la IA la describa.");
  const fotos = await leerArchivos(archivos);
  const errorFoto = validarFotos(fotos);
  if (errorFoto) throw new ErrorHttp(400, errorFoto);
  return json(await describirPublicacion({ foto: fotos[0] ?? null, titulo: campos.titulo }));
});
