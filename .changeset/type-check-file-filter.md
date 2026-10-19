---
"@nick-vi/type-inject-core": patch
---

Fix `type_check` with a `file` argument returning raw tsc output from other files when the requested file has no errors. It now reports the file as clean; raw output is only returned when tsc fails without any parseable diagnostics.
