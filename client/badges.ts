// Code badges: flags code blocks that are deliberately wrong.
//
//   ```ts,does_not_compile        ```ts,throws        ```ts,not_desired_behavior
//
// To add a badge: add an entry here, put `<class>.svg` in theme/badges/, and
// add the class to the selector list in client/styles/badges.css.

export const BADGES = [
  { cls: "does_not_compile", title: "This code does not compile!" },
  { cls: "throws", title: "This code throws an error when it runs!" },
  { cls: "not_desired_behavior", title: "This code does not do what it is meant to." },
];

/** Where badges link to: a page explaining them. */
const EXPLAINER = "introduction.html#code-badges";

export function initBadges(root: string) {
  for (const { cls, title } of BADGES) {
    for (const pre of document.querySelectorAll<HTMLElement>(`pre.${cls}`)) {
      const lines = (pre.querySelector("code")?.textContent ?? "").replace(/\n$/, "").split("\n").length;

      const link = document.createElement("a");
      link.className = `badge badge-${lines < 4 ? "small" : "large"}`;
      link.href = root + EXPLAINER;
      link.title = title;

      const img = document.createElement("img");
      img.src = `${root}assets/badges/${cls}.svg`;
      img.alt = title;
      link.append(img);
      pre.append(link);
    }
  }
}
