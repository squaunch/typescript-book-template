import { describe, expect, it } from "vitest";

import { isCorrect } from "../client/quiz";
import { search } from "../client/search";
import { normaliseAnswer, type QuizQuestion } from "../shared/quiz";

describe("quiz answers", () => {
  const mc: QuizQuestion = {
    id: "1",
    type: "MultipleChoice",
    prompt: "",
    multi: true,
    sortAnswers: false,
    options: [
      { html: "a", correct: true },
      { html: "b", correct: true },
      { html: "c", correct: false },
    ],
  };
  const sa: QuizQuestion = { id: "2", type: "ShortAnswer", prompt: "", accepted: ["-3", "minus three"].map(normaliseAnswer), display: "-3" };

  it("needs exactly the correct set of options", () => {
    expect(isCorrect(mc, [1, 0])).toBe(true);
    expect(isCorrect(mc, [0])).toBe(false);
    expect(isCorrect(mc, [0, 1, 2])).toBe(false);
  });

  it("compares short answers loosely", () => {
    expect(isCorrect(sa, "  −3 ")).toBe(true);
    expect(isCorrect(sa, "Minus   Three")).toBe(true);
    expect(isCorrect(sa, "3")).toBe(false);
  });
});

describe("search", () => {
  const docs = [
    { t: "Ownership", h: "", u: "a.html", b: "memory memory memory" },
    { t: "Intro", h: "Memory", u: "b.html#memory", b: "welcome" },
    { t: "Other", h: "", u: "c.html", b: "nothing relevant" },
  ];
  it("requires every term and ranks headings above body text", () => {
    expect(search(docs, ["memory"]).map(d => d.u)).toEqual(["a.html", "b.html#memory"]);
    expect(search(docs, ["memory", "welcome"]).map(d => d.u)).toEqual(["b.html#memory"]);
    expect(search(docs, ["zzz"])).toEqual([]);
  });
});

import { htmlToText } from "../engine/search";

describe("htmlToText", () => {
  it("joins inline tags without spaces and splits block tags", () => {
    expect(htmlToText('<p>A <a href="#">link</a>.</p><p>Next &amp; <code>x</code></p><script>no</script>')).toBe("A link. Next & x");
  });
});
