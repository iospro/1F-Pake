(function () {
  const PANEL_ID = "pake-1forma-accounts-panel";
  const LIST_COMMAND = "list_accounts";
  const UPSERT_COMMAND = "upsert_account";
  const SET_ACTIVE_COMMAND = "set_active_account";
  const DELETE_COMMAND = "delete_account";

  let snapshot = { active_account_id: null, accounts: [] };
  let visible = false;
  let mode = "list";
  let deletePendingAccountId = null;

  function requestNative(action, params = {}) {
    const invoke = window.__TAURI__?.core?.invoke;
    if (!invoke) throw new Error("Tauri invoke bridge not ready");
    return invoke(action, params);
  }

  function getAccounts() {
    return Array.isArray(snapshot.accounts) ? snapshot.accounts : [];
  }

  function hasAccounts() {
    return getAccounts().length > 0;
  }

  function getActiveAccount() {
    const accounts = getAccounts();
    return (
      accounts.find((account) => account.active) ||
      accounts.find((account) => account.id === snapshot.active_account_id) ||
      accounts[0] ||
      null
    );
  }

  function normalizeHost(value) {
    const trimmed = String(value || "").trim();
    if (!trimmed) return "";
    if (/^https?:\/\//i.test(trimmed)) return trimmed.replace(/\/+$/, "");
    return `https://${trimmed.replace(/\/+$/, "")}`;
  }

  function isValidHost(value) {
    const raw = String(value || "").trim();
    if (!raw || /\s/.test(raw)) return false;
    try {
      const url = raw.startsWith("http://") || raw.startsWith("https://")
        ? new URL(raw)
        : new URL(`https://${raw}`);
      return Boolean(url.hostname) && url.hostname.includes(".") && !url.hostname.endsWith(".");
    } catch {
      return false;
    }
  }

  function getEmptyAccountStateHref() {
    const isWindowsLike = /Windows/i.test(navigator.userAgent) || /Android/i.test(navigator.userAgent);
    return isWindowsLike
      ? "https://tauri.localhost/empty-account.html"
      : "tauri://localhost/empty-account.html";
  }

  function updateSubmitState(form) {
    const titleInput = form.querySelector('input[name="account-title"]');
    const hostInput = form.querySelector('input[name="account-host"]');
    const submitButton = form.querySelector(".pake-accounts-submit");
    if (!submitButton) return;
    const enabled = String(titleInput?.value || "").trim().length > 0 && isValidHost(hostInput?.value);
    submitButton.disabled = !enabled;
  }

  function setMode(nextMode) {
    mode = nextMode === "add" ? "add" : "list";
    render();
  }

  function openPanel() {
    visible = true;
    mode = hasAccounts() ? "list" : "add";
    render();
    const panel = document.getElementById(PANEL_ID);
    if (panel) {
      panel.classList.add("is-visible");
    }
  }

  window.__PAKE_OPEN_ACCOUNT_MANAGER__ = openPanel;
  window.addEventListener("pake:open-account-manager", openPanel);

  function closePanel() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    panel.classList.remove("is-visible");
    visible = false;
    deletePendingAccountId = null;
    render();
  }

  async function loadAccounts() {
    try {
      snapshot = (await requestNative(LIST_COMMAND)) || snapshot;
      if (!hasAccounts()) {
        mode = "add";
        openPanel();
        return;
      }

      mode = "list";
      visible = false;
      render();
    } catch {
      // ignore until bridge is ready
    }
  }

  async function submitAccount(form) {
    const titleInput = form.querySelector('input[name="account-title"]');
    const hostInput = form.querySelector('input[name="account-host"]');
    const title = String(titleInput?.value || "").trim();
    const host = normalizeHost(hostInput?.value);
    if (!title || !isValidHost(host)) return;

    const submitButton = form.querySelector(".pake-accounts-submit");
    if (submitButton) submitButton.disabled = true;

    try {
      const payload = await requestNative(UPSERT_COMMAND, {
        params: { title, host },
      });
      if (payload?.id) {
        await activateAccount(payload.id);
        return;
      }
      snapshot = await requestNative(LIST_COMMAND).catch(() => snapshot);
      mode = "list";
      render();
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  }

  async function activateAccount(accountId) {
    const account = await requestNative(SET_ACTIVE_COMMAND, { params: { id: accountId } });
    snapshot = await requestNative(LIST_COMMAND).catch(() => snapshot);
    mode = "list";
    visible = false;
    render();
    const nextUrl = String(account?.base_url || account?.host || "").trim();
    if (nextUrl) {
      const target = nextUrl.startsWith("http://") || nextUrl.startsWith("https://")
        ? nextUrl
        : `https://${nextUrl}`;
      if (window.location.href !== target) {
        window.location.href = target;
      }
    }
  }

  async function deleteAccount(accountId) {
    deletePendingAccountId = accountId;
    render();
  }

  async function confirmDeleteAccount() {
    const accountId = deletePendingAccountId;
    if (!accountId) return;
    deletePendingAccountId = null;
    render();
    const wasActive = snapshot.active_account_id === accountId;
    try {
      await requestNative(DELETE_COMMAND, { params: { id: accountId } });
      snapshot = await requestNative(LIST_COMMAND).catch(() => snapshot);
      if (!hasAccounts()) {
        mode = "add";
        try {
          await requestNative("show_empty_account_state");
        } catch (error) {
          console.warn("show_empty_account_state failed, falling back to direct navigation", error);
          window.location.replace(getEmptyAccountStateHref());
        }
        return;
      }

      mode = "list";
      render();

      if (wasActive) {
        const nextAccount = getAccounts()[0] || null;
        if (nextAccount?.id) {
          await activateAccount(nextAccount.id);
        }
      }
    } catch (error) {
      console.error("delete_account failed", error);
    }
  }

  function renderList(panel, list) {
    const accounts = getAccounts();
    list.textContent = "";

    if (!accounts.length) {
      list.hidden = true;
      return;
    }

    list.hidden = false;

    for (const account of accounts) {
      const row = document.createElement("div");
      row.className = `pake-account-row${account.active ? " active" : ""}`;

      const meta = document.createElement("div");
      meta.className = "pake-account-meta";

      const title = document.createElement("div");
      title.className = "pake-account-title";
      title.textContent = account.title || account.host || account.base_url;

      const host = document.createElement("div");
      host.className = "pake-account-host";
      host.textContent = account.base_url || account.host || "";

      meta.appendChild(title);
      meta.appendChild(host);

      const actions = document.createElement("div");
      actions.className = "pake-account-actions";

      const useButton = document.createElement("button");
      useButton.type = "button";
      useButton.className = "pake-account-use";
      useButton.textContent = account.active ? "Активна" : "Выбрать";
      useButton.disabled = account.active;
      useButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        void activateAccount(account.id);
      });

      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "pake-account-delete";
      deleteButton.textContent = "Удалить";
      deleteButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        console.info("[Pake] delete_account click", { id: account.id, active: account.active });
        void deleteAccount(account.id);
      });

      actions.appendChild(useButton);
      actions.appendChild(deleteButton);
      row.appendChild(meta);
      row.appendChild(actions);
      list.appendChild(row);
    }
  }

  function renderAdd(panel) {
    const form = panel.querySelector(".pake-accounts-form");
    const list = panel.querySelector(".pake-accounts-list");
    const addToggle = panel.querySelector(".pake-accounts-add-toggle");

    const showAdd = mode === "add" || !hasAccounts();
    form.hidden = !showAdd && hasAccounts();
    list.hidden = showAdd;
    if (addToggle) addToggle.hidden = showAdd || !hasAccounts();

    if (form) updateSubmitState(form);
  }

  function render() {
    if (!document.body) return;

    let panel = document.getElementById(PANEL_ID);
    if (!panel) {
      panel = document.createElement("div");
      panel.id = PANEL_ID;
      panel.innerHTML = `
        <div class="pake-accounts-card" role="dialog" aria-modal="true" aria-label="Домены">
          <div class="pake-accounts-head">
            <h2>Домены</h2>
            <button type="button" class="pake-accounts-close">Закрыть</button>
          </div>
          <form class="pake-accounts-form">
            <div class="pake-accounts-form-head">
              <div class="pake-accounts-form-title">Добавить домен</div>
            </div>
            <input name="account-title" type="text" placeholder="Название учетной записи" autocomplete="off" />
            <input name="account-host" type="text" placeholder="domain.example.com или https://domain.example.com" autocomplete="off" />
            <button type="submit" class="pake-accounts-submit">Добавить</button>
          </form>
          <div class="pake-accounts-list"></div>
          <div class="pake-accounts-footer">
            <button type="button" class="pake-accounts-add-toggle">Добавить</button>
          </div>
          <div class="pake-delete-confirm" hidden>
            <div class="pake-delete-confirm-card" role="alertdialog" aria-modal="true" aria-label="Подтверждение удаления">
              <div class="pake-delete-confirm-title">Удалить домен?</div>
              <div class="pake-delete-confirm-actions">
                <button type="button" class="pake-delete-confirm-cancel">Отмена</button>
                <button type="button" class="pake-delete-confirm-ok">Удалить</button>
              </div>
            </div>
          </div>
        </div>
      `;

      panel.addEventListener("click", (event) => {
        if (event.target === panel) closePanel();
      });
      panel.querySelector(".pake-accounts-close")?.addEventListener("click", closePanel);
      panel.querySelector(".pake-accounts-add-toggle")?.addEventListener("click", () => setMode("add"));
      panel.querySelector(".pake-delete-confirm-cancel")?.addEventListener("click", () => {
        deletePendingAccountId = null;
        render();
      });
      panel.querySelector(".pake-delete-confirm-ok")?.addEventListener("click", async () => {
        await confirmDeleteAccount();
      });
      panel.querySelector(".pake-accounts-form")?.addEventListener("submit", async (event) => {
        event.preventDefault();
        console.info("[Pake] account-manager submit", {
          mode,
          visible,
          hasAccounts: hasAccounts(),
        });
        await submitAccount(event.currentTarget);
      });
      panel.querySelector(".pake-accounts-form")?.addEventListener("input", (event) => {
        const target = event.target;
        if (!target || target.tagName !== "INPUT") return;
        updateSubmitState(event.currentTarget);
      });

      document.body.appendChild(panel);
    }

    const list = panel.querySelector(".pake-accounts-list");
    if (!list) return;

    panel.classList.toggle("has-accounts", hasAccounts());
    panel.classList.toggle("show-add", mode === "add" || !hasAccounts());
    panel.classList.toggle("show-delete-confirm", Boolean(deletePendingAccountId));

    const deleteConfirm = panel.querySelector(".pake-delete-confirm");
    if (deleteConfirm) {
      deleteConfirm.hidden = !deletePendingAccountId;
    }

    renderList(panel, list);
    renderAdd(panel);

    panel.style.display = visible ? "flex" : "none";
  }

  function installButton() {
    const titlebar = document.getElementById("pake-1forma-titlebar");
    const actionsGroup = titlebar?.querySelector(".pake-actions");
    if (!actionsGroup || actionsGroup.querySelector(".pake-accounts-button")) return true;

    const historyGroup = actionsGroup.querySelector(".pake-history");
    const addButton = document.createElement("button");
    addButton.className = "pake-accounts-button";
    addButton.type = "button";
    addButton.title = "Домены";
    addButton.setAttribute("aria-label", "Домены");
    addButton.textContent = "☰";
    addButton.addEventListener("click", () => {
      if (visible) {
        closePanel();
      } else {
        openPanel();
      }
    });

    if (historyGroup) actionsGroup.insertBefore(addButton, historyGroup);
    else actionsGroup.appendChild(addButton);
    return true;
  }

  function installStyle() {
    if (document.getElementById("pake-1forma-accounts-style")) return;

    const style = document.createElement("style");
    style.id = "pake-1forma-accounts-style";
    style.textContent = `
      #${PANEL_ID} {
        position: fixed;
        inset: 0;
        display: none;
        align-items: center;
        justify-content: center;
        background: rgba(15, 23, 42, 0.64);
        backdrop-filter: blur(12px);
        z-index: 2147483648;
        pointer-events: auto;
      }

      #${PANEL_ID}.is-visible {
        display: flex;
      }

      #${PANEL_ID} .pake-accounts-card {
        width: min(720px, calc(100vw - 24px));
        max-height: min(84vh, 820px);
        overflow: auto;
        border-radius: 20px;
        background: #0f172a;
        color: #f8fafc;
        box-shadow: 0 30px 80px rgba(0, 0, 0, 0.42);
        padding: 20px;
      }

      #${PANEL_ID} .pake-accounts-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        margin-bottom: 16px;
      }

      #${PANEL_ID} .pake-accounts-head h2 {
        margin: 0;
        font-size: 22px;
      }

      #${PANEL_ID} .pake-accounts-close {
        border: 0;
        border-radius: 10px;
        padding: 8px 12px;
        background: rgba(255, 255, 255, 0.08);
        color: inherit;
        cursor: pointer;
      }

      #${PANEL_ID} .pake-accounts-form {
        display: none;
        grid-template-columns: 1fr 1fr auto;
        gap: 10px;
        margin-bottom: 18px;
      }

      #${PANEL_ID}.show-add .pake-accounts-form,
      #${PANEL_ID}:not(.has-accounts) .pake-accounts-form {
        display: grid;
      }

      #${PANEL_ID} .pake-accounts-form-head {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
        grid-column: 1 / -1;
      }

      #${PANEL_ID} .pake-accounts-form-title {
        font-size: 18px;
        font-weight: 600;
      }

      #${PANEL_ID} .pake-accounts-list {
        display: grid;
        gap: 10px;
      }

      #${PANEL_ID}.show-add .pake-accounts-list {
        display: none;
      }

      #${PANEL_ID} .pake-accounts-footer {
        display: flex;
        justify-content: flex-end;
        margin-top: 14px;
      }

      #${PANEL_ID} .pake-delete-confirm {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(15, 23, 42, 0.54);
        backdrop-filter: blur(6px);
        z-index: 3;
      }

      #${PANEL_ID} .pake-delete-confirm[hidden] {
        display: none !important;
      }

      #${PANEL_ID} .pake-delete-confirm-card {
        width: min(360px, calc(100vw - 40px));
        border-radius: 18px;
        background: #0f172a;
        color: #f8fafc;
        padding: 18px;
        box-shadow: 0 24px 60px rgba(0, 0, 0, 0.4);
      }

      #${PANEL_ID} .pake-delete-confirm-title {
        font-size: 18px;
        font-weight: 700;
        margin-bottom: 8px;
      }

      #${PANEL_ID} .pake-delete-confirm-text {
        font-size: 14px;
        opacity: 0.82;
        margin-bottom: 16px;
      }

      #${PANEL_ID} .pake-delete-confirm-actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
      }

      #${PANEL_ID} .pake-delete-confirm-actions button {
        border: 0;
        border-radius: 10px;
        padding: 8px 12px;
        cursor: pointer;
      }

      #${PANEL_ID} .pake-delete-confirm-cancel {
        background: rgba(255, 255, 255, 0.08);
        color: inherit;
      }

      #${PANEL_ID} .pake-delete-confirm-ok {
        background: rgba(248, 113, 113, 0.22);
        color: inherit;
      }

      #${PANEL_ID} .pake-accounts-add-toggle {
        border: 0;
        border-radius: 12px;
        padding: 10px 14px;
        background: rgba(74, 125, 255, 0.18);
        color: inherit;
        cursor: pointer;
      }

      #${PANEL_ID} .pake-account-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
        border-radius: 14px;
        padding: 14px;
        background: rgba(255, 255, 255, 0.06);
      }

      #${PANEL_ID} .pake-account-row.active {
        outline: 1px solid rgba(74, 125, 255, 0.7);
      }

      #${PANEL_ID} .pake-account-meta {
        display: grid;
        gap: 2px;
      }

      #${PANEL_ID} .pake-account-title {
        font-weight: 600;
      }

      #${PANEL_ID} .pake-account-host {
        font-size: 13px;
        opacity: 0.8;
      }

      #${PANEL_ID} .pake-account-actions {
        display: flex;
        gap: 8px;
        position: relative;
        z-index: 1;
      }

      #${PANEL_ID} .pake-account-actions button {
        border: 0;
        border-radius: 10px;
        padding: 8px 12px;
        cursor: pointer;
        position: relative;
        z-index: 2;
        pointer-events: auto;
      }

      #${PANEL_ID} .pake-account-use {
        background: rgba(74, 125, 255, 0.2);
        color: inherit;
      }

      #${PANEL_ID} .pake-account-delete {
        background: rgba(248, 113, 113, 0.18);
        color: inherit;
      }

      #${PANEL_ID} .pake-accounts-submit {
        border: 0;
        border-radius: 12px;
        background: #4a7dff;
        color: white;
        padding: 12px 16px;
        cursor: pointer;
      }

      #${PANEL_ID} .pake-accounts-submit:disabled {
        background: rgba(148, 163, 184, 0.36);
        color: rgba(255, 255, 255, 0.72);
        cursor: not-allowed;
      }

      #${PANEL_ID} input {
        border: 1px solid rgba(255, 255, 255, 0.14);
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.05);
        color: inherit;
        padding: 12px 14px;
        outline: none;
      }
    `;
    document.head.appendChild(style);
  }

  function bootstrap() {
    installStyle();
    installButton();
    loadAccounts();
  }

  function waitForBootstrap() {
    if (document.body) {
      installButton();
      bootstrap();
      return;
    }
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      if (document.body) {
        installButton();
        window.clearInterval(timer);
        bootstrap();
      } else if (attempts >= 80) {
        window.clearInterval(timer);
      }
    }, 100);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", waitForBootstrap, { once: true });
  } else {
    waitForBootstrap();
  }
})();
