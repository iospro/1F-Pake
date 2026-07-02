(function () {
  const ACCOUNTS_PANEL_ID = "pake-1forma-accounts-panel";
  let accountsSnapshot = { active_account_id: null, accounts: [] };
  let accountsPanelVisible = false;
  let accountsFormVisible = true;
  let debugStep = "boot";
  let debugDetail = "";
  let bridgeListenerReady = false;
  let bridgeRequestCounter = 0;
  const pendingBridgeRequests = new Map();

  function normalizeEventPayload(payload) {
    if (typeof payload === "string") {
      try {
        return JSON.parse(payload);
      } catch {
        return null;
      }
    }
    return payload && typeof payload === "object" ? payload : null;
  }

  function setDebugStep(step, detail = "") {
    debugStep = step;
    debugDetail = detail;
    const panel = document.getElementById(ACCOUNTS_PANEL_ID);
    if (!panel) return;
    const debugNode = panel.querySelector(".pake-accounts-debug");
    if (debugNode) {
      debugNode.textContent = detail ? `${step}: ${detail}` : step;
    }
    console.info("[Pake][AccountManager]", step, detail);
  }

  function emitNative(name, payload) {
    const emit = window.__TAURI__?.event?.emit;
    if (!emit) return Promise.reject(new Error("Tauri event bridge not ready"));
    return emit(name, payload);
  }

  async function ensureBridgeListener() {
    if (bridgeListenerReady) return true;
    const listen = window.__TAURI__?.event?.listen;
    if (!listen) return false;

    bridgeListenerReady = true;
    await listen("ru.1forma.accounts:response", (event) => {
      const payload = normalizeEventPayload(event.payload);
      if (!payload) return;
      const pending = pendingBridgeRequests.get(payload.request_id);
      if (!pending) return;

      pendingBridgeRequests.delete(payload.request_id);
      if (payload.ok) {
        pending.resolve(payload.data);
      } else {
        pending.reject(new Error(payload.error || "Account bridge error"));
      }
    });
    await listen("ru.1forma.accounts.snapshot", (event) => {
      const payload = normalizeEventPayload(event.payload);
      if (!payload) return;
      accountsSnapshot = payload;
      accountsFormVisible = !hasAccounts();
      setDebugStep("snapshot", `${getAccountsList().length} accounts`);
      renderAccountsPanel();
    });
    return true;
  }

  async function requestNative(action, params = {}) {
    const ready = await ensureBridgeListener();
    if (!ready) {
      throw new Error("Tauri event bridge not ready");
    }

    bridgeRequestCounter += 1;
    const request_id = `${Date.now()}-${bridgeRequestCounter}`;
    const request = { request_id, action, params };

    const response = new Promise((resolve, reject) => {
      pendingBridgeRequests.set(request_id, { resolve, reject });
      window.setTimeout(() => {
        if (pendingBridgeRequests.has(request_id)) {
          pendingBridgeRequests.delete(request_id);
          reject(new Error(`Account bridge timeout: ${action}`));
        }
      }, 8000);
    });

    await emitNative("ru.1forma.accounts:request", request);
    return response;
  }

  function getAccountsList() {
    return Array.isArray(accountsSnapshot.accounts) ? accountsSnapshot.accounts : [];
  }

  function hasAccounts() {
    return getAccountsList().length > 0;
  }

  function normalizeHostInput(value) {
    const trimmed = String(value || "").trim();
    if (!trimmed) return "";
    if (/^https?:\/\//i.test(trimmed)) return trimmed.replace(/\/+$/, "");
    return `https://${trimmed.replace(/\/+$/, "")}`;
  }

  function deriveAccountTitle(host) {
    const normalized = String(host || "").replace(/^https?:\/\//i, "").replace(/\/+$/, "");
    return normalized || "Новая учетка";
  }

  function isValidAccountHostInput(value) {
    const raw = String(value || "").trim();
    if (!raw) return false;
    if (/\s/.test(raw)) return false;
    try {
      const url = raw.startsWith("http://") || raw.startsWith("https://") ? new URL(raw) : new URL(`https://${raw}`);
      return Boolean(url.hostname) && url.hostname.includes(".") && !url.hostname.endsWith(".");
    } catch {
      return false;
    }
  }

  function updateAddButtonState(form) {
    const titleInput = form.querySelector('input[name="account-title"]');
    const hostInput = form.querySelector('input[name="account-host"]');
    const submitButton = form.querySelector(".pake-accounts-submit");
    if (!submitButton) return;

    const hasTitle = String(titleInput?.value || "").trim().length > 0;
    const hostIsValid = isValidAccountHostInput(hostInput?.value);
    const enabled = hasTitle && hostIsValid;

    submitButton.disabled = !enabled;
    form.dataset.addEnabled = enabled ? "true" : "false";
  }

  function closeAccountsPanel() {
    const panel = document.getElementById(ACCOUNTS_PANEL_ID);
    if (!panel) return;
    panel.classList.remove("is-visible");
    accountsPanelVisible = false;
    setDebugStep("panel-close");
  }

  function revealAccountsForm() {
    const panel = document.getElementById(ACCOUNTS_PANEL_ID);
    const form = panel?.querySelector(".pake-accounts-form");
    const titleInput = form?.querySelector('input[name="account-title"]');
    setDebugStep("form-reveal", form ? "scrolling form into view" : "form missing");
    if (form?.scrollIntoView) {
      form.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    if (titleInput?.focus) {
      window.requestAnimationFrame(() => titleInput.focus());
    }
  }

  function openAccountsPanel() {
    const panel = document.getElementById(ACCOUNTS_PANEL_ID);
    if (!panel) return;
    panel.classList.add("is-visible");
    accountsPanelVisible = true;
    accountsFormVisible = !hasAccounts();
    setDebugStep("panel-open", hasAccounts() ? "accounts exist" : "no accounts yet");
    renderAccountsPanel();
  }

  async function loadAccountsSnapshot() {
    try {
      setDebugStep("load-start");
      const payload = await requestNative("list_accounts");
      accountsSnapshot = payload || accountsSnapshot;
      accountsFormVisible = !hasAccounts();
      setDebugStep("load-ok", `${getAccountsList().length} accounts`);
      renderAccountsPanel();
      if (!hasAccounts()) openAccountsPanel();
    } catch {
      // ignore until native bridge is ready
      setDebugStep("load-failed", "native bridge not ready");
    }
  }

  function signalNativeReady() {
    const emit = window.__TAURI__?.event?.emit;
    if (!emit) return;
    emit("ru.1forma.accounts:ready", {
      source: "account-manager-routes",
      ready_at: Date.now(),
    }).catch((error) => {
      console.warn("[Pake][AccountManager] ready signal failed", error);
    });
  }

  async function saveAccountFromForm(form) {
    const titleInput = form.querySelector('input[name="account-title"]');
    const hostInput = form.querySelector('input[name="account-host"]');
    const title = String(titleInput?.value || "").trim() || deriveAccountTitle(hostInput?.value);
    const host = normalizeHostInput(hostInput?.value);
    if (!title || !isValidAccountHostInput(host)) {
      setDebugStep("submit-invalid", `title="${title}" host="${String(hostInput?.value || "").trim()}"`);
      return;
    }

    const submitButton = form.querySelector(".pake-accounts-submit");
    if (submitButton) submitButton.disabled = true;
    setDebugStep("submit-valid", `${title} -> ${host}`);

    try {
      setDebugStep("invoke-upsert", JSON.stringify({ title, host }));
      const payload = await requestNative("upsert_account", { title, host });
      if (payload) {
        setDebugStep("upsert-ok", payload.id || "no-id");
        await requestNative("set_active_account", { id: payload.id }).catch(() => {});
        setDebugStep("active-set", payload.id || "no-id");
        accountsSnapshot = await requestNative("list_accounts").catch(() => accountsSnapshot);
        accountsFormVisible = false;
        setDebugStep("refresh-list", `${getAccountsList().length} accounts`);
        renderAccountsPanel();

        const nextTitleInput = form.querySelector('input[name="account-title"]');
        const nextHostInput = form.querySelector('input[name="account-host"]');
        if (nextTitleInput) nextTitleInput.value = "";
        if (nextHostInput) nextHostInput.value = "";

        const panel = document.getElementById(ACCOUNTS_PANEL_ID);
        const list = panel?.querySelector(".pake-accounts-list");
        if (list) {
          list.scrollTop = list.scrollHeight;
        }
        setDebugStep("save-done", payload.id || "no-id");
      }
    } catch (error) {
      console.error("[Pake] Failed to save account", error);
      setDebugStep("submit-error", error?.message || String(error));
      throw error;
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  }

  async function activateAccount(accountId) {
    try {
      setDebugStep("activate-start", String(accountId));
      await requestNative("set_active_account", { id: accountId });
      accountsSnapshot = await requestNative("list_accounts");
      setDebugStep("activate-refresh", `${getAccountsList().length} accounts`);
      renderAccountsPanel();
      closeAccountsPanel();
      const account = getAccountsList().find((item) => item.id === accountId);
      if (account?.base_url) {
        setDebugStep("navigate", account.base_url);
        window.location.href = account.base_url;
      }
    } catch {
      // ignore until native bridge is ready
      setDebugStep("activate-failed", String(accountId));
    }
  }

  function renderAccountsPanel() {
    if (!document.body) return;
    let panel = document.getElementById(ACCOUNTS_PANEL_ID);
    if (!panel) {
      panel = document.createElement("div");
      panel.id = ACCOUNTS_PANEL_ID;
      panel.innerHTML = `
        <div class="pake-accounts-card" role="dialog" aria-modal="true" aria-label="Учетки">
          <div class="pake-accounts-head">
            <h2>Учетки</h2>
            <button type="button" class="pake-accounts-close">Закрыть</button>
          </div>
          <div class="pake-accounts-debug">boot</div>
          <form class="pake-accounts-form">
            <input name="account-title" type="text" placeholder="Название учетной записи" autocomplete="off" />
            <input name="account-host" type="text" placeholder="domain.example.com или https://domain.example.com" autocomplete="off" />
            <button type="submit" class="pake-accounts-submit">Добавить</button>
          </form>
          <div class="pake-accounts-list"></div>
          <div class="pake-accounts-footer">
            <button type="button" class="pake-accounts-add-toggle">Добавить</button>
          </div>
        </div>
      `;
      panel.addEventListener("click", (event) => {
        if (event.target === panel) closeAccountsPanel();
      });
      panel.querySelector(".pake-accounts-close")?.addEventListener("click", closeAccountsPanel);
      panel.querySelector(".pake-accounts-add-toggle")?.addEventListener("click", () => {
        setDebugStep("footer-click", "showing form");
        accountsFormVisible = true;
        renderAccountsPanel();
        revealAccountsForm();
      });
      panel.querySelector(".pake-accounts-form")?.addEventListener("submit", async (event) => {
        event.preventDefault();
        setDebugStep("form-submit", "submit event received");
        await saveAccountFromForm(event.currentTarget);
      });
      panel.querySelector(".pake-accounts-form")?.addEventListener("input", (event) => {
        const target = event.target;
        if (!target || target.tagName !== "INPUT") return;
        setDebugStep("form-input", `${target.name || "input"} changed`);
        updateAddButtonState(event.currentTarget);
      });
      panel.querySelector(".pake-accounts-form")?.addEventListener("change", (event) => {
        const target = event.target;
        if (!target || target.tagName !== "INPUT") return;
        setDebugStep("form-change", `${target.name || "input"} changed`);
        updateAddButtonState(event.currentTarget);
      });
      document.body.appendChild(panel);
    }

    const list = panel.querySelector(".pake-accounts-list");
    if (!list) return;
    list.textContent = "";

    const accounts = getAccountsList();
    panel.classList.toggle("has-accounts", accounts.length > 0);
    panel.classList.toggle("show-form", accountsFormVisible || !accounts.length);
    setDebugStep("render", `${accounts.length} accounts; form=${accountsFormVisible || !accounts.length ? "on" : "off"}`);
    if (!accounts.length) {
      list.textContent = "Сначала добавь домен, потом откроется обычный вход через веб.";
      const form = panel.querySelector(".pake-accounts-form");
      if (form) {
        updateAddButtonState(form);
      }
      return;
    }

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

      const state = document.createElement("div");
      state.className = "pake-account-state";
      state.textContent = account.credential_state || "new";

      meta.appendChild(title);
      meta.appendChild(host);
      meta.appendChild(state);

      const actions = document.createElement("div");
      actions.className = "pake-account-actions";

      const useButton = document.createElement("button");
      useButton.type = "button";
      useButton.className = "pake-account-use";
      useButton.textContent = account.active ? "Активна" : "Выбрать";
      useButton.disabled = account.active;
      useButton.addEventListener("click", async () => {
        await activateAccount(account.id);
      });

      actions.appendChild(useButton);
      row.appendChild(meta);
      row.appendChild(actions);
      list.appendChild(row);
    }

    const form = panel.querySelector(".pake-accounts-form");
    if (form) {
      updateAddButtonState(form);
    }
  }

  function installAccountButton() {
    const titlebar = document.getElementById("pake-1forma-titlebar");
    const actionsGroup = titlebar?.querySelector(".pake-actions");
    if (!actionsGroup || actionsGroup.querySelector(".pake-accounts-button")) return true;

    const historyGroup = actionsGroup.querySelector(".pake-history");
    const addButton = document.createElement("button");
    addButton.className = "pake-accounts-button";
    addButton.type = "button";
    addButton.title = "Учетки";
    addButton.setAttribute("aria-label", "Учетки");
    addButton.textContent = "☰";
    addButton.addEventListener("click", () => {
      if (accountsPanelVisible) {
        closeAccountsPanel();
      } else {
        openAccountsPanel();
      }
    });

    if (historyGroup) {
      actionsGroup.insertBefore(addButton, historyGroup);
    } else {
      actionsGroup.appendChild(addButton);
    }
    return true;
  }

  function installStyle() {
    if (document.getElementById("pake-1forma-accounts-style")) return;

    const style = document.createElement("style");
    style.id = "pake-1forma-accounts-style";
    style.textContent = `
      #${ACCOUNTS_PANEL_ID} {
        position: fixed;
        inset: 0;
        display: none;
        align-items: center;
        justify-content: center;
        background: rgba(15, 23, 42, 0.64);
        backdrop-filter: blur(12px);
        z-index: 2147483646;
      }

      #${ACCOUNTS_PANEL_ID}.is-visible {
        display: flex;
      }

      #${ACCOUNTS_PANEL_ID} .pake-accounts-card {
        width: min(720px, calc(100vw - 24px));
        max-height: min(84vh, 820px);
        overflow: auto;
        border-radius: 20px;
        background: #0f172a;
        color: #f8fafc;
        box-shadow: 0 30px 80px rgba(0, 0, 0, 0.42);
        padding: 20px;
      }

      #${ACCOUNTS_PANEL_ID} .pake-accounts-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        margin-bottom: 16px;
      }

      #${ACCOUNTS_PANEL_ID} .pake-accounts-head h2 {
        margin: 0;
        font-size: 22px;
      }

      #${ACCOUNTS_PANEL_ID} .pake-accounts-close {
        border: 0;
        border-radius: 10px;
        padding: 8px 12px;
        background: rgba(255, 255, 255, 0.08);
        color: inherit;
        cursor: pointer;
      }

      #${ACCOUNTS_PANEL_ID} .pake-accounts-debug {
        margin: -4px 0 14px;
        padding: 10px 12px;
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.06);
        color: rgba(248, 250, 252, 0.88);
        font-size: 12px;
        line-height: 1.35;
        white-space: pre-wrap;
      }

      #${ACCOUNTS_PANEL_ID} form {
        display: grid;
        grid-template-columns: 1fr 1fr auto;
        gap: 10px;
        margin-bottom: 18px;
      }

      #${ACCOUNTS_PANEL_ID} input {
        border: 1px solid rgba(255, 255, 255, 0.14);
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.05);
        color: inherit;
        padding: 12px 14px;
        outline: none;
      }

      #${ACCOUNTS_PANEL_ID} .pake-accounts-submit {
        border: 0;
        border-radius: 12px;
        background: #4a7dff;
        color: white;
        padding: 12px 16px;
        cursor: pointer;
      }

      #${ACCOUNTS_PANEL_ID} .pake-accounts-submit:disabled {
        background: rgba(148, 163, 184, 0.36);
        color: rgba(255, 255, 255, 0.72);
        cursor: not-allowed;
        box-shadow: none;
        transform: none;
      }

      #${ACCOUNTS_PANEL_ID}.has-accounts .pake-accounts-form {
        display: none;
      }

      #${ACCOUNTS_PANEL_ID}.show-form .pake-accounts-form {
        display: grid;
      }

      #${ACCOUNTS_PANEL_ID} .pake-accounts-list {
        display: grid;
        gap: 10px;
      }

      #${ACCOUNTS_PANEL_ID}:not(.has-accounts) .pake-accounts-list {
        display: none;
      }

      #${ACCOUNTS_PANEL_ID} .pake-accounts-footer {
        display: flex;
        justify-content: flex-end;
        margin-top: 14px;
      }

      #${ACCOUNTS_PANEL_ID} .pake-accounts-add-toggle {
        border: 0;
        border-radius: 12px;
        padding: 10px 14px;
        background: rgba(74, 125, 255, 0.18);
        color: inherit;
        cursor: pointer;
      }

      #${ACCOUNTS_PANEL_ID}:not(.has-accounts) .pake-accounts-footer {
        display: none;
      }

      #${ACCOUNTS_PANEL_ID} .pake-account-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
        border-radius: 14px;
        padding: 14px;
        background: rgba(255, 255, 255, 0.06);
      }

      #${ACCOUNTS_PANEL_ID} .pake-account-row.active {
        outline: 1px solid rgba(74, 125, 255, 0.7);
      }

      #${ACCOUNTS_PANEL_ID} .pake-account-meta {
        display: grid;
        gap: 2px;
      }

      #${ACCOUNTS_PANEL_ID} .pake-account-title {
        font-weight: 600;
      }

      #${ACCOUNTS_PANEL_ID} .pake-account-host {
        font-size: 13px;
        opacity: 0.8;
      }

      #${ACCOUNTS_PANEL_ID} .pake-account-state {
        font-size: 12px;
        opacity: 0.75;
      }

      #${ACCOUNTS_PANEL_ID} .pake-account-actions {
        display: flex;
        gap: 8px;
      }

      #${ACCOUNTS_PANEL_ID} .pake-account-actions button {
        border: 0;
        border-radius: 10px;
        padding: 8px 12px;
        cursor: pointer;
      }

      #${ACCOUNTS_PANEL_ID} .pake-account-use {
        background: rgba(74, 125, 255, 0.2);
        color: inherit;
      }
    `;
    document.head.appendChild(style);
  }

  function bootstrapAccounts() {
    installStyle();
    installAccountButton();
    renderAccountsPanel();
    loadAccountsSnapshot();
    signalNativeReady();
    setDebugStep("bootstrap");
  }

  function waitForBootstrap() {
    if (document.body && installAccountButton()) {
      bootstrapAccounts();
      return;
    }
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      if (document.body && installAccountButton()) {
        window.clearInterval(timer);
        bootstrapAccounts();
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
