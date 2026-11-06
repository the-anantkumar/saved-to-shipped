"use strict";

// Run before styles load so a remembered theme is applied before first paint.
(() => {
  const key = "save2ship-theme";
  const modes = ["system", "light", "dark"];
  const system = window.matchMedia("(prefers-color-scheme: dark)");
  let preference = "system";

  function readPreference() {
    try {
      const saved = window.localStorage.getItem(key);
      return modes.includes(saved) ? saved : "system";
    } catch {
      return "system";
    }
  }

  function apply(mode, persist = false) {
    preference = modes.includes(mode) ? mode : "system";
    const resolved = preference === "system" ? (system.matches ? "dark" : "light") : preference;
    document.documentElement.dataset.theme = resolved;
    document.documentElement.style.colorScheme = resolved;
    const control = document.querySelector("#theme-mode");
    if (control) control.value = preference;
    if (persist) {
      try { window.localStorage.setItem(key, preference); } catch { /* Session-only when storage is unavailable. */ }
    }
  }

  window.save2shipTheme = {
    get preference() { return preference; },
    set(mode) { apply(mode, true); },
  };
  const systemChanged = () => { if (preference === "system") apply("system"); };
  if (system.addEventListener) system.addEventListener("change", systemChanged);
  else if (system.addListener) system.addListener(systemChanged);
  window.addEventListener("storage", event => {
    if (event.key === key || event.key === null) apply(readPreference());
  });
  apply(readPreference());
})();
