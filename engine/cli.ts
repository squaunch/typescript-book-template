import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "./build";
import { BookError, resolveConfig, type BookConfig, type ResolvedConfig } from "./config";

const USAGE = `Usage:
  npm run build              build the book into ./book
  npm run dev [-- --port N] [--host H]
                             build, serve on http://localhost:3000 and rebuild on change`;

async function loadConfig(root: string): Promise<ResolvedConfig> {
  const file = path.join(root, "book.config.ts");
  if (!fs.existsSync(file)) throw new BookError("missing book.config.ts");
  const mod = (await import(pathToFileURL(file).href)) as { default?: BookConfig };
  if (!mod.default || typeof mod.default.title !== "string") {
    throw new BookError("book.config.ts must `export default defineConfig({ title: ... })`");
  }
  return resolveConfig(mod.default, root);
}

function report(e: unknown) {
  if (e instanceof BookError) console.error(`\x1b[31merror\x1b[0m ${e.message}`);
  else console.error(e);
}

async function runBuild(root: string) {
  const config = await loadConfig(root);
  const { pages, ms } = await build(config, { log: m => console.log(m) });
  console.log(`Built ${pages} pages into ${config.out}/ in ${ms} ms`);
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};

async function runDev(root: string, port: number, host: string) {
  const config = await loadConfig(root);
  const outDir = path.resolve(root, config.out);
  const clients = new Set<http.ServerResponse>();

  // One build at a time; changes made during a build trigger exactly one more.
  let running: Promise<void> | null = null;
  let pending = false;
  const rebuild = async (): Promise<void> => {
    if (running) {
      pending = true;
      return running;
    }
    running = (async () => {
      try {
        const { pages, ms } = await build(config, { dev: true, log: m => console.log(m) });
        console.log(`Rebuilt ${pages} pages in ${ms} ms`);
        for (const c of clients) c.write("data: reload\n\n");
      } catch (e) {
        report(e);
      }
    })();
    await running;
    running = null;
    if (pending) {
      pending = false;
      await rebuild();
    }
  };
  await rebuild();

  const notFound = (res: http.ServerResponse) => {
    const page = path.join(outDir, "404.html");
    res.writeHead(404, { "Content-Type": MIME[".html"] });
    res.end(fs.existsSync(page) ? fs.readFileSync(page) : "Not found");
  };

  const server = http.createServer((req, res) => {
    let url: string;
    try {
      url = decodeURIComponent((req.url ?? "/").split("?")[0]!);
    } catch {
      res.writeHead(400).end("Bad request");
      return;
    }
    if (url === "/__livereload") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
      res.write(": connected\n\n");
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }

    // Resolve inside outDir only; "." + url keeps a leading "/" from escaping it.
    let file = path.resolve(outDir, "." + url);
    if (file !== outDir && !file.startsWith(outDir + path.sep)) return notFound(res);
    try {
      if (fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
      if (!fs.statSync(file).isFile()) return notFound(res);
    } catch {
      return notFound(res); // missing, or removed by a rebuild in progress
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" });
    fs.createReadStream(file)
      .on("error", () => res.destroy())
      .pipe(res);
  });
  server.on("error", (e: NodeJS.ErrnoException) => {
    console.error(
      e.code === "EADDRINUSE"
        ? `\x1b[31merror\x1b[0m port ${port} is already in use. Try \`npm run dev -- --port ${port + 1}\``
        : `\x1b[31merror\x1b[0m ${e.message}`
    );
    process.exit(1);
  });
  // Localhost only: drafts shouldn't be reachable from the network. Use --host to override.
  server.listen(port, host, () => console.log(`Serving on http://${host === "127.0.0.1" ? "localhost" : host}:${port}  (Ctrl+C to stop)`));

  let timer: NodeJS.Timeout | undefined;
  const watch = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    fs.watch(dir, { recursive: true }, () => {
      clearTimeout(timer);
      timer = setTimeout(() => void rebuild(), 100);
    });
  };
  for (const dir of [config.src, "quizzes", "client", "shared", "theme"]) watch(path.resolve(root, dir));
  for (const file of ["book.config.ts", "engine"]) {
    const p = path.resolve(root, file);
    if (fs.existsSync(p)) {
      fs.watch(p, { recursive: true }, () => console.log(`${file} changed: restart \`npm run dev\` to pick it up`));
    }
  }
}

const [command, ...rest] = process.argv.slice(2);
const flag = (name: string) => {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : undefined;
};
const port = Number(flag("--port") ?? 3000);
const host = flag("--host") ?? "127.0.0.1";
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error(`\x1b[31merror\x1b[0m --port must be a number from 0 to 65535`);
  process.exit(1);
}

const run = command === "build" ? runBuild(process.cwd()) : command === "dev" ? runDev(process.cwd(), port, host) : null;
if (!run) {
  console.log(USAGE);
  process.exit(command ? 1 : 0);
}
run.catch(e => {
  report(e);
  process.exit(1);
});
