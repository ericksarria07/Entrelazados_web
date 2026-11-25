// Igual que tema.js: elección guardada o, si no hay, el modo del sistema. Va en línea
// en el <head> para que corra antes de pintar. Lo usan app/layout.tsx y
// app/global-error.tsx (que arma su propio <html> y no pasa por el layout).
export const SCRIPT_TEMA = `(function(){try{var t=localStorage.getItem('entrelazados-tema');if(t!=='claro'&&t!=='oscuro'){t=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'oscuro':'claro'}var r=document.documentElement;r.setAttribute('data-tema',t);r.style.colorScheme=t==='oscuro'?'dark':'light'}catch(e){}})();`;
