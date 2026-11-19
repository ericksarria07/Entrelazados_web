// GET /api/usuarios/[id]/publico: perfil PÚBLICO (sin sesión), lo que se puede compartir
import { json, ruta } from "@/lib/http";
import { perfilPublico } from "@/lib/usuarios";

export const GET = ruta<RouteContext<"/api/usuarios/[id]/publico">>(async (_req, ctx) =>
  json(await perfilPublico((await ctx.params).id))
);
