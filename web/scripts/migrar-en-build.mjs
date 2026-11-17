// ==========================================================================
// MIGRACIONES AUTOMÁTICAS EN EL BUILD DE VERCEL (ROADMAP 1.12)
//
//   vercel.json → "buildCommand": "npm run vercel-build"
//               = node scripts/migrar-en-build.mjs && next build
//
// Aplica las migraciones pendientes de db/migraciones (drizzle-kit migrate) ANTES
// de construir, así la versión nueva nunca queda activa con un esquema viejo:
//   production  → la base real. Si falta la conexión o la migración falla, el
//                 build falla y producción sigue con la versión anterior.
//   preview     → la rama de Neon de esa vista previa (integración Neon ↔ Vercel).
//                 Si la vista previa no tiene base, solo avisa y sigue.
// Las migraciones tienen que ser compatibles hacia atrás (ver README) para que
// un rollback a la versión anterior siga funcionando con el esquema nuevo.
// ==========================================================================
import { spawnSync } from "node:child_process";

const entorno = process.env.VERCEL_ENV || "local";
const hayConexion = Boolean((process.env.DATABASE_URL_UNPOOLED ?? "").trim());

if (!hayConexion) {
  if (entorno === "production") {
    console.error("❌ Falta DATABASE_URL_UNPOOLED en producción: no se pueden aplicar las migraciones.");
    process.exit(1);
  }
  console.warn(`⚠️  Sin DATABASE_URL_UNPOOLED (${entorno}): se omiten las migraciones.`);
  process.exit(0);
}

console.log(`▶ Migraciones (${entorno})…`);
const r = spawnSync("npx", ["drizzle-kit", "migrate"], { stdio: "inherit" });
if (r.status !== 0) {
  console.error("❌ La migración falló: se detiene el build.");
  process.exit(r.status ?? 1);
}
console.log("✅ Esquema al día.");
