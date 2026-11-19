---
"@nick-vi/opencode-type-inject": patch
---

Add an `exports` map so the OpenCode 2 plugin loader can resolve the package entrypoint. The loader resolves published plugins through the `exports` map (not the legacy `main` field); without it the package fails to load with "Plugin must export a default definition with an id and an effect or setup function".
