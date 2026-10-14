// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

import { initQuizzes } from "../client/quiz";
import { normaliseAnswer, type QuizData } from "../shared/quiz";

const data: QuizData = {
  name: "t/q",
  version: "v1",
  fullscreen: true,
  cacheAnswers: true,
  questions: [
    { id: "1", type: "MultipleChoice", prompt: "<p>Pick</p>", multi: false, sortAnswers: true, options: [{ html: "a", correct: true }, { html: "b", correct: false }] },
    { id: "2", type: "ShortAnswer", prompt: "<p>Type</p>", accepted: [normaliseAnswer("-3")], display: "-3" },
  ],
};

function mount() {
  document.documentElement.className = "";
  document.body.innerHTML = `<div class="quiz"><script type="application/json">${JSON.stringify(data)}</script></div>`;
  initQuizzes();
  return document.querySelector<HTMLElement>(".quiz")!;
}
const click = (el: Element | null | undefined) => (el as HTMLElement).click();
const btn = (root: ParentNode, text: string) => [...root.querySelectorAll("button")].find(b => b.textContent === text);
function submit(root: HTMLElement) {
  root.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
}

describe("quiz DOM", () => {
  beforeEach(() => vi.stubGlobal("localStorage", mem()));

  it("runs a full quiz, fires the completion event, caches the result", () => {
    const el = mount();
    const done = vi.fn();
    window.addEventListener("book:quiz-complete", e => done((e as CustomEvent).detail), { once: true });
    click(btn(el, "Start"));
    expect(document.documentElement.classList.contains("quiz-open")).toBe(true);
    expect(el.querySelector<HTMLButtonElement>("button[type=submit]")!.disabled).toBe(true);
    const first = el.querySelector<HTMLInputElement>("input[type=radio]")!; // sortAnswers => "a" first
    first.checked = true;
    first.dispatchEvent(new Event("change"));
    submit(el);
    const text = el.querySelector<HTMLInputElement>("input[type=text]")!;
    text.value = "−3";
    text.dispatchEvent(new Event("input"));
    submit(el);
    expect(el.querySelector(".quiz-score")!.textContent).toContain("all 2 questions correctly");
    expect(done).toHaveBeenCalledWith({ name: "t/q", score: 2, total: 2 });
    expect(JSON.parse(localStorage.getItem("book-quiz:t/q")!)).toEqual({ version: "v1", answers: [[0], "−3"] });
  });

  it("restores last attempt on load and Escape closes the modal", () => {
    localStorage.setItem("book-quiz:t/q", JSON.stringify({ version: "v1", answers: [[1], "x"] }));
    const el = mount();
    expect(el.textContent).toContain("Last attempt: 0 of 2 correct.");
    click(btn(el, "Review answers"));
    expect(el.querySelectorAll(".quiz-review.incorrect")).toHaveLength(2);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.documentElement.classList.contains("quiz-open")).toBe(false);
    expect(btn(el, "Retry")).toBeTruthy();
  });

  it("ignores corrupt, stale or mismatched saved answers", () => {
    const saved = (v: unknown) => {
      localStorage.setItem("book-quiz:t/q", typeof v === "string" ? v : JSON.stringify(v));
      return btn(mount(), "Start");
    };
    expect(saved("{not json")).toBeTruthy();
    expect(saved({ version: "v1", answers: [[0]] })).toBeTruthy(); // wrong length
    expect(saved({ version: "old", answers: [[0], "x"] })).toBeTruthy(); // quiz edited since
    expect(saved({ version: "v1", answers: [[5], "x"] })).toBeTruthy(); // option index out of range
    expect(saved({ version: "v1", answers: ["a", "x"] })).toBeTruthy(); // wrong response type
    expect(saved({ answers: [[0], "x"] })).toBeTruthy(); // pre-versioning format
    expect(saved({ version: "v1", answers: [[0], "x"] })).toBeFalsy(); // valid: shows Retry instead
  });

  it("keeps Tab focus inside the open quiz", () => {
    const el = mount();
    const outside = document.createElement("a");
    outside.href = "#";
    document.body.append(outside);
    click(btn(el, "Start"));
    const close = el.querySelector<HTMLButtonElement>(".quiz-close")!;
    const radios = el.querySelectorAll<HTMLInputElement>("input");
    radios[radios.length - 1]!.focus();
    // Tab from the last focusable element wraps to the first (submit is disabled).
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(close);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true }));
    expect(el.contains(document.activeElement)).toBe(true);
  });
});

// Node >=25 ships a global `localStorage` stub (no methods without --localstorage-file) that shadows happy-dom's.
function mem(): Storage {
  const m = new Map<string, string>();
  return { getItem: k => m.get(k) ?? null, setItem: (k, v) => void m.set(k, String(v)), removeItem: k => void m.delete(k), clear: () => m.clear(), key: i => [...m.keys()][i] ?? null, get length() { return m.size; } };
}
