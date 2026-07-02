# Custom Pake Overlay Features

This document lists the project-specific overlay ideas and product logic that sit on top of Pake.

It is intentionally **not** a concrete implementation plan. It is a feature map and mental model for the custom layer we are building around the stock Pake runtime.

## What This Layer Is

The custom layer is the set of app-specific JS overlays and native commands that extend Pake without replacing its core window/webview runtime.

It contains:

- navigation and tab orchestration;
- account selection and account creation UI;
- window-scoped app state;
- future login/session recovery behavior;
- future native integrations such as badges, tray behavior, and native account storage.

## Current Feature Set

### 1. Native Tab Shell

Goal:

- keep the Pake `WebviewWindow` model;
- expose a tab-like UI inside the webview;
- map each logical tab to a native Rust window.

Important behavior:

- the `+` button creates a native webview window;
- switching tabs should not recreate windows;
- the native window is the source of truth for tab state.

### 2. Account Manager Overlay

Goal:

- provide a native-feeling account chooser inside the webview;
- keep the list of accounts separate from the account creation form;
- allow switching the active account before navigating into the app flow.

Current interaction model:

- the list screen shows existing accounts and a `Добавить` action;
- the add screen shows only the account creation form;
- the active account can be selected from the list;
- an account can be removed from the list.

### 3. Build-Time ACL and Permission Wiring

Goal:

- keep custom Rust commands callable from JS;
- make ACL failures explicit at build time, not as silent runtime surprises.

The key rule:

- capability files decide which webview may call the command;
- permission manifests decide whether the command exists for build-time ACL;
- JS payload shape must match the Rust command signature exactly.

### 4. Generated Config Awareness

Goal:

- avoid assuming `.pake/tauri.conf.json` stays in sync with the source config;
- treat generated build artifacts as build inputs that can drift.

### 5. Future Account State

Potential next steps:

- persist and surface access/refresh token state;
- restore the previously selected account on app start;
- introduce a “needs login” state for expired sessions;
- show account health/credential status in the list view.

## Design Rules

These are the current rules for the custom layer:

1. Keep Pake core window management intact.
2. Put project-specific UI in injected JS, not in random Rust hacks.
3. Use Rust only where persistence, window orchestration, or command execution is needed.
4. Keep build-time ACL permissions explicit and local to the repo.
5. Keep bridge payloads boring and schema-shaped.
6. Keep the account chooser and the add form as two separate user states.

## What This Document Is For

Use this file when you need to remember:

- what the custom layer is supposed to do;
- what belongs to the overlay versus the native core;
- which ideas are product direction rather than implementation details.

