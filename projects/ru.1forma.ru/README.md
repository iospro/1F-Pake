# ru.1forma.ru

Отдельный macOS desktop-проект на базе Pake для сайта `ru.1forma.ru`.

Структура и подход такие же, как у `1forma.ru`:

- отдельная папка под проект;
- свой `config.json`;
- свой `build-new.sh`;
- при необходимости свои инъекции.

Цель:

- открыть `ru.1forma.ru` в отдельном приложении на Mac;
- проверить авторизацию через обычные cookies/session;
- сохранить вход между перезапусками, если сайт это позволяет.

Важно:

- сайт должен открываться в широком desktop-viewport;
- если окно слишком узкое, верстка может схлопываться в responsive-режим;
- для `ru.1forma.ru` лучше стартовать с большого окна.

## Pipeline сборки

Зафиксирован рабочий pipeline для macOS:

- `Pake` используется только для сборки `.app`;
- встроенный `Pake`-pipeline для `.dmg` не используется;
- `.dmg` собирается отдельно через `dmgbuild` по логике `Codex Manager`;
- notarization выполняется отдельным шагом и не входит в обычную локальную сборку.

Практически это означает:

- `./build-new.sh` собирает только `.app`;
- `scripts/rebuild-local.sh` — удобный wrapper для локальной пересборки `.app`;
- `./build-new.sh` использует локальный репозиторий `pake-cli` из соседнего дерева проекта, а не системный `/opt/homebrew/lib/node_modules/pake-cli`;
- `./build-new.sh` запускает CLI из корня `pake-cli`, чтобы upstream-логика package manager видела pinned `pnpm@10.26.2` и не падала в `npm` fallback;
- `scripts/package-dmg.sh` упаковывает готовый `.app` в `.dmg`;
- `scripts/docker-check.sh` запускает легкие контейнерные проверки, но не собирает macOS `.app`;
- `scripts/notarize-app.sh` нужен только для будущего релизного шага.

Ключевые файлы:

- `build/.staging/1forma.app` — промежуточный результат app-only сборки;
- `dist/Первая Форма.app` — итоговый macOS app после postprocess;
- `dist/Первая Форма.dmg` — итоговый DMG;
- `docs/github-actions-multiplatform-builds.md` — схема сборок macOS, Windows и Linux на GitHub-hosted runners;
- `docs/github-cli-github-actions-guide.md` — практический гайд по `gh`, Actions и запуску workflow из терминала;
- `docs/build-and-acl-essentials.md` — краткая памятка по build-time ACL, `.pake`-конфигу и критическим файлам сборки;
- `.github/workflows/ru-1forma-windows.yml` — ручная сборка Windows MSI для `ru.1forma.ru`;
- `scripts/rebuild-local.sh` — локальная пересборка `.app`, опционально с `--install` и `--dmg`;
- `scripts/docker-check.sh` — Docker-проверка JS-синтаксиса без macOS app build;
- `.docker/check.Dockerfile` — минимальный image для Docker-проверок;
- `scripts/package-dmg.sh` — упаковка DMG;
- `scripts/dmgbuild_settings.py` — layout и Finder-геометрия DMG;
- `scripts/preflight-notarization.sh` — проверка prereqs;
- `scripts/notarize-app.sh` — отдельный шаг notarization.

Команды:

```bash
# Локально пересобрать .app без сетевой установки зависимостей
scripts/rebuild-local.sh

# Разрешить bootstrap pake-cli зависимостей, если локально они отсутствуют
scripts/rebuild-local.sh --install

# Пересобрать .app и затем упаковать DMG
scripts/rebuild-local.sh --dmg

# Пересобрать .app и упаковать DMG, автоматически добрав недостающий dist/cli.js
scripts/rebuild-local.sh --dmg --install

# Проверить, что дерево чистое, запустить Windows workflow и открыть live log
scripts/run-windows-gh.sh

# Проверить, что дерево чистое, запустить Linux workflow и открыть live log
scripts/run-linux-gh.sh

# Собрать Docker image для легких проверок
scripts/docker-check.sh --build

# Запустить Docker-проверку JS-синтаксиса
scripts/docker-check.sh
```

## Notarization

Для notarization используется не профиль из `Codex Manager`, а рабочие credentials из:

- `/Users/malex/Work/1Forma/CI/Сборка Electron/AuthKey_A8R92JBBQB.p8`

Логика:

- `scripts/preflight-notarization.sh` проверяет наличие `build/.staging/1forma.app`, `dmgbuild`, `xcrun notarytool` и файла ключа;
- `scripts/notarize-app.sh` отправляет zip с `build/.staging/1forma.app` через `notarytool submit --key --key-id --issuer`;
- значения `key id` и `issuer` синхронизированы с текущим Electron CI-процессом.

## Внутренняя навигация

Для `ru.1forma.ru` добавлена project-specific инъекция:

- `same-window-routes.js` — управляет табами, навигацией и общими overlay-патчами внутри текущего окна, включая принудительное удержание ВКС-сценариев в этом же webview.
- `account-manager-routes.js` — отдельный injected-слой для экрана учеток, списка аккаунтов и добавления новой учетки.

## Камера и микрофон

Для WebView-пермишенов macOS сборка должна идти с флагами:

- `--camera`
- `--microphone`

Эти флаги нужны отдельно от `Info.plist`, потому что `pake-cli` через них генерирует macOS entitlements для доступа к `getUserMedia`.

Дополнительно после сборки выполняется postprocess:

- `scripts/postprocess-macos-app.sh` обновляет privacy-описания в `Info.plist`;
- `scripts/macos-entitlements.plist` задает итоговый набор entitlements для приложения;
- туда уже включены `camera`, `microphone` и `location`.

## Native tabs

The app treats every Rust-created `WebviewWindow` as an independent tab. The injected overlay renders a native-style tab strip, while Rust stays the source of truth for tab creation, activation, closing, and snapshot sync. App-specific JS is split into `same-window-routes.js` for navigation/tab behavior and `account-manager-routes.js` for the account manager UI.

Current bridge contract:

- JS sends tab requests through `pake.tabs:request`;
- Rust replies through `pake.tabs:response`;
- Rust emits `pake-tabs:snapshot` after state changes;
- the `+` button opens a new native `WebviewWindow` and then activates it through the bridge.

Tab labels are path-first: the visible text should prefer the current page's relative path, truncated with ellipsis when space is tight.
