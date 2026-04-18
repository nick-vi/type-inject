# @nick-vi/claude-type-inject-hook

## 1.1.2

### Patch Changes

- e977763: Fix OpenCode plugin loading with a ts-morph compatibility wrapper and make type_check report explicit failures when tsc cannot run.
- Updated dependencies [e977763]
  - @nick-vi/type-inject-core@1.1.2

## 1.1.1

### Patch Changes

- Updated dependencies [15a3e62]
  - @nick-vi/type-inject-core@1.1.1

## 1.1.0

### Minor Changes

- f0ff10b: Add type_check tool and Write hook for type checking

  - Add `type_check` MCP tool for project/file type checking
  - Add `type_check` to OpenCode plugin
  - Add Write hook for automatic type error feedback on file writes
  - Add severity field to Diagnostic type

### Patch Changes

- Updated dependencies [f0ff10b]
  - @nick-vi/type-inject-core@1.1.0

## 1.0.1

### Patch Changes

- 286b379: Fix workspace:\* dependency resolution for npm installs
