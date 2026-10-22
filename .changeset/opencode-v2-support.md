---
"@nick-vi/opencode-type-inject": minor
---

Support OpenCode v2. The plugin now default-exports `{ id, server, setup }`, so the same package loads in OpenCode v2 (`setup`) and v1 >=1.3.4 (`server`). On v2 the tools are registered as direct tools and reads are injected via the `tool` `execute.after` hook.

Also fixes read offsets being treated as 0-based: OpenCode's read tool has used 1-based offsets since 1.2, so partial-read injection and `lookup_type` offset hints were off by one line.

The `@opencode-ai/plugin` peer range is now `>=1.3.4`.
