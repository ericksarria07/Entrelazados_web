"use client";
// Vercel Web Analytics (visitas) y Speed Insights (Core Web Vitals reales), sin
// cookies. Solo se pinta en Vercel (app/layout.tsx): en local y en el CI no existe
// /_vercel/insights/script.js. Antes de enviar, quita los tokens de la dirección.
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { sinDatosPrivados } from "@/lib/medicion";

export default function Medicion() {
  return (
    <>
      <Analytics beforeSend={(evento) => ({ ...evento, url: sinDatosPrivados(evento.url) })} />
      <SpeedInsights beforeSend={(evento) => ({ ...evento, url: sinDatosPrivados(evento.url) })} />
    </>
  );
}
