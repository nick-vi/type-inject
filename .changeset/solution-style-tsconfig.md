---
"@nick-vi/type-inject-core": patch
---

Fix `list_types` and `lookup_type` returning no results for solution-style tsconfigs. When the root `tsconfig.json` uses `"files": []` with project `references` (the default Vite scaffolding since 2023), `TypeLookup` now uses the TypeScript config parser and loads source files from every referenced tsconfig, including directory references and configs with comments or trailing commas, so type indexing works without changes to the project's build config.
