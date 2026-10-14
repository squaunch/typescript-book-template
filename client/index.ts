// Entry point for assets/book.js. Each feature only runs if it's enabled in
// book.config.ts (the build lists enabled features on <html data-features>).

import { initBadges } from "./badges";
import { initChrome } from "./chrome";
import { initQuizzes } from "./quiz";
import { initRunnable } from "./runnable";
import { initSearch } from "./search";

const root = document.documentElement.dataset.root ?? "";
const features = new Set((document.documentElement.dataset.features ?? "").split(" "));

initChrome();
if (features.has("search")) initSearch(root);
if (features.has("quizzes")) initQuizzes();
if (features.has("badges")) initBadges(root);
if (features.has("runnable")) initRunnable();
