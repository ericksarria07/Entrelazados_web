// ==========================================================================
// PRUEBAS E2E CON PLAYWRIGHT (ROADMAP 2.8)
//
//   cd web && npm run build && npm run e2e
//
// Antes de las pruebas se vacía y se siembra la base de PRUEBAS (pruebas/e2e/preparar.mjs)
// y se levanta `next start` en el puerto 3066 contra ella. Las pruebas no dependen de
// Gemini, Ably ni Vercel Blob: corren igual en el CI (Postgres desechable) y en local.
// ==========================================================================
import { defineConfig, devices } from "@playwright/test";

const PUERTO = 3066;

export default defineConfig({
  testDir: "pruebas/e2e",
  globalSetup: "./pruebas/e2e/preparar.mjs",
  // Los flujos comparten cuentas y datos: van en orden, uno a la vez
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  reporter: process.env.CI ? [["list"], ["html", { open: "never", outputFolder: "pruebas/e2e/informe" }]] : "list",
  outputDir: "pruebas/e2e/resultados",
  use: {
    baseURL: `http://localhost:${PUERTO}`,
    locale: "es-NI",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "celular", use: { ...devices["Pixel 7"] } }],
  webServer: {
    command: `node_modules/.bin/next start -p ${PUERTO}`,
    url: `http://localhost:${PUERTO}/api/salud`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      NODE_ENV: "production",
      DATABASE_URL: process.env.PRUEBAS_DATABASE_URL ?? "",
      JWT_SECRET: "secreto-e2e-local",
      GEMINI_API_KEY: "sin-clave",
      ABLY_API_KEY: "",
      EMAIL_USER: "",
      EMAIL_PASS: "",
      APP_URL: "",
      VERIFICAR_CORREO: "0",
      CIERRE_PEREZOSO: "0",
      LIMITE_REGISTRO: "40",
      LIMITE_LOGIN: "60",
      LIMITE_API: "5000",
    },
  },
});
