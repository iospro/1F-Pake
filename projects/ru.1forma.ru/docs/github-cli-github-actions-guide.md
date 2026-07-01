# GitHub CLI And GitHub Actions For 1F-Pake

This guide records the practical flow we used to manage GitHub, branches, and Actions for the `ru.1forma.ru` desktop app.

## What We Were Trying To Do

- build a Windows MSI through GitHub Actions;
- trigger the build from terminal, not from the GitHub UI;
- use the custom workflow `ru-1forma-windows.yml`;
- build code from branch `1f`.

## GitHub CLI

`gh` is GitHub's official command-line client.

Common commands:

```bash
gh auth login
gh auth status
gh workflow run ru-1forma-windows.yml --ref 1f
gh run list --workflow ru-1forma-windows.yml
gh run watch
gh run download
```

## Login

First-time login:

```bash
gh auth login
```

Typical flow:

1. choose `GitHub.com`;
2. choose `HTTPS`;
3. open the device login page in a browser;
4. enter the code printed by `gh`;
5. confirm access.

Check the result:

```bash
gh auth status
```

## GitHub Actions

GitHub Actions is GitHub's built-in CI system.

It runs workflows described in YAML files under `.github/workflows/`.

Example:

```yaml
on:
  workflow_dispatch:

jobs:
  build:
    runs-on: windows-latest
```

## Workflow

A workflow is just one YAML file.

For this project, the relevant workflow is:

```text
.github/workflows/ru-1forma-windows.yml
```

`workflow_dispatch` means the workflow can be started manually.

## `--ref`

The `--ref` flag in `gh workflow run` chooses the branch whose source code should be built.

Example:

```bash
gh workflow run ru-1forma-windows.yml --ref 1f
```

That means:

- use workflow definition from the branch where GitHub already indexed it;
- build source code from branch `1f`.

## Default Branch Rule

GitHub indexes workflows from the repository's default branch.

That is why a workflow may be visible in the repo, but still not appear in Actions if it only exists on a non-default branch.

In our case:

- `main` is the default branch on GitHub;
- `1f` is the working branch for the Windows build flow.

If a workflow does not appear in the UI, the fix is usually:

1. make sure the workflow file exists on the default branch, or
2. run it explicitly with `gh workflow run ... --ref 1f`.

## Our Working Flow

From the terminal inside `ru.1forma.ru`:

```bash
cd /Users/malex/Work/Pake/pake-cli/projects/ru.1forma.ru
bash ./scripts/run-windows-gh.sh
```

That script:

1. refuses to run if the working tree is dirty;
2. triggers `ru-1forma-windows.yml` on branch `1f`;
3. prints the run URL;
4. follows the live log in the terminal.

If you want the raw `gh` sequence:

```bash
cd /Users/malex/Work/Pake/pake-cli
gh workflow run ru-1forma-windows.yml --ref 1f
gh run list --workflow ru-1forma-windows.yml
gh run watch <RUN_ID>
gh run download <RUN_ID> -n 1forma-windows
```

If the run fails, inspect the failed log:

```bash
gh run view <RUN_ID> --log-failed
```

## What Broke And Why

We hit two common issues:

- `projects/ru.1forma.ru` was first treated like a gitlink/submodule pointer, so GitHub Actions could not see `same-window-routes.js` on the runner;
- Windows build rejected the Russian app name in `--name`, so we had to use the slug `1forma` and keep the human title in `--title`.

## Final Working Pattern

- keep `projects/ru.1forma.ru` as real files inside `pake-cli`;
- before Windows CI, make sure the tree is clean and committed;
- use `scripts/run-windows-gh.sh` for the Windows build and live log;
- use `scripts/rebuild-local.sh --dmg` for macOS packaging;
- use `gh run download <RUN_ID> -n 1forma-windows` to fetch the MSI artifact.
