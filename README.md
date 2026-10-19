# type-inject

TypeScript type context for AI coding assistants. Auto-injects type signatures into file reads, provides type error feedback on writes, and offers type lookup tools.

## Installation

### OpenCode

Full plugin with automatic type injection on file reads and MCP tools:

```json
{
  "plugins": ["@nick-vi/opencode-type-inject"]
}
```

Works with OpenCode v2 and v1 (>=1.3.4). On v1, use the `"plugin"` key instead of `"plugins"`; v2 accepts either.

Or MCP server only (tools only, no auto-injection):

```json
{
  "mcp": {
    "type-inject": {
      "type": "local",
      "command": ["npx", "-y", "@nick-vi/type-inject-mcp"]
    }
  }
}
```

### Claude Code

One-liner install (adds MCP server + hooks):

```bash
curl -fsSL https://raw.githubusercontent.com/nick-vi/type-inject/main/scripts/claude-install.sh | bash
```

<details>
<summary>Manual installation</summary>

**1. Add the MCP server** (provides `lookup_type` and `list_types` tools):

```bash
# Global (all projects)
claude mcp add type-inject -s user -- npx -y @nick-vi/type-inject-mcp

# Or project-only
claude mcp add type-inject -- npx -y @nick-vi/type-inject-mcp
```

**2. Add the hooks** (type injection on reads, type checking on writes):

Add to your `~/.claude/settings.json`:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Read",
        "hooks": [
          {
            "type": "command",
            "command": "npx -y @nick-vi/claude-type-inject-hook"
          }
        ]
      },
      {
        "matcher": "Write",
        "hooks": [
          {
            "type": "command",
            "command": "npx -y @nick-vi/claude-type-inject-hook"
          }
        ]
      }
    ]
  }
}
```

</details>

### Cursor

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "type-inject": {
      "command": "npx",
      "args": ["-y", "@nick-vi/type-inject-mcp"]
    }
  }
}
```

## What It Does

### Automatic Type Injection (Read Hook)

When an LLM reads a TypeScript or Svelte file, this plugin automatically:

1. Extracts type signatures (functions, types, interfaces, enums, classes, constants)
2. Resolves imported types from other files (up to 4 levels deep)
3. Applies smart filtering (only types actually used in the code)
4. Enforces a token budget with priority-based ordering
5. Injects the signatures as additional context

For partial file reads (with offset/limit), only types relevant to that section are injected.

### Type Checking (Write Hook - Claude Code only)

When an LLM writes a TypeScript file, the hook runs type checking and reports errors:

```
TypeScript errors in the file you just wrote:
<file_diagnostics>
ERROR [5:2] Type 'string' is not assignable to type 'boolean'.
</file_diagnostics>
TypeScript errors in other project files:
<project_diagnostics>
src/utils.ts
  ERROR [12:5] Property 'foo' does not exist on type 'User'.
</project_diagnostics>
```

This gives the LLM immediate feedback to fix type errors without manual intervention.

**How it works:**
- Only reports errors (not warnings or hints)
- Shows errors in the written file first (`<file_diagnostics>`)
- Shows errors in other project files (`<project_diagnostics>`)
- Limits: 20 errors per file, 5 files max for project diagnostics
- Requires a `tsconfig.json` in the project (searches up from the file)

### MCP Tools

The plugin provides three tools:

- **`lookup_type`** - Look up any type by name without reading files
- **`list_types`** - List all types in the project
- **`type_check`** - Run TypeScript type checking on the project or a specific file

## Example Output

When reading a file, the LLM receives additional context:

```
Type definitions referenced in this file but defined elsewhere:
<types count="3" tokens="~85">
function getUser(id: string): User  // [offset=2,limit=8]

type User = { id: string; name: string; role: Role; }

type Role = { name: string; permissions: Permission[]; }  // [filePath=./lib/role.ts]
</types>
```

For partial reads (with offset/limit), the description changes to "Type definitions referenced in this range..."

## Key Features

### Token Budget with Priority Ordering

Types are prioritized by importance:

| Tier | Contents | Priority |
|------|----------|----------|
| 1 | Function signatures | ALWAYS included |
| 2 | Types used in function signatures | High |
| 3 | Dependencies of tier 2 types | Medium |
| 4 | Other local types | Low |
| 5 | Imported types not yet included | Lowest |

### Import Resolution

Types are automatically resolved from imported files up to 4 levels deep.

### Smart Filtering

Only types actually used in the code are included. For partial file reads (with offset/limit), only types relevant to that section are injected.

### Barrel File Detection

Files that only contain `export * from` statements are skipped.

### Svelte Support

Svelte files (`.svelte`) are fully supported:

- Extracts types from both `<script lang="ts">` (instance) and `<script module lang="ts">` (module) blocks
- Resolves imports between Svelte and TypeScript files in any direction (TS → Svelte, Svelte → TS)
- Calculates correct line numbers for each script block
- Requires `svelte` as an optional peer dependency (only loaded if installed)

## Understanding the Output

### What Gets Shown

| What | Shown As | Why |
|------|----------|-----|
| Functions | Signature only | Implementation can be long; signature tells you how to call it |
| Classes | Public members only | Private details are internal; public API is what matters |
| Types/Interfaces | Full definition | They ARE the definition - nothing hidden |
| Arrow functions | Only if explicitly typed | `const fn: Type = ...` is intentional API; `const fn = () => {}` is often implementation detail |

### Location Comments

Since functions and classes only show signatures, we provide location hints so you can read the implementation when needed:

```typescript
function processUser(id: string): User  // [offset=15,limit=28]
```

The format matches the `read` tool parameters directly - no translation needed.

### When filePath is Included

```typescript
// Direct import - you can see the import statement above
type User = { ... }

// Transitive import (2+ levels deep) - source not obvious
type Permission = { ... }  // [filePath=./lib/permission.ts]
```

Direct imports are visible in the file's import statements. Transitive imports aren't - so we include where they live for navigation and refactoring.

| Type | Local/Direct Import | Transitive Import (depth > 1) |
|------|---------------------|-------------------------------|
| function/class | `// [offset=X,limit=Y]` | `// [filePath=...,offset=X,limit=Y]` |
| type/interface/enum | (none - full definition shown) | `// [filePath=...]` |

## Tools

Both tools support TypeScript and Svelte files.

### `lookup_type`

Look up type definitions by name (works with `.ts`, `.tsx`, and `.svelte` files).

**Arguments:**
- `name` (required): Type name to search for
- `exact` (optional): Exact match or contains. Default: true
- `kind` (optional): Filter by kind (function, type, interface, enum, class, const)
- `includeUsages` (optional): Include files that import this type. Default: false
- `limit` (optional): Maximum results. Default: 5

**Output includes:**
```
## TypeName (kind)
File: ./path/to/file.ts [offset=9,limit=50]

## CounterProps (type)
File: ./components/Counter.svelte [offset=6,limit=5]
```

The `offset` and `limit` match the read tool parameters for easy navigation.

### `list_types`

List all type names in the project (includes both TypeScript and Svelte files).

**Arguments:**
- `kind` (optional): Filter by kind
- `limit` (optional): Maximum results. Default: 100

### `type_check`

Run TypeScript type checking on the project or a specific file.

**Arguments:**
- `file` (optional): File path to check. If omitted, checks the entire project.

**Output:**
```
TypeScript errors in the file you just wrote:
<file_diagnostics>
ERROR [5:2] Type 'string' is not assignable to type 'boolean'.
</file_diagnostics>
```

Or for project-wide check:
```
TypeScript errors in other project files:
<project_diagnostics>
src/utils.ts
  ERROR [12:5] Property 'foo' does not exist on type 'User'.
</project_diagnostics>
```

Returns a success message if no errors are found.

## Packages

This is a monorepo with four packages:

| Package | Description |
|---------|-------------|
| `@nick-vi/type-inject-core` | Shared TypeScript extraction library |
| `@nick-vi/type-inject-mcp` | MCP server for TypeScript type lookup |
| `@nick-vi/claude-type-inject-hook` | Claude Code hooks (Read + Write) |
| `@nick-vi/opencode-type-inject` | OpenCode plugin |

## License

MIT
