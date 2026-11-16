import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

// Exercise rendering and navigation as application code, without a browser or providers.
function app(data = {}, hosted = null) {
  const nodes = new Map();
  const events = {};
  const classes = () => {
    const values = new Set();
    return {
      add(value) { values.add(value); }, remove(value) { values.delete(value); },
      contains(value) { return values.has(value); },
      toggle(value, enabled) { if (enabled) values.add(value); else values.delete(value); },
    };
  };
  const root = { classList: classes() };
  const selection = { clears: 0, removeAllRanges() { this.clears++; } };
  const node = (name) => {
    if (!nodes.has(name)) nodes.set(name, {
      innerHTML: "", open: false, disabled: false,
      classList: classes(), style: {},
      addEventListener(type, callback) { events[name + ":" + type] = callback; },
      querySelectorAll() { return []; },
      setAttribute() {}, removeAttribute() {}, remove() {},
      showModal() { this.open = true; }, close() { this.open = false; },
      focus() {}, scrollIntoView() {},
    });
    return nodes.get(name);
  };
  const context = vm.createContext({
    URLSearchParams, console,
    location: { search: "", hash: "" },
    history: { state: null, pushState(state, _unused, hash) { this.state = state; context.location.hash = hash; }, replaceState(state, unused, hash) { this.pushState(state, unused, hash); } },
    window: { Save2ShipHosted: hosted, scrollY: 0, innerHeight: 900, requestAnimationFrame() {}, matchMedia: () => ({ matches: false }), getSelection: () => selection, scrollTo() {}, addEventListener(type, callback) { events[type] = callback; } },
    document: {
      documentElement: root, body: { appendChild() {} }, elementFromPoint: () => null,
      querySelector: node, querySelectorAll: () => [],
      addEventListener(type, callback) { (events["document:" + type] ||= []).push(callback); },
    },
    fetch: () => new Promise(() => {}),
    setTimeout: () => 1, clearTimeout() {},
  });
  vm.runInContext(readFileSync("saved_to_shipped/web/onboarding.js", "utf8"), context);
  vm.runInContext(readFileSync("saved_to_shipped/web/reading.js", "utf8"), context);
  vm.runInContext(readFileSync("saved_to_shipped/web/app.js", "utf8"), context);
  context.fixture = structuredClone({ items: [], projects: [], settings: {}, imports: [], ...data });
  vm.runInContext("state = fixture", context);
  return { run: (code) => vm.runInContext(code, context), node, events, context, root, selection,
    emit(type, event) { for (const callback of events["document:" + type] || []) callback(event); } };
}

const draft = { id: "draft", title: "Practice query plans", content: "Compare an index", note: "For my app", kind: "project", status: "inbox", has_context: true, saved_at: "2026-11-01", url: "https://linkedin.com/posts/example", next_action: "Compare one query", definition_of_done: "Two plans saved", effort_hours: 1 };
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

function dragGesture(ui) {
  const tile = ui.node("tile");
  tile.dataset = { tileId: "draft" };
  tile.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200 });
  tile.setPointerCapture = () => { tile.captured = true; };
  tile.hasPointerCapture = () => tile.captured;
  tile.releasePointerCapture = () => { tile.captured = false; };
  tile.cloneNode = () => ui.node("#drag-preview");
  const event = {
    target: { closest: selector => selector === '[data-draggable="true"]' ? tile : null },
    pointerId: 7, button: 0, pointerType: "mouse", clientX: 5, clientY: 5,
    prevented: false, preventDefault() { this.prevented = true; },
  };
  ui.emit("pointerdown", event);
  return event;
}

test("dragging prevents page selection and releases it after an outside drop", () => {
  const ui = app({ items: [draft] });
  const down = dragGesture(ui);
  assert.equal(down.prevented, true);
  assert.equal(ui.root.classList.contains("tile-dragging"), true);
  let blocked = false;
  ui.emit("selectstart", { preventDefault() { blocked = true; } });
  assert.equal(blocked, true);
  ui.emit("pointermove", { ...down, clientX: 40 });
  assert.equal(ui.selection.clears, 1);
  ui.emit("pointerup", down);
  assert.equal(ui.root.classList.contains("tile-dragging"), false);
  blocked = false;
  ui.emit("selectstart", { preventDefault() { blocked = true; } });
  assert.equal(blocked, false);
});

test("cancel, lost capture, Escape, and window blur restore selection", () => {
  for (const end of ["pointercancel", "lostpointercapture", "Escape", "blur"]) {
    const ui = app({ items: [draft] });
    dragGesture(ui);
    if (end === "blur") ui.events.blur();
    else if (end === "Escape") ui.emit("keydown", { key: "Escape", preventDefault() {} });
    else ui.emit(end, { pointerId: 7 });
    assert.equal(ui.root.classList.contains("tile-dragging"), false, end);
    assert.equal(ui.run("pointerDrag"), null, end);
  }
});

test("editor controls do not activate the page selection lock", () => {
  const ui = app();
  let prevented = false;
  ui.emit("pointerdown", {
    target: { closest: () => ({}) },
    button: 0, preventDefault() { prevented = true; },
  });
  assert.equal(prevented, false);
  assert.equal(ui.root.classList.contains("tile-dragging"), false);
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

const article = {...draft, id: "learn", title: "LEARNING_INDEXES", kind: "learning", project_id: "databases", content: "Useful database knowledge", status: "ready"};
const reference = {...article, id: "reference", title: "REFERENCE_FORMS", kind: "reference", project_id: "forms"};
const experience = {...article, id: "experience", title: "EXPERIENCE_STORY", kind: "experience", project_id: "careers"};
const collections = [{id: "databases", name: "Databases"}, {id: "forms", name: "Accessible forms"}, {id: "careers", name: "Careers"}];

test("project board and reading libraries keep their kinds separate", () => {
  const ui = app({items: [draft, article, reference, experience], projects: collections});
  const board = ui.run("backlog()");
  assert.match(board, /Practice query plans/);
  assert.doesNotMatch(board, /LEARNING_INDEXES|REFERENCE_FORMS|EXPERIENCE_STORY|Accessible forms|Careers/);
  ui.run('view = "learning"');
  const learning = ui.run("readingLibrary()");
  assert.match(learning, /LEARNING_INDEXES/);
  assert.match(learning, /REFERENCE_FORMS/);
  assert.doesNotMatch(learning, /Practice query plans|EXPERIENCE_STORY|Careers/);
  ui.run('view = "experiences"');
  assert.match(ui.run("readingLibrary()"), /EXPERIENCE_STORY/);
  assert.doesNotMatch(ui.run("readingLibrary()"), /LEARNING_INDEXES|REFERENCE_FORMS|Practice query plans/);
  assert.equal(ui.run("reviewItems().length"), 1);
});

test("topic, reading time, search, and completion narrow the library together", () => {
  const long = {...article, id: "long", title: "LONG_READ", content: "index ".repeat(1400)};
  const read = {...reference, reading: {status: "read", progress: 100}};
  const ui = app({items: [article, long, read], projects: collections});
  ui.run('view = "learning"; readingLength = "5"; search = "knowledge"; projectFilter = "databases"');
  assert.match(ui.run("readingLibrary()"), /LEARNING_INDEXES/);
  assert.doesNotMatch(ui.run("readingLibrary()"), /LONG_READ|REFERENCE_FORMS/);
  ui.run('search = ""; projectFilter = ""; readingFilter = "read"');
  assert.match(ui.run("readingLibrary()"), /REFERENCE_FORMS/);
  assert.doesNotMatch(ui.run("readingLibrary()"), /LEARNING_INDEXES|LONG_READ/);
  assert.equal(ui.run("readingMinutes(state.items[1])"), 7);
});

test("reading prioritizes an unfinished read then the chosen Read next queue", () => {
  const ui = app({items: [article, {...reference, reading: {status: "unread", queued: true}}, {...article, id: "started", reading: {status: "reading", progress: 40}}]});
  assert.equal(ui.run("readingOrder(state.items).map(item => item.id).join(',')"), "started,reference,learn");
  ui.run('view="learning"; readingFilter="queued"');
  assert.equal(ui.run("filteredReading(libraryItems()).map(item => item.id).join(',')"), "reference");
});

test("reading routes retain filters, deep links, and legacy project links", () => {
  const ui = app({items: [article]});
  ui.context.location.hash = "#learning?project=databases&filter=reading&length=5&q=hello+world&read=learn";
  ui.run("restoreRoute()");
  assert.equal(ui.run("libraryHash()"), ui.context.location.hash);
  assert.equal(ui.run("readerId"), "learn");
  ui.context.location.hash = "#experiences?read=learn";
  ui.events.popstate();
  assert.equal(ui.run("readerId"), "");
  ui.context.location.hash = "#projects";
  ui.run("restoreRoute()");
  assert.equal(ui.run("view"), "backlog");
  ui.context.location.hash = "";
  ui.run("restoreRoute()");
  assert.equal(ui.run("view"), "focus");
});

test("the reader escapes source text and keeps coverage and notes visible", () => {
  const ui = app({items: [{...article, content: '<script>bad()</script>\n\nA second paragraph.', enrichment: {status: "partial", coverage: "Video not transcribed", links: ["javascript:bad()", "https://example.com/read"]}}]});
  ui.run('view="learning"; readerId="learn"');
  const page = ui.run("readingPage()");
  assert.match(page, /&lt;script&gt;bad\(\)&lt;\/script&gt;/);
  assert.match(page, /Video not transcribed|Partial text/);
  assert.match(page, /Your notes|Add a takeaway/);
  assert.match(page, /https:\/\/example.com\/read/);
  assert.doesNotMatch(page, /<script>|javascript:|name="next_action"|name="note"|data-draggable/);
});

test("reading mutations are serialized so completion follows pending progress", async () => {
  const ui = app({items: [article]});
  ui.run('let calls = []; api = async (_route, payload) => { calls.push(payload); return {reading: {...readingState(state.items[0]), ...payload}}; };');
  await ui.run('Promise.all([changeReading("learn", {progress: 50}), changeReading("learn", {status: "read", progress: 100})])');
  assert.equal(ui.run("calls.map(call => call.status || call.progress).join(',')"), "50,read");
  assert.equal(ui.run("state.items[0].reading.status"), "read");
  assert.equal(ui.run("state.items[0].status"), "ready");
  assert.equal(ui.run("readingRequests.size"), 0);
});

test("reading organization sends metadata without rewriting tasks or notes", async () => {
  const ui = app({items: [article], projects: collections});
  ui.run('let saveReading, sent; bindForm = callback => saveReading = callback; api = async (_route, payload) => { sent = payload; }; readingDialog("learn");');
  assert.doesNotMatch(ui.node("#modal").innerHTML, /name="status"|name="note"|name="next_action"|name="effort_hours"/);
  ui.context.form = new Map([["title", "A clearer title"], ["kind", "reference"], ["project_id", "forms"]]);
  await ui.run("saveReading(form)");
  assert.deepEqual(JSON.parse(ui.run("JSON.stringify(sent)")), {id: "learn", title: "A clearer title", kind: "reference", project_id: "forms"});
});

test("navigation flushes pending progress before leaving a reading space", async () => {
  const ui = app({items: [article]});
  ui.run('view="learning"; readerId="learn"; pendingReadingProgress={id:"learn", progress:40}; let sent; api = async (_route,payload) => { sent = payload; return {reading:{status:"reading",progress:payload.progress,queued:false}}; };');
  await ui.run('navigate("experiences")');
  assert.deepEqual(JSON.parse(ui.run("JSON.stringify(sent)")), {id: "learn", progress: 40, status: "reading"});
  assert.equal(ui.run("state.items[0].reading.progress"), 40);
  assert.equal(ui.run("state.items[0].status"), "ready");
  assert.equal(ui.context.location.hash, "#experiences");
  assert.equal(ui.run("readerId"), "");
});

test("a save opened from intake returns to its reading library", async () => {
  const ui = app({items: [{...article, reading: {status: "read", progress: 100}}]});
  ui.run('view="inbox"; openReading("learn")');
  assert.equal(ui.context.history.state.libraryReturn, "#learning");
  assert.equal(ui.context.history.state.fromLibrary, false);
  await ui.run("backToLibrary()");
  assert.equal(ui.context.location.hash, "#learning");
  assert.equal(ui.run("readerId"), "");
});

test("organizing dropdowns offer inline creation for each destination", () => {
  const ui = app({items: [draft, article, experience], projects: collections});
  for (const [id, label] of [["draft", "New project"], ["learn", "New learning topic"], ["experience", "New experience section"]]) {
    ui.run(id === "draft" ? 'itemDialog("draft")' : `readingDialog("${id}")`);
    const html = ui.node("#modal").innerHTML;
    assert.match(html, new RegExp(`<option value="__new_section__"[^>]*>\\+ ${label}`));
    assert.match(html, /name="new_project_name"[^>]*disabled/);
    assert.doesNotMatch(html, /data-action="reading-new-topic"/);
  }
});

test("inline creation preserves draft fields and follows kind changes", () => {
  const ui = app();
  const group = ui.node("#f-project_id");
  group.id = "f-project_id";
  const option = ui.node("new-option");
  group.querySelector = () => option;
  group.value = "__new_section__";
  ui.node("#f-kind").value = "learning";
  ui.node("#f-title").value = "My unsaved title";
  ui.node("#f-new_project_name").value = "My unsaved topic";
  ui.emit("change", {target: group});
  assert.equal(ui.node("#new-section-field").classList.contains("hidden"), false);
  assert.equal(ui.node("#f-new_project_name").disabled, false);
  assert.equal(ui.node("#f-new_project_name").required, true);
  assert.match(option.textContent, /New learning topic/);
  ui.node("#f-kind").id = "f-kind";
  ui.node("#f-kind").value = "experience";
  ui.emit("change", {target: ui.node("#f-kind")});
  assert.match(option.textContent, /New experience section/);
  assert.equal(ui.node("#f-title").value, "My unsaved title");
  assert.equal(ui.node("#f-new_project_name").value, "My unsaved topic");
  group.id = "f-project_id";
  group.value = "databases";
  ui.emit("change", {target: group});
  assert.equal(ui.node("#f-new_project_name").disabled, true);
  assert.equal(ui.node("#f-new_project_name").required, false);
  assert.equal(ui.node("#new-section-field").classList.contains("hidden"), true);
});

test("reading creation submits a single item edit without a temporary section ID", async () => {
  const ui = app({items: [article]});
  ui.run('let saveReading, calls=[]; bindForm = callback => saveReading = callback; api = async (route,payload) => { calls.push({route,payload}); }; readingDialog("learn");');
  ui.context.form = new Map([["title", "My revised title"], ["kind", "learning"], ["project_id", "__new_section__"], ["new_project_name", "Query tuning"]]);
  await ui.run("saveReading(form)");
  assert.deepEqual(JSON.parse(ui.run("JSON.stringify(calls)")), [{route: "/api/item", payload: {id: "learn", title: "My revised title", kind: "learning", new_project_name: "Query tuning"}}]);
});

test("existing section choices ignore a previously entered new name", () => {
  const ui = app();
  ui.context.form = new Map([["project_id", "databases"], ["new_project_name", "An abandoned draft"]]);
  assert.deepEqual(JSON.parse(ui.run("JSON.stringify(organizationPayload(form))")), {project_id: "databases"});
});

test('late missing-reader recovery removes only its original save after navigation', async () => {
  const items = [{ ...draft, id: 'a', kind: 'learning' }, { ...draft, id: 'b', kind: 'learning' }];
  let rejectDetail, started;
  const opening = new Promise(resolve => { started = resolve; });
  const adapter = { epoch: 1, start() {}, api: async () => ({ items, projects: [], imports: [] }),
    detail: async () => new Promise((_resolve, reject) => { rejectDetail = reject; started(); }) };
  const ui = app({ items }, adapter);
  ui.run('initialLoad = false; view = "learning"; readerId = "a"; render = () => {}; scheduleRetrieval = () => {};');
  const refreshing = ui.run('refresh()');
  await opening;
  ui.run('readerId = "b"');
  rejectDetail(Object.assign(new Error('Removed remotely'), { code: 'NOT_FOUND' }));
  await refreshing;
  assert.equal(ui.run('readerId'), 'b');
  assert.equal(ui.run('JSON.stringify(state.items.map(item => item.id))'), '["b"]');
});

test('superseded hosted reading replies do not replace more recent progress in the UI', async () => {
  const item = { ...draft, revision: 3, reading: { status: 'reading', progress: 70 } };
  const adapter = { epoch: 1, start() {}, api: async () => ({ superseded: true, revision: 2, reading: { status: 'reading', progress: 20 } }) };
  const ui = app({ items: [item] }, adapter);
  await ui.run('changeReading("draft", {progress: 20})');
  assert.equal(ui.run('state.items[0].reading.progress'), 70);
  assert.equal(ui.run('state.items[0].revision'), 3);
});

test('the slash shortcut searches every space instead of retaining a reading topic', async () => {
  const ui = app({items: [article, draft]});
  let focused = false, prevented = false;
  ui.node('#search').focus = () => { focused = true; };
  ui.context.document.activeElement = {tagName: 'BODY'};
  ui.run('view = "learning"; projectFilter = "databases"; search = "old phrase"; readingFilter = "read";');
  ui.emit('keydown', {key: '/', preventDefault() { prevented = true; }});
  await new Promise(setImmediate);
  assert.equal(prevented, true);
  assert.equal(focused, true);
  assert.equal(ui.run('view'), 'inbox');
  assert.equal(ui.run('projectFilter'), '');
  assert.equal(ui.run('search'), '');
  assert.equal(ui.run('filter'), 'all');
  assert.equal(ui.context.location.hash, '#inbox');
});

test('dirty notes survive Escape and backdrop dismissal until explicitly discarded', async () => {
  const ui = app({items: [draft]});
  ui.run('contextDialog("draft")');
  const note = ui.node('#f-note'), source = ui.node('#f-content');
  note.value = 'A thought I have not saved'; source.value = draft.content;
  const dialog = ui.node('#modal'), prompt = ui.node('#discard-prompt');
  prompt.classList.add('hidden');
  let prevented = false;
  ui.events['#modal:cancel']({preventDefault() { prevented = true; }});
  assert.equal(prevented, true);
  assert.equal(dialog.open, true);
  assert.equal(prompt.classList.contains('hidden'), false);
  assert.equal(note.value, 'A thought I have not saved');
  await ui.events['document:click'][0]({target: {closest: () => ({dataset: {action: 'keep-editing'}})}});
  assert.equal(prompt.classList.contains('hidden'), true);
  assert.equal(ui.run('notesAreDirty()'), true);
  dialog.getBoundingClientRect = () => ({left: 100, top: 100, right: 500, bottom: 600});
  ui.events['#modal:click']({target: dialog, clientX: 20, clientY: 20});
  assert.equal(dialog.open, true);
  assert.equal(prompt.classList.contains('hidden'), false);
  await ui.events['document:click'][0]({target: {closest: () => ({dataset: {action: 'discard-notes'}})}});
  assert.equal(dialog.open, false);
  assert.equal(ui.run('notesDraft'), null);
  assert.equal(ui.run('state.items[0].note'), draft.note);
});

test('source edits trigger the same guard, clean notes close normally, and only dirty drafts warn before unload', () => {
  const ui = app({items: [draft]});
  ui.run('contextDialog("draft")');
  ui.node('#f-note').value = draft.note; ui.node('#f-content').value = draft.content;
  let prevented = false;
  ui.events.beforeunload({preventDefault() { prevented = true; }});
  assert.equal(prevented, false);
  ui.run('requestDialogClose()');
  assert.equal(ui.node('#modal').open, false);
  ui.run('contextDialog("draft")');
  ui.node('#f-content').value = 'A corrected source paragraph';
  const event = {preventDefault() { prevented = true; }};
  ui.events.beforeunload(event);
  assert.equal(prevented, true);
  assert.equal(event.returnValue, '');
  ui.run('requestDialogClose()');
  assert.equal(ui.node('#modal').open, true);
  assert.equal(ui.node('#f-content').value, 'A corrected source paragraph');
});

test('Today excerpts escape source content and never invent a passage for a notes-only save', () => {
  const ui = app({items: [{...article, content: '<img src=x onerror="bad()"> A source passage'}]});
  assert.match(ui.run('focusPage()'), /class="focus-excerpt">&lt;img/);
  assert.doesNotMatch(ui.run('focusPage()'), /<img/);
  ui.run('state.items[0].content = ""; state.items[0].excerpt = ""');
  assert.doesNotMatch(ui.run('focusPage()'), /class="focus-excerpt"/);
});
