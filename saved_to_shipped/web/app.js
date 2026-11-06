"use strict";

const $ = (s, root = document) => root.querySelector(s);
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const shapes = {
  arrow: "M5 12h14m-6-6 6 6-6 6",
  inbox: "M4 4h16v16H4z M4 13h5l2 3h2l2-3h5",
  grid: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  board: "M4 4h16v16H4z M9 4v16 M15 4v16",
  check: "m5 12 4 4L19 6",
  calendar: "M5 5h14v16H5z M8 3v4 M16 3v4 M5 10h14 M9 14h2 M14 14h2",
  upload: "M12 16V3m-5 5 5-5 5 5 M4 15v6h16v-6",
  plus: "M12 5v14 M5 12h14",
  search: "M20 20l-5-5 M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0",
  lock: "M6 10h12v11H6z M9 10V6a3 3 0 0 1 6 0v4",
  close: "m6 6 12 12 M18 6 6 18",
  spark: "m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z",
  link: "M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2 M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2",
  external: "M14 3h7v7 M21 3 10 14 M10 3H3v18h18v-7",
  download: "M12 3v12m-5-5 5 5 5-5 M4 17v4h16v-4",
  folder: "M3 5h7l2 3h9v12H3z",
  clock: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M12 7v5l3 2",
  leaf: "M20 3C8 1 1 9 6 16s15 2 14-13z M5 21 16 9",
  file: "M5 3h9l5 5v13H5z M14 3v6h5 M8 13h8 M8 17h6",
  note: "M4 4h16v12l-4 4H4z M8 8h8 M8 12h6 M15 20v-5h5",
  grip: "M9 5h.01 M15 5h.01 M9 12h.01 M15 12h.01 M9 19h.01 M15 19h.01",
};
const icon = (name) =>
  `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${shapes[name] || shapes.file}"/></svg>`;
const workspace =
  new URLSearchParams(location.search).get("workspace") === "demo"
    ? "demo"
    : "personal";
let state = { items: [], projects: [], imports: [] },
  view = "inbox",
  filter = "all",
  projectFilter = "",
  search = "",
  hours = 6,
  toastTimer,
  retrievalTimer,
  visibleLimit = 25,
  classificationCancelled = false;
let initialLoad = true;
let draggedTile = "", movingTile = false, suppressTileClick = false, pointerDrag = null;
const labels = {
  untriaged: "Needs context",
  project: "Build",
  learning: "Learn",
  experience: "Experience",
  reference: "Reference",
  skip: "Skip",
};
const retrievalLabels = {
  extracted: "Retrieved",
  partial: "Partial content",
  gated: "Login required",
  deleted: "Deleted post",
  error: "Retrieval error",
  missing: "No result",
  empty: "No usable text",
};
const statusLabels = {
  inbox: "To review",
  ready: "To do",
  doing: "In progress",
  done: "Done",
  parked: "Parked",
};
const apiURL = (route, query = "") =>
  `${route}?workspace=${workspace}${query ? "&" + query : ""}`;
async function api(route, data, query = "") {
  const response = await fetch(
    apiURL(route, query),
    data === undefined
      ? {}
      : {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Workbench-Token": state.token,
          },
          body: JSON.stringify(data),
        },
  );
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error || "Something went wrong. Try again.");
  return result;
}
async function refresh() {
  state = await api("/api/state");
  if (initialLoad) {
    restoreRoute();
    filter = reviewItems().length ? "review" : "all";
    initialLoad = false;
  }
  if (!draggedTile) render();
  scheduleRetrieval();
}
function toast(message) {
  const node = $("#toast");
  node.textContent = message;
  node.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove("visible"), 5500);
}
function projectName(id) {
  return state.projects.find((p) => p.id === id)?.name || "";
}
function category(item) {
  if (!item.has_context && item.enrichment)
    return retrievalLabels[item.enrichment.status] || "Needs context";
  return item.kind === "untriaged" && item.has_context
    ? "Ready to organize"
    : labels[item.kind] || item.kind;
}
function dateLabel(raw) {
  if (!raw) return "Date unknown";
  const date = new Date(raw);
  return Number.isNaN(date.getTime())
    ? raw
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function navigate(next, project = "") {
  view = next;
  projectFilter = project;
  filter = next === "inbox" && !project && reviewItems().length ? "review" : "all";
  search = "";
  visibleLimit = 25;
  history.pushState(null, "", `#${next}${project ? "?project=" + encodeURIComponent(project) : ""}`);
  render();
  window.scrollTo({ top: 0 });
  $("h1")?.focus({ preventScroll: true });
}
function restoreRoute() {
  const [route, query = ""] = location.hash.slice(1).split("?");
  view = ["inbox", "projects", "backlog", "week", "shipped"].includes(route) ? route : state.items.some(item => item.kind !== "untriaged") ? "backlog" : "inbox";
  projectFilter = new URLSearchParams(query).get("project") || "";
}
window.addEventListener("popstate", () => {
  restoreRoute();
  filter = "all";
  search = "";
  render();
});
function reviewItems() {
  return state.items.filter((item) => item.status === "inbox" && item.has_context && item.kind !== "untriaged");
}
function sidebar() {
  $("#sidebar").innerHTML =
    `<a class="brand" href="/?workspace=${workspace}" aria-label="Save2Ship home"><span class="brand-mark">${icon("arrow")}</span><span class="brand-name">save2ship<span class="brand-period">.</span></span></a>
  <nav class="nav" aria-label="Main navigation">${[
    ["inbox", "inbox", "Saves"],
    ["projects", "grid", "Projects"],
    ["backlog", "board", "Board"],
  ]
    .map(
      ([key, img, label]) =>
        `<button data-view="${key}" class="${view === key || (key === "backlog" && ["week", "shipped"].includes(view)) ? "active" : ""}" ${view === key || (key === "backlog" && ["week", "shipped"].includes(view)) ? 'aria-current="page"' : ""} title="${label}">${icon(img)}<span class="nav-name">${label}</span>${key === "inbox" && reviewItems().length ? `<span class="count">${reviewItems().length}</span>` : ""}</button>`,
    )
    .join("")}</nav>
  <div class="side-bottom"><button class="utility" data-action="import" aria-label="Import archive">${icon("upload")}<span>Import archive</span></button><button class="utility" data-action="settings" aria-label="Settings">${icon("lock")}<span>Settings</span></button><a class="utility" href="${workspace === "demo" ? "/" : "/?workspace=demo"}">${icon("leaf")}<span>${workspace === "demo" ? "My workspace" : "Try the demo"}</span></a><div class="local-label"><span class="dot"></span>Local workspace</div></div>`;
}
function topbar() {
  return `<div class="topbar"><span>${workspace === "demo" ? "THE PLAYGROUND" : "A LITTLE LESS SAVING. A LITTLE MORE DOING."}</span><button class="quiet-link" data-action="export">${icon("download")}Export</button></div>${workspace === "demo" ? '<div class="demo-banner"><span>Sample ideas, separate from your workspace.</span><a href="/">My workspace ↗</a></div>' : ""}`;
}
function heading(title, description, actions) {
  return `<div class="heading"><div><h1 tabindex="-1">${title}</h1><p>${description}</p></div>${actions ? `<div class="heading-actions">${actions}</div>` : ""}</div>`;
}
function empty(title, description, actions = "") {
  return `<div class="empty"><div class="empty-icon">${icon("leaf")}</div><h3>${title}</h3><p>${description}</p>${actions}</div>`;
}

function row(item) {
  const title = item.title || "Saved LinkedIn post";
  return `<div class="save-row"><button class="save-open" data-item="${item.id}" aria-label="${item.has_context ? "Review" : "Add context to"} ${esc(title)}"><span class="source-mark">${item.has_context ? icon(item.kind === "project" ? "spark" : "file") : "in"}</span><span class="save-text"><span class="save-title">${esc(title)}</span><span class="save-meta">${esc(item.author || "LinkedIn")}<span>·</span>${esc(dateLabel(item.saved_at))}${item.project_id ? `<span>·</span><span class="row-project">${esc(projectName(item.project_id))}</span>` : ""}</span></span><span class="pill ${esc(item.kind)}">${esc(category(item))}</span></button><button class="notes-button ${item.note ? "has-note" : ""}" data-action="notes" data-id="${item.id}" aria-label="Notes for ${esc(title)}" title="${item.note ? "Edit your notes" : "Add notes"}">${icon("note")}</button></div>`;
}
function table(items) {
  return `<div class="save-list">${items.length ? items.map(row).join("") : empty("Nothing here yet", search ? "Try a different search." : "Your saves will appear here as they move through your workspace.")}</div>`;
}
function inbox() {
  const scope = state.items.filter(item => !projectFilter || item.project_id === projectFilter);
  const reviews = reviewItems().filter(item => !projectFilter || item.project_id === projectFilter);
  const waiting = scope.filter((item) => !item.has_context);
  const items = scope.filter((item) =>
    (filter === "all" || (filter === "review" && reviews.some((review) => review.id === item.id)) || (filter === "context" && !item.has_context)) &&
    `${item.title} ${item.content} ${item.note} ${projectName(item.project_id)} ${(item.tags || []).join(" ")}`.toLowerCase().includes(search.toLowerCase())
  );
  if (!state.items.length) return heading("Good ideas deserve a next step.", "A calmer home for the things you want to build and learn.") + `<div class="welcome"><div class="welcome-mark">${icon("inbox")}</div><h2>Start with your saved posts.</h2><p>Import your LinkedIn archive. Recover the useful bits.<br>Leave with a few things worth doing.</p><button class="button primary" data-action="import">${icon("upload")}Import LinkedIn archive</button><a class="quiet-link" href="/?workspace=demo">Take a look around first ${icon("arrow")}</a><div class="welcome-note">Your archive stays on your device.</div></div>`;
  return heading(projectFilter ? esc(projectName(projectFilter)) : "Your saves, with somewhere to go.", projectFilter ? "Related ideas. One useful next step at a time." : `${state.items.length} saves · ${reviews.length} to review · ${waiting.length} waiting for content`, `<button class="button" data-action="capture">${icon("plus")}Add a link</button>`) +
    (projectFilter ? `<button class="quiet-link back-link" data-view="projects">← All projects</button>` : pipeline()) +
    `<div class="toolbar"><div class="tabs" aria-label="Filter saves">${[["review", "To review", reviews.length], ["all", "All saves", scope.length], ["context", "Waiting", waiting.length]].map(([key,label,count]) => `<button class="tab ${filter === key ? "selected" : ""}" data-filter="${key}" aria-pressed="${filter === key}">${label}<span>${count}</span></button>`).join("")}</div><label class="search">${icon("search")}<input id="search" placeholder="Search saves" aria-label="Search saves" value="${esc(search)}"><kbd>/</kbd></label></div>` + table(items.slice(0,visibleLimit)) + `${items.length > visibleLimit ? `<button class="button load-more" data-action="more">Show ${Math.min(25,items.length-visibleLimit)} more</button>` : ""}<div class="table-foot"><span>${items.length} ${items.length === 1 ? "save" : "saves"}${projectFilter ? " in this project" : ""}</span>${waiting.length && filter !== "context" && !projectFilter ? '<button class="quiet-link" data-action="retrieve">Process more saves ↗</button>' : ""}</div>`;
}
function projects() {
  return heading("A little direction.", `${state.projects.length} projects bringing related ideas together.`, '<button class="button" data-action="project">'+icon("plus")+'New project</button>') + `<div class="project-grid">${state.projects.length ? state.projects.map((project,index) => {
    const items = state.items.filter((item) => item.project_id === project.id);
    const active = items.filter((item) => ["ready","doing"].includes(item.status)).length;
    const done = items.filter((item) => item.status === "done").length;
    return `<button class="project-card" data-project="${project.id}"><span class="project-icon c${index%3}">${icon("folder")}</span><h2>${esc(project.name)}</h2>${project.description ? `<p>${esc(project.description)}</p>` : ""}<footer><span>${items.length} saves${active ? ` · ${active} active` : ""}${done ? ` · ${done} shipped` : ""}</span>${icon("arrow")}</footer></button>`;
  }).join("") : empty("Let a project take shape", "Organize your saves to find related ideas, or start a group of your own.", '<button class="button primary" data-view="inbox">Back to saves</button>')}</div>`;
}
function orderedTiles(items) {
  const rank = new Map((state.board_order || []).map((id,index) => [id,index]));
  return [...items].sort((a,b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity) || (b.score || 0) - (a.score || 0));
}
function task(item, draggable = false) {
  const title = item.title || "Untitled idea";
  return `<article class="task tile" data-tile-id="${item.id}" draggable="false" ${draggable ? 'data-draggable="true"' : ""} aria-label="${esc(title)}"><div class="tile-top"><span class="tile-kind ${esc(item.kind)}"><span></span>${esc(labels[item.kind])}</span>${draggable ? `<span class="drag-handle" aria-hidden="true" title="Drag to move">${icon("grip")}</span>` : ""}</div><h3><button class="save-title" data-item="${item.id}" draggable="false">${esc(title)}</button></h3><p class="task-preview">${esc(item.next_action)}</p><div class="tile-meta"><span class="task-project">${esc(projectName(item.project_id) || "Personal")}</span><span>${item.effort_hours}h</span></div><footer><button class="notes-button ${item.note ? "has-note" : ""}" data-action="notes" data-id="${item.id}" aria-label="Notes for ${esc(title)}" title="${item.note ? "Edit notes" : "Add notes"}">${icon("note")}<span>Notes</span></button><select class="move-select" data-move-id="${item.id}" aria-label="Move ${esc(title)}"><option value="">Move…</option>${Object.entries(statusLabels).filter(([key]) => key !== item.status).map(([key,label]) => `<option value="${key}">${label}</option>`).join("")}</select></footer></article>`;
}
function backlogTabs() {
  return `<div class="tabs backlog-tabs" aria-label="Board views">${[["backlog","Board"],["week","This week"],["shipped","Done"]].map(([key,label]) => `<button class="tab ${view===key ? "selected" : ""}" data-view="${key}" aria-pressed="${view===key}">${label}</button>`).join("")}</div>`;
}
function backlog() {
  const items = state.items.filter(item => !projectFilter || item.project_id === projectFilter);
  return heading("Your board.", "Drag ideas between stages. Arrange what comes next.", reviewItems().length ? '<button class="button" data-action="review-next">Review next '+icon("arrow")+'</button>' : "") +
    `<div class="board-toolbar">${backlogTabs()}<label class="board-filter"><span class="sr-only">Filter board by project</span><select id="board-project" aria-label="Filter board by project"><option value="">All projects</option>${state.projects.map(project => `<option value="${project.id}" ${projectFilter===project.id ? "selected" : ""}>${esc(project.name)}</option>`).join("")}</select></label></div>` +
    `<div class="board-scroll"><div class="board kanban" aria-label="Idea board" aria-busy="${movingTile}">${[["inbox","Review"],["ready","To do"],["doing","In progress"],["done","Done"]].map(([key,label]) => {
      const lane = orderedTiles(items.filter(item => item.status === key && item.kind !== "untriaged" && item.has_context));
      return `<section class="column" data-drop-status="${key}" aria-label="${label}"><div class="column-title"><span class="stage-dot ${key}"></span><h2>${label}</h2><small>${lane.length}</small></div><div class="lane-body">${lane.map(item => task(item,true)).join("")}<p class="lane-placeholder">${key === "inbox" ? "Organized ideas land here." : key === "ready" ? "Drop an idea to line it up." : key === "doing" ? "Make a little room to begin." : "A place for finished work."}</p></div></section>`;
    }).join("")}</div></div>${items.some(item => item.status === "parked") ? `<details class="parked-list"><summary>Parked · ${items.filter(item => item.status === "parked").length}</summary>${table(items.filter(item => item.status === "parked"))}</details>` : ""}`;
}
function week() {
  let remaining = hours;
  const selected = [];
  for (const item of state.items
    .filter(
      (i) => i.kind === "project" && ["ready", "doing"].includes(i.status),
    )
    .sort((a, b) => b.score - a.score)) {
    if (
      selected.length < 2 &&
      item.effort_hours > 0 &&
      item.effort_hours <= remaining
    ) {
      selected.push(item);
      remaining -= item.effort_hours;
    }
  }
  return (
    heading(
      "A little focus goes a long way.",
      "Pick a realistic slice of work for the time you actually have.",
      `<label class="budget">This week <input id="hours" type="number" min="0.25" max="168" step="0.25" value="${hours}" aria-label="Weekly time budget">hours</label>`,
    ) +
    backlogTabs() + `<div class="week-note">${selected.length ? `${selected.length} small build ${selected.length === 1 ? "task" : "tasks"} · ${Math.round((hours - remaining) * 100) / 100}h planned · ${Math.round(remaining * 100) / 100}h breathing room` : "No reviewed build tasks fit this budget yet."}<br>A maximum of two build tasks. Leave yourself room to finish.</div><div class="board">${selected.length ? selected.map(item => task(item)).join("") : empty("Make space for one good idea", "Review a build idea, set a next action, then add it to your backlog.", '<button class="button primary" data-view="inbox">Review saved ideas</button>')}</div>`
  );
}
function render() {
  sidebar();
  $("#main").classList.toggle("board-page", view === "backlog");
  $("#main").innerHTML =
    topbar() +
    {
      inbox,
      projects,
      backlog,
      week,
      shipped: () =>
        heading(
          "Look what you made.",
          "A small collection of things you followed through on.",
        ) + backlogTabs() + table(state.items.filter((i) => i.status === "done")),
    }[view]();
}
function modal(
  title,
  body,
  footer = '<button class="button" type="button" data-action="close">Close</button>',
  form = false,
) {
  const dialog = $("#modal");
  dialog.classList.toggle("review-dialog", body.includes('class="review-layout"'));
  dialog.innerHTML = `${form ? '<form id="dialog-form">' : ""}<div class="dialog-head"><h2 id="dialog-title">${title}</h2><button type="button" class="close" data-action="close" aria-label="Close dialog">${icon("close")}</button></div><div class="dialog-body"><div id="form-error" class="error-message hidden" role="alert"></div>${body}</div><div class="dialog-footer">${footer}</div>${form ? "</form>" : ""}`;
  if (!dialog.open) dialog.showModal();
}
function field(label, name, value = "", type = "input", attrs = "") {
  return `<div class="field"><label for="f-${name}">${label}</label>${type === "textarea" ? `<textarea id="f-${name}" name="${name}" ${attrs}>${esc(value)}</textarea>` : `<input id="f-${name}" name="${name}" value="${esc(value)}" ${attrs}>`}</div>`;
}
function select(label, name, options, value) {
  return `<div class="field"><label for="f-${name}">${label}</label><select id="f-${name}" name="${name}">${options.map(([key, label]) => `<option value="${esc(key)}" ${key === value ? "selected" : ""}>${esc(label)}</option>`).join("")}</select></div>`;
}
function bindForm(callback) {
  $("#dialog-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const buttons = [...$("#dialog-form").querySelectorAll("[type=submit]")];
    buttons.forEach(button => button.disabled = true);
    $("#form-error").classList.add("hidden");
    try {
      const next = await callback(new FormData(e.currentTarget), e.submitter);
      $("#modal").close();
      await refresh();
      if (next?.nextItem) itemDialog(next.nextItem);
      if (next?.completedReview) navigate("backlog");
      if (next?.afterRefresh) next.afterRefresh();
    } catch (error) {
      $("#form-error").textContent = error.message;
      $("#form-error").classList.remove("hidden");
      $("#form-error").scrollIntoView({ block: "nearest" });
    } finally {
      buttons.forEach(button => button.disabled = false);
    }
  });
}
function captureDialog() {
  modal(
    "Catch a good idea",
    `<p>No archive yet? Add a LinkedIn link and paste the post text or a personal note.</p>${field("LinkedIn post or article URL", "url", "", "input", 'type="url" required placeholder="https://www.linkedin.com/posts/…"')}${field("Give it a title", "title", "", "input", 'maxlength="300" placeholder="What caught your eye?"')}${field("Post text", "content", "", "textarea", 'placeholder="Paste the part you want to keep…"')}${field("Your note", "note", "", "textarea", 'placeholder="Why did you save it? What could you make with it?"')}`,
    '<button class="button" type="button" data-action="close">Cancel</button><button class="button primary" type="submit">Add to inbox</button>',
    true,
  );
  bindForm(async (form) => {
    await api("/api/capture", Object.fromEntries(form));
    toast("Idea captured. Give it context, then classify it.");
  });
}
function projectDialog() {
  modal(
    "Make room for a project",
    field(
      "Project name",
      "name",
      "",
      "input",
      'required maxlength="100" placeholder="e.g. My AI playground"',
    ) +
      field(
        "What are you working toward?",
        "description",
        "",
        "textarea",
        'maxlength="2000" placeholder="A small outcome you would like to make real."',
      ),
    '<button class="button" type="button" data-action="close">Cancel</button><button class="button primary" type="submit">Create project</button>',
    true,
  );
  bindForm(async (form) => {
    await api("/api/project", Object.fromEntries(form));
    toast("Project created. Assign ideas from their review panel.");
  });
}
function effortChoices(current) {
  const values = [0.25,0.5,0.75,1,1.25,1.5,1.75,2];
  if (!values.includes(current)) values.push(current);
  return values.sort((a,b) => a-b).map(value => [String(value), value < 1 ? `${value * 60} minutes` : `${value} ${value === 1 ? "hour" : "hours"}`]);
}
function contextDialog(id) {
  const item = state.items.find(candidate => candidate.id === id);
  if (!item) return;
  modal("A little context, on your terms.",
    `<div class="context-header"><h3>${esc(item.title || "Saved LinkedIn post")}</h3><a class="quiet-link" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">Original post ${icon("external")}</a></div><p>A place for why you saved this, a question, or something you want to try.</p>${field("Your notes", "note", item.note, "textarea", 'rows="7" maxlength="20000" placeholder="What makes this interesting to you?"')}<details><summary>Post text</summary><p class="helper">Paste or correct the source text here. Your notes stay separate.</p>${field("Source text", "content", item.content, "textarea", 'rows="8" maxlength="20000" placeholder="Paste the post text…"')}</details>`,
    '<button class="button" type="button" data-action="close">Cancel</button><button class="button primary" type="submit">Save context</button>', true);
  bindForm(async form => {
    const payload = {id};
    for (const key of ["note", "content"]) {
      if (form.get(key) !== (item[key] || "")) payload[key] = form.get(key);
    }
    if (Object.keys(payload).length > 1) await api("/api/item", payload);
    toast("Context saved.");
  });
}
function itemDialog(id) {
  const item = state.items.find((i) => i.id === id);
  if (!item) return;
  const draft = item.status === "inbox" && item.kind !== "untriaged";
  const queue = reviewItems().filter(candidate => !projectFilter || candidate.project_id === projectFilter);
  const coverage = item.enrichment;
  const compact = window.matchMedia("(max-width: 800px)").matches;
  modal(
    draft ? "One idea. One next step." : "Your saved idea",
    `<div class="review-layout"><section class="source-panel"><div class="eyebrow">THE INSPIRATION</div><h2>${esc(item.title || "Saved LinkedIn post")}</h2><div class="source-byline">${esc(item.author || "LinkedIn")} · ${esc(dateLabel(item.saved_at))}<a class="quiet-link" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">Original ${icon("external")}</a></div>${item.metadata?.synthetic ? '<div class="coverage-note">Synthetic sample content.</div>' : ""}${coverage ? `<div class="coverage-note ${coverage.status === "partial" ? "partial" : ""}">${icon(coverage.status === "partial" ? "file" : "check")}${esc(retrievalLabels[coverage.status] || coverage.status)} · ${esc(coverage.coverage || "No readable text returned")}${coverage.content_truncated ? ". Text shortened to 20,000 characters." : ""}</div>` : ""}<details class="read-source" ${compact ? "" : "open"}><summary>${item.content ? "Read post text" : "Read saved context"}</summary><div class="post-text">${esc(item.content || item.note || "The archive contains this post's link. Use Notes on the save to add context, or retrieve its text.")}</div></details>${coverage?.links?.length ? `<details class="source-links"><summary>${coverage.links.length} links from this post</summary>${coverage.links.slice(0,30).map(link => `<a class="quiet-link" href="${esc(link)}" target="_blank" rel="noopener noreferrer">${esc(link)} ${icon("external")}</a>`).join("")}</details>` : ""}</section><section class="action-panel"><div class="eyebrow">MAKE IT USEFUL</div>${item.classification_method ? `<p class="suggestion-note">Draft from ${esc(item.classification_method)} · ${esc(item.confidence)} confidence</p>` : '<p class="suggestion-note">Add context, then organize this save or shape a task yourself.</p>'}${field("Working title", "title", item.title, "input", 'maxlength="300" placeholder="Give the idea a short name"')}${field("Next action", "next_action", item.next_action, "textarea", 'placeholder="One small thing you can do in under two hours."')}${field("Done when", "definition_of_done", item.definition_of_done, "textarea", 'placeholder="A result you can point to."')}<div class="field-row">${select("Project", "project_id", [["", "No project"], ...state.projects.map(p => [p.id,p.name])], item.project_id || "")}${select("Time to make a start", "effort_hours", effortChoices(item.effort_hours || 1), String(item.effort_hours || 1))}</div><details><summary>More details</summary>${select("Kind of idea", "kind", Object.entries(labels).map(([key,label]) => [key,key === "untriaged" ? "Not organized yet" : label]),item.kind)}${select("Status", "status", Object.entries(statusLabels),item.status)}${item.why ? `<p>${esc(item.why)}</p>` : ""}${field("Result / commit / PR link", "outcome_url", item.outcome_url || "", "input", 'type="url" placeholder="https://github.com/…"')}</details></section></div>`,
    `${draft ? `<span class="review-count">${queue.length} ${queue.length === 1 ? "idea" : "ideas"} left to review</span><button class="button ghost" type="submit" name="decision" value="parked">Park for later</button>` : ""}<button class="button" type="submit" name="decision" value="save">${draft ? "Save draft" : "Save changes"}</button>${draft ? '<button class="button primary" type="submit" name="decision" value="ready">Add to backlog '+icon("arrow")+'</button>' : ""}`,
    true,
  );
  bindForm(async (form, submitter) => {
    const payload = Object.fromEntries(form);
    payload.id = id;
    payload.effort_hours = Number(payload.effort_hours);
    const decision = submitter?.value;
    if (["ready","parked"].includes(decision)) payload.status = decision;
    await api("/api/item", payload);
    toast(decision === "ready" ? "Added to your backlog." : decision === "parked" ? "Parked. Come back when it feels useful." : "Changes saved.");
    if (draft && ["ready","parked"].includes(decision)) {
      const next = queue.find(candidate => candidate.id !== id);
      return next ? { nextItem: next.id } : { completedReview: true };
    }
  });
}
function importDialog() {
  modal(
    "Bring your saves in.",
    `<p>Choose your LinkedIn data export. We’ll find the saved posts and keep your existing notes intact.</p><label class="dropzone" id="dropzone" for="archive-file">${icon("upload")}<strong>Drop your LinkedIn archive here</strong>or choose a ZIP / Saved Items CSV (up to 128 MiB)<input id="archive-file" type="file" accept=".zip,.csv" required></label><p class="helper">Re-import any time. Duplicate saves are skipped and your notes stay intact.</p><p>Need a test file? <a class="inline-link" href="${apiURL("/api/sample")}">Download a synthetic test ZIP</a> or <a class="inline-link" href="/?workspace=demo">explore the demo</a>.</p><p class="helper"><a href="https://www.linkedin.com/help/linkedin/answer/a1341346" target="_blank" rel="noopener noreferrer">How to request your Saved Items archive ↗</a></p>${state.imports.length ? `<div class="history"><strong>Last import</strong><br>${esc(state.imports[0].filename)} · ${state.imports[0].added} new · ${state.imports[0].duplicates} duplicates</div>` : ""}`,
    '<button class="button" type="button" data-action="close">Cancel</button><button class="button primary" type="submit">Import saves</button>',
    true,
  );
  const drop = $("#dropzone");
  drop.addEventListener("dragover", (e) => e.preventDefault());
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    $("#archive-file").files = e.dataTransfer.files;
  });
  bindForm(async () => {
    const file = $("#archive-file").files[0];
    if (!file) throw new Error("Choose a LinkedIn ZIP or CSV first.");
    if (file.size > 128 * 1024 * 1024)
      throw new Error(
        "The archive exceeds 128 MiB. Import Saved_Items.csv directly.",
      );
    const response = await fetch(
      apiURL("/api/import", "filename=" + encodeURIComponent(file.name)),
      {
        method: "POST",
        headers: { "X-Workbench-Token": state.token },
        body: file,
      },
    );
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    navigate("inbox");
    toast(`${result.added} saves added. ${result.duplicates} duplicates skipped.`);
  });
}
function classifyDialog() {
  const eligible = state.items.filter(i => i.kind === "untriaged" && i.has_context && i.status === "inbox").length;
  const ai = state.ai?.available;
  modal("Find the useful next steps.",
    `<div class="dialog-intro"><span class="intro-number">${eligible}</span><p>readable saves ready to organize.<br>Related ideas become projects, with small next steps to review.</p></div>${ai ? `<p>Use your OpenAI key to organize up to 20 saves per batch. Selected post text, notes, and goals are sent to OpenAI. API charges apply.</p><button class="button primary wide" data-action="run-ai" ${eligible ? "" : "disabled"}>${icon("spark")}Organize ${Math.min(20,eligible)} ${eligible === 1 ? "save" : "saves"}</button><details><summary>Batch options</summary><label class="checkbox"><input id="classify-all" type="checkbox"> Continue through all ${eligible} readable saves (additional API usage)</label></details>` : `<p>Start with offline suggestions, or connect OpenAI for more specific actions and groups.</p><button class="button primary wide" data-action="run-classify" ${eligible ? "" : "disabled"}>${icon("spark")}Organize with local rules</button><button class="quiet-link" data-action="settings">Connect OpenAI in Settings ↗</button>`}<details><summary>${ai ? "Other ways to organize" : "Use ChatGPT instead"}</summary>${ai ? `<p>Local rules use keywords and run offline. Suggestions are marked low confidence.</p><button class="button" data-action="run-classify" ${eligible ? "" : "disabled"}>Use local rules</button>` : ""}<p>Download a prompt, use it in ChatGPT, then paste the JSON response.</p><a class="quiet-link" href="${apiURL("/api/prompt")}">${icon("download")}Download prompt</a><div class="field"><label for="triage-json">ChatGPT response</label><textarea id="triage-json" rows="5" placeholder='{"items": [...]}'></textarea></div><button class="button" data-action="apply-triage">Apply response</button></details>`);
}
document.addEventListener("click", async (e) => {
  const button = e.target.closest(
    "[data-view],[data-item],[data-project],[data-filter],[data-action],[data-status]",
  );
  if (!button) return;
  try {
    if (button.dataset.status) {
      button.disabled = true;
      await api("/api/item", { id: button.dataset.id, status: button.dataset.status });
      await refresh();
      toast(button.dataset.status === "done" ? "One idea, shipped." : "Task started.");
      return;
    }
    if (button.dataset.view) return navigate(button.dataset.view);
    if (suppressTileClick) return;
    if (button.dataset.item) {
      const item = state.items.find(candidate => candidate.id === button.dataset.item);
      return item && !item.has_context ? contextDialog(item.id) : itemDialog(button.dataset.item);
    }
    if (button.dataset.project)
      return navigate("inbox", button.dataset.project);
    if (button.dataset.filter) {
      filter = button.dataset.filter;
      visibleLimit = 25;
      return render();
    }
    switch (button.dataset.action) {
      case "notes":
        contextDialog(button.dataset.id);
        break;
      case "review-next":
        if (reviewItems().length) itemDialog(reviewItems()[0].id);
        break;
      case "settings":
        settingsDialog();
        break;
      case "retrieve":
        retrievalDialog();
        break;
      case "poll-retrieval":
        await pollRetrieval(true);
        break;
      case "stop-retrieval":
        await api("/api/retrieve/stop", {});
        await refresh();
        retrievalDialog();
        break;
      case "dismiss-retrieval":
        await api("/api/retrieve/dismiss", {});
        $("#modal").close();
        await refresh();
        break;
      case "more":
        visibleLimit += 25;
        render();
        break;
      case "close":
        $("#modal").close();
        break;
      case "capture":
        captureDialog();
        break;
      case "import":
        importDialog();
        break;
      case "project":
        projectDialog();
        break;
      case "classify":
        classifyDialog();
        break;
      case "clear-project":
        projectFilter = "";
        render();
        break;
      case "export":
        location.href = apiURL("/api/export", "hours=" + hours);
        break;
      case "run-classify": {
        button.disabled = true;
        const result = await api("/api/classify", {});
        filter = "review";
        $("#modal").close();
        await refresh();
        toast(
          `${result.classified} draft ${result.classified === 1 ? "suggestion is" : "suggestions are"} ready. Open an idea to review its next step.`,
        );
        break;
      }
      case "run-ai": {
        button.disabled = true;
        classificationCancelled = false;
        const all = $("#classify-all")?.checked;
        let total = 0;
        do {
          button.textContent = `Classifying… ${total} done`;
          const result = await api("/api/classify-ai", {});
          total += result.classified;
          filter = "review";
          await refresh();
          if (!result.classified) break;
        } while (
          all &&
          !classificationCancelled &&
          state.items.some(
            (i) =>
              i.kind === "untriaged" && i.has_context && i.status === "inbox",
          )
        );
        $("#modal").close();
        toast(`${total} AI drafts ready for your review.`);
        break;
      }
      case "apply-triage": {
        const payload = JSON.parse($("#triage-json").value);
        button.disabled = true;
        const result = await api(
          "/api/triage",
          Array.isArray(payload) ? { items: payload } : payload,
        );
        $("#modal").close();
        await refresh();
        toast(`${result.classified} ideas classified.`);
        break;
      }
    }
  } catch (error) {
    button.disabled = false;
    if ($("#modal").open) {
      $("#form-error").textContent = error.message;
      $("#form-error").classList.remove("hidden");
    } else toast(error.message);
  }
});
function dropDestination(column, y) {
  const tiles = [...column.querySelectorAll("[data-tile-id]")].filter(tile => tile.dataset.tileId !== draggedTile);
  const before = tiles.find(tile => {
    const rect = tile.getBoundingClientRect();
    return y < rect.top + rect.height / 2;
  });
  return { status: column.dataset.dropStatus, before_id: before?.dataset.tileId || null };
}
function clearDropMarker() {
  document.querySelectorAll(".column.drop-active").forEach(column => column.classList.remove("drop-active"));
  $("#drop-marker")?.remove();
}
async function moveTile(id, status, before = null) {
  if (movingTile) return false;
  movingTile = true;
  $(".kanban")?.setAttribute("aria-busy", "true");
  document.querySelectorAll("[data-move-id]").forEach(select => select.disabled = true);
  try {
    await api("/api/move", { id, status, before_id: before });
    await refresh();
    toast(`Moved to ${statusLabels[status].toLowerCase()}.`);
    $(`[data-tile-id="${id}"] .save-title`)?.focus({ preventScroll: true });
    return true;
  } catch (error) {
    // A timed-out response may have saved. Reconcile instead of guessing or resubmitting.
    await refresh().catch(() => {});
    toast(error.message);
    return false;
  } finally {
    movingTile = false;
    $(".kanban")?.setAttribute("aria-busy", "false");
    document.querySelectorAll("[data-move-id]").forEach(select => select.disabled = false);
  }
}
function showDropTarget(column, y) {
  const destination = dropDestination(column, y);
  clearDropMarker();
  column.classList.add("drop-active");
  const marker = document.createElement("div");
  marker.id = "drop-marker";
  marker.setAttribute("aria-hidden", "true");
  const anchor = destination.before_id ? column.querySelector(`[data-tile-id="${destination.before_id}"]`) : null;
  column.querySelector(".lane-body").insertBefore(marker, anchor);
}
function finishPointerDrag(destination = null) {
  const active = pointerDrag;
  const id = draggedTile;
  pointerDrag = null;
  draggedTile = "";
  clearDropMarker();
  $("#drag-preview")?.remove();
  if (active) {
    active.tile.classList.remove("dragging");
    if (active.tile.hasPointerCapture(active.pointerId)) active.tile.releasePointerCapture(active.pointerId);
  }
  if (id) {
    setTimeout(() => suppressTileClick = false, 150);
    if (destination) void moveTile(id, destination.status, destination.before_id);
    else render();
  }
}
document.addEventListener("pointerdown", event => {
  const tile = event.target.closest('[data-draggable="true"]');
  if (!tile || movingTile || event.button !== 0 || event.target.closest("button,input,select,textarea,a")) return;
  if (event.pointerType === "touch" && !event.target.closest(".drag-handle")) return;
  const rect = tile.getBoundingClientRect();
  pointerDrag = {tile, pointerId: event.pointerId, x: event.clientX, y: event.clientY,
                 offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top, width: rect.width};
  tile.setPointerCapture(event.pointerId);
  if (event.target.closest(".drag-handle")) event.preventDefault();
});
document.addEventListener("pointermove", event => {
  if (!pointerDrag || event.pointerId !== pointerDrag.pointerId) return;
  if (!draggedTile) {
    if (Math.hypot(event.clientX - pointerDrag.x, event.clientY - pointerDrag.y) < 6) return;
    draggedTile = pointerDrag.tile.dataset.tileId;
    suppressTileClick = true;
    pointerDrag.tile.classList.add("dragging");
    const preview = pointerDrag.tile.cloneNode(true);
    preview.id = "drag-preview";
    preview.classList.remove("dragging");
    preview.removeAttribute("data-tile-id");
    preview.removeAttribute("data-draggable");
    preview.setAttribute("aria-hidden", "true");
    preview.inert = true;
    preview.style.width = pointerDrag.width + "px";
    document.body.appendChild(preview);
  }
  event.preventDefault();
  const preview = $("#drag-preview");
  preview.style.left = (event.clientX - pointerDrag.offsetX) + "px";
  preview.style.top = (event.clientY - pointerDrag.offsetY) + "px";
  const column = document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-drop-status]");
  if (column) showDropTarget(column, event.clientY);
  else clearDropMarker();
});
document.addEventListener("pointerup", event => {
  if (!pointerDrag || event.pointerId !== pointerDrag.pointerId) return;
  const column = document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-drop-status]");
  finishPointerDrag(draggedTile && column ? dropDestination(column, event.clientY) : null);
});
document.addEventListener("pointercancel", () => finishPointerDrag());
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && pointerDrag) {
    event.preventDefault();
    finishPointerDrag();
  }
});
document.addEventListener("dragstart", event => {
  if (event.target.closest('[data-draggable="true"]')) event.preventDefault();
});
document.addEventListener("input", (e) => {
  if (e.target.id === "search") {
    const cursor = e.target.selectionStart;
    search = e.target.value;
    visibleLimit = 25;
    render();
    $("#search").focus();
    $("#search").setSelectionRange(cursor, cursor);
  }
});
document.addEventListener("change", async (e) => {
  if (e.target.dataset.moveId && e.target.value) {
    await moveTile(e.target.dataset.moveId, e.target.value);
    e.target.value = "";
    return;
  }
  if (e.target.id === "board-project") {
    projectFilter = e.target.value;
    history.replaceState(null, "", `#backlog${projectFilter ? "?project=" + encodeURIComponent(projectFilter) : ""}`);
    return render();
  }
  if (e.target.id === "hours") {
    const value = Number(e.target.value);
    if (!Number.isFinite(value) || value <= 0 || value > 168) {
      e.target.value = hours;
      return toast("Choose a time budget between 0 and 168 hours.");
    }
    hours = value;
    render();
  }
});
document.addEventListener("keydown", (e) => {
  if (
    e.key === "/" &&
    !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName) &&
    !$("#modal").open
  ) {
    e.preventDefault();
    $("#search")?.focus();
  }
});
$("#modal").addEventListener("close", () => {
  classificationCancelled = true;
});
$("#modal").addEventListener("click", (e) => {
  if (e.target === $("#modal")) {
    const rect = e.target.getBoundingClientRect();
    if (
      e.clientX < rect.left ||
      e.clientX > rect.right ||
      e.clientY < rect.top ||
      e.clientY > rect.bottom
    )
      e.target.close();
  }
});
refresh().catch((error) => {
  $("#main").innerHTML =
    `<div class="empty"><h3>Could not open the workbench</h3><p>${esc(error.message)} Make sure server.py is running, then reload.</p></div>`;
});
