# AGENTS.md - ru.1forma.ru Project

## Required Includes (Project)

INCLUDE_REQUIRED: `~/.codex/AGENTS.md`

## Include Fallback (Project)

- If global include files are unavailable on this machine, continue with the project rules in this file.
- Treat `README.md` and the checked-in scripts in this folder as the source of truth for the app-specific workflow.

## Project Rules

- This folder contains the macOS desktop project for `ru.1forma.ru`.
- Use the parent `pake-cli` repository two levels up from this folder for app builds.
- Build the `.app` separately from the `.dmg`; do not rely on the built-in Pake DMG pipeline.
- Keep notarization as a separate step and do not fold it into the normal local build.
- Keep the VKS route handling in `same-window-routes.js`.
- Build with the macOS camera and microphone flags when testing VKS flows.
- Update `README.md` when the build pipeline or app-specific contracts change.
