// BROWSER KEYSTORE PASS Gate 1 stage 3 — `server-only` for the device bundle. The marker meant "never ship this to a
// client bundle that has no keys"; the device bundle IS the key holder (docs/custody-model.md D-CU-0-2), so it is a
// no-op here. The Next server bundle still enforces it.
export {};
