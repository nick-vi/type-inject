# @nick-vi/opencode-type-inject

## 1.6.0

### Minor Changes

- e305c13: Support OpenCode v2. The plugin now default-exports `{ id, server, setup }`, so the same package loads in OpenCode v2 (`setup`) and v1 >=1.3.4 (`server`). On v2 the tools are registered as direct tools and reads are injected via the `tool` `execute.after` hook.

  Also fixes read offsets being treated as 0-based: OpenCode's read tool has used 1-based offsets since 1.2, so partial-read injection and `lookup_type` offset hints were off by one line.

  The `@opencode-ai/plugin` peer range is now `>=1.3.4`.

### Patch Changes

- Updated dependencies [add4bdb]
  - @nick-vi/type-inject-core@1.1.3

## 1.5.2

### Patch Changes

- e977763: Fix OpenCode plugin loading with a ts-morph compatibility wrapper and make type_check report explicit failures when tsc cannot run.
- Updated dependencies [e977763]
  - @nick-vi/type-inject-core@1.1.2

## 1.5.1

### Patch Changes

- 15a3e62: type_check now finds nearest tsconfig.json for better monorepo support

  When checking a specific file, type_check now searches for the nearest tsconfig.json starting from the file's directory, enabling proper path alias resolution in monorepos.

- Updated dependencies [15a3e62]
  - @nick-vi/type-inject-core@1.1.1

## 1.5.0

### Minor Changes

- f0ff10b: Add type_check tool and Write hook for type checking

  - Add `type_check` MCP tool for project/file type checking
  - Add `type_check` to OpenCode plugin
  - Add Write hook for automatic type error feedback on file writes
  - Add severity field to Diagnostic type

### Patch Changes

- Updated dependencies [f0ff10b]
  - @nick-vi/type-inject-core@1.1.0

## 1.4.2

### Patch Changes

- 286b379: Fix workspace:\* dependency resolution for npm installs

## 1.4.0

### Minor Changes

- 6f8a20e: Refactored to use shared @nick-vi/type-inject-core library
