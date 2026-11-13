// Entry point for assets/book.js, loaded on every page. Each feature only runs
// if it's enabled in book.config.ts (the build lists enabled features on
// <html data-features>). Quizzes, runnable code and diagrams have their own
// bundles (client/entries/, client/diagrams.ts), added only to pages that use them.

import { initBadges } from "./badges";
import { initChrome } from "./chrome";
import { initSearch } from "./search";

const root = document.documentElement.dataset.root ?? "";
const features = new Set((document.documentElement.dataset.features ?? "").split(" "));

initChrome();
if (features.has("search")) initSearch(root);
if (features.has("badges")) initBadges(root);
