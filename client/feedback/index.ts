// Reader highlights + notes (assets/feedback.js).
//
// Select text -> click ✏️ -> optionally type a note -> Save. Highlights are
// saved in localStorage per page and restored on the next visit. Each one
// stores a hash of the paragraph it's in; if you edit that paragraph, the
// highlight is dropped instead of landing on the wrong text.
//
// Fires `book:highlight` on window with { action: "create" | "remove", ... }
// so you can hook in syncing or analytics without editing this file.

import md5 from "md5";
import Highlighter from "web-highlighter";
import type HighlightSource from "web-highlighter/dist/model/source";

import { isObj, isStr } from "../../shared/guards";

const STORAGE_KEY = "book-highlights";
/** Never highlight inside these (interactive widgets, code). */
const EXCLUDE = [".quiz", "pre", ".run-output", ".code-buttons", "button", "input", "textarea"];

interface Extra {
  note: string;
  page: string;
  domHash?: string;
}

type Stored = Pick<HighlightSource, "startMeta" | "endMeta" | "text" | "id"> & { extra: string };

const isStored = (v: unknown): v is Stored =>
  isObj(v) && isStr(v["id"]) && isStr(v["text"]) && isStr(v["extra"]) && isObj(v["startMeta"]) && isObj(v["endMeta"]);

/** Saved highlights; anything malformed (edited by hand, older format) is ignored. */
const readAll = (): Stored[] => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(isStored) : [];
  } catch {
    return [];
  }
};

/**
 * Which page a highlight belongs to. Uses the page's own URL from the build
 * (not location.pathname), so "/", "/index.html" and pretty URLs all match,
 * and moving the site to another base path keeps highlights.
 */
const pageKey = () => document.documentElement.dataset.page ?? location.pathname;
const writeAll = (items: Stored[]) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Storage unavailable: highlights just won't persist.
  }
};
const parseExtra = (extra: unknown): Extra => {
  try {
    const parsed: unknown = typeof extra === "string" ? JSON.parse(extra) : {};
    if (!isObj(parsed)) return { note: "", page: "" };
    return {
      note: isStr(parsed["note"]) ? parsed["note"] : "",
      page: isStr(parsed["page"]) ? parsed["page"] : "",
      ...(isStr(parsed["domHash"]) ? { domHash: parsed["domHash"] } : {}),
    };
  } catch {
    return { note: "", page: "" };
  }
};

function init() {
  const content = document.getElementById("content");
  if (!content) return;

  const highlighter = new Highlighter({
    $root: content,
    exceptSelectors: EXCLUDE,
    style: { className: "book-highlight" },
  });

  // Restore this page's highlights, dropping ones whose paragraph changed.
  const all = readAll();
  const keep: Stored[] = [];
  for (const h of all) {
    const extra = parseExtra(h.extra);
    if (extra.page !== pageKey()) {
      keep.push(h);
      continue;
    }
    try {
      highlighter.fromStore(h.startMeta, h.endMeta, h.text, h.id, h.extra);
      const dom = highlighter.getDoms(h.id)[0];
      if (dom && (!extra.domHash || md5(dom.innerHTML) === extra.domHash)) keep.push(h);
      else highlighter.remove(h.id);
    } catch {
      // The page structure changed too much to restore it: drop it.
    }
  }
  writeAll(keep);

  highlighter.on(Highlighter.event.CREATE, ({ sources, type }) => {
    if (String(type) === "from-store") return; // restored from storage, already saved
    const items = readAll();
    for (const source of sources) {
      const dom = highlighter.getDoms(source.id)[0];
      const extra = { ...parseExtra(source.extra), domHash: dom ? md5(dom.innerHTML) : undefined };
      source.extra = JSON.stringify(extra);
      items.push({ startMeta: source.startMeta, endMeta: source.endMeta, text: source.text, id: source.id, extra: source.extra as string });
      window.dispatchEvent(new CustomEvent("book:highlight", { detail: { action: "create", text: source.text, ...extra } }));
    }
    writeAll(items);
  });
  highlighter.on(Highlighter.event.REMOVE, ({ ids }) => {
    writeAll(readAll().filter(h => !ids.includes(h.id)));
    for (const id of ids) window.dispatchEvent(new CustomEvent("book:highlight", { detail: { action: "remove", id } }));
  });

  initSelectionButton(highlighter, content);
  initHighlightTooltip(highlighter);
}

/** Floating ✏️ button over the current selection. */
function initSelectionButton(highlighter: Highlighter, content: HTMLElement) {
  const pencil = popup("feedback-pencil");
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "✏️";
  button.title = "Highlight and add a note";
  button.setAttribute("aria-label", "Highlight and add a note");
  pencil.append(button);

  let range: Range | null = null;

  const update = () => {
    const sel = document.getSelection();
    const r = sel && !sel.isCollapsed && sel.rangeCount ? sel.getRangeAt(0) : null;
    const node = r?.commonAncestorContainer;
    const el = node instanceof Element ? node : node?.parentElement;
    if (!r || !el || !content.contains(el) || el.closest(EXCLUDE.join(","))) {
      range = null;
      pencil.hidden = true;
      return;
    }
    range = r;
    place(pencil, r.getBoundingClientRect());
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  document.addEventListener("selectionchange", () => {
    clearTimeout(timer);
    timer = setTimeout(update, 120);
  });
  // Keep the selection alive when the button is pressed.
  button.addEventListener("mousedown", e => e.preventDefault());
  button.addEventListener("click", () => {
    if (!range) return;
    const saved = range.cloneRange();
    pencil.hidden = true;
    askForNote(note => {
      const page = pageKey();
      const dispose = highlighter.hooks.Serialize.RecordInfo.tap(() => JSON.stringify({ note, page }));
      highlighter.fromRange(saved);
      dispose();
      document.getSelection()?.removeAllRanges();
    });
  });
}

/** Native <dialog> asking for an optional note. Calls `onSave` unless cancelled. */
function askForNote(onSave: (note: string) => void) {
  const dialog = document.createElement("dialog");
  dialog.className = "feedback-dialog";
  dialog.innerHTML = `
    <form method="dialog">
      <label>Note (optional)<textarea rows="4" placeholder="Your note…"></textarea></label>
      <div class="feedback-actions">
        <button value="cancel" type="submit" class="secondary">Cancel</button>
        <button value="save" type="submit">Save highlight</button>
      </div>
    </form>`;
  document.body.append(dialog);
  const textarea = dialog.querySelector("textarea")!;
  textarea.addEventListener("keydown", e => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) dialog.close("save");
  });
  dialog.addEventListener("close", () => {
    if (dialog.returnValue === "save") onSave(textarea.value.trim());
    dialog.remove();
  });
  dialog.showModal();
  textarea.focus();
}

/** Tooltip shown when hovering (or tapping) a saved highlight: note + delete button. */
function initHighlightTooltip(highlighter: Highlighter) {
  const tip = popup("feedback-tooltip");
  let current: string | null = null;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;

  const show = (id: string) => {
    clearTimeout(hideTimer);
    const dom = highlighter.getDoms(id)[0];
    if (!dom) return;
    current = id;
    const { note } = parseExtra(highlighter.cache.get(id)?.extra);
    tip.replaceChildren();
    if (note) {
      const text = document.createElement("span");
      text.className = "feedback-note";
      text.textContent = note;
      tip.append(text);
    }
    const del = document.createElement("button");
    del.type = "button";
    del.textContent = "🗑";
    del.title = "Delete highlight";
    del.setAttribute("aria-label", "Delete highlight");
    del.addEventListener("click", () => {
      if (current) highlighter.remove(current);
      hide(0);
    });
    tip.append(del);
    place(tip, dom.getBoundingClientRect());
  };
  const hide = (delay = 250) => {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      tip.hidden = true;
      current = null;
    }, delay);
  };

  highlighter.on(Highlighter.event.HOVER, ({ id }) => show(id));
  highlighter.on(Highlighter.event.CLICK, ({ id }) => show(id));
  highlighter.on(Highlighter.event.HOVER_OUT, () => hide());
  tip.addEventListener("mouseenter", () => clearTimeout(hideTimer));
  tip.addEventListener("mouseleave", () => hide());
}

function popup(className: string): HTMLDivElement {
  const el = document.createElement("div");
  el.className = `feedback-popup ${className}`;
  el.hidden = true;
  document.body.append(el);
  return el;
}

/** Positions a popup centred above a rect (or below, if there's no room). */
function place(el: HTMLElement, rect: DOMRect) {
  el.hidden = false;
  const { width, height } = el.getBoundingClientRect();
  const left = Math.max(8, Math.min(window.innerWidth - width - 8, rect.left + rect.width / 2 - width / 2));
  const above = rect.top - height - 8;
  const top = above > 8 ? above : rect.bottom + 8;
  el.style.left = `${left + window.scrollX}px`;
  el.style.top = `${top + window.scrollY}px`;
}

init();
