# Sesly brand

Sesly uses a flat geometric "S" cut out of a solid tile. Strictly monochrome:
no accent color, no gradients, no glow, no decorative rings. The product voice
is clear, calm, and direct.

The desktop UI follows the same rule — black, white, and neutral grays only,
with hue reserved for status (error, warning, success). Primary actions are
white on black in dark mode and black on white in light mode. Typography is
Geist Sans and Geist Mono, bundled locally via `@fontsource-variable`.

## Assets

| Surface | Source |
|---|---|
| Primary vector mark | `docs/logo.svg` |
| README mark | `docs/logo.png` and `docs/logo-256.png` |
| Browser icon | `frontend/public/favicon.svg` |
| In-app mark | `frontend/src/components/brand/SeslyMark.jsx` |
| Desktop/platform icons (Electron, via the shared Tauri icon set) | `frontend/src-tauri/icons/` |
| Electron in-app mark | inline `<BrandMark />` in `electron/src/renderer/src/components/brand-mark.tsx` (theme-aware: tile is `currentColor`, letter is the page background) |
| Electron browser icon | `frontend/public/favicon.svg` via `electron/src/renderer/src/lib/brand.ts` |

Regenerate every desktop icon from the canonical vector after changing the
mark: rasterize PNG sizes with `sharp`, pack `icon.ico` with `png-to-ico`, and
pack `icon.icns` with the pure-JS `png2icons` (works on Windows/Linux too).
The `android/` and `ios/` sets are archived Tauri targets; regenerate them at
their existing sizes (iOS: opaque full-bleed tile; Android adaptive background
`#0A0A0A`).

Do not redraw the mark per screen. Use `SeslyMark` in React and the canonical
SVG elsewhere so the silhouette stays recognizable at 16–512 px.

## Palette

| Role | Color |
|---|---|
| Tile | `#0A0A0A` (neutral, near-black), corner radius 14/64 |
| Mark stroke | `#FFFFFF`, 6/64 wide, butt caps |
| Accent | none |
| Tray "recording" state | mark dimmed to `#A3A3A3` (neutral-400), status dot `#DC2626` (red-600), ring `#FFFFFF` |

The mark may render in one color (`currentColor`) inside app chrome. Do not
put text inside the icon or add gradients, glows, or an enclosing ring.

## Name and copy

- Product name: **Sesly** — one word, capital S.
- Voice: concise, professional, warm, and direct.
- Promise: local-first creation without a subscription or usage meter.
- Avoid absolute privacy claims: network-backed engines, downloads, analytics,
  and cloud integrations are explicit opt-ins, not nonexistent.
- Attribute the bundled default model as **k2-fsa/OmniVoice** where model lineage
  matters. OmniVoice is an upstream model/runtime name, not the product name.

## Compatibility names

Sesly has no prior installed base, so its own identifiers are fully rebranded
top to bottom — including the archived Tauri shell's bundle identifier
(`com.salihavcioglu.sesly`) and Cargo package/dev-binary name (`sesly-dev`,
kept distinct from the installed app so the dev launcher's process match can
never collide with a real installed app). A few names stay as they are for a
different reason — they identify an **upstream** project Sesly vendors or
extends, not the old brand:

- `omnivoice` Python imports and package name (`pyproject.toml`) — vendors
  upstream `k2-fsa/OmniVoice`, not ours to rename.
- `OMNIVOICE_*` environment variables and `X-OmniVoice-*` API headers.
- existing `OmniVoice` / `.omnivoice` data and cache directories, and the
  `omnivoice.db` filename — this is where every user's voices, projects and
  settings already live.
- upstream repositories, model IDs, classes, and engine IDs.

The **actively maintained** identity — Electron's `appId`
(`com.sesly.desktop`), window title, published Docker/GHCR image
(`ghcr.io/salihavcioglu/sesly`), and the root/`electron` package names — is
fully rebranded, since those are Sesly's own.

Visible copy can explain those compatibility names, but must not silently
rename them on disk or over the wire.

Electron uses the shared multi-resolution ICO for Windows window/taskbar and tray
icons, the shared PNG for Linux and macOS runtime icons, and the ICNS for the macOS
bundle. The tray icon restores the window; closing the app retains its existing
quit behavior. Installed executable icons are applied when building the installer.
