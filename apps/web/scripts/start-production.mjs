import { existsSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const dist = join(root, "dist");

if (!existsSync(join(dist, "index.html"))) {
  console.error("No existe apps/web/dist/index.html. Ejecutá build antes de start.");
  process.exit(1);
}

const apiUrl = (process.env.VITE_API_URL ?? process.env.API_URL ?? "").trim();
writeFileSync(
  join(dist, "runtime-config.js"),
  `window.__APPPADEL_API_URL__=${JSON.stringify(apiUrl)};\n`
);

if (!apiUrl) {
  console.warn(
    "Aviso: VITE_API_URL (o API_URL) está vacío. El front usará localhost salvo que el build ya haya inyectado la URL."
  );
}

const port = process.env.PORT ?? "4173";
const listen = `tcp://0.0.0.0:${port}`;
const child = spawn("npx", ["serve", dist, "-s", "-l", listen], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
  shell: process.platform === "win32",
});

child.on("exit", (code) => process.exit(code ?? 0));
