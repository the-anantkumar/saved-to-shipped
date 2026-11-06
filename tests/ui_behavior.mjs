import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

// Exercise rendering and navigation as application code, without a browser or providers.
function app(data = {}) {
  const nodes = new Map();
  const events = {};
  const node = (name) => {
    if (!nodes.has(name)) nodes.set(name, {
      innerHTML: "", open: false, disabled: false,
      classList: { toggle() {}, add() {}, remove() {} },
      addEventListener(type, callback) { events[name + ":" + type] = callback; },
      querySelectorAll() { return []; },
      setAttribute() {}, remove() {},
      showModal() { this.open = true; }, close() { this.open = false; },
      focus() {},
    });
    return nodes.get(name);
  };
  const context = vm.createContext({
    URLSearchParams, console,
    location: { search: "", hash: "" },
    history: { pushState(_state, _unused, hash) { context.location.hash = hash; } },
    window: { matchMedia: () => ({ matches: false }), scrollTo() {}, addEventListener(type, callback) { events[type] = callback; } },
    document: { querySelector: node, querySelectorAll: () => [], addEventListener() {} },
    fetch: () => new Promise(() => {}),
    setTimeout: () => 1, clearTimeout() {},
  });
  vm.runInContext(readFileSync("saved_to_shipped/web/onboarding.js", "utf8"), context);
  vm.runInContext(readFileSync("saved_to_shipped/web/app.js", "utf8"), context);
  context.fixture = { items: [], projects: [], settings: {}, imports: [], ...data };
  vm.runInContext("state = fixture", context);
  return { run: (code) => vm.runInContext(code, context), node, events, context };
}

const draft = { id: "draft", title: "Practice query plans", content: "Compare an index", note: "For my app", kind: "learning", status: "inbox", has_context: true, saved_at: "2026-11-01", url: "https://linkedin.com/posts/example", next_action: "Compare one query", definition_of_done: "Two plans saved", effort_hours: 1 };
const waiting = { ...draft, id: "waiting", title: "UNKNOWN_POST", content: "", note: "", kind: "untriaged", has_context: false };

test("the next action prioritizes review and never invents context for waiting links", () => {
  const ui = app({ items: [draft, waiting] });
  assert.match(ui.run("pipeline()"), /Start reviewing/);
  ui.run('filter = "review"');
  const page = ui.run("inbox()");
  assert.match(page, /Practice query plans/);
  assert.doesNotMatch(page, /UNKNOWN_POST/);
  assert.equal((ui.run("pipeline()").match(/<button/g) || []).length, 1);
});

test("uncertain paid submissions take priority over other actions", () => {
  const ui = app({ items: [draft], retrieval_jobs: [{ status: "UNCERTAIN", total: 10, error: "Check before retrying" }] });
  assert.match(ui.run("pipeline()"), /Check run/);
  assert.doesNotMatch(ui.run("pipeline()"), /Start reviewing/);
});

test("dismissed submissions stop masking the useful next action", () => {
  const ui = app({ items: [waiting], retrieval_jobs: [{ status: "DISMISSED", error: "Old failure" }] });
  const panel = ui.run("pipeline()");
  assert.match(panel, /Process 1 save/);
  assert.doesNotMatch(panel, /Old failure|Check run/);
});

test("review keeps context read-only and escapes untrusted text", () => {
  const ui = app({ items: [{ ...draft, title: '<img src=x onerror="bad()">', effort_hours: 1.2, content: "<script>bad()</script>", enrichment: { status: "partial", coverage: "post text only" } }] });
  ui.run('itemDialog("draft")');
  const html = ui.node("#modal").innerHTML;
  assert.match(html, /Partial content/);
  assert.doesNotMatch(html, /name="content"|name="note"/);
  assert.match(html, /value="1.2" selected/);
  assert.match(html, /Add to backlog/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>|<img/);
});

test("personal context has a separate editor without task or review fields", () => {
  const ui = app({ items: [draft] });
  ui.run('contextDialog("draft")');
  const html = ui.node("#modal").innerHTML;
  assert.match(html, /name="note"/);
  assert.match(html, /name="content"/);
  assert.match(html, /For my app/);
  assert.doesNotMatch(html, /name="next_action"|name="status"|Add to backlog/);
});

test("editing a note does not resubmit an unchanged source or task", async () => {
  const ui = app({ items: [draft] });
  ui.run('let saveContext, sent; bindForm = callback => saveContext = callback; api = async (_route, payload) => { sent = payload; }; contextDialog("draft");');
  ui.context.form = new Map([["note", "My revised note"], ["content", draft.content]]);
  await ui.run("saveContext(form)");
  assert.deepEqual(JSON.parse(ui.run("JSON.stringify(sent)")), { id: "draft", note: "My revised note" });
});

test("drop position chooses the next tile and excludes the tile being dragged", () => {
  const ui = app();
  ui.context.column = {
    dataset: { dropStatus: "ready" },
    querySelectorAll: () => [
      { dataset: { tileId: "dragged" }, getBoundingClientRect: () => ({ top: 0, height: 100 }) },
      { dataset: { tileId: "first" }, getBoundingClientRect: () => ({ top: 110, height: 100 }) },
      { dataset: { tileId: "second" }, getBoundingClientRect: () => ({ top: 220, height: 100 }) },
    ],
  };
  ui.run('draggedTile = "dragged"');
  assert.equal(ui.run("dropDestination(column, 150).before_id"), "first");
  assert.equal(ui.run("dropDestination(column, 200).before_id"), "second");
  assert.equal(ui.run("dropDestination(column, 350).before_id"), null);
});

test("a rejected move keeps the original lane and never resubmits automatically", async () => {
  const ui = app({ items: [draft] });
  ui.run('let attempts = 0; api = async () => { attempts++; throw new Error("Invalid move"); }; refresh = async () => {};');
  assert.equal(await ui.run('moveTile("draft", "ready")'), false);
  assert.equal(ui.run("attempts"), 1);
  assert.equal(ui.run("state.items[0].status"), "inbox");
  assert.equal(ui.run("movingTile"), false);
});

test("project navigation survives reload and browser back", () => {
  const ui = app();
  ui.run('navigate("inbox", "project/one")');
  assert.equal(ui.context.location.hash, "#inbox?project=project%2Fone");
  ui.run('view="projects"; projectFilter=""; restoreRoute()');
  assert.equal(ui.run("projectFilter"), "project/one");
  ui.context.location.hash = "#backlog";
  ui.events.popstate();
  assert.equal(ui.run("view"), "backlog");
  assert.match(ui.node("#sidebar").innerHTML, /aria-current="page"/);
});

test("configured AI has one clear action and other methods stay available", () => {
  const ui = app({ items: [{ ...draft, kind: "untriaged" }], ai: { available: true, model: "test" } });
  ui.run("classifyDialog()");
  const html = ui.node("#modal").innerHTML;
  assert.match(html, /Organize 1 save/);
  assert.match(html, /<details><summary>Other ways/);
  assert.match(html, /Use local rules/);
  assert.doesNotMatch(html, /\$\{/);
});
