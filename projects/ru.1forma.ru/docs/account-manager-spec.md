# Account Manager Spec

This document defines the next product layer for `ru.1forma.ru`: a native account manager with credential capture from web authentication.

## Goal

The app should store multiple accounts natively and switch between them without losing the current product architecture:

- each account has its own host/domain;
- credentials are captured from the web login flow for the selected account;
- the native app becomes the source of truth for saved accounts and active account selection;
- the webview remains only the login/interaction surface used to obtain and refresh credentials.

## Non-goals

- do not move to a browser-profile-only model;
- do not treat project trees or source code as account-specific data;
- do not require manual token entry by the user;
- do not redesign the native tab/window architecture in this task.

## User Flows

### First Launch

1. App opens for the first time.
2. Instead of going directly into the site, the app shows an account setup screen.
3. The user enters the domain/host for the account.
4. The user continues into the existing web login flow for that host.
5. After successful login, the app captures and stores the account credentials.

### Normal Launch

1. App opens.
2. App loads the previously active account.
3. The startup URL is injected in Rust the same way the static URL used to be injected.
4. If credentials are valid, the app opens the webview for that account.
5. If credentials are expired or invalid, the app shows the account picker / login screen.

### Account Switch

1. User clicks the account button in the top bar.
2. App opens the account picker / account manager screen.
3. User selects an existing account or adds a new one.
4. App switches the active account context.
5. App opens the existing login flow for that selected account if re-authentication is needed.

## UI Requirements

### Entry Screen

The account manager screen must support:

- add a new account by host/domain;
- list existing accounts;
- mark expired accounts as needing login;
- switch to an existing account;
- show the active account clearly.

### Top Bar

Add a button on the right side of the top bar that opens the account manager screen from anywhere in the app.

## Rendering and Click Contract

The account manager UI is split into two visible modes:

1. account list mode;
2. add-account mode.

The click contract is strict:

- the list mode shows existing accounts, the active state, and delete actions;
- the add mode shows only the add form and its submit button;
- clicking `Добавить` from the list mode must switch into add mode, not create a separate screen;
- clicking `К списку` is no longer part of the flow;
- deleting an account must open the in-UI confirm overlay first;
- clicking the delete confirm button must call the native delete path, not `window.confirm()`;
- if the deleted account was active and other accounts remain, the first remaining account becomes active;
- if the deleted account was the last one, the app must return to the add flow and the main webview must also fall back to the empty-account page.

The button logic only works reliably when the panel is mounted before it is shown. The practical ordering is:

1. build or update the DOM;
2. attach listeners;
3. set `visible = true`;
4. then add the visible class.

This is why an open/close button can appear visually correct but still fail to react if the show/hide sequence is inverted.

## Account Model

Each account should store at minimum:

- `id`
- `title`
- `host`
- `baseUrl`
- `active`
- `createdAt`
- `updatedAt`
- `credentialState`
- `accessToken`
- `refreshToken`
- `expiresAt`
- optional web session metadata required by the site

Suggested state values for `credentialState`:

- `new`
- `authenticated`
- `expired`
- `invalid`
- `revoked`

## Credential Capture

Credentials must be captured from the web auth flow after a successful login for the chosen account.

Expected behavior:

- the login happens in the existing webview flow;
- when the site completes auth, Rust or injected JS intercepts the resulting token payload;
- the app persists the credentials into the native account store;
- the active account becomes `authenticated`;
- the app returns to the normal app view.

The capture layer should treat these as the minimum payload:

- access token
- refresh token
- expiry metadata
- any stable account identifier returned by the site

## Refresh / Expiry Handling

When an active account becomes invalid:

- the app should not silently fail;
- the account should move to `expired` or `invalid`;
- the UI should return the user to the account manager screen;
- selecting the same account should reopen the web login flow for that host.

## Storage Rules

- account storage must be native/local;
- the storage layer must be separate from the current web session;
- credentials must be isolated per account;
- the active account must be persisted across app restarts;
- the account list must be available even when the current web session is dead.

## Code Integration Points

The implementation should be split by responsibility:

### Rust

- native account storage;
- active account selection;
- credential persistence;
- auth state detection;
- commands for opening the account manager screen;
- commands for selecting an account and starting login for that host.

### JS / Injected UI

- top-bar account button;
- account manager screen rendering;
- list/add account forms;
- communication with Rust through the event bridge;
- auth success signal capture if the web flow exposes it cleanly in JS.

Current bridge contract:

- JS sends account requests through `ru.1forma.accounts:request`;
- Rust replies through `ru.1forma.accounts:response`;
- Rust emits `ru.1forma.accounts.snapshot` after store changes.

## Technical Architecture

This feature is split into three layers so the account manager can evolve without destabilizing the web app.

### Native state layer

Rust owns the durable account state and the bridge lifecycle.

Responsibilities:

- keep the authoritative list of accounts;
- track the currently active account;
- persist account metadata and credentials;
- expose commands for read and write operations;
- emit snapshots after each state change;
- register the native listener only after JS has finished its startup handshake.

This layer does not:

- render the account manager UI;
- own input focus, button state, or form validation;
- assume the webview is ready during app launch;
- register early listeners in `setup()` if that can crash startup.

### Web UI layer

JS owns the interactive shell inside the webview.

Responsibilities:

- render the account manager screen;
- show the current account list;
- show the add-account form;
- keep local interaction state such as input values, button enabled state, and debug markers;
- call Rust commands when the user asks for data changes;
- react to Rust snapshots and responses.

This layer does not:

- decide how accounts are stored on disk;
- own the native lifecycle of the app;
- register native listeners before the webview is ready;
- keep the account store as the only source of truth.

### Bridge contract layer

This is the protocol between the two worlds.

Current contract:

- JS installs its listeners first;
- JS calls `init_account_bridge`;
- Rust registers the native bridge listener at that point;
- Rust immediately emits the current account snapshot;
- JS updates visible state from that snapshot;
- later mutations flow through request/response events and snapshot refreshes.

This contract exists specifically to avoid startup races on macOS and to keep bridge initialization deterministic.

## Webview Startup Rules

The startup webview URL is owned by Rust.

Rules:

- empty store => load `empty-account.html`;
- active account exists => inject its `base_url` into the main window from Rust;
- do not let JS also rewrite the startup URL if Rust already selected it;
- if the user switches accounts, the selected account must be persisted natively before the webview navigates;
- if the account list becomes empty, the app should not leave the user staring at a blank shell.
- after deleting the last account, JS should ask Rust to navigate the current main window to the local empty-account page instead of trying to resolve the URL itself.

This makes the webview behave like a controlled native surface instead of a page that guesses its own startup URL.

## Startup Rule

The startup URL for the main `WebviewWindow` must be chosen in Rust before the window is built.

Do not:

- inject a second JS-side redirect on startup when Rust already picked the active account;
- wait for the account manager overlay to decide the page URL;
- use a page-load hook to re-show the main window after the user has already closed it.

Do:

- resolve the active account once in the Rust window builder;
- fall back to the static project URL only when no active account exists;
- treat the startup URL path as the same kind of injection point that the old static URL used.

## Internal Structure

The account manager is easier to reason about as a set of focused modules rather than one monolithic feature.

### Rust-side modules

#### `src-tauri/src/app/account_store.rs`

This is the account domain store.

Logical responsibilities:

- `AccountRecord` stores one saved account;
- `AccountStore` keeps the in-memory/native collection;
- `UpsertAccountParams` describes add/update operations;
- `SetActiveAccountParams` describes account switching;
- `AccountListResponse` packages list output for the UI;
- `AccountBridgeRequest` and `AccountBridgeResponse<T>` define the bridge payload contract;
- `list_accounts()` returns the current account list;
- `upsert_account()` adds or updates one account;
- `set_active_account()` changes the active account;
- `emit_current_accounts_snapshot()` pushes the current store state to JS;
- `register_account_bridge()` installs the native listener that reacts to JS requests.

#### `src-tauri/src/lib.rs`

This is the app bootstrap and command registration point.

Responsibilities:

- register Tauri plugins;
- expose account-related commands through `invoke_handler`;
- own the `init_account_bridge` handshake command;
- keep startup work minimal enough to avoid early AppKit crashes;
- wire global app concerns such as menu, tray, and window visibility.

#### `src-tauri/src/app/window.rs`

This is the native window orchestration layer.

Responsibilities:

- create and focus windows;
- manage visibility and focus behavior;
- support the existing tab/window architecture;
- keep account manager work separate from core window mechanics.

#### `src-tauri/src/app/invoke.rs`

This file hosts app commands that are not account-store specific.

Responsibilities:

- general app commands;
- notifications;
- downloads;
- badge and dock helpers;
- theme and restart commands.

### JS-side modules

#### `projects/ru.1forma.ru/account-manager-routes.js`

This is the account manager UI controller.

Responsibilities:

- bootstrap the account manager screen;
- install listeners for native responses and snapshots;
- send bridge requests to Rust;
- maintain UI-local state like input values, debug steps, and button state;
- render the list/add-account experience.

#### `projects/ru.1forma.ru/same-window-routes.js`

This is the shared shell and navigation controller.

Responsibilities:

- manage the current webview-driven shell;
- keep the tab and navigation overlay behavior working;
- stay focused on general app route logic rather than account manager internals.

## Why the split matters

The split is not cosmetic. It protects us from three failure classes:

1. Startup crash risk from early native event registration.
2. State drift between what the web UI shows and what the native store owns.
3. Future feature creep where account logic starts leaking into the general navigation file.

With this split:

- Rust owns persistence and lifecycle-sensitive code;
- JS owns interaction and rendering;
- the bridge is the only narrow seam between them;
- the app can restart, reload, or re-render the webview without losing account state.

## Account Manager Flow, End to End

1. App launches.
2. WebView loads the injected routes.
3. The account manager JS layer initializes its listeners.
4. JS calls `init_account_bridge`.
5. Rust registers the bridge listener and emits a snapshot.
6. JS renders the current account list.
7. User adds or selects an account.
8. JS sends a bridge request.
9. Rust mutates the native store and emits a fresh snapshot.
10. JS redraws the screen from the new snapshot.

The key property is that the UI is always derived from native state, not the other way around.

## Button Payload Rules

The account manager buttons only work when the JS payload matches the Rust command signature exactly.

Current shape:

- `upsert_account` receives `{ params: { title, host } }`;
- `set_active_account` receives `{ params: { id } }`;
- `delete_account` receives `{ params: { id } }`.

If the payload shape drifts, the UI may still click and animate, but Rust will reject the command and the screen will look broken even though the button itself is wired.

## Event Map

This section defines the live event contract between JS and Rust.

### JS -> Rust

- `init_account_bridge`
  - sent by JS after its listeners are installed;
  - starts the native bridge lifecycle;
  - must not be called before the web layer is ready.

- `ru.1forma.accounts:request`
  - carries account actions such as list, add, and switch;
  - is the main request channel for the account manager UI;
  - should stay the only direct command pipe from JS to the native account store.

### Rust -> JS

- `ru.1forma.accounts:response`
  - carries replies for request/response bridge actions;
  - returns either payload data or an error for the originating request.

- `ru.1forma.accounts.snapshot`
  - carries the full current account list state;
  - is emitted after store mutations and during bridge bootstrap;
  - is the canonical refresh signal for the JS UI.

### Lifecycle Rules

- JS installs listeners first.
- JS then calls `init_account_bridge`.
- Rust registers the native listener only at that point.
- Rust immediately emits the current snapshot.
- JS always rebuilds the visible screen from the latest snapshot.
- Any write operation should end with a fresh snapshot so the UI and native store cannot drift.

### Failure Boundaries

- if JS is not ready, the bridge should not start;
- if Rust has not emitted a snapshot yet, the account manager UI should remain in a loading or bootstrap state;
- if a request fails, JS should show the error and keep the current snapshot intact.

### Existing Files Likely to Change

- [`/Users/malex/Work/Pake/pake-cli/projects/ru.1forma.ru/same-window-routes.js`](/Users/malex/Work/Pake/pake-cli/projects/ru.1forma.ru/same-window-routes.js)
- [`/Users/malex/Work/Pake/pake-cli/projects/ru.1forma.ru/account-manager-routes.js`](/Users/malex/Work/Pake/pake-cli/projects/ru.1forma.ru/account-manager-routes.js)
- [`/Users/malex/Work/Pake/pake-cli/src-tauri/src/app/window.rs`](/Users/malex/Work/Pake/pake-cli/src-tauri/src/app/window.rs)
- [`/Users/malex/Work/Pake/pake-cli/src-tauri/src/app/invoke.rs`](/Users/malex/Work/Pake/pake-cli/src-tauri/src/app/invoke.rs)
- [`/Users/malex/Work/Pake/pake-cli/src-tauri/src/lib.rs`](/Users/malex/Work/Pake/pake-cli/src-tauri/src/lib.rs)
- [`/Users/malex/Work/Pake/pake-cli/src-tauri/src/app/config.rs`](/Users/malex/Work/Pake/pake-cli/src-tauri/src/app/config.rs)

## Acceptance Criteria

The work is complete when all of the following are true:

1. First launch shows the account setup flow.
2. Existing accounts are listed natively.
3. Selecting an account opens the correct host in the existing login flow.
4. Successful auth stores access and refresh credentials natively.
5. Expired credentials bring the user back to account selection.
6. The top-bar account button opens the account manager from any screen.
7. No project-tree migration behavior is introduced.

## Open Questions

- Where exactly should the native store live: a local JSON file, OS keychain, or a hybrid model?
- What web event or payload is the most reliable source of `access_token` and `refresh_token`?
- Should the account manager be a full screen route or a modal-like overlay inside the current shell?
