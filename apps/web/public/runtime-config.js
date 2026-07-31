// En `vite dev` este archivo evita 404. En producción (Railway), `start` sobrescribe dist/runtime-config.js.
// En Vercel usá VITE_API_URL en build time; este archivo puede quedar vacío.
window.__APPPADEL_API_URL__ = window.__APPPADEL_API_URL__ || "";
