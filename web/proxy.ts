// ==========================================================================
// PROXY (antes "middleware"): corre antes de cada petición a /api/* y a /registro.
//
// Protección CSRF: con la sesión en una cookie, el navegador la mandaría sola aunque
// la petición la dispare otro sitio. SameSite=Lax ya frena los formularios ajenos;
// además aquí se rechaza cualquier escritura (POST, PUT, PATCH, DELETE) cuyo Origin
// sea de otro sitio. Las peticiones sin Origin (pruebas, curl, Vercel Cron) pasan:
// los navegadores siempre lo mandan en las escrituras.
// ==========================================================================
import { type NextRequest, NextResponse } from "next/server";

const LECTURAS = new Set(["GET", "HEAD", "OPTIONS"]);

export function proxy(req: NextRequest) {
  if (LECTURAS.has(req.method)) return NextResponse.next();
  const origen = req.headers.get("origin");
  if (!origen) return NextResponse.next();

  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  let hostOrigen: string | null = null;
  try {
    hostOrigen = new URL(origen).host;
  } catch {
    /* Origin raro ("null", mal formado): se rechaza */
  }
  if (host && hostOrigen === host) return NextResponse.next();

  return NextResponse.json(
    { message: "Petición rechazada: viene de otro sitio." },
    { status: 403, headers: { "Cache-Control": "no-store" } }
  );
}

export const config = {
  // /registro está fuera de /api (lo pide así el formulario de /unirse), pero también es una escritura
  matcher: ["/api/:path*", "/registro"],
};
