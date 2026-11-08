---
"@nick-vi/type-inject-core": patch
---

TypeExtractor: resolve path-alias and bare-package imports (e.g. `@/lib/models` with tsconfig `paths`) instead of only relative ones. Non-relative specifiers are followed only when they resolve inside the project directory and never descend into `node_modules`. Also extract arrow functions that only carry a return type annotation (`const makeTask = (id: string): Task => ...`), which were previously skipped when the variable itself had no type annotation.
