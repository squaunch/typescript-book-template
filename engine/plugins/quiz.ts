import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { parse as parseToml } from "smol-toml";

import { normaliseAnswer, type QuizData, type QuizQuestion } from "../../shared/quiz";
import { isObj, isStr, isStrArray } from "../../shared/guards";
import { BookError, errorMessage, type Plugin, type PluginContext } from "../config";
import { escapeHtml } from "../markdown";
import { NOT_ESCAPED, outsideCode } from "../text";

const QUIZ_DIRECTIVE = new RegExp(`^${NOT_ESCAPED}\\{\\{#quiz\\s+([^}\\s]+)\\s*\\}\\}\\s*$`, "gm");

/**
 * `{{#quiz ../quizzes/name.toml}}` -> an interactive quiz.
 *
 * Quiz files use the same TOML format as mdbook-quiz, minus the Rust-only
 * `Tracing` question type. See `quizzes/ch01-01-section-title.toml`.
 */
export const quizPlugin: Plugin = {
  name: "quiz",
  preprocess(source, ctx) {
    if (!ctx.config.features.quizzes) return outsideCode(source, text => text.replace(QUIZ_DIRECTIVE, ""));
    return outsideCode(source, text => text.replace(QUIZ_DIRECTIVE, (_m, rel: string) => {
      const file = path.resolve(path.dirname(ctx.file), rel);
      const data = loadQuiz(file, ctx);
      const json = JSON.stringify(data).replace(/</g, "\\u003c");
      return (
        `<div class="quiz" data-quiz="${escapeHtml(data.name)}">` +
        `<script type="application/json">${json}</script>` +
        `<noscript>This quiz needs JavaScript.</noscript></div>\n`
      );
    }));
  },
};

export function loadQuiz(file: string, ctx: PluginContext): QuizData {
  const display = path.relative(ctx.config.root, file);
  if (!fs.existsSync(file)) throw new BookError(`quiz file not found: ${display}`, ctx.page.path);

  let raw: unknown;
  try {
    raw = parseToml(fs.readFileSync(file, "utf8"));
  } catch (e) {
    throw new BookError(`invalid TOML: ${errorMessage(e)}`, display, { cause: e });
  }

  // Quiz ids must be unique across the whole book, because answers are cached by id.
  let ids = ctx.buildState.get("quiz:ids") as Map<string, string> | undefined;
  if (!ids) ctx.buildState.set("quiz:ids", (ids = new Map()));

  const questions = validateQuiz(raw, display, ids).map(q => renderQuestion(q, ctx));
  return {
    name: display.replace(/\\/g, "/").replace(/\.toml$/, ""),
    // Changes whenever questions/options change, so saved answers from an
    // older version of the quiz are discarded instead of misread.
    version: createHash("sha256").update(JSON.stringify(questions)).digest("hex").slice(0, 12),
    fullscreen: ctx.config.quiz.fullscreen,
    cacheAnswers: ctx.config.quiz.cacheAnswers,
    questions,
  };
}

/** A question from a TOML file, after validation, with the multipart scenario resolved. */
export type SourceQuestion = {
  id: string;
  prompt: string;
  context?: string | undefined;
  /** The shared scenario text (from [multipart]), if any. */
  multipart?: string | undefined;
} & (
  | { type: "MultipleChoice"; answers: string[]; multi: boolean; distractors: string[]; sortAnswers: boolean }
  | { type: "ShortAnswer"; answer: string; alternatives: string[] }
);

/** Checks a parsed quiz file and returns its questions, or throws a helpful BookError. */
export function validateQuiz(raw: unknown, file: string, seenIds = new Map<string, string>()): SourceQuestion[] {
  const fail = (msg: string): never => {
    throw new BookError(msg, file);
  };
  if (!isObj(raw) || !Array.isArray(raw["questions"]) || raw["questions"].length === 0) {
    return fail("needs at least one [[questions]] entry");
  }
  const scenarios = isObj(raw["multipart"]) ? raw["multipart"] : {};

  return (raw["questions"] as unknown[]).map((q, i): SourceQuestion => {
    const where = `question ${i + 1}`;
    if (!isObj(q)) return fail(`${where}: not a table`);
    const id = q["id"];
    if (!isStr(id) || id.trim() === "") return fail(`${where}: missing "id" (generate one with \`uuidgen\`)`);
    const prev = seenIds.get(id);
    if (prev) fail(`${where}: id "${id}" is already used in ${prev}`);
    seenIds.set(id, file);

    if (q["type"] === "Tracing") {
      fail(`${where}: "Tracing" questions are Rust-specific. Use MultipleChoice or ShortAnswer instead`);
    }
    const prompt = isObj(q["prompt"]) ? q["prompt"] : fail(`${where}: missing prompt.prompt`);
    const answer = isObj(q["answer"]) ? q["answer"] : fail(`${where}: missing answer.answer`);
    const promptText = isStr(prompt["prompt"]) ? prompt["prompt"] : fail(`${where}: prompt.prompt must be a string`);
    const rawContext = q["context"];
    const context = rawContext === undefined || isStr(rawContext) ? rawContext : fail(`${where}: context must be a string`);

    let multipart: string | undefined;
    if (q["multipart"] !== undefined) {
      const key = q["multipart"];
      const scenario = isStr(key) ? scenarios[key] : undefined;
      multipart = isStr(scenario) ? scenario : fail(`${where}: multipart = "${String(key)}" has no matching entry under [multipart]`);
    }
    const base = { id, prompt: promptText, context, multipart };

    switch (q["type"]) {
      case "MultipleChoice": {
        const distractors = prompt["distractors"] ?? [];
        if (!isStrArray(distractors)) return fail(`${where}: prompt.distractors must be a list of strings`);
        const a = answer["answer"];
        const answers = isStr(a) ? [a] : isStrArray(a) && a.length > 0 ? a : null;
        if (!answers) return fail(`${where}: answer.answer must be a string, or a non-empty list for select-all questions`);
        if (isStr(a) && distractors.length === 0) fail(`${where}: a single-answer question needs at least one distractor`);
        const rawSort = prompt["sortAnswers"] ?? false;
        const sortAnswers = typeof rawSort === "boolean" ? rawSort : fail(`${where}: prompt.sortAnswers must be true or false`);
        return { ...base, type: "MultipleChoice", answers, multi: !isStr(a), distractors, sortAnswers };
      }
      case "ShortAnswer": {
        const a = answer["answer"];
        if (!isStr(a)) return fail(`${where}: answer.answer must be a string`);
        const alternatives = answer["alternatives"] ?? [];
        if (!isStrArray(alternatives)) return fail(`${where}: answer.alternatives must be a list of strings`);
        return { ...base, type: "ShortAnswer", answer: a, alternatives };
      }
      default:
        return fail(`${where}: unknown type "${String(q["type"])}" (expected MultipleChoice or ShortAnswer)`);
    }
  });
}

function renderQuestion(q: SourceQuestion, ctx: PluginContext): QuizQuestion {
  const md = (s: string) => ctx.md.render(s);
  const mdInline = (s: string) => ctx.md.renderInline(s);
  const base = {
    id: q.id,
    prompt: md(q.prompt),
    ...(q.multipart ? { multipart: md(q.multipart) } : {}),
    ...(q.context ? { context: md(q.context) } : {}),
  };
  if (q.type === "MultipleChoice") {
    return {
      ...base,
      type: "MultipleChoice",
      multi: q.multi,
      sortAnswers: q.sortAnswers,
      options: [
        ...q.answers.map(a => ({ html: mdInline(a), correct: true })),
        ...q.distractors.map(d => ({ html: mdInline(d), correct: false })),
      ],
    };
  }
  return {
    ...base,
    type: "ShortAnswer",
    accepted: [q.answer, ...q.alternatives].map(normaliseAnswer),
    display: q.answer,
  };
}
