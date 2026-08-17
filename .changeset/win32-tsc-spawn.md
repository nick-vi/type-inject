---
'@nick-vi/type-inject-core': patch
---

Make `type_check` run `tsc` on Windows. On win32, `node_modules/.bin/tsc` is an extensionless shell shim that `child_process.spawnSync` cannot execute directly, so `type_check` fails with `ENOENT`. Run the spawn through `cmd` on Windows so the `.cmd` shim resolves, and quote arguments that contain spaces.
