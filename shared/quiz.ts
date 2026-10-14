// Types shared by the build (engine/plugins/quiz.ts) and the browser (client/quiz.ts).

export interface QuizData {
  /** Stable name, used as the localStorage key. */
  name: string;
  /** Hash of the questions; saved answers are only reused if it matches. */
  version: string;
  fullscreen: boolean;
  cacheAnswers: boolean;
  questions: QuizQuestion[];
}

interface QuestionBase {
  id: string;
  /** Rendered HTML. */
  prompt: string;
  /** Rendered HTML of the shared multipart scenario, if any. */
  multipart?: string;
  /** Rendered HTML explanation shown with the answers. */
  context?: string;
}

export interface MultipleChoiceQuestion extends QuestionBase {
  type: "MultipleChoice";
  /** More than one correct option: render checkboxes. */
  multi: boolean;
  /** Keep options in source order instead of shuffling. */
  sortAnswers: boolean;
  options: { html: string; correct: boolean }[];
}

export interface ShortAnswerQuestion extends QuestionBase {
  type: "ShortAnswer";
  /** Accepted answers, already normalised with `normaliseAnswer`. */
  accepted: string[];
  /** The main answer, as written by the author, for display. */
  display: string;
}

export type QuizQuestion = MultipleChoiceQuestion | ShortAnswerQuestion;

/** How short answers are compared: case-, whitespace- and minus-sign-insensitive. */
export function normaliseAnswer(s: string): string {
  return s.trim().toLowerCase().replace(/[−–]/g, "-").replace(/\s+/g, " ");
}
