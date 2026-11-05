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
  toastTimer;
const labels = {
  untriaged: "Needs context",
  project: "Build",
  learning: "Learn",
  experience: "Experience",
  reference: "Reference",
  skip: "Skip",
};
const statusLabels = {
  inbox: "Inbox / review",
  ready: "Ready",
  doing: "In progress",
  done: "Shipped",
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
  render();
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
  return item.kind === "untriaged" && item.has_context
    ? "Ready to classify"
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
  filter = "all";
  search = "";
  render();
  window.scrollTo({ top: 0 });
}
function sidebar() {
  $("#sidebar").innerHTML =
    `<a class="brand" href="/?workspace=${workspace}" aria-label="Saved to Shipped home"><span class="brand-mark">${icon("arrow")}</span><span class="brand-name">saved<span> to </span>shipped<span class="brand-period">.</span></span></a>
  <div class="eyebrow nav-label">Your workspace</div><nav class="nav" aria-label="Main navigation">${[
    ["inbox", "inbox", "Saved inbox"],
    ["projects", "grid", "Projects"],
    ["backlog", "board", "Backlog"],
    ["week", "calendar", "This week"],
    ["shipped", "check", "Shipped"],
  ]
    .map(
      ([key, img, label]) =>
        `<button data-view="${key}" class="${view === key ? "active" : ""}" ${view === key ? 'aria-current="page"' : ""} title="${label}">${icon(img)}<span class="nav-name">${label}</span>${key === "inbox" ? `<span class="count">${state.items.filter((i) => i.status === "inbox").length}</span>` : ""}</button>`,
    )
    .join("")}</nav>
  <div class="side-projects"><div class="eyebrow nav-label">Your projects</div>${
    state.projects
      .slice(0, 5)
      .map(
        (p, i) =>
          `<button class="project-nav" data-project="${p.id}"><span class="dot c${i % 3}"></span>${esc(p.name)}</button>`,
      )
      .join("") ||
    '<div class="project-nav">Make room for your next idea.</div>'
  }<button class="project-nav" data-action="project">${icon("plus")}New project</button></div>
  <div class="side-bottom"><div class="local-label"><span class="dot"></span>Stored on this device</div><p>A little less collecting.<br>A little more creating.</p><a class="workspace-link" href="${workspace === "demo" ? "/" : "/?workspace=demo"}">${workspace === "demo" ? "Back to my workspace" : "Explore the sample workspace"} ${icon("arrow")}</a></div>`;
}
function topbar() {
  return `<div class="topbar"><div class="breadcrumb">Workspace <span>/</span> <strong>${{ inbox: "Saved inbox", projects: "Projects", backlog: "Backlog", week: "This week", shipped: "Shipped" }[view]}</strong></div><div class="top-actions"><span class="private">${icon("lock")}Local & personal</span><button class="button small" data-action="import">${icon("upload")}Import archive</button><div class="avatar" title="Personal workspace">${workspace === "demo" ? "D" : "ME"}</div></div></div>${workspace === "demo" ? '<div class="demo-banner"><span>Sample workspace · All posts are synthetic. Your personal saves stay separate.</span><a href="/">My workspace ↗</a></div>' : ""}`;
}
function heading(title, description, actions) {
  return `<div class="heading"><div><h1>${title}</h1><p>${description}</p></div><div class="heading-actions">${actions || ""}</div></div>`;
}
function empty(title, description, actions = "") {
  return `<div class="empty"><div class="empty-icon">${icon("leaf")}</div><h3>${title}</h3><p>${description}</p>${actions}</div>`;
}
function stats() {
  const vals = [
    [state.items.length, "Saved ideas", "inbox", "collected"],
    [state.projects.length, "Projects taking shape", "grid", "in motion"],
    [
      state.items.filter((i) => ["ready", "doing"].includes(i.status)).length,
      "Ready to work on",
      "board",
      "next steps",
    ],
    [
      state.items.filter((i) => i.status === "done").length,
      "Ideas shipped",
      "check",
      "made real",
    ],
  ];
  return `<div class="stats">${vals.map(([value, label, img, note]) => `<div class="stat"><div class="stat-top">${label}${icon(img)}</div><div class="stat-value">${value}<small>${note}</small></div></div>`).join("")}</div>`;
}
function row(item) {
  return `<div class="save-row"><div class="save-main"><span class="source-mark" title="LinkedIn">in</span><div class="save-text"><button class="save-title" data-item="${item.id}">${esc(item.title || "A saved idea waiting for a title")}</button><div class="save-meta">${esc(item.author || "LinkedIn save")}<span>·</span>${esc(dateLabel(item.saved_at))}<span>·</span>${!item.has_context ? "Add post text or notes" : item.status === "inbox" ? "In your inbox" : esc(statusLabels[item.status])}</div></div></div><span class="pill ${esc(item.kind)}">${esc(category(item))}</span><span class="project-cell">${item.project_id ? `<span class="dot"></span>${esc(projectName(item.project_id))}` : "Unassigned"}</span><button class="row-arrow" data-item="${item.id}" aria-label="Review ${esc(item.title || "saved idea")}">${icon("arrow")}</button></div>`;
}
function table(items) {
  return `<div class="table"><div class="table-head"><span>Saved idea</span><span>Destination</span><span class="project-cell">Project</span><span></span></div>${items.length ? items.map(row).join("") : empty(state.items.length ? "A clean slate here" : "Your next project is hiding in your saves", state.items.length ? "Try another filter, or add a new save." : "Import your LinkedIn archive, capture a post with a note, or explore the sample workspace.", state.items.length ? "" : `<button class="button primary" data-action="import">${icon("upload")}Import LinkedIn archive</button><a class="button" href="/?workspace=demo">Try the demo ${icon("arrow")}</a>`)}</div>`;
}
function inbox() {
  const candidates = state.items.filter(
    (i) => i.kind === "untriaged" && i.has_context && i.status === "inbox",
  );
  const items = state.items.filter(
    (i) =>
      (!projectFilter || i.project_id === projectFilter) &&
      (filter === "all" ||
        (filter === "context" && !i.has_context) ||
        (filter === "review" && i.status === "inbox" && i.has_context) ||
        (filter === "project" && i.kind === "project")) &&
      `${i.title} ${i.content} ${i.note} ${(i.tags || []).join(" ")}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    heading(
      "Good saves. Great starting points.",
      "A home for the ideas you want to do something with.",
      `<button class="button" data-action="capture">${icon("plus")}Add a save</button><button class="button primary" data-action="classify">${icon("spark")}Classify inbox${candidates.length ? ` <span>(${candidates.length})</span>` : ""}</button>`,
    ) +
    `<section class="hero"><div class="hero-text"><div class="eyebrow">From “someday” to shipped</div><h2>You saved it for a reason.<br><span>Give it a next step.</span></h2><p>Turn the things that caught your eye into small projects,<br>useful experiments, and work you can point to.</p></div><div class="hero-art" aria-hidden="true"><div class="orbit"></div><div class="mini-card">${icon("inbox")}<div class="line"></div><div class="line short"></div></div><div class="mini-card front">${icon("check")}<div class="line"></div><div class="line short"></div></div><span class="spark">✧</span></div></section>` +
    stats() +
    `<div class="section-head"><div class="section-title">Your saved ideas <small>${state.items.length} total</small></div><button class="button ghost small" data-action="export">${icon("download")}Export backlog</button></div>${projectFilter ? `<button class="project-filter" data-action="clear-project">${esc(projectName(projectFilter))} ${icon("close")}</button>` : ""}<div class="toolbar"><div class="tabs">${[
      ["all", "All saves"],
      ["review", "To review"],
      ["context", "Needs context"],
      ["project", "Build ideas"],
    ]
      .map(
        ([key, label]) =>
          `<button class="tab ${filter === key ? "selected" : ""}" data-filter="${key}">${label}</button>`,
      )
      .join(
        "",
      )}</div><label class="search">${icon("search")}<input id="search" placeholder="Find an idea…" aria-label="Search saved ideas" value="${esc(search)}"><kbd>/</kbd></label></div>${table(items)}<div class="table-foot"><span>${items.length} ${items.length === 1 ? "idea" : "ideas"}${search ? " matching your search" : ""}</span><span>${icon("lock")}Saved locally. AI is optional.</span></div>`
  );
}
function projects() {
  return (
    heading(
      "A place for every possibility.",
      "Group related saves around something you want to make.",
      `<button class="button primary" data-action="project">${icon("plus")}New project</button>`,
    ) +
    `<div class="project-grid">${
      state.projects.length
        ? state.projects
            .map((p, index) => {
              const items = state.items.filter((i) => i.project_id === p.id),
                done = items.filter((i) => i.status === "done").length;
              return `<button class="project-card" data-project="${p.id}"><div class="project-icon">${icon(index % 2 ? "folder" : "spark")}</div><h3>${esc(p.name)}</h3><p>${esc(p.description || "Related ideas, one small next step at a time.")}</p><div class="progress"><span data-progress="${items.length ? Math.round((done / items.length) * 100) : 0}"></span></div><footer><span>${items.length} saved ${items.length === 1 ? "idea" : "ideas"}</span><span>${done} shipped ${icon("arrow")}</span></footer></button>`;
            })
            .join("")
        : empty(
            "Start with one project",
            "Create a project, then assign saves to it. Classification can also suggest groups for context-backed ideas.",
            '<button class="button primary" data-action="project">Create a project</button>',
          )
    }</div>`
  );
}
function task(item) {
  return `<article class="task"><span class="pill ${esc(item.kind)}">${esc(labels[item.kind])}</span><h3><button class="save-title" data-item="${item.id}">${esc(item.title)}</button></h3><p>${esc(item.next_action)}</p><footer><span class="task-meta">${icon("clock")}${esc(item.effort_hours)}h ${item.project_id ? " · " + esc(projectName(item.project_id)) : ""}</span><button data-item="${item.id}">Open ${item.status === "done" ? "result" : "task"} ↗</button></footer></article>`;
}
function backlog() {
  return (
    heading(
      "Less backlog. More forward.",
      "Small, reviewed next steps. Move one idea into motion.",
      `<button class="button" data-action="export">${icon("download")}Export tasks</button>`,
    ) +
    `<div class="board">${[
      ["ready", "Ready to start"],
      ["doing", "In progress"],
      ["done", "Shipped"],
    ]
      .map(([key, label]) => {
        const items = state.items
          .filter((i) => i.status === key)
          .sort((a, b) => b.score - a.score);
        return `<section class="column"><div class="column-title"><span class="dot ${key === "done" ? "c1" : ""}"></span>${label}<small>${items.length}</small></div>${items.length ? items.map(task).join("") : '<p class="helper">' + (key === "ready" ? "Review a classified idea and add it to your backlog." : key === "doing" ? "Open a ready task and change its status to In progress." : "Your finished ideas will live here.") + "</p>"}</section>`;
      })
      .join(
        "",
      )}</div>${state.items.some((i) => i.status === "parked") ? `<div class="section-head heading"><div class="section-title">Parked ideas</div></div>${table(state.items.filter((i) => i.status === "parked"))}` : ""}`
  );
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
    `<div class="week-note">${selected.length ? `${selected.length} small build ${selected.length === 1 ? "task" : "tasks"} · ${Math.round((hours - remaining) * 100) / 100}h planned · ${Math.round(remaining * 100) / 100}h breathing room` : "No reviewed build tasks fit this budget yet."}<br>A maximum of two build tasks. Leave yourself room to finish.</div><div class="board">${selected.length ? selected.map(task).join("") : empty("Make space for one good idea", "Review a build idea, set a next action, then add it to your backlog.", '<button class="button primary" data-view="inbox">Review saved ideas</button>')}</div><div class="heading-actions heading"><button class="button" data-action="export">${icon("download")}Download sprint & issue drafts</button></div>`
  );
}
function render() {
  sidebar();
  $("#main").innerHTML =
    topbar() +
    {
      inbox,
      projects,
      backlog,
      week,
      shipped: () =>
        heading(
          "From saved to something real.",
          "A small collection of things you followed through on.",
        ) + table(state.items.filter((i) => i.status === "done")),
    }[view]() +
    '<div class="footer-note">Collect with curiosity. Build with intention.</div>';
  document
    .querySelectorAll("[data-progress]")
    .forEach((el) => (el.style.width = el.dataset.progress + "%"));
}
function modal(
  title,
  body,
  footer = '<button class="button" type="button" data-action="close">Close</button>',
  form = false,
) {
  const dialog = $("#modal");
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
    const button = $("[type=submit]", $("#dialog-form"));
    button.disabled = true;
    $("#form-error").classList.add("hidden");
    try {
      await callback(new FormData(e.currentTarget), e.submitter);
      $("#modal").close();
      await refresh();
    } catch (error) {
      $("#form-error").textContent = error.message;
      $("#form-error").classList.remove("hidden");
      $("#form-error").scrollIntoView({ block: "nearest" });
    } finally {
      button.disabled = false;
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
function itemDialog(id) {
  const item = state.items.find((i) => i.id === id);
  if (!item) return;
  modal(
    "Give this idea a next step",
    `${item.metadata?.synthetic ? '<div class="callout">Synthetic demo content. This example does not point to a real post.</div>' : `<a class="source-link" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">Open original LinkedIn save ${icon("external")}</a>`}${field("Title", "title", item.title, "input", 'maxlength="300"')}${field("Post text", "content", item.content, "textarea")}${field("Your note / why you saved it", "note", item.note, "textarea")}${item.classification_method ? `<div class="callout">Suggested using ${esc(item.classification_method)} · ${esc(item.confidence)} confidence. ${esc(item.why)}</div>` : ""}<div class="details-section">Shape the next step</div><div class="field-row">${select(
      "Destination",
      "kind",
      Object.entries(labels).map(([key, label]) => [
        key,
        key === "untriaged" ? "Not classified" : label,
      ]),
      item.kind,
    )}${select("Project", "project_id", [["", "Unassigned"], ...state.projects.map((p) => [p.id, p.name])], item.project_id || "")}</div>${field("First action", "next_action", item.next_action, "textarea", 'placeholder="A concrete task you could finish in two hours."')}${field("Done when", "definition_of_done", item.definition_of_done, "textarea", 'placeholder="How will you know this first step worked?"')}<div class="field-row">${field("First-action estimate (hours)", "effort_hours", item.effort_hours || 1, "input", 'type="number" min="0.25" max="2" step="0.25" required')}${select("Status", "status", Object.entries(statusLabels), item.status)}</div>${field("Result / commit / PR link (optional)", "outcome_url", item.outcome_url || "", "input", 'type="url" placeholder="https://github.com/…"')}`,
    '<button class="button" type="button" data-action="close">Cancel</button><button class="button primary" type="submit">Save changes</button>',
    true,
  );
  bindForm(async (form) => {
    const payload = Object.fromEntries(form);
    payload.id = id;
    payload.effort_hours = Number(payload.effort_hours);
    await api("/api/item", payload);
    toast("Idea updated. One step closer.");
  });
}
function importDialog() {
  modal(
    "Bring your saves home",
    `<div class="callout">LinkedIn exports saved dates and URLs. Post text stays on LinkedIn: add it or a personal note after importing. Only the Saved Items CSV is read from your archive.</div><label class="dropzone" id="dropzone" for="archive-file">${icon("upload")}<strong>Drop your LinkedIn archive here</strong>or choose a ZIP / Saved Items CSV (up to 128 MiB)<input id="archive-file" type="file" accept=".zip,.csv" required></label><p class="helper">Re-import any time. Duplicate saves are skipped and your notes stay intact.</p><p>Waiting for your archive? <a class="inline-link" href="${apiURL("/api/sample")}">Download a synthetic test ZIP</a> or <a class="inline-link" href="/?workspace=demo">explore the demo</a>.</p><p class="helper"><a href="https://www.linkedin.com/help/linkedin/answer/a1341346" target="_blank" rel="noopener noreferrer">How to request your Saved Items archive ↗</a></p>${state.imports.length ? `<div class="history"><strong>Last import</strong><br>${esc(state.imports[0].filename)} · ${state.imports[0].added} new · ${state.imports[0].duplicates} duplicates</div>` : ""}`,
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
    toast(
      `${result.added} new saves imported. ${result.duplicates} duplicates skipped.`,
    );
  });
}
function classifyDialog() {
  const eligible = state.items.filter(
    (i) => i.kind === "untriaged" && i.has_context && i.status === "inbox",
  ).length;
  modal(
    "Find a direction for your ideas",
    `<div class="summary"><strong>${eligible} ${eligible === 1 ? "idea has" : "ideas have"} context and can be classified.</strong><br>${state.items.filter((i) => !i.has_context && i.kind === "untriaged").length} saves still need post text or a useful note.</div><p><strong>Local suggestions</strong><br>A simple keyword classifier groups related ideas, suggests a destination, and drafts a small next step. It runs offline and labels suggestions as low confidence. Review them before adding to your backlog.</p><button class="button primary" data-action="run-classify" ${eligible ? "" : "disabled"}>${icon("spark")}Suggest directions locally</button><div class="details-section">Optional AI classification</div><p>${state.ai?.available ? `Use ${esc(state.ai.model)} to classify up to 20 unclassified ideas with context. Clicking below sends their titles, post text, notes, and existing project names to OpenAI. API usage is billed to your key.` : "Set OPENAI_API_KEY before starting the server to enable direct AI classification. No key is needed for local suggestions or the copy/paste route below."}</p>${state.ai?.available ? `<button class="button" data-action="run-ai" ${eligible ? "" : "disabled"}>${icon("spark")}Send batch to OpenAI</button>` : ""}<div class="details-section">Use ChatGPT with copy & paste</div><p>Download a context-only prompt, use it in ChatGPT, then paste the JSON response here. Your archive is never uploaded by this app.</p><a class="button small" href="${apiURL("/api/prompt")}">${icon("download")}Download ChatGPT prompt</a><div class="field heading"><label for="triage-json">Paste triage JSON</label><textarea id="triage-json" rows="5" placeholder='{"items": [...]}'></textarea></div><button class="button small" data-action="apply-triage">Apply ChatGPT response</button>`,
  );
}
document.addEventListener("click", async (e) => {
  const button = e.target.closest(
    "[data-view],[data-item],[data-project],[data-filter],[data-action]",
  );
  if (!button) return;
  try {
    if (button.dataset.view) return navigate(button.dataset.view);
    if (button.dataset.item) return itemDialog(button.dataset.item);
    if (button.dataset.project)
      return navigate("inbox", button.dataset.project);
    if (button.dataset.filter) {
      filter = button.dataset.filter;
      return render();
    }
    switch (button.dataset.action) {
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
        $("#modal").close();
        await refresh();
        toast(
          `${result.classified} draft suggestions ready. Open an idea to review its next step.`,
        );
        break;
      }
      case "run-ai": {
        button.disabled = true;
        button.textContent = "Classifying…";
        const result = await api("/api/classify-ai", {});
        $("#modal").close();
        await refresh();
        toast(`${result.classified} AI drafts ready for your review.`);
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
document.addEventListener("input", (e) => {
  if (e.target.id === "search") {
    const cursor = e.target.selectionStart;
    search = e.target.value;
    render();
    $("#search").focus();
    $("#search").setSelectionRange(cursor, cursor);
  }
});
document.addEventListener("change", (e) => {
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
