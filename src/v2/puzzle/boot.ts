import { FALLBACK_GAME, GAMES, IMAGE_EXT, IMAGE_PREFIX } from "./store";

// Inline <script> in the root layout's <head>: runs synchronously on every
// page load, so the backdrop's CSS variable is set before first paint and
// only the chosen image ever loads. Picks uniformly at random on every load (nothing is
// persisted); if anything throws it falls back to FALLBACK_GAME, matching
// the store's default. The pick is also kept on `self.__puzzleGame`: React
// strips every attribute off <html> if it ever client-renders the root (a
// failed hydration), so the DOM stamp alone isn't reliable — BootSync
// re-applies it from the global. Keep it ES5-ish and tiny — it's not bundled.
// Only the home page shows the image, so only it preloads; arriving there by a
// client navigation fetches it through the CSS variable.
export const PUZZLE_BOOT_SCRIPT = `(function(){var G=${JSON.stringify(GAMES)},g=${JSON.stringify(FALLBACK_GAME)};try{g=G[Math.floor(Math.random()*G.length)]}catch(e){}self.__puzzleGame=g;var el=document.documentElement;el.dataset.game=g;var u=${JSON.stringify(IMAGE_PREFIX)}+g+${JSON.stringify(IMAGE_EXT)};el.style.setProperty("--puzzle-image","url("+u+")");if(location.pathname==="/"){var l=document.createElement("link");l.rel="preload";l.as="image";l.setAttribute("fetchpriority","high");l.href=u;document.head.appendChild(l)}})();`;
