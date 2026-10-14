// Code kept in a real file can be type-checked and tested with normal tooling,
// then pulled into a page with {{#include}}.
export function greet(name: string): string {
  return `Hello, ${name}!`;
}

console.log(greet("reader"));
