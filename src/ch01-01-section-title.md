# Section 1.1 Title

<!-- TEMPLATE: this page shows the syntax of every interactive element.
     Replace each placeholder with your own content and delete what you don't use. -->

## Subheading

Paragraph text with a [link to another page](ch01-02-section-title.md).

> Note: Placeholder note text.

> Tip: Placeholder tip text.

> Warning: Placeholder warning text.

<Listing number="1-1" file-name="src/main.ts" caption="Placeholder caption">

```ts
function main(): void {
  // placeholder
}
```

</Listing>

```ts,runnable
const items = [3, 1, 2]; // @hide
const sorted = [...items].sort((a, b) => a - b);
console.log(sorted);
```

```js,runnable,editable
console.log("Readers can edit this and run it again.");
```

```ts,does_not_compile
const x: number = "not a number";
```

```ts,runnable,throws
JSON.parse("{ not json");
```

```ts,not_desired_behavior
const total = [1, 2, 3].reduce((sum, n) => sum - n, 0);
```

```ts
{{#include ../code/greet.ts}}
```

<figure>

<img src="img/placeholder.svg" alt="Placeholder" class="center" width="300" />

<figcaption>Figure 1-1: Placeholder caption</figcaption>

</figure>

{{#quiz ../quizzes/ch01-01-section-title.toml}}

## Maths

Inline maths sits in single dollars, like $a^2 + b^2 = c^2$; a literal dollar sign is written \$5.

$$
\text{recall} = \frac{TP}{TP + FN}
$$

```math
\bar{x} = \frac{1}{n} \sum_{i=1}^{n} x_i
```

## Diagrams

```mermaid Placeholder caption for the diagram
flowchart LR
  A["Write Markdown"] --> B["Build"]
  B --> C{"Checks pass?"}
  C -- yes --> D["Publish"]
  C -- no --> A
```
