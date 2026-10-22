# @nick-vi/type-inject-core

## 1.1.3

### Patch Changes

- add4bdb: Fix `type_check` with a `file` argument returning raw tsc output from other files when the requested file has no errors. It now reports the file as clean; raw output is only returned when tsc fails without any parseable diagnostics.

## 1.1.2

### Patch Changes

- e977763: Fix OpenCode plugin loading with a ts-morph compatibility wrapper and make type_check report explicit failures when tsc cannot run.

## 1.1.1

### Patch Changes

- 15a3e62: type_check now finds nearest tsconfig.json for better monorepo support

  When checking a specific file, type_check now searches for the nearest tsconfig.json starting from the file's directory, enabling proper path alias resolution in monorepos.

## 1.1.0

### Minor Changes

- f0ff10b: Add type_check tool and Write hook for type checking

  - Add `type_check` MCP tool for project/file type checking
  - Add `type_check` to OpenCode plugin
  - Add Write hook for automatic type error feedback on file writes
  - Add severity field to Diagnostic type
