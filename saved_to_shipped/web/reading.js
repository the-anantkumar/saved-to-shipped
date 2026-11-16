"use strict";

const READING_KINDS = ["learning", "reference", "experience"];
const readingLabels = {unread: "To read", reading: "Reading", read: "Read", queued: "Read next", all: "All"};
let readerId = "", readingFilter = "unread", readingLength = "any";
let readingProgressTimer, pendingReadingProgress = null, restoringReading = false;
const readingRequests = new Map();

function isReadingView() { return ["learning", "experiences"].includes(view); }
function readingState(item) {
  const status = item.reading?.status || ({doing: "reading", done: "read"}[item.status] || "unread");
  return {status, progress: status === "read" ? 100 : item.reading?.progress || 0, queued: item.reading?.queued === true};
}
function readingMinutes(item) {
  if (Number.isFinite(item.reading_minutes)) return Math.max(1, item.reading_minutes);
  return Math.max(1, Math.ceil((item.content || item.note || "").trim().split(/\s+/).filter(Boolean).length / 200));
}
function libraryItems() {
  return state.items.filter(item => view === "experiences" ? item.kind === "experience" : ["learning", "reference"].includes(item.kind));
}
function libraryHash(includeReader = true) {
  const params = new URLSearchParams();
  if (projectFilter) params.set("project", projectFilter);
  if (readingFilter !== "unread") params.set("filter", readingFilter);
  if (readingLength !== "any") params.set("length", readingLength);
  if (search) params.set("q", search);
  if (includeReader && readerId) params.set("read", readerId);
  return `#${view}${params.size ? "?" + params.toString() : ""}`;
}
function syncLibraryRoute() { history.replaceState(history.state, "", libraryHash()); }
function readingOrder(items) {
  return [...items].sort((a,b) => {
    const priority = item => readingState(item).status === "reading" ? 0 : readingState(item).queued ? 1 : 2;
    return priority(a) - priority(b) || newestSavedFirst(a, b);
  });
}
function filteredReading(items) {
  return readingOrder(items.filter(item => {
    const reading = readingState(item);
    const matchesStatus = readingFilter === "all" || (readingFilter === "unread" ? reading.status !== "read" : readingFilter === "queued" ? reading.queued && reading.status !== "read" : reading.status === readingFilter);
    return matchesStatus && (readingLength === "any" || readingMinutes(item) <= Number(readingLength)) &&
      matchesSearch(item);
  }));
}
function readingByline(item) {
  return `<span>${esc(item.author || "LinkedIn")}</span><span>·</span><span>${readingMinutes(item)} min read${!(item.has_content ?? Boolean(item.content)) ? " · notes only" : ""}</span>${item.enrichment?.status === "partial" ? '<span>·</span><span class="partial-label">Partial text</span>' : ""}`;
}
function readingRow(item) {
  const reading = readingState(item);
  const excerpt = (item.excerpt || item.content || item.note || "Add the post text or a note to read this save.").replace(/\s+/g, " ").trim();
  return `<article class="reading-row"><div class="reading-row-main"><div class="reading-byline">${readingByline(item)}</div><h2><button data-item="${esc(item.id)}">${esc(item.title || "Saved LinkedIn post")}</button></h2><p class="reading-excerpt">${esc(excerpt.slice(0,240))}${excerpt.length > 240 ? "…" : ""}</p><div class="reading-row-foot"><button class="topic-label" data-action="reading-topic" data-id="${esc(item.project_id || "_ungrouped")}">${esc(projectName(item.project_id) || "Unsorted")}</button>${item.kind === "reference" ? '<span>Reference</span>' : ""}<span class="reading-status ${reading.status}">${reading.status === "reading" ? `Reading · ${Math.round(reading.progress)}%` : readingLabels[reading.status]}</span><span>Saved ${esc(dateLabel(item.saved_at))}</span></div></div><div class="reading-row-actions">${reading.status !== "read" && item.has_context ? `<button class="reading-bookmark ${reading.queued ? "selected" : ""}" data-action="reading-queue" data-id="${esc(item.id)}" aria-label="${reading.queued ? "Remove from" : "Add to"} Read next: ${esc(item.title)}" aria-pressed="${reading.queued}" title="${reading.queued ? "In Read next" : "Read next"}">${icon("bookmark")}</button>` : ""}<button class="notes-button ${(item.has_note ?? Boolean(item.note)) ? "has-note" : ""}" data-action="notes" data-id="${esc(item.id)}" aria-label="Notes for ${esc(item.title)}" title="Your notes">${icon("note")}</button></div></article>`;
}
function readingLibrary() {
  const all = libraryItems();
  const scoped = all.filter(item => !projectFilter || (projectFilter === "_ungrouped" ? !item.project_id : item.project_id === projectFilter));
  const items = filteredReading(scoped);
  const topics = sectionsFor(view === "experiences" ? "experience" : "learning");
  const unsorted = all.filter(item => !item.project_id).length;
  // Suggestions honor the current topic, search, and available time, but exclude completed reads.
  const next = items.find(item => item.has_context && readingState(item).status !== "read");
  const topicButton = (id, name, count) => `<button class="${projectFilter === id ? "selected" : ""}" data-action="reading-topic" data-id="${esc(id)}" aria-pressed="${projectFilter === id}"><span>${esc(name)}</span><small>${count}</small></button>`;
  return heading(view === "experiences" ? "A little perspective." : "Make time for a good read.", view === "experiences" ? "Stories, experiences, and opportunities. Something to take with you." : "Learning and references, with room to think. Choose one thing worth your attention.", `<button class="button" data-action="reading-new-topic">${icon("plus")}New ${view === "experiences" ? "section" : "topic"}</button>`) +
    `<div class="library-layout"><section class="library-feed" aria-label="${view === "experiences" ? "Experiences" : "Learning library"}"><div class="library-toolbar"><div class="tabs reading-tabs" aria-label="Reading status">${["unread", "reading", "queued", "read", "all"].map(key => `<button class="tab ${readingFilter === key ? "selected" : ""}" data-action="reading-filter" data-value="${key}" aria-pressed="${readingFilter === key}">${readingLabels[key]}<span>${scoped.filter(item => key === "all" || (key === "unread" ? readingState(item).status !== "read" : key === "queued" ? readingState(item).queued && readingState(item).status !== "read" : readingState(item).status === key)).length}</span></button>`).join("")}</div><div class="library-tools"><label class="search">${icon("search")}<input id="search" maxlength="200" placeholder="Search your reading" aria-label="Search your reading" value="${esc(search)}"></label><select id="reading-length" aria-label="Available reading time"><option value="any">Any length</option><option value="5" ${readingLength === "5" ? "selected" : ""}>5 min or less</option><option value="10" ${readingLength === "10" ? "selected" : ""}>10 min or less</option></select><select class="reading-topic-select" id="reading-topic-select" aria-label="Reading topic"><option value="">All topics · ${all.length}</option>${topics.map(topic => `<option value="${esc(topic.id)}" ${projectFilter === topic.id ? "selected" : ""}>${esc(topic.name)}</option>`).join("")}${unsorted ? `<option value="_ungrouped" ${projectFilter === "_ungrouped" ? "selected" : ""}>Unsorted · ${unsorted}</option>` : ""}</select></div></div>${projectFilter ? `<div class="library-scope">${esc(projectFilter === "_ungrouped" ? "Unsorted" : projectName(projectFilter))}<button class="quiet-link" data-action="reading-topic" data-id="">All topics ${icon("close")}</button></div>` : ""}<div class="reading-list">${searchFeedback() || (items.length ? items.slice(0,visibleLimit).map(readingRow).join("") : empty(projectFilter && !scoped.length ? "A place for your next save." : all.length ? "A little breathing room." : view === "experiences" ? "A home for lived experience." : "Your next good read starts here.", projectFilter && !scoped.length ? "This section is ready. Find a saved idea and organize it here when you want to." : all.length ? "No saves match these filters. Try another topic or reading status." : "Organize a readable save as " + (view === "experiences" ? "Experience" : "Learn or Reference") + " to find it here.", projectFilter && !scoped.length ? '<button class="button" data-action="global-find">Find existing saves</button>' : all.length ? '<button class="quiet-link" data-action="reading-reset">Clear filters</button>' : '<button class="button" data-view="inbox">Go to saves</button>'))}</div>${items.length > visibleLimit ? '<button class="quiet-link load-more" data-action="more">Show more reads</button>' : ""}<p class="reading-count">${items.length} ${items.length === 1 ? "save" : "saves"} · Reading times estimate the saved text.</p></section><aside class="library-rail" aria-label="Reading guide">${next ? `<section class="read-next"><span class="eyebrow">${readingState(next).status === "reading" ? "PICK UP WHERE YOU LEFT OFF" : "ONE GOOD PLACE TO START"}</span><h2>${esc(next.title)}</h2><p>${readingMinutes(next)} min · ${esc(projectName(next.project_id) || "Unsorted")}</p><button class="quiet-link" data-item="${esc(next.id)}">${readingState(next).status === "reading" ? "Continue reading" : "Start reading"} ${icon("arrow")}</button></section>` : ""}<section class="reading-topics"><div class="rail-heading"><h2>${view === "experiences" ? "Your sections" : "Your topics"}</h2><button class="quiet-link" data-action="reading-new-topic" aria-label="${view === "experiences" ? "New experience section" : "New reading topic"}">${icon("plus")}</button></div>${topicButton("", "All topics", all.length)}${topics.map(topic => topicButton(topic.id, topic.name, all.filter(item => item.project_id === topic.id).length)).join("")}${unsorted ? topicButton("_ungrouped", "Unsorted", unsorted) : ""}</section><p class="reading-rail-note">A place to return to, not keep up with.<br>Read one thing. Keep something useful.</p></aside></div>`;
}
function safeReadingLinks(item) {
  const links = item.enrichment?.links;
  return (Array.isArray(links) ? links : []).filter(link => typeof link === "string" && /^https?:\/\//i.test(link)).slice(0,30);
}
function reader(item) {
  const reading = readingState(item);
  const coverage = item.enrichment;
  const links = safeReadingLinks(item);
  const text = item.content || item.note || "";
  return `<div class="reader-shell"><div class="reader-navigation"><button class="quiet-link" data-action="library-back">← ${view === "experiences" ? "Experiences" : "Learning"}</button><button class="quiet-link" data-action="reading-organize" data-id="${esc(item.id)}">Organize ${icon("folder")}</button></div><article class="reader"><header><div class="eyebrow">${esc(projectName(item.project_id) || "YOUR READING SPACE")}${item.kind === "reference" ? " · REFERENCE" : ""}</div><h1 tabindex="-1">${esc(item.title || "Saved LinkedIn post")}</h1><div class="reading-byline">${readingByline(item)}</div><div class="reader-actions"><a class="quiet-link" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">Original on LinkedIn ${icon("external")}</a><span class="reader-action-buttons">${reading.status !== "read" ? `<button class="quiet-link ${reading.queued ? "queued" : ""}" data-action="reading-queue" data-id="${esc(item.id)}" aria-pressed="${reading.queued}">${icon("bookmark")}${reading.queued ? "In Read next" : "Read next"}</button>` : '<span class="reading-status read">✓ Read</span>'}<button class="quiet-link" data-action="notes" data-id="${esc(item.id)}">${icon("note")}Your notes${item.note ? " · 1" : ""}</button></span></div>${item.metadata?.synthetic ? '<p class="coverage-note">Synthetic sample content.</p>' : ""}${coverage && (coverage.status === "partial" || coverage.content_truncated) ? `<p class="coverage-note partial">${esc(retrievalLabels[coverage.status] || "Saved text")} · ${esc(coverage.coverage || "Only the retrieved text is available")}${coverage.content_truncated ? ". Text shortened to 20,000 characters." : ""}</p>` : ""}${!item.content ? '<p class="coverage-note">Only your notes are available for this save. Open the original for the source.</p>' : ""}</header><div id="reading-body" class="reader-body">${text.split(/\n\s*\n/).filter(part => part.trim()).map(part => `<p>${esc(part.trim())}</p>`).join("")}</div>${links.length ? `<details class="source-links"><summary>Links from this post · ${links.length}</summary>${links.map(link => `<a class="quiet-link" href="${esc(link)}" target="_blank" rel="noopener noreferrer">${esc(link)} ${icon("external")}</a>`).join("")}</details>` : ""}<footer class="reader-finish"><span class="eyebrow">A MOMENT TO MAKE IT STICK</span><h2>What will you take from this?</h2><p>Keep a thought in your notes, then get back to your day.</p><div><button class="button" data-action="notes" data-id="${esc(item.id)}">${icon("note")}Add a takeaway</button><button class="button ${reading.status === "read" ? "" : "primary"}" data-action="reading-status" data-id="${esc(item.id)}" data-value="${reading.status === "read" ? "unread" : "read"}">${reading.status === "read" ? "Mark as unread" : "Mark read"} ${icon("check")}</button></div><button class="quiet-link" data-action="library-back">Back to ${view === "experiences" ? "Experiences" : "Learning"} ${icon("arrow")}</button></footer></article></div>`;
}
function readingPage() {
  const item = libraryItems().find(item => item.id === readerId);
  return item ? reader(item) : readingLibrary();
}
async function changeReading(id, patch) {
  const epoch = hosted?.epoch;
  const previous = readingRequests.get(id) || Promise.resolve();
  const request = previous.catch(() => {}).then(() => {
    if (hosted && hosted.epoch !== epoch) throw new Error("Account changed. Your old reading update was discarded.");
    return api("/api/reading", {id, ...patch});
  }).then(result => {
    if (hosted && (hosted.epoch !== epoch || result.superseded)) return result.reading;
    const position = state.items.findIndex(item => item.id === id);
    const item = state.items[position];
    const revision = result.item?.revision ?? result.revision;
    if (item && !(hosted && revision !== undefined && item.revision > revision)) {
      // Hosted reading writes hydrate the transport cache. Keep the visible item
      // in sync so opening it can safely skip a second detail request.
      if (hosted && result.item?.id === id) state.items[position] = result.item;
      state.items[position].reading = result.reading;
      if (revision !== undefined) state.items[position].revision = revision;
    }
    return result.reading;
  });
  readingRequests.set(id, request);
  try { return await request; }
  finally { if (readingRequests.get(id) === request) readingRequests.delete(id); }
}
function startReading(item) {
  if (readingState(item).status === "unread") changeReading(item.id, {status: "reading"}).catch(error => toast(error.message));
}
function openReading(id) {
  if (hosted && !hosted.hasDetail(id)) return hydrateItem(id).then(() => openReading(id)).catch(error => toast(error.message));
  const item = state.items.find(item => item.id === id);
  if (!item || !READING_KINDS.includes(item.kind)) return;
  flushReadingProgress();
  const fromLibrary = isReadingView() && !readerId && (view === "experiences") === (item.kind === "experience");
  const returnTo = fromLibrary ? libraryHash(false) : item.kind === "experience" ? "#experiences" : "#learning";
  if (!isReadingView() || (view === "experiences") !== (item.kind === "experience")) {
    projectFilter = ""; search = ""; readingFilter = "unread"; readingLength = "any";
  }
  view = item.kind === "experience" ? "experiences" : "learning";
  readerId = id;
  history.pushState({libraryReturn: returnTo, fromLibrary}, "", libraryHash());
  render(false);
  restoreReadingPosition();
  startReading(item);
  $("h1")?.focus({preventScroll: true});
}
function restoreReadingPosition() {
  restoringReading = true;
  window.requestAnimationFrame(() => {
    const body = $("#reading-body");
    const item = state.items.find(item => item.id === readerId);
    const progress = item && readingState(item).status !== "read" ? readingState(item).progress : 0;
    const top = body && progress ? Math.max(0, window.scrollY + body.getBoundingClientRect().top + body.offsetHeight * progress / 100 - window.innerHeight) : 0;
    window.scrollTo({top});
    window.requestAnimationFrame(() => { restoringReading = false; });
  });
}
async function backToLibrary() {
  if (pendingReadingProgress || readingRequests.size) await flushReadingProgress();
  if (history.state?.fromLibrary) return history.back();
  readerId = "";
  history.replaceState(null, "", history.state?.libraryReturn || libraryHash());
  restoreRoute();
  render(false);
  window.scrollTo({top: 0});
}
async function flushReadingProgress() {
  clearTimeout(readingProgressTimer);
  const pending = pendingReadingProgress;
  pendingReadingProgress = null;
  if (pending) {
    const item = state.items.find(item => item.id === pending.id);
    const patch = {progress: pending.progress};
    if (item && readingState(item).status === "unread") patch.status = "reading";
    changeReading(pending.id, patch).catch(error => toast(`Could not save your place: ${error.message}`));
  }
  await Promise.allSettled([...readingRequests.values()]);
}
window.addEventListener("scroll", () => {
  if (!readerId || restoringReading || !isReadingView()) return;
  const item = state.items.find(item => item.id === readerId);
  const body = $("#reading-body");
  if (!item || !body || readingState(item).status === "read") return;
  const progress = Math.min(99, Math.max(0, Math.round((window.innerHeight - body.getBoundingClientRect().top) / body.offsetHeight * 100)));
  if (!Number.isFinite(progress) || progress <= readingState(item).progress) return;
  pendingReadingProgress = {id: item.id, progress};
  clearTimeout(readingProgressTimer);
  readingProgressTimer = setTimeout(flushReadingProgress, 900);
}, {passive: true});
window.addEventListener("pagehide", flushReadingProgress);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushReadingProgress(); });

function readingDialog(id) {
  if (hosted && !hosted.hasDetail(id)) return hydrateItem(id).then(() => readingDialog(id)).catch(error => toast(error.message));
  const item = state.items.find(item => item.id === id);
  if (!item) return;
  modal("Find the right place for it", field("Title", "title", item.title, "input", 'maxlength="300" required') + select("Keep this as", "kind", [["learning", "Learning"], ["reference", "Reference"], ["experience", "Experience"], ["project", "Project"]], item.kind) + organizationFields(item), '<button class="button" type="button" data-action="close">Cancel</button><button class="button primary" type="submit">Save organization</button>', true);
  bindForm(async form => {
    await flushReadingProgress();
    const payload = {id, ...organizationPayload(form)};
    if (hosted) payload.expected_revision = item.revision;
    await api("/api/item", payload);
    toast("Organization saved.");
    if (payload.kind !== item.kind && (payload.kind === "project" || (payload.kind === "experience") !== (item.kind === "experience"))) {
      return {afterRefresh: () => navigate(payload.kind === "project" ? "backlog" : payload.kind === "experience" ? "experiences" : "learning")};
    }
  });
}
