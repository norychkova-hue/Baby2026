// Telegram Mini App glue. Safe to load in a normal browser: everything is a no-op outside Telegram.
(() => {
  const tg = window.Telegram && window.Telegram.WebApp;
  const inTg = !!(tg && tg.initData !== undefined && tg.platform && tg.platform !== "unknown");

  function syncTheme() {
    if (!inTg) return;
    document.documentElement.dataset.theme = tg.colorScheme === "dark" ? "dark" : "light";
    try {
      const bg = getComputedStyle(document.body).backgroundColor;
      const hex = "#" + (bg.match(/\d+/g) || []).slice(0, 3).map((n) => (+n).toString(16).padStart(2, "0")).join("");
      if (hex.length === 7) { tg.setHeaderColor(hex); tg.setBackgroundColor(hex); }
    } catch (e) {}
  }

  if (inTg) {
    try { tg.ready(); tg.expand(); } catch (e) {}
    try { tg.disableVerticalSwipes && tg.disableVerticalSwipes(); } catch (e) {}
    document.addEventListener("DOMContentLoaded", syncTheme);
    if (document.readyState !== "loading") syncTheme();
    try { tg.onEvent("themeChanged", syncTheme); } catch (e) {}
  }

  window.App = {
    inTelegram: inTg,
    // kind: "light" | "soft" | "medium" | "heavy" | "double"
    haptic(kind) {
      try {
        if (inTg && tg.HapticFeedback) {
          if (kind === "double") {
            tg.HapticFeedback.impactOccurred("medium");
            setTimeout(() => tg.HapticFeedback.impactOccurred("medium"), 120);
          } else tg.HapticFeedback.impactOccurred(kind);
          return;
        }
        if (navigator.vibrate) navigator.vibrate(kind === "double" ? [20, 60, 20] : kind === "light" ? 15 : 30);
      } catch (e) {}
    },
    // Ask before closing the app mid-contraction
    guardClose(on) {
      try { if (inTg) on ? tg.enableClosingConfirmation() : tg.disableClosingConfirmation(); } catch (e) {}
    },
  };
})();
