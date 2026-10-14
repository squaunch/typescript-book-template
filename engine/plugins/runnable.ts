import { transformSync } from "esbuild";

import { BookError, type Plugin } from "../config";
import { escapeHtml, parseInfo, type RenderEnv } from "../markdown";

const LOADERS: Record<string, "ts" | "tsx" | "js" | "jsx"> = {
  ts: "ts",
  typescript: "ts",
  tsx: "tsx",
  js: "js",
  javascript: "js",
  jsx: "jsx",
};

/**
 * ```ts,runnable            -> ▶ Run button; output shown under the block
 * ```js,runnable,editable   -> reader can edit the code and re-run it
 *
 * TypeScript is compiled to JavaScript at build time with esbuild, so syntax
 * errors fail the build (like `mdbook test` for Rust). The browser runs the
 * result in a sandboxed iframe and shows console output.
 * Lines ending in `// @hide` run but aren't shown.
 */
export const runnablePlugin: Plugin = {
  name: "runnable",
  extendMarkdown(md, config) {
    const base = md.renderer.rules.fence!;
    md.renderer.rules.fence = (tokens, idx, options, env, self) => {
      const file = (env as RenderEnv | undefined)?.file;
      const html = base(tokens, idx, options, env, self);
      const { lang, flags } = parseInfo(tokens[idx]!.info);
      if (!flags.includes("runnable") || !config.features.runnable) return html;

      const where = `code block on line ${(tokens[idx]!.map?.[0] ?? 0) + 1}`;
      const loader = LOADERS[lang];
      if (!loader) throw new BookError(`${where}: "runnable" only works for ts/js blocks, not "${lang}"`, file);
      if (flags.includes("editable") && loader !== "js") {
        throw new BookError(`${where}: "editable" only works for js blocks (ts is compiled at build time)`, file);
      }

      let js: string;
      try {
        js = transformSync(tokens[idx]!.content, { loader, format: "esm", target: "es2022" }).code;
      } catch (e) {
        const msg = (e as { errors?: { text: string; location?: { line: number } }[] }).errors?.[0];
        throw new BookError(
          `${where}: does not compile${msg ? ` (line ${msg.location?.line}: ${msg.text})` : ""}. ` +
            `Tag it "does_not_compile" and drop "runnable" if that's intended`,
          file
        );
      }
      return html.replace("<pre ", `<pre data-runnable="${escapeHtml(js)}" `);
    };
  },
};
