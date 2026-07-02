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
3. If credentials are valid, the app opens the webview for that account.
4. If credentials are expired or invalid, the app shows the account picker / login screen.

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
