// ==========================================================================
// PASA EL <style> DE UNA PÁGINA VIEJA A UN CSS MODULE (Fase 2)
//
//   node scripts/estilos-a-modulo.mjs public/login.html app/login/login.module.css
//
// Reglas (ver README, "Cómo se pasa una página a React"):
//   - body / html  → la clase raíz local .pagina (que envuelve toda la página)
//   - cualquier otro selector → .pagina :global(selector): los nombres de clase
//     quedan globales, así el modo oscuro de public/tema.css los sigue encontrando
//   - :root → las variables propias pasan a .pagina; las de colores base
//     (app/estilos/base.css) se quitan para no tapar las del modo oscuro
//   - el reinicio * { margin/padding/box-sizing } se quita (ya está en base.css)
//   - 'Source Sans 3' → var(--fuente-base) (next/font cambia el nombre de la letra)
//   - url(imagen.webp) → url(/imagen.webp) (archivos de public/)
//   - @keyframes se quedan en el módulo (Turbopack renombra la animación y sus usos)
// El resultado se revisa a mano: es el punto de partida, no la última palabra.
// ==========================================================================
import fs from "node:fs";
import postcss from "postcss";

const [, , entrada, salida] = process.argv;
if (!entrada || !salida) {
  console.error("Uso: node scripts/estilos-a-modulo.mjs <pagina.html> <salida.module.css>");
  process.exit(1);
}

const BASE = {
  "--color-principal": "#7d381b",
  "--color-secundario": "#3d170a",
  "--color-terciario": "#993d24",
};
const RAIZ = ".pagina";

const html = fs.readFileSync(entrada, "utf8");
const css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join("\n");
const raizAst = postcss.parse(css);
const raiz = postcss.rule({ selector: RAIZ });

const globalizar = (sel) => {
  sel = sel.trim();
  if (sel === "body" || sel === "html") return RAIZ;
  const deTema = sel.match(/^(html\[[^\]]+\])\s+(.*)$/);
  if (deTema) return `:global(${deTema[1]}) ${globalizar(deTema[2])}`;
  if (sel.startsWith("body ")) sel = sel.slice(5).trim();
  return `${RAIZ} :global(${sel})`;
};

raizAst.walkDecls((d) => {
  d.value = d.value
    .replace(/(["'])Source Sans 3\1/g, "var(--fuente-base)")
    .replace(/url\((["']?)(?!https?:|data:|\/)([^)"']+)\1\)/g, "url('/$2')");
});

raizAst.walkRules((regla) => {
  if (regla.parent?.type === "atrule" && /keyframes/.test(regla.parent.name)) return;
  const sels = regla.selectors.map((s) => s.trim());

  if (sels.length === 1 && sels[0] === ":root") {
    regla.each((d) => {
      if (d.type !== "decl") return;
      if (BASE[d.prop] && BASE[d.prop] === d.value.trim().toLowerCase()) return;
      raiz.append(d.clone());
    });
    regla.remove();
    return;
  }
  if (sels.length === 1 && sels[0] === "*") {
    const soloReinicio = regla.nodes.every((d) => d.type !== "decl" || ["box-sizing", "margin", "padding"].includes(d.prop));
    if (soloReinicio) {
      regla.remove();
      return;
    }
  }
  if (sels.every((s) => s === "body" || s === "html")) {
    // dentro de un @media se queda como regla de .pagina; arriba se junta con la raíz
    if (regla.parent.type === "root") {
      regla.each((d) => d.type === "decl" && raiz.append(d.clone()));
      regla.remove();
      return;
    }
  }
  regla.selectors = sels.map(globalizar);
});

// En modo oscuro tema.css pinta el fondo de <body>: aquí lo hace la raíz
const oscuro = postcss.parse(
  `:global(html[data-tema="oscuro"]) ${RAIZ} { background-color: #17110e; color: var(--text-dark); }`
);
raizAst.prepend(oscuro);
raizAst.prepend(raiz);
// Formato parejo (las páginas viejas tenían sangrías mezcladas)
raizAst.cleanRaws();
raizAst.walk((n) => {
  if (n.type === "decl") return;
  n.raws.before = n.parent === raizAst ? "\n\n" : "\n";
  n.raws.after = "\n";
  if (n.type === "rule" || n.type === "atrule") n.raws.between = " ";
});
raizAst.walkDecls((d) => {
  const nivel = d.parent.parent?.type === "atrule" && d.parent.parent.parent === raizAst ? "        " : "    ";
  d.raws.before = "\n" + nivel;
  d.raws.between = ": ";
});
raizAst.walkRules((r) => {
  if (r.parent?.type === "atrule") { r.raws.before = "\n    "; r.raws.after = "\n    "; }
});

const cabecera = `/* Estilos de ${entrada.replace(/^.*\//, "")}, pasados a CSS Module con scripts/estilos-a-modulo.mjs.\n   Los nombres de clase de adentro son globales (:global) para que el modo oscuro de\n   public/tema.css los siga encontrando. */\n`;
fs.writeFileSync(salida, cabecera + raizAst.toString().replace(/^\n+/, "").replace(/\n{3,}/g, "\n\n") + "\n");
console.log(`✅ ${salida}`);
