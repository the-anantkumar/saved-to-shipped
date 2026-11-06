import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

function theme({ dark = false, saved, blocked = false } = {}) {
  const storage = new Map(saved === undefined ? [] : [["save2ship-theme", saved]]);
  const events = {};
  const root = { dataset: {}, style: {} };
  const control = { value: "" };
  const media = { matches: dark, addEventListener(_type, callback) { events.system = callback; } };
  const window = {
    matchMedia: () => media,
    localStorage: {
      getItem(key) { if (blocked) throw new Error("Storage unavailable"); return storage.get(key) ?? null; },
      setItem(key, value) { if (blocked) throw new Error("Storage unavailable"); storage.set(key, value); },
    },
    addEventListener(type, callback) { events[type] = callback; },
  };
  vm.runInNewContext(readFileSync("saved_to_shipped/web/theme.js", "utf8"), {
    window, document: { documentElement: root, querySelector: () => control },
  });
  return { api: window.save2shipTheme, root, control, storage, events, media };
}

test("system mode follows appearance changes without saving an explicit choice", () => {
  const ui = theme({ dark: true });
  assert.equal(ui.root.dataset.theme, "dark");
  assert.equal(ui.root.style.colorScheme, "dark");
  assert.equal(ui.api.preference, "system");
  ui.media.matches = false;
  ui.events.system();
  assert.equal(ui.root.dataset.theme, "light");
  assert.equal(ui.storage.size, 0);
});

test("saved overrides survive reload and ignore system changes until reset", () => {
  const ui = theme({ dark: true, saved: "light" });
  assert.equal(ui.root.dataset.theme, "light");
  ui.events.system();
  assert.equal(ui.root.dataset.theme, "light");
  ui.api.set("dark");
  const reloaded = theme({ saved: ui.storage.get("save2ship-theme") });
  assert.equal(reloaded.root.dataset.theme, "dark");
  assert.equal(reloaded.control.value, "dark");
  ui.api.set("system");
  ui.media.matches = false;
  ui.events.system();
  assert.equal(ui.root.dataset.theme, "light");
});

test("blocked storage and invalid preferences safely fall back to the system", () => {
  const ui = theme({ dark: true, blocked: true });
  assert.equal(ui.root.dataset.theme, "dark");
  assert.doesNotThrow(() => ui.api.set("light"));
  assert.equal(ui.root.dataset.theme, "light");
  assert.equal(theme({ dark: true, saved: "invalid" }).root.dataset.theme, "dark");
});

test("other tabs update their theme and control when the saved preference changes", () => {
  const ui = theme();
  ui.storage.set("save2ship-theme", "dark");
  ui.events.storage({ key: "save2ship-theme" });
  assert.equal(ui.root.dataset.theme, "dark");
  assert.equal(ui.control.value, "dark");
  ui.storage.clear();
  ui.events.storage({ key: null });
  assert.equal(ui.root.dataset.theme, "light");
  assert.equal(ui.control.value, "system");
});
