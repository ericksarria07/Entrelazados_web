// GET /api/docs: documentación interactiva de la API (Swagger UI, desde unpkg)
// Lee /api/openapi.json. El token pegado en "Authorize" sobrevive al recargar.
import { connection } from "next/server";

const SWAGGER = "https://unpkg.com/swagger-ui-dist@5.34.1";

const PAGINA = `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>API de EntreLazados</title>
  <link rel="stylesheet" href="${SWAGGER}/swagger-ui.css">
  <style>body { margin: 0; background: #fff; } .swagger-ui .topbar { display: none }</style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="${SWAGGER}/swagger-ui-bundle.js"></script>
  <script>
    window.ui = SwaggerUIBundle({
      url: '/api/openapi.json',
      dom_id: '#swagger-ui',
      persistAuthorization: true,
      docExpansion: 'none',
      tagsSorter: 'alpha'
    });
  </script>
</body>
</html>`;

export async function GET() {
  await connection();
  return new Response(PAGINA, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
