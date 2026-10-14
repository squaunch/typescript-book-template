// Public API for book.config.ts and your own plugins.
export { defineConfig, definePlugin, BookError, errorMessage } from "./config";
export type { BookConfig, Features, Page, Plugin, PluginContext, ResolvedConfig } from "./config";
export type { Markdown, RenderEnv } from "./markdown";
export { escapeHtml, parseInfo } from "./markdown";
export { outsideCode } from "./text";
