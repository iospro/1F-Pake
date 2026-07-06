# Pake Architecture And Visible Webview Area

This document captures the current Pake architecture relevant to the 1Forma desktop wrapper and the problem of reserving top chrome space without breaking page layout, fixed elements, or bottom-bound UI.

## Current Working Baseline

- `pake-cli` is back to the stock `WebviewWindow` model.
- The stable working point in this project is commit `24dc40e chore: capture working desktop wrapper state`.
- The generated app is built through `build-new.sh`.
- The current app-specific injection is split across:
  - `same-window-routes.js` for tab/navigation and shared overlay logic;
  - `account-manager-routes.js` for the account manager UI.

Current bridge contract in the checked-in baseline:

- `same-window-routes.js` talks to Rust through `pake.tabs:request` and `pake.tabs:response`.
- Rust emits `pake-tabs:snapshot` after tab state changes.
- `account-manager-routes.js` uses the same event-bridge pattern through `ru.1forma.accounts:request` and `ru.1forma.accounts:response`.
- The native tab layer is backed by Rust `WebviewWindow` orchestration, not by `invoke(...)` calls.

## What Was Stabilized In The Recent 1Forma Work

The current codebase reflects these facts:

- Rust owns the startup URL for the main window.
- When the native account store is empty, Rust returns the local `empty-account.html` asset instead of a remote page or `about:blank`.
- When an active account exists, Rust injects that account's base URL directly in `window.rs`.
- The injected UI is split into two layers:
  - `same-window-routes.js` for shared shell behavior, navigation, tabs, and the top chrome;
  - `account-manager-routes.js` for the account list/add flow and its native bridge.
- The account bridge is late-bound: JS installs listeners first, then calls `init_account_bridge`, and Rust registers the native listener only after that handshake.
- Account writes must end with a fresh native snapshot so the JS UI does not drift away from the store.
- `New Window` now goes through Rust and creates a real extra `WebviewWindow`.
- The new-window path currently copies the active URL and window geometry from the focused window, but drag and size feel are still unstable and need a follow-up pass.

## How Pake Is Wired Internally

### CLI And Build Pipeline

The CLI entrypoint is `bin/cli.ts`.

Runtime flow:

1. `getCliProgram()` declares CLI flags.
2. `handleInputOptions()` normalizes URL/options.
3. `BuilderProvider.create()` selects the platform builder.
4. Builder `prepare()` generates app config and resources.
5. Builder `build(url)` runs Tauri with generated `.pake` config.

Key files:

- `bin/helpers/cli-program.ts` declares options.
- `bin/defaults.ts` owns defaults.
- `bin/types.ts` owns CLI/config shapes.
- `bin/helpers/merge.ts` turns CLI options into generated Pake/Tauri config.
- `src-tauri/.pake/pake.json` is generated for `cli-build`.
- `src-tauri/.pake/tauri.conf.json` is generated for `cli-build`.
- `src-tauri/src/inject/custom.js` is generated from `--inject`.

For 1Forma, the actual build command lives in `build-new.sh`:

```bash
PAKE_CREATE_APP=1 node "$PAKE_CLI_ENTRY" https://ru.1forma.ru \
  --name "$APP_SLUG" \
  --width 1600 \
  --height 1000 \
  --hide-title-bar \
  --multi-window \
  --camera \
  --microphone \
  --inject "$ROOT/same-window-routes.js" \
  --inject "$ROOT/account-manager-routes.js"
```

The script intentionally:

- uses the local `pake-cli` repository from the parent tree;
- avoids network install unless `ALLOW_NETWORK_INSTALL=1`;
- restores generated/mutated `pake-cli/src-tauri/entitlements.plist` and `pake-cli/src-tauri/src/inject/custom.js` on exit;
- copies the resulting `.app` into project `build/` and `dist/`.

### Rust Runtime Lifecycle

Runtime entry is `src-tauri/src/lib.rs`.

High-level flow:

1. Load Pake config and Tauri config through `get_pake_config()`.
2. Configure `tauri-plugin-window-state`.
3. Register plugins: OAuth, HTTP, shell, notification, opener.
4. Optionally register single-instance plugin.
5. Register invoke commands.
6. In `.setup()`, create `MultiWindowState`.
7. Build the main window through `set_window()`.
8. Create tray and global shortcut.
9. Show the main window after a short delay unless `start_to_tray` is enabled.

Window creation is centralized in `src-tauri/src/app/window.rs`.

Important functions:

- `set_window()` creates the main `WebviewWindow` label `pake`.
- `open_additional_window()` creates `pake-1`, `pake-2`, etc.
- `open_additional_window_safe()` wraps additional-window creation and uses a separate thread on Windows.
- `build_window()` owns the actual `WebviewWindowBuilder` setup.

Important builder behavior:

- Windows are created as `WebviewWindow`, not `Window + child Webview`.
- Main and additional windows use the same builder path.
- Initial window visibility is controlled by `.visible(visible)`.
- Main window is built hidden, then shown later.
- On macOS, `hide_title_bar` maps to `TitleBarStyle::Overlay`.
- `new_window` is a separate feature for `window.open`, not the same thing as `multi_window`.

### Config Shape

Runtime config shape is in `src-tauri/src/app/config.rs`.

Relevant fields:

- `hide_title_bar`
- `fullscreen`
- `maximize`
- `width`
- `height`
- `resizable`
- `always_on_top`
- `incognito`
- `new_window`
- `start_to_tray`
- `enable_find`
- `min_width`
- `min_height`

### Injection Order

`window.rs` injects scripts in this order:

1. `window.pakeConfig = ...`
2. `find.js`
3. `toast.js`
4. `fullscreen.js`
5. `event.js`
6. `style.js`
7. `theme_refresh.js`
8. `auth.js`
9. `custom.js`

For 1Forma, `custom.js` is generated from `same-window-routes.js` plus `account-manager-routes.js`, so the app-specific overlays run after Pake's common injections.

## Current 1Forma Injection

The project injection files are `same-window-routes.js` and `account-manager-routes.js`.

It currently does four major jobs:

1. Dock badge sync from title and ticker API responses.
2. Same-window routing for links that stay on the current 1Forma domain, plus external browser handoff for links that leave it.
3. Custom macOS overlay titlebar.
4. Native-tab UI that talks to Rust through the event bridge.

The custom overlay:

- only enables on macOS when `window.pakeConfig.hide_title_bar` is true;
- uses a fixed `44px` titlebar height;
- appends a fixed titlebar into `document.documentElement`;
- reserves space with `body { padding-top: 44px !important; }`.

## Why The Current Visible-Area Fix Is Fragile

The current CSS reservation is:

```css
html {
  scroll-padding-top: 44px;
}

body {
  padding-top: 44px !important;
  box-sizing: border-box;
}
```

This changes document layout, but it does not change the real webview viewport.

Consequences:

- `window.innerHeight` remains the full webview height.
- `100vh`, `100dvh`, `h-screen`, and full-height flex layouts still calculate from the full viewport.
- `position: fixed` elements remain pinned to the physical viewport, not to the padded body.
- `bottom: 0` controls can overlap or fall outside the intended visible content area.
- Internal scroll containers do not automatically shrink by `44px`.
- Sticky headers/sidebars can stick to the wrong scroll boundary.
- A root `transform`/`translateY` workaround is worse because it creates a new containing block and breaks fixed descendants and hit testing.

This is why "move content down" fixes the top but causes the bottom edge to go out of bounds.

## The Real Architectural Problem

We need to reserve native chrome space without lying to the page layout engine.

There are two different spaces:

1. Native window/client area, controlled by Tauri.
2. DOM layout inside the webview, controlled by the website and injected CSS/JS.

`padding-top` only affects the second space.

For pages with fixed, sticky, or `100vh` UI, the correct solution is usually to change the first space: make the webview's actual content rect start below the titlebar and be shorter by the titlebar height.

Then the page naturally sees the correct viewport:

- `100vh` becomes the content area height.
- `fixed bottom: 0` pins to the real visible bottom.
- sticky and scroll containers behave as if the top chrome is outside the webview.

## Solution Classes

| Approach | What It Does | Pros | Cons | Recommendation |
|---|---|---|---|---|
| `body padding-top` | Moves normal document flow | Simple | Breaks `100vh`, fixed/sticky/bottom UI | Do not use as base strategy |
| `scroll-padding-top` | Helps anchor scrolling | Low risk | Does not reserve viewport | Use only as supplement |
| Targeted `calc(100dvh - 44px)` CSS | Shrinks known containers | Can patch specific pages | Requires knowing 1Forma DOM, brittle | Temporary workaround only |
| Wrapper around whole app | Creates artificial content viewport | Conceptually neat | Can break SPA hydration, portals, modals | High risk |
| Native titlebar overlay only | Leaves DOM untouched | No layout regression | Content can sit under overlay | Good only if site has safe-area support |
| Separate webview content rect | Makes actual webview viewport smaller | Correct for fixed/sticky/100vh | Requires Rust/Tauri architecture change | Best long-term direction |
| Tauri child webview / multi-webview | Parent window hosts chrome + child content webview | Enables native chrome/tabs | More lifecycle risk, platform caveats | Possible, but must be feature-gated/prototyped |
| Upstream app safe area | Site handles desktop shell inset itself | Cleanest for one product | Requires changing 1Forma frontend | Ideal if available |

## Recommended Path

### Phase 0: Keep Working Baseline Stable

Do not change `pake-cli` runtime until there is a small prototype.

The current stable baseline is:

- stock `WebviewWindow`;
- project commit `24dc40e`;
- app launches;
- no `Window::add_child` architecture.

### Phase 1: Remove Dangerous Layout Assumptions

Short-term:

- stop relying on global `body padding-top` as the main layout fix;
- avoid `transform`, `translateY`, and root wrappers;
- keep overlay small and mostly visual;
- if necessary, add targeted CSS only for known 1Forma root scroll containers.

This does not solve the architecture, but prevents making the bottom-edge bug worse.

### Phase 2: Decide The Real Chrome Model

There are two viable directions.

#### Direction A: Keep One WebviewWindow

Use macOS `TitleBarStyle::Overlay` and avoid reserving space inside the page globally.

Best when:

- tab UI is not required yet;
- the page can tolerate a small top overlay;
- we can add upstream/site-specific safe-area support.

Limits:

- cannot make `100vh` automatically exclude the custom toolbar because the toolbar is inside the same webview.

#### Direction B: Parent Window + Content Webview Rect

Create native/top chrome outside the content webview, then put the page webview at:

- `x = 0`
- `y = toolbarHeight`
- `width = parentInnerWidth`
- `height = parentInnerHeight - toolbarHeight`

Best when:

- we need native tabs;
- fixed/sticky/bottom UI must be correct;
- `100vh` must refer to visible content only.

Risks:

- Tauri Rust `Window::add_child` is behind the `unstable` feature.
- It changes the model from `WebviewWindow` to `Window + Webview`.
- Many existing Pake assumptions use `get_webview_window("pake")`.
- Capabilities may need to include new webview labels.
- Resize handling must be explicit and platform-aware.
- Linux/Wayland and macOS WKWebView lifecycle need extra caution.

If this path is chosen, it must be built as a small feature-gated prototype, not dropped into the main runtime in one shot.

## New Window Follow-up Plan

The `New Window` work is not considered finished yet. The remaining plan is:

1. Keep `New Window` routed through Rust, not through JS-side page cloning.
2. Preserve Dock/reopen as the separate "show existing window" path.
3. Continue using the focused webview as the source of truth for copied URL and window state.
4. Stabilize macOS drag behavior on the overlay/titlebar layer separately from window-copy logic.
5. Re-check whether `inner_size` or `outer_size` should be the canonical geometry source if the clone still jumps between smaller and larger frames.
6. If the cloned window frame is still inconsistent, split the builder path for main window vs copied window instead of trying to force one shared geometry contract.
7. Only after geometry and drag are stable should we decide whether `New Window` also needs to clone title, focus state, or tab snapshot state.

## Why The Previous Child-Webview Attempt Could Collapse The Window

Likely causes:

- The app changed from `WebviewWindow` to `Window + child Webview`, but the rest of Pake still expected `WebviewWindow`.
- Existing code paths still looked up `get_webview_window("pake")`, while the actual page was moved to another label.
- Child webview bounds may have been calculated before the parent had restored final size from `tauri-plugin-window-state`.
- Bounds may have mixed physical and logical sizes.
- Resize handling was not mature enough.
- New webview labels were not synchronized with capabilities and menu/invoke assumptions.
- macOS titlebar overlay plus manual child bounds can conflict with restored inner size.
- If a bad tiny size was saved by window-state, subsequent launches could appear collapsed or invisible.

## Native Tabs: Required Contract

The current tab layer is bridge-based and must stay consistent between JS and Rust.

JS sends:

- `get_tabs`
- `open_tab`
- `switch_tab`
- `close_tab`
- `set_tab_title`
- `set_tab_path`

Rust replies:

- `pake.tabs:response`

Rust emits:

- `pake-tabs:snapshot`

Rust owns:

- a `TabManager`;
- stable tab IDs;
- active tab state;
- title/path sync;
- explicit show/hide behavior between `WebviewWindow`s;
- snapshot emission after every change.

Important: if tabs are implemented with multiple `WebviewWindow`s, the `+` action must create the new window hidden first and only then activate it, otherwise the OS window frame flashes visibly.

## Safe Change Points

For small changes:

- `same-window-routes.js` for project-only injected UI/routing/badge logic.
- `account-manager-routes.js` for the separate account manager layer.
- `build-new.sh` for actual build flags.

For Pake runtime:

- `src-tauri/src/app/window.rs` is the central place for window geometry and builder flags.
- `src-tauri/src/lib.rs` is the central lifecycle and invoke registration point.
- `src-tauri/src/app/invoke.rs` is where tab commands would belong.
- `src-tauri/capabilities/default.json` must be reviewed if new webview labels or APIs are added.

Avoid editing generated files directly:

- `src-tauri/.pake/*`
- `src-tauri/src/inject/custom.js`
- `src-tauri/entitlements.plist`

## Rebuild Commands

From a clean local state:

```bash
cd ../..
pnpm install
pnpm run cli:build
```

Then:

```bash
cd .
bash build-new.sh
```

If `node_modules` or `dist/cli.js` is missing and network install is acceptable:

```bash
cd .
ALLOW_NETWORK_INSTALL=1 bash build-new.sh
```

Expected outputs:

- `build/.staging/1forma.app`
- `dist/Первая Форма.app`

## Final Recommendation

Do not try to solve the visible-area bug with global CSS offsets.

The clean architecture is:

1. Keep the toolbar/chrome outside the content page.
2. Make the webview's real content rect smaller by the toolbar height.
3. Let the page see the correct viewport naturally.
4. Only then restore native tabs, with a Rust-side tab manager and a JS contract that actually exists in the runtime.

Until that architecture is prototyped safely, keep the current stock `WebviewWindow` baseline and avoid global `body` movement.
