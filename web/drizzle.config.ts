// Configuración de drizzle-kit (npm run db:generar / db:migrar / db:estudio / db:revisar).
// Usa la conexión DIRECTA de Neon (DATABASE_URL_UNPOOLED): el pooler no sirve
// para cambios de esquema. Las variables salen de .env.local (neon env pull).
import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: ".env.local", quiet: true });

const url = (process.env.DATABASE_URL_UNPOOLED ?? "").trim();

export default defineConfig({
  dialect: "postgresql",
  schema: "./db/esquema.ts",
  out: "./db/migraciones",
  casing: "snake_case",
  // verify-full: verifica el certificado (pg avisa que "require" cambiará de significado)
  dbCredentials: { url: url.replace(/sslmode=(require|prefer|verify-ca)/, "sslmode=verify-full") },
  strict: true,
  verbose: true,
});
