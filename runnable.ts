// ▶ Run buttons for code blocks tagged `runnable`. The build compiles the code
// to JavaScript (see engine/plugins/runnable.ts) and stores it in
// `data-runnable`. Here it runs in a sandboxed iframe, with console output
// shown under the block.

import { codeButtons } from "./chrome";

const TIMEOUT_MS = 5000;
const MAX_LINES = 500;

/** Cancels the in-flight run for an output panel, so re-clicking Run restarts cleanly. */
const activeRuns = new WeakMap<HTMLElement, () => void>();

type RunMessage = { runId: string; level: "log" | "info" | "warn" | "error" | "done"; text: string };

/** The script the iframe runs before the reader's code: forwards console + errors to the page. */
const HARNESS = (runId: string) => `
const runId = ${JSON.stringify(runId)};
const fmt = v => {
  if (typeof v === "string") return v;
  if (v instanceof Error) return v.stack || String(v);
  try {
    const compact = JSON.stringify(v);
    if (compact === undefined) return String(v);
    return compact.length > 60 ? JSON.stringify(v, null, 2) : compact;
  } catch { return String(v); }
};
const send = (level, args) => parent.postMessage({ runId, level, text: args.map(fmt).join(" ") }, "*");
for (const level of ["log", "info", "warn", "error"]) console[level] = (...args) => send(level, args);
addEventListener("error", e => send("error", [e.error ?? e.message]));
addEventListener("unhandledrejection", e => send("error", ["Uncaught (in promise)", e.reason]));
`;

export function initRunnable() {
  for (const pre of document.querySelectorAll<HTMLElement>("pre[data-runnable]")) {
    const code = pre.querySelector("code")!;
    const editable = pre.classList.contains("editable");
    const original = code.innerHTML;

    const output = document.createElement("div");
    output.className = "run-output";
    output.hidden = true;
    output.setAttribute("role", "status");
    output.setAttribute("aria-live", "polite");
    pre.after(output);

    const run = document.createElement("button");
    run.type = "button";
    run.className = "code-button run-button";
    run.textContent = "▶ Run";
    run.setAttribute("aria-label", "Run this code");
    run.addEventListener("click", () => execute(editable ? code.innerText : pre.dataset.runnable!, output));
    codeButtons(pre).prepend(run);

    if (editable) {
      code.contentEditable = "plaintext-only";
      if (code.contentEditable !== "plaintext-only") code.contentEditable = "true";
      code.spellcheck = false;
      const reset = document.createElement("button");
      reset.type = "button";
      reset.className = "code-button";
      reset.textContent = "Reset";
      reset.addEventListener("click", () => {
        code.innerHTML = original;
        output.hidden = true;
      });
      codeButtons(pre).append(reset);
    }
  }
}

function execute(js: string, output: HTMLElement) {
  activeRuns.get(output)?.();
  output.hidden = false;
  output.replaceChildren();
  output.classList.add("running");

  const runId = Math.random().toString(36).slice(2);
  const frame = document.createElement("iframe");
  frame.sandbox.add("allow-scripts"); // no allow-same-origin: code can't touch the book
  frame.hidden = true;
  const safe = (s: string) => s.replace(/<\/script/gi, "<\\/script");
  frame.srcdoc =
    `<script>${safe(HARNESS(runId))}</script>` +
    `<script type="module">${safe(js)}</script>` +
    `<script type="module">setTimeout(() => parent.postMessage({ runId: ${JSON.stringify(runId)}, level: "done", text: "" }, "*"), 0);</script>`;

  let lines = 0;
  let done = false;
  let settle: ReturnType<typeof setTimeout> | undefined;
  const finish = (note?: string) => {
    if (done) return;
    done = true;
    clearTimeout(timeout);
    clearTimeout(settle);
    activeRuns.delete(output);
    window.removeEventListener("message", onMessage);
    frame.remove();
    output.classList.remove("running");
    if (note) addLine(output, "note", note);
    else if (lines === 0) addLine(output, "note", "(no output)");
  };
  const timeout = setTimeout(() => finish(`(stopped after ${TIMEOUT_MS / 1000}s)`), TIMEOUT_MS);

  const onMessage = (e: MessageEvent<RunMessage>) => {
    if (e.source !== frame.contentWindow || e.data?.runId !== runId) return;
    if (e.data.level === "done") {
      // Give pending timers/promises a moment, then stop.
      settle = setTimeout(() => finish(), 300);
      return;
    }
    lines++;
    if (lines <= MAX_LINES) addLine(output, e.data.level, e.data.text);
    else if (lines === MAX_LINES + 1) addLine(output, "note", `(output truncated after ${MAX_LINES} lines)`);
    if (settle) {
      clearTimeout(settle);
      settle = setTimeout(() => finish(), 300);
    }
  };
  window.addEventListener("message", onMessage);
  activeRuns.set(output, () => finish("(restarted)"));
  document.body.append(frame);
}

function addLine(output: HTMLElement, level: string, text: string) {
  const line = document.createElement("div");
  line.className = `run-line run-${level}`;
  line.textContent = text;
  output.append(line);
}
