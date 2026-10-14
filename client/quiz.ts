// Interactive quizzes. The build (engine/plugins/quiz.ts) embeds each quiz as
// JSON inside <div class="quiz">; this turns it into a step-by-step quiz.
//
// Fires `book:quiz-complete` on window with { name, score, total } so you can
// hook in analytics or progress tracking without editing this file.

import { normaliseAnswer, type QuizData, type QuizQuestion } from "../shared/quiz";
import { isObj, isStr } from "../shared/guards";
import { readStorage, trapFocus, writeStorage } from "./chrome";

/** A reader's response: indices into `options` (multiple choice) or text (short answer). */
type Response = number[] | string;

interface Saved {
  /** QuizData.version the answers were given against. */
  version: string;
  answers: Response[];
}

let uid = 0;

export function initQuizzes() {
  for (const el of document.querySelectorAll<HTMLElement>(".quiz")) {
    const json = el.querySelector('script[type="application/json"]')?.textContent;
    if (json) new Quiz(el, JSON.parse(json) as QuizData);
  }
}

export function isCorrect(q: QuizQuestion, r: Response): boolean {
  if (q.type === "ShortAnswer") return typeof r === "string" && q.accepted.includes(normaliseAnswer(r));
  if (!Array.isArray(r)) return false;
  const correct = q.options.flatMap((o, i) => (o.correct ? [i] : []));
  return correct.length === r.length && correct.every(i => r.includes(i));
}

function shuffle<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

const plain = (html: string) => html.replace(/<[^>]+>/g, "");

class Quiz {
  private readonly id = `quiz-${++uid}`;
  private readonly key: string;
  private answers: Response[] = [];
  private order: number[][] = [];
  /** Element focused before the quiz opened; focus returns there on close. */
  private opener: HTMLElement | null = null;
  private onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") this.close();
    else trapFocus(this.el, e);
  };

  constructor(
    private readonly el: HTMLElement,
    private readonly data: QuizData
  ) {
    this.key = `book-quiz:${data.name}`;
    this.el.setAttribute("aria-label", "Quiz");
    this.renderIntro();
  }

  /** The saved attempt, if it matches the current version of the quiz and is well-formed. */
  private load(): Saved | null {
    if (!this.data.cacheAnswers) return null;
    let saved: unknown;
    try {
      saved = JSON.parse(readStorage(this.key) ?? "null");
    } catch {
      return null;
    }
    if (!isObj(saved) || saved["version"] !== this.data.version || !Array.isArray(saved["answers"])) return null;
    const answers: unknown[] = saved["answers"];
    const qs = this.data.questions;
    const ok =
      answers.length === qs.length &&
      qs.every((q, i) => {
        const r = answers[i];
        return q.type === "ShortAnswer"
          ? isStr(r)
          : Array.isArray(r) && r.every(j => Number.isInteger(j) && j >= 0 && j < q.options.length);
      });
    return ok ? { version: this.data.version, answers: answers as Response[] } : null;
  }

  private score(answers: Response[]): number {
    return this.data.questions.filter((q, i) => isCorrect(q, answers[i]!)).length;
  }

  private header(right: string): HTMLElement {
    const header = document.createElement("div");
    header.className = "quiz-header";
    header.innerHTML = `<span class="quiz-title">Quiz</span><span class="quiz-progress">${right}</span>`;
    if (this.el.classList.contains("quiz-active")) {
      const close = button("✕", () => this.close(), "quiz-close");
      close.setAttribute("aria-label", "Close quiz");
      header.append(close);
    }
    return header;
  }

  private renderIntro() {
    const total = this.data.questions.length;
    const saved = this.load();
    const body = document.createElement("div");
    body.className = "quiz-body";
    if (saved) {
      const score = this.score(saved.answers);
      const p = document.createElement("p");
      p.textContent = `Last attempt: ${score} of ${total} correct.`;
      body.append(p, buttonRow(button("Retry", () => this.start()), button("Review answers", () => this.open(() => this.renderReview(saved.answers)), "secondary")));
    } else {
      body.append(buttonRow(button("Start", () => this.start())));
    }
    this.el.replaceChildren(this.header(`${total} question${total === 1 ? "" : "s"}`), body);
  }

  private open(render: () => void) {
    if (!this.el.classList.contains("quiz-active")) this.opener = document.activeElement as HTMLElement | null;
    this.el.classList.add("quiz-active");
    if (this.data.fullscreen) {
      this.el.classList.add("quiz-fullscreen");
      this.el.setAttribute("role", "dialog");
      this.el.setAttribute("aria-modal", "true");
      document.documentElement.classList.add("quiz-open");
      document.addEventListener("keydown", this.onKey);
    }
    render();
  }

  private close() {
    this.el.classList.remove("quiz-active", "quiz-fullscreen");
    this.el.removeAttribute("role");
    this.el.removeAttribute("aria-modal");
    document.documentElement.classList.remove("quiz-open");
    document.removeEventListener("keydown", this.onKey);
    this.renderIntro();
    // The opener was replaced by re-rendering the intro, so fall back to its first button.
    (this.opener?.isConnected ? this.opener : this.el.querySelector("button"))?.focus();
    this.opener = null;
  }

  private start() {
    this.answers = [];
    this.order = this.data.questions.map(q => {
      if (q.type !== "MultipleChoice") return [];
      const idx = q.options.map((_, i) => i);
      return q.sortAnswers ? idx.sort((a, b) => plain(q.options[a]!.html).localeCompare(plain(q.options[b]!.html))) : shuffle(idx);
    });
    this.open(() => this.renderQuestion(0));
  }

  private renderQuestion(i: number) {
    const q = this.data.questions[i]!;
    const total = this.data.questions.length;
    const form = document.createElement("form");
    form.className = "quiz-body";

    if (q.multipart) form.append(div("quiz-multipart", q.multipart));
    const prompt = div("quiz-prompt", `<p class="quiz-question-number">Question ${i + 1}</p>${q.prompt}`);
    form.append(prompt);

    const submit = button(i + 1 === total ? "Finish" : "Submit", () => {}, "", "submit");
    submit.disabled = true;
    let read: () => Response;

    if (q.type === "MultipleChoice") {
      const fieldset = document.createElement("fieldset");
      fieldset.className = "quiz-options";
      fieldset.innerHTML = `<legend>${q.multi ? "Select all that apply" : "Choose one"}</legend>`;
      for (const optIndex of this.order[i]!) {
        const label = document.createElement("label");
        const input = document.createElement("input");
        input.type = q.multi ? "checkbox" : "radio";
        input.name = `${this.id}-q${i}`;
        input.value = String(optIndex);
        input.addEventListener("change", () => (submit.disabled = !fieldset.querySelector("input:checked")));
        const text = document.createElement("span");
        text.innerHTML = q.options[optIndex]!.html;
        label.append(input, text);
        fieldset.append(label);
      }
      form.append(fieldset);
      read = () => [...fieldset.querySelectorAll<HTMLInputElement>("input:checked")].map(x => Number(x.value));
    } else {
      const label = document.createElement("label");
      label.className = "quiz-short";
      label.textContent = "Your answer ";
      const input = document.createElement("input");
      input.type = "text";
      input.autocomplete = "off";
      input.addEventListener("input", () => (submit.disabled = input.value.trim() === ""));
      label.append(input);
      form.append(label);
      read = () => input.value;
    }

    form.append(buttonRow(submit));
    form.addEventListener("submit", e => {
      e.preventDefault();
      if (submit.disabled) return;
      this.answers[i] = read();
      if (i + 1 < total) this.renderQuestion(i + 1);
      else this.finish();
    });

    this.el.replaceChildren(this.header(`Question ${i + 1} / ${total}`), form);
    form.querySelector<HTMLElement>("input")?.focus();
  }

  private finish() {
    if (this.data.cacheAnswers) writeStorage(this.key, JSON.stringify({ version: this.data.version, answers: this.answers } satisfies Saved));
    const score = this.score(this.answers);
    const total = this.data.questions.length;
    window.dispatchEvent(new CustomEvent("book:quiz-complete", { detail: { name: this.data.name, score, total } }));

    const body = div("quiz-body", "");
    const result = document.createElement("p");
    result.className = "quiz-score";
    result.setAttribute("role", "status");
    result.textContent = score === total ? `You answered all ${total} questions correctly! 🎉` : `You answered ${score} of ${total} questions correctly.`;
    const answers = this.answers;
    body.append(
      result,
      buttonRow(
        ...(score < total ? [button("Retry quiz", () => this.start())] : []),
        button("Review answers", () => this.renderReview(answers), score < total ? "secondary" : ""),
        button("Close", () => this.close(), "secondary")
      )
    );
    this.el.replaceChildren(this.header("Done"), body);
    body.querySelector("button")?.focus();
  }

  private renderReview(answers: Response[]) {
    const body = div("quiz-body", "");
    this.data.questions.forEach((q, i) => {
      const r = answers[i]!;
      const ok = isCorrect(q, r);
      const item = div(`quiz-review ${ok ? "correct" : "incorrect"}`, "");
      if (q.multipart) item.append(div("quiz-multipart", q.multipart));
      item.append(div("quiz-prompt", `<p class="quiz-question-number">Question ${i + 1} ${ok ? "✓" : "✗"}</p>${q.prompt}`));

      const yours = q.type === "MultipleChoice" ? (r as number[]).map(j => q.options[j]!.html).join(", ") : escape(r as string);
      item.append(div("quiz-answer", `<strong>Your answer:</strong> ${yours || "<em>none</em>"}`));
      if (!ok) {
        const correct = q.type === "MultipleChoice" ? q.options.filter(o => o.correct).map(o => o.html).join(", ") : escape(q.display);
        item.append(div("quiz-answer", `<strong>Correct answer:</strong> ${correct}`));
      }
      if (q.context) item.append(div("quiz-context", q.context));
      body.append(item);
    });
    body.append(buttonRow(button("Retry quiz", () => this.start()), button("Close", () => this.close(), "secondary")));
    this.el.replaceChildren(this.header("Answers"), body);
    this.el.scrollTop = 0;
  }
}

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function div(className: string, html: string): HTMLDivElement {
  const d = document.createElement("div");
  d.className = className;
  d.innerHTML = html;
  return d;
}

function button(label: string, onClick: () => void, className = "", type: "button" | "submit" = "button"): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = type;
  b.textContent = label;
  if (className) b.className = className;
  if (type === "button") b.addEventListener("click", onClick);
  return b;
}

function buttonRow(...buttons: HTMLButtonElement[]): HTMLDivElement {
  const row = div("quiz-buttons", "");
  row.append(...buttons);
  return row;
}
