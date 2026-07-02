(function () {
  const TITLEBAR_ID = "pake-1forma-titlebar";
  const TITLEBAR_STYLE_ID = "pake-1forma-titlebar-style";
  const TITLEBAR_HEIGHT = 44;
  const HISTORY_INDEX_KEY = "pake_history_index";
  const HISTORY_MAX_KEY = "pake_history_max";
  const PENDING_PUSH_KEY = "pake_history_pending_push";
  const TICKERS_URL_PATTERNS = ["/tickers/all", "/tickers/system"];
  function toAbsoluteUrl(url) {
    try {
      return new URL(url, window.location.href);
    } catch {
      return null;
    }
  }

  function isMacOverlayTitlebarEnabled() {
    const isMac = /Mac/i.test(navigator.userAgent);
    const hideTitleBar =
      window.pakeConfig?.hide_title_bar || window.pakeConfig?.hideTitleBar;
    return Boolean(isMac && hideTitleBar);
  }

  function getRetinaDisplaySize() {
    const scale = Math.max(1, Math.round(window.devicePixelRatio || 1));
    return {
      scale,
      width: Math.round((screen.width || window.innerWidth || 0) * scale),
      height: Math.round((screen.height || window.innerHeight || 0) * scale),
    };
  }

  function withIdealConstraint(value, ideal) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value >= ideal ? value : { ideal, max: ideal };
    }
    if (value && typeof value === "object") {
      const currentIdeal = Number(value.ideal) || 0;
      const currentMax = Number(value.max) || 0;
      return {
        ...value,
        ideal: Math.max(currentIdeal, ideal),
        max: Math.max(currentMax, ideal),
      };
    }
    return { ideal, max: ideal };
  }

  function withRetinaResizeMode(value) {
    if (value === undefined) return "none";
    return value;
  }

  function withRetinaDisplayConstraints(constraints) {
    const nextConstraints =
      constraints && typeof constraints === "object" ? { ...constraints } : {};
    const requestedVideo = nextConstraints.video;
    if (requestedVideo === false) return constraints;

    const currentVideo =
      requestedVideo && typeof requestedVideo === "object" ? requestedVideo : {};
    const retina = getRetinaDisplaySize();
    if (!retina.width || !retina.height || retina.scale <= 1) {
      nextConstraints.video = requestedVideo === undefined ? true : requestedVideo;
      return nextConstraints;
    }

    nextConstraints.video = {
      ...currentVideo,
      width: withIdealConstraint(currentVideo.width, retina.width),
      height: withIdealConstraint(currentVideo.height, retina.height),
      resizeMode: withRetinaResizeMode(currentVideo.resizeMode),
    };
    return nextConstraints;
  }

  function invokeNative(name, payload) {
    const invoke = window.__TAURI__?.core?.invoke;
    if (!invoke) return Promise.reject(new Error("Tauri bridge not ready"));
    return invoke(name, payload);
  }

  function installRetinaDisplayMediaPatch() {
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices?.getDisplayMedia || mediaDevices.__pakeRetinaDisplayMediaPatched) {
      return Boolean(mediaDevices?.__pakeRetinaDisplayMediaPatched);
    }

    const originalGetDisplayMedia = mediaDevices.getDisplayMedia.bind(mediaDevices);
    const patchedGetDisplayMedia = async function (constraints) {
      const nextConstraints = withRetinaDisplayConstraints(constraints);
      const stream = await originalGetDisplayMedia(nextConstraints);
      const track = stream.getVideoTracks()[0];
      const settings = track?.getSettings?.();
      const retina = getRetinaDisplaySize();
      console.info("[Pake] getDisplayMedia Retina request", {
        requested: nextConstraints,
        actual: settings,
        devicePixelRatio: window.devicePixelRatio,
        expectedRetina: retina,
      });
      return stream;
    };
    try {
      Object.defineProperty(mediaDevices, "getDisplayMedia", {
        configurable: true,
        writable: true,
        value: patchedGetDisplayMedia,
      });
    } catch {
      mediaDevices.getDisplayMedia = patchedGetDisplayMedia;
    }
    Object.defineProperty(mediaDevices, "__pakeRetinaDisplayMediaPatched", {
      configurable: true,
      value: true,
    });
    window.__PAKE_RETINA_DISPLAY_MEDIA__ = true;
    console.info("[Pake] Retina getDisplayMedia patch installed", {
      devicePixelRatio: window.devicePixelRatio,
      expectedRetina: getRetinaDisplaySize(),
    });
    return true;
  }

  function patchRetinaDisplayMedia() {
    if (installRetinaDisplayMediaPatch()) return;

    let attempts = 0;
    const retry = window.setInterval(() => {
      attempts += 1;
      if (installRetinaDisplayMediaPatch() || attempts >= 40) {
        window.clearInterval(retry);
      }
    }, 250);
  }

  function applyDockBadgeCount(count) {
    if (typeof navigator.setAppBadge === "function") {
      navigator.setAppBadge(count).catch(() => {});
      return;
    }

    const invoke = window.__TAURI__?.core?.invoke;
    if (!invoke) return;
    invoke("set_dock_badge", { count }).catch(() => {});
  }

  function clearDockBadge() {
    if (typeof navigator.clearAppBadge === "function") {
      navigator.clearAppBadge().catch(() => {});
      return;
    }

    const invoke = window.__TAURI__?.core?.invoke;
    if (!invoke) return;
    invoke("clear_dock_badge").catch(() => {});
  }

  // Badge flow: read unread count from 1Forma tickers and pass it to Pake's
  // built-in Web Badging bridge.
  function extractUnreadCountFromTitle(title) {
    const normalizedTitle = String(title || "").trim();
    if (!normalizedTitle) return null;

    const patterns = [
      /^\((\d{1,5})\)/,
      /^\[(\d{1,5})\]/,
      /(?:^|\s)\((\d{1,5})\)(?:\s|$)/,
      /(?:^|\s)\[(\d{1,5})\](?:\s|$)/,
    ];

    for (const pattern of patterns) {
      const match = normalizedTitle.match(pattern);
      if (!match) continue;
      const value = Number(match[1]);
      if (Number.isFinite(value) && value > 0) {
        return value;
      }
    }

    return null;
  }

  function syncDockBadgeFromTitle() {
    const unreadCount = extractUnreadCountFromTitle(document.title);
    if (unreadCount === null) return;
    applyDockBadgeCount(unreadCount);
  }

  function syncDockBadgeCount(unreadCount) {
    if (unreadCount > 0) {
      applyDockBadgeCount(unreadCount);
    } else {
      clearDockBadge();
    }
  }

  function observeTitleBadge() {
    syncDockBadgeFromTitle();

    const titleElement = document.querySelector("title");
    if (!titleElement) return;

    const observer = new MutationObserver(syncDockBadgeFromTitle);
    observer.observe(titleElement, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    window.addEventListener("focus", syncDockBadgeFromTitle);
    document.addEventListener("visibilitychange", syncDockBadgeFromTitle);
  }

  function isTickersUrl(url) {
    const absolute = toAbsoluteUrl(url);
    if (!absolute) return false;
    const haystack = `${absolute.pathname}${absolute.search}`.toLowerCase();
    return TICKERS_URL_PATTERNS.some(pattern => haystack.includes(pattern));
  }

  function findFirstFiniteNumber(candidates) {
    for (const candidate of candidates) {
      const value = Number(candidate);
      if (Number.isFinite(value) && value >= 0) {
        return value;
      }
    }
    return null;
  }

  function extractUnreadCountFromTickersPayload(payload) {
    if (!payload || typeof payload !== "object") return null;

    const data = payload.data && typeof payload.data === "object" ? payload.data : payload;
    const systemTickers =
      data.systemTickers && typeof data.systemTickers === "object" ? data.systemTickers : null;

    return findFirstFiniteNumber([
      systemTickers?.UnreadCommentsCount,
      systemTickers?.unreadCommentsCount,
      data.UnreadCommentsCount,
      data.unreadCommentsCount,
      data.badge,
      payload.UnreadCommentsCount,
      payload.unreadCommentsCount,
      payload.badge,
    ]);
  }

  function syncDockBadgeFromPayload(payload) {
    const unreadCount = extractUnreadCountFromTickersPayload(payload);
    if (unreadCount === null) return false;
    syncDockBadgeCount(unreadCount);
    return true;
  }

  function trySyncDockBadgeFromText(text) {
    if (!text) return false;
    try {
      const payload = JSON.parse(text);
      return syncDockBadgeFromPayload(payload);
    } catch {
      return false;
    }
  }

  function observeTickersRequests() {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async function (...args) {
      const response = await originalFetch(...args);
      const requestUrl = typeof args[0] === "string" ? args[0] : args[0]?.url;

      if (response && isTickersUrl(requestUrl)) {
        response
          .clone()
          .text()
          .then(trySyncDockBadgeFromText)
          .catch(() => {});
      }

      return response;
    };

    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url) {
      this.__pakeTickersUrl = typeof url === "string" ? url : String(url || "");
      return originalOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function () {
      this.addEventListener("load", function () {
        if (!isTickersUrl(this.__pakeTickersUrl)) return;
        trySyncDockBadgeFromText(this.responseText);
      });
      return originalSend.apply(this, arguments);
    };
  }

  function isInternal1FormaUrl(url) {
    const absolute = toAbsoluteUrl(url);
    if (!absolute) return false;
    const host = absolute.hostname.toLowerCase();
    return host === "ru.1forma.ru" || host.endsWith(".1forma.ru");
  }

  function normalizeText(value) {
    return (value || "").toLowerCase().replace(/\s+/g, " ").trim();
  }

  function isVksLabel(text) {
    const normalized = normalizeText(text);
    return (
      normalized.includes("вкс") ||
      normalized.includes("видеоконф") ||
      normalized.includes("видеосвяз") ||
      normalized.includes("видео-конф") ||
      normalized.includes("video")
    );
  }

  function isVksUrl(url) {
    const absolute = toAbsoluteUrl(url);
    if (!absolute) return false;
    const haystack = `${absolute.href} ${absolute.hostname} ${absolute.pathname}`.toLowerCase();
    return (
      haystack.includes("vks") ||
      haystack.includes("jitsi") ||
      haystack.includes("conference") ||
      haystack.includes("videocall") ||
      haystack.includes("video-call") ||
      haystack.includes("webinar") ||
      haystack.includes("meet")
    );
  }

  function getStoredNumber(key, fallback) {
    const raw = window.sessionStorage.getItem(key);
    if (raw === null) return fallback;
    const value = Number(raw);
    return Number.isFinite(value) ? value : fallback;
  }

  function setStoredNumber(key, value) {
    window.sessionStorage.setItem(key, String(value));
  }

  function normalizeTabTitle(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function getCurrentPageTitle() {
    const metaTitle = document.querySelector(
      'meta[property="og:title"], meta[name="twitter:title"], meta[name="title"]',
    )?.getAttribute("content");
    return normalizeTabTitle(metaTitle || document.title || "");
  }

  function getTabDisplayTitle(tab) {
    return normalizeTabTitle(tab?.title || "");
  }

  function getCurrentHistoryIndex() {
    if (history.state && typeof history.state.__pakeNavIndex === "number") {
      return history.state.__pakeNavIndex;
    }
    return getStoredNumber(HISTORY_INDEX_KEY, 0);
  }

  function getMaxHistoryIndex() {
    const currentIndex = getCurrentHistoryIndex();
    return getStoredNumber(HISTORY_MAX_KEY, currentIndex);
  }

  function replaceStateWithIndex(index) {
    const currentState =
      history.state && typeof history.state === "object" ? history.state : {};
    history.replaceState(
      { ...currentState, __pakeNavIndex: index },
      document.title,
      window.location.href,
    );
    setStoredNumber(HISTORY_INDEX_KEY, index);
    setStoredNumber(HISTORY_MAX_KEY, Math.max(index, getMaxHistoryIndex()));
  }

  function registerPushNavigation() {
    const nextIndex = getMaxHistoryIndex() + 1;
    window.sessionStorage.setItem(PENDING_PUSH_KEY, "1");
    setStoredNumber(HISTORY_INDEX_KEY, nextIndex);
    setStoredNumber(HISTORY_MAX_KEY, nextIndex);
  }

  function ensureHistoryState() {
    const pendingPush = window.sessionStorage.getItem(PENDING_PUSH_KEY) === "1";
    if (pendingPush) {
      window.sessionStorage.removeItem(PENDING_PUSH_KEY);
      replaceStateWithIndex(getStoredNumber(HISTORY_INDEX_KEY, 0));
      return;
    }

    if (history.state && typeof history.state.__pakeNavIndex === "number") {
      const currentIndex = history.state.__pakeNavIndex;
      setStoredNumber(HISTORY_INDEX_KEY, currentIndex);
      setStoredNumber(HISTORY_MAX_KEY, Math.max(currentIndex, getMaxHistoryIndex()));
      return;
    }

    replaceStateWithIndex(getStoredNumber(HISTORY_INDEX_KEY, 0));
  }

  function ensureTitlebarStyles() {
    if (document.getElementById(TITLEBAR_STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = TITLEBAR_STYLE_ID;
    style.textContent = `
      html {
        scroll-padding-top: ${TITLEBAR_HEIGHT}px;
      }

      body {
        padding-top: ${TITLEBAR_HEIGHT}px !important;
        box-sizing: border-box;
      }

      #${TITLEBAR_ID} {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        height: ${TITLEBAR_HEIGHT}px;
        z-index: 2147483647;
        display: grid;
        grid-template-columns: minmax(0, auto) minmax(0, 1fr) auto;
        align-items: center;
        column-gap: 10px;
        padding: 6px 12px 6px 110px;
        box-sizing: border-box;
        background: rgba(244, 246, 250, 0.92);
        backdrop-filter: blur(18px) saturate(1.15);
        -webkit-backdrop-filter: blur(18px) saturate(1.15);
        border-bottom: 1px solid rgba(15, 23, 42, 0.07);
        -webkit-app-region: drag;
        user-select: none;
        -webkit-user-select: none;
      }

      #${TITLEBAR_ID} .pake-title-group,
      #${TITLEBAR_ID} .pake-tabs,
      #${TITLEBAR_ID} .pake-actions,
      #${TITLEBAR_ID} .pake-history-group {
        display: flex;
        align-items: center;
        min-width: 0;
        -webkit-app-region: no-drag;
      }

      #${TITLEBAR_ID} .pake-title-group {
        grid-column: 2;
        justify-self: center;
        flex: 0 1 auto;
        max-width: 100%;
        justify-content: center;
      }

      #${TITLEBAR_ID} .pake-tabs {
        grid-column: 2;
        justify-self: stretch;
        width: 100%;
        flex: 1 1 auto;
        gap: 0;
        overflow: hidden;
        justify-content: stretch;
        align-items: stretch;
        min-width: 0;
      }

      #${TITLEBAR_ID} .pake-actions {
        grid-column: 3;
        justify-self: end;
        flex: 0 0 auto;
        flex-shrink: 0;
        gap: 8px;
        margin-left: 0;
        padding-left: 8px;
      }

      #${TITLEBAR_ID} button {
        appearance: none;
        border: 1px solid rgba(15, 23, 42, 0.10);
        background: rgba(255, 255, 255, 0.78);
        color: #0f172a;
        border-radius: 10px;
        min-width: 36px;
        height: 28px;
        padding: 0 10px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        font: 600 13px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06);
        transition: background 120ms ease, transform 120ms ease, opacity 120ms ease;
      }

      #${TITLEBAR_ID} button:hover:not(:disabled) {
        background: #ffffff;
        transform: translateY(-1px);
      }

      #${TITLEBAR_ID} button:disabled {
        opacity: 0.45;
        cursor: default;
        transform: none;
      }

      #${TITLEBAR_ID} .pake-tab {
        position: relative;
        flex: 1 1 0;
        width: auto;
        min-width: 0;
        max-width: none;
        margin-top: 0;
        margin-left: -1px;
        overflow: visible;
      }

      #${TITLEBAR_ID} .pake-tab:first-child {
        margin-left: 0;
      }

      #${TITLEBAR_ID} .pake-tab-main {
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 5px;
        padding: 0 12px 0 24px;
        height: 29px;
        border-radius: 999px;
        border: 1px solid rgba(148, 163, 184, 0.18);
        border-bottom-color: rgba(148, 163, 184, 0.28);
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(245, 247, 250, 0.95));
        color: #111827;
        overflow: hidden;
        box-shadow:
          0 1px 0 rgba(255, 255, 255, 0.82) inset,
          0 1px 1px rgba(15, 23, 42, 0.035);
        transition: transform 120ms ease, background 120ms ease, border-color 120ms ease, box-shadow 120ms ease;
      }

      #${TITLEBAR_ID} .pake-tab--active .pake-tab-main {
        background: linear-gradient(180deg, rgba(255, 255, 255, 1), rgba(251, 252, 254, 0.98));
        border-color: rgba(148, 163, 184, 0.18);
        border-bottom-color: rgba(255, 255, 255, 1);
        box-shadow:
          0 1px 0 rgba(255, 255, 255, 0.92) inset,
          0 2px 4px rgba(15, 23, 42, 0.06);
      }

      #${TITLEBAR_ID} .pake-tab-label {
        display: block;
        min-width: 0;
        flex: 1 1 auto;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        text-align: center;
        font-size: 13px;
        font-weight: 600;
        letter-spacing: -0.01em;
      }

      #${TITLEBAR_ID} .pake-tab-close,
      #${TITLEBAR_ID} .pake-add-tab {
        flex-shrink: 0;
      }

      #${TITLEBAR_ID} .pake-tab-close {
        position: absolute;
        top: 50%;
        left: 9px;
        transform: translateY(-50%);
        width: 16px;
        min-width: 16px;
        height: 16px;
        padding: 0;
        border-radius: 999px;
        background: rgba(15, 23, 42, 0.06);
        color: rgba(15, 23, 42, 0.72);
        font-size: 12px;
        line-height: 1;
        opacity: 0.72;
        box-shadow: none;
      }

      #${TITLEBAR_ID} .pake-tab-close:hover {
        background: rgba(15, 23, 42, 0.12);
        color: rgba(15, 23, 42, 0.92);
      }

      #${TITLEBAR_ID} .pake-add-tab {
        min-width: 34px;
        width: 34px;
        padding: 0;
        font-size: 18px;
        font-weight: 500;
      }

      #${TITLEBAR_ID} .pake-accounts-button {
        min-width: 34px;
        width: 34px;
        padding: 0;
        font-size: 14px;
        font-weight: 700;
      }
    `;
    document.head.appendChild(style);
  }

  function updateHistoryButtons() {
    const titlebar = document.getElementById(TITLEBAR_ID);
    if (!titlebar) return;

    const backButton = titlebar.querySelector(".pake-history-back");
    const forwardButton = titlebar.querySelector(".pake-history-forward");

    if (backButton) {
      backButton.disabled = getCurrentHistoryIndex() <= 0;
    }

    if (forwardButton) {
      forwardButton.disabled = getCurrentHistoryIndex() >= getMaxHistoryIndex();
    }
  }

  function ensureTitlebar() {
    if (window.__PAKE_CHILD_TAB__) return;
    if (!isMacOverlayTitlebarEnabled()) return;

    ensureTitlebarStyles();

    let titlebar = document.getElementById(TITLEBAR_ID);
    if (!titlebar) {
      titlebar = document.createElement("div");
      titlebar.id = TITLEBAR_ID;
      titlebar.setAttribute("data-tauri-drag-region", "");

      const titleGroup = document.createElement("div");
      titleGroup.className = "pake-title-group";
      titleGroup.textContent = "";

      const tabsContainer = document.createElement("div");
      tabsContainer.className = "pake-tabs";
      tabsContainer.style.display = "none";

      const historyGroup = document.createElement("div");
      historyGroup.className = "pake-history-group";

      const backButton = document.createElement("button");
      backButton.className = "pake-history-back";
      backButton.type = "button";
      backButton.title = "Назад";
      backButton.setAttribute("aria-label", "Назад");
      backButton.textContent = "‹";
      backButton.addEventListener("click", () => window.history.back());

      const forwardButton = document.createElement("button");
      forwardButton.className = "pake-history-forward";
      forwardButton.type = "button";
      forwardButton.title = "Вперед";
      forwardButton.setAttribute("aria-label", "Вперед");
      forwardButton.textContent = "›";
      forwardButton.addEventListener("click", () => window.history.forward());

      historyGroup.appendChild(backButton);
      historyGroup.appendChild(forwardButton);

      const actionsGroup = document.createElement("div");
      actionsGroup.className = "pake-actions";

      const addButton = document.createElement("button");
      addButton.className = "pake-add-tab";
      addButton.type = "button";
      addButton.title = "Новая вкладка";
      addButton.setAttribute("aria-label", "Новая вкладка");
      addButton.textContent = "+";
      addButton.addEventListener("click", async () => {
        try {
          const tab = await requestTabsNative("open_tab", { url: window.location.href });
          await requestTabsNative("switch_tab", { id: tab.id });
        } catch {
          // Keep the current tab usable if native tab creation fails.
        }
      });

      actionsGroup.appendChild(addButton);
      actionsGroup.appendChild(historyGroup);
      titlebar.appendChild(titleGroup);
      titlebar.appendChild(tabsContainer);
      titlebar.appendChild(actionsGroup);
      document.documentElement.appendChild(titlebar);
    }

    updateHistoryButtons();
    renderTabs();
    updateTitleDisplay();
  }

  let tabsSnapshot = [];
  let latestSnapshotVersion = 0;
  let tabsListenerReady = false;
  let tabsBridgeListenerReady = false;
  let tabsBridgeRequestCounter = 0;
  const pendingTabsBridgeRequests = new Map();

  function normalizeTabsEventPayload(payload) {
    if (typeof payload === "string") {
      try {
        return JSON.parse(payload);
      } catch {
        return null;
      }
    }
    return payload && typeof payload === "object" ? payload : null;
  }

  function emitTabsNative(name, payload) {
    const emit = window.__TAURI__?.event?.emit;
    if (!emit) return Promise.reject(new Error("Tauri event bridge not ready"));
    return emit(name, payload);
  }

  async function ensureTabsBridgeListener() {
    if (tabsBridgeListenerReady) return true;
    const listen = window.__TAURI__?.event?.listen;
    if (!listen) return false;

    tabsBridgeListenerReady = true;
    await listen("pake.tabs:response", (event) => {
      const payload = normalizeTabsEventPayload(event.payload);
      if (!payload) return;
      const pending = pendingTabsBridgeRequests.get(payload.request_id);
      if (!pending) return;

      pendingTabsBridgeRequests.delete(payload.request_id);
      if (payload.ok) {
        pending.resolve(payload.data);
      } else {
        pending.reject(new Error(payload.error || "Tab bridge error"));
      }
    });
    return true;
  }

  async function requestTabsNative(action, params = {}) {
    const ready = await ensureTabsBridgeListener();
    if (!ready) {
      throw new Error("Tauri event bridge not ready");
    }

    tabsBridgeRequestCounter += 1;
    const request_id = `${Date.now()}-${tabsBridgeRequestCounter}`;
    const request = { request_id, action, params };

    const response = new Promise((resolve, reject) => {
      pendingTabsBridgeRequests.set(request_id, { resolve, reject });
      window.setTimeout(() => {
        if (pendingTabsBridgeRequests.has(request_id)) {
          pendingTabsBridgeRequests.delete(request_id);
          reject(new Error(`Tab bridge timeout: ${action}`));
        }
      }, 8000);
    });

    await emitTabsNative("pake.tabs:request", request);
    return response;
  }

  function applyTabsSnapshot(payload) {
    const nextVersion = Number(payload?.version || 0);
    if (nextVersion && nextVersion < latestSnapshotVersion) return false;
    latestSnapshotVersion = nextVersion || latestSnapshotVersion;
    tabsSnapshot = Array.isArray(payload?.tabs) ? payload.tabs : [];
    return true;
  }

  function getActiveTabId() {
    return tabsSnapshot.find((tab) => tab.active)?.id ?? null;
  }

  function renderTabs() {
    const titlebar = document.getElementById(TITLEBAR_ID);
    if (!titlebar) return;
    let tabsContainer = titlebar.querySelector(".pake-tabs");
    if (!tabsContainer) return;

    tabsContainer.textContent = "";
    tabsContainer.style.display = tabsSnapshot.length > 1 ? "flex" : "none";

    const activeTabId = getActiveTabId();
    for (const tab of tabsSnapshot) {
      const isActive = tab.id === activeTabId;
      const tabItem = document.createElement("div");
      tabItem.className = `pake-tab${isActive ? " pake-tab--active" : ""}`;
      tabItem.title = `${getTabDisplayTitle(tab)}\n${tab.path || "/"}`;

      const tabButton = document.createElement("button");
      tabButton.type = "button";
      tabButton.className = "pake-tab-main";
      tabButton.setAttribute("aria-label", getTabDisplayTitle(tab));
      if (isActive) {
        tabButton.setAttribute("aria-current", "page");
      }
      tabButton.addEventListener("click", async () => {
        if (isActive) return;
        try {
          await requestTabsNative("switch_tab", { id: tab.id });
        } catch {
          // The next snapshot will reconcile a stale tab button.
        }
      });

      const close = document.createElement("button");
      close.type = "button";
      close.className = "pake-tab-close";
      close.textContent = "×";
      close.title = "Закрыть вкладку";
      close.disabled = tab.id === 1;
      close.addEventListener("click", async (event) => {
        event.stopPropagation();
        if (tab.id === 1) return;
        try {
          await requestTabsNative("close_tab", { id: tab.id });
        } catch {
          // The next snapshot will reconcile a stale tab button.
        }
      });

      const label = document.createElement("span");
      label.className = "pake-tab-label";
      label.textContent = getTabDisplayTitle(tab);

      tabButton.appendChild(label);
      tabItem.appendChild(tabButton);
      tabItem.appendChild(close);
      tabsContainer.appendChild(tabItem);
    }
  }

  function updateTitleDisplay() {
    const titlebar = document.getElementById(TITLEBAR_ID);
    if (!titlebar) return;
    const titleGroup = titlebar.querySelector(".pake-title-group");
    const hasTabs = tabsSnapshot.length > 1;
    if (!titleGroup) return;
    titleGroup.style.display = hasTabs ? "none" : "flex";
    titleGroup.textContent = hasTabs ? "" : getCurrentPageTitle();
  }

  async function refreshTabsSnapshot() {
    try {
      const payload = await requestTabsNative("get_tabs");
      if (applyTabsSnapshot(payload)) {
        renderTabs();
        updateTitleDisplay();
      }
    } catch {
      // ignore until bridge is ready
    }
  }

  async function ensureTabsListener() {
    if (tabsListenerReady) return;
    const listen = window.__TAURI__?.event?.listen;
    if (!listen) return;
    tabsListenerReady = true;
    await listen("pake-tabs:snapshot", (event) => {
      const payload = normalizeTabsEventPayload(event.payload);
      if (applyTabsSnapshot(payload)) {
        renderTabs();
        updateTitleDisplay();
      }
    });
  }

  function shouldForceSameWindow(anchor) {
    if (!anchor) return false;
    const href = anchor.getAttribute("href") || anchor.href || "";
    const text = [anchor.textContent, anchor.getAttribute("aria-label"), anchor.title]
      .filter(Boolean)
      .join(" ");

    const target = (anchor.getAttribute("target") || "").toLowerCase();
    return (
      isVksLabel(text) ||
      isVksUrl(href) ||
      ((target === "_blank" || target === "_new") && isInternal1FormaUrl(href))
    );
  }

  function navigateInPlace(url) {
    const absolute = toAbsoluteUrl(url);
    registerPushNavigation();

    if (absolute) {
      window.location.href = absolute.href;
    } else if (typeof url === "string" && url) {
      window.location.href = url;
    }
  }

  document.addEventListener(
    "click",
    (event) => {
      const anchor = event.target && event.target.closest ? event.target.closest("a") : null;
      if (!shouldForceSameWindow(anchor)) return;

      const href = anchor.href || anchor.getAttribute("href");
      if (!href) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      navigateInPlace(href);
    },
    true,
  );

  const originalWindowOpen = window.open;
  window.open = function (url, name, specs) {
    const shouldRouteInPlace =
      isVksUrl(url) ||
      isVksLabel(name) ||
      isInternal1FormaUrl(url);

    if (shouldRouteInPlace) {
      navigateInPlace(url);
      return window;
    }

    return originalWindowOpen.call(window, url, name, specs);
  };

  const originalPushState = history.pushState;
  history.pushState = function (state, title, url) {
    const nextIndex = getCurrentHistoryIndex() + 1;
    setStoredNumber(HISTORY_INDEX_KEY, nextIndex);
    setStoredNumber(HISTORY_MAX_KEY, nextIndex);
    const nextState =
      state && typeof state === "object" ? { ...state, __pakeNavIndex: nextIndex } : { __pakeNavIndex: nextIndex };
    const result = originalPushState.call(history, nextState, title, url);
    updateHistoryButtons();
    return result;
  };

  const originalReplaceState = history.replaceState;
  history.replaceState = function (state, title, url) {
    const currentIndex = getCurrentHistoryIndex();
    const nextState =
      state && typeof state === "object"
        ? { ...state, __pakeNavIndex: currentIndex }
        : { __pakeNavIndex: currentIndex };
    const result = originalReplaceState.call(history, nextState, title, url);
    updateHistoryButtons();
    return result;
  };

  window.addEventListener("popstate", (event) => {
    if (event.state && typeof event.state.__pakeNavIndex === "number") {
      setStoredNumber(HISTORY_INDEX_KEY, event.state.__pakeNavIndex);
    }
    updateHistoryButtons();
  });

  window.addEventListener("pageshow", () => {
    ensureHistoryState();
    ensureTitlebar();
    syncDockBadgeFromTitle();
  });

  window.addEventListener("load", () => {
    ensureHistoryState();
    ensureTitlebar();
    syncDockBadgeFromTitle();
  });

  ensureHistoryState();
  patchRetinaDisplayMedia();
  ensureTitlebar();
  observeTitleBadge();
  observeTickersRequests();
})();
