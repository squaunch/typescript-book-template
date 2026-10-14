import { defineConfig } from "./engine";

export default defineConfig({
  title: "Your Book Title",
  authors: ["Your Name"],
  description: "One-line description, used for search engines and link previews.",
  language: "en",
  // repositoryUrl: "https://github.com/you/your-book",
  // URL path the site is served from, e.g. "/your-book/" for a GitHub project site.
  // basePath: "/",

  // Interactive features. All on by default; set any to false to remove it.
  features: {
    quizzes: true,
    highlights: true,
    badges: true,
    runnable: true,
    search: true,
  },

  quiz: {
    fullscreen: true,
    cacheAnswers: true,
  },

  // Old URL -> new URL, for when you rename or renumber pages.
  redirects: {
    // "old-chapter.html": "new-chapter.html",
  },

  // Your own build-time plugins (see GUIDE.md §11.2).
  plugins: [],
});
