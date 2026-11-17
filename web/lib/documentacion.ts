// La especificación OpenAPI se escribe a mano en web/docs/openapi.yaml.
// next.config.ts la incluye en la función de Vercel (outputFileTracingIncludes).
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

let especificacion: unknown;

export function leerEspecificacion(): unknown {
  especificacion ??= YAML.parse(fs.readFileSync(path.join(process.cwd(), "docs", "openapi.yaml"), "utf8"));
  return especificacion;
}
