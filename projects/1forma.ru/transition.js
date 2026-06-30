(function () {
  const STYLE_ID = "pake-page-transition-style";
  const OVERLAY_ID = "pake-page-transition-overlay";
  const SHOW_DELAY_MS = 90;
  const HIDE_DELAY_MS = 220;

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${OVERLAY_ID} {
        position: fixed;
        inset: 0;
        pointer-events: none;
        opacity: 0;
        background:
          radial-gradient(circle at 20% 20%, rgba(0, 115, 255, 0.12), transparent 28%),
          linear-gradient(180deg, rgba(255,255,255,0.96), rgba(245,247,250,0.98));
        backdrop-filter: blur(2px);
        transition: opacity 180ms ease;
        z-index: 2147483647;
      }

      #${OVERLAY_ID}.is-visible {
        opacity: 1;
      }

      #${OVERLAY_ID}::before {
        content: "";
        position: absolute;
        left: 50%;
        top: 50%;
        width: 36px;
        height: 36px;
        margin-left: -18px;
        margin-top: -18px;
        border-radius: 999px;
        border: 3px solid rgba(0, 112, 255, 0.2);
        border-top-color: rgba(0, 112, 255, 0.95);
        animation: pake-spin 0.8s linear infinite;
      }

      @keyframes pake-spin {
        to { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);
  }

  function ensureOverlay() {
    let overlay = document.getElementById(OVERLAY_ID);
    if (overlay) return overlay;
    overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    document.documentElement.appendChild(overlay);
    return overlay;
  }

  function showOverlay() {
    ensureStyles();
    const overlay = ensureOverlay();
    window.clearTimeout(overlay._hideTimer);
    window.clearTimeout(overlay._showTimer);
    overlay._showTimer = window.setTimeout(() => {
      overlay.classList.add("is-visible");
    }, SHOW_DELAY_MS);
  }

  function hideOverlay() {
    const overlay = document.getElementById(OVERLAY_ID);
    if (!overlay) return;
    window.clearTimeout(overlay._showTimer);
    window.clearTimeout(overlay._hideTimer);
    overlay._hideTimer = window.setTimeout(() => {
      overlay.classList.remove("is-visible");
    }, HIDE_DELAY_MS);
  }

  function shouldHandle(url) {
    try {
      const next = new URL(url, window.location.href);
      return next.hostname === window.location.hostname || next.hostname.endsWith(".1forma.ru");
    } catch {
      return false;
    }
  }

  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;

  history.pushState = function () {
    showOverlay();
    return originalPushState.apply(this, arguments);
  };

  history.replaceState = function () {
    showOverlay();
    return originalReplaceState.apply(this, arguments);
  };

  window.addEventListener("popstate", showOverlay);
  window.addEventListener("pageshow", hideOverlay);
  window.addEventListener("load", hideOverlay);

  document.addEventListener(
    "click",
    (event) => {
      const anchor = event.target && event.target.closest ? event.target.closest("a") : null;
      if (!anchor || !anchor.href) return;
      if (shouldHandle(anchor.href)) {
        showOverlay();
        window.setTimeout(hideOverlay, 2500);
      }
    },
    true,
  );

  document.addEventListener(
    "submit",
    () => {
      showOverlay();
      window.setTimeout(hideOverlay, 2500);
    },
    true,
  );
})();
