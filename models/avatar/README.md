# Avatar models

Downloaded by the app on first use (not bundled, to keep the APK small); URLs are pinned to the
commit that added them, see `AvatarModel` in `ModelStore.kt`.

| File | Character | Source | License |
|---|---|---|---|
| `mira.vrm` | Mira (placeholder, matured) | VRoid beta sample "Sendagaya Shino", modified | CC0 |
| `kai.vrm` | Kai (placeholder, matured) | VRoid beta sample "Sakurada Fumiriya", modified | CC0 |

To replace a character: add the new `.vrm` here in its own commit, then point `AvatarModel` at
that commit hash (spec for new models: `docs/AVATAR_HANDOFF.md`).

Both are modified derivatives (school uniform replaced, proportions and face aged to mid-20s),
still CC0; the note is in each file's VRM meta. Rebuild and checks: `tools/avatar_mature/README.md`.
