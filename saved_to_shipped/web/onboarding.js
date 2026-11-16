"use strict";

let hostedPollFailures = 0;
function pendingRetrieval() {
  if (hosted) return (state.retrieval_jobs || []).find(job => ["QUEUED", "STARTING", "RUNNING", "APPLYING", "UNCERTAIN", "QUOTA_BLOCKED"].includes(job.status));
  return (state.retrieval_jobs || []).find(
    (job) => job.run_id && !job.applied_at,
  );
}

function latestRetrieval() {
  return (state.retrieval_jobs || []).find((job) => job.status !== "DISMISSED");
}
function hostedJobDialog(job) {
  const classification = job.kind === "classification";
  const providerConsole = classification ? "https://platform.openai.com/usage" : "https://console.apify.com/actors/runs";
  const uncertain = job.status === "UNCERTAIN";
  const blocked = job.status === "QUOTA_BLOCKED";
  const status = ({QUEUED: "Queued", STARTING: "Starting", RUNNING: "In progress", APPLYING: "Saving results", UNCERTAIN: "Needs checking", QUOTA_BLOCKED: "Paused at a limit"})[job.status] || job.status;
  modal(uncertain ? "Check before trying again" : blocked ? "A little more room is needed" : classification ? "Finding the next steps" : "Retrieving your saves",
    `<p><strong>${esc(status)}</strong> · ${Number(job.selected_count ?? job.total ?? 0)} selected saves.</p><p>${esc(job.error || (uncertain ? "The provider may have accepted this request. We will not submit it again automatically." : blocked ? "Processing reached a workspace or daily limit. Export or delete saves if storage is full, or return after the daily budget resets. Resume applies the existing results without submitting another paid request." : "You can keep browsing or close this tab. The server keeps the job’s progress."))}</p>${uncertain ? `<p>Review your <a class="inline-link" href="${providerConsole}" target="_blank" rel="noopener noreferrer">provider account ↗</a> before dismissing the uncertain submission. Dismissal does not cancel or refund provider work.</p>` : ""}`,
    `<button class="button" data-action="close">Close</button>${uncertain ? '<button class="button" data-action="dismiss-retrieval">I checked the provider. Dismiss.</button>' : `<button class="button" data-action="stop-retrieval">Stop processing</button><button class="button primary" data-action="${blocked ? "resume-retrieval" : "poll-retrieval"}">${blocked ? "Resume existing results" : "Check progress"}</button>`}`);
}

function pipeline() {
  const reviews = reviewItems().length;
  const eligible = state.items.filter(item => item.has_context && item.kind === "untriaged" && item.status === "inbox").length;
  const missing = state.items.filter(item => !item.has_context && !["done","parked"].includes(item.status)).length;
  const job = pendingRetrieval() || latestRetrieval();
  let title, description, action, label, image = "arrow";
  if (job && (["STARTING","UNCERTAIN"].includes(job.status) || pendingRetrieval())) {
    title = job.status === "UNCERTAIN" ? "Your last run needs a look." : "Your saves are on their way.";
    description = job.error || `${job.selected_count ?? job.total ?? 0} selected saves. You can keep browsing while we check for results.`;
    action = 'data-action="retrieve"'; label = "Check run"; image = "clock";
  } else if (reviews) {
    title = `${reviews} ${reviews === 1 ? "idea, ready for a decision." : "ideas, ready for a decision."}`;
    description = "Keep a useful next step. Park the rest. Make room to begin.";
    action = 'data-action="review-next"'; label = "Start reviewing";
  } else if (eligible) {
    title = `${eligible} readable ${eligible === 1 ? "save. Let’s find its next step." : "saves. Let’s find their next steps."}`;
    description = "Find a home for each save: Projects, Learning, or Experiences.";
    action = 'data-action="classify"'; label = "Organize saves"; image = "spark";
  } else if (missing) {
    title = "There’s something in your saves.";
    description = `${missing} links are waiting for content. Start with a small batch.`;
    action = 'data-action="retrieve"'; label = `Process ${Math.min(10, missing)} ${missing === 1 ? "save" : "saves"}`; image = "download";
  } else {
    const destination = state.items.some(item => item.kind === "project") ? "backlog" : state.items.some(item => ["learning", "reference"].includes(item.kind)) ? "learning" : "experiences";
    title = "Your saves have a place now.";
    description = "Build something, learn something, or make room for a fresh perspective.";
    action = `data-view="${destination}"`; label = destination === "backlog" ? "Open Projects" : destination === "learning" ? "Open Learning" : "Open Experiences"; image = "check";
  }
  return `<section class="next-step" aria-label="Your next step"><div class="next-symbol" aria-hidden="true">${icon(image)}</div><div class="next-copy"><span class="eyebrow">UP NEXT</span><h2>${esc(title)}</h2><p>${esc(description)}</p></div><button class="button primary" ${action}>${label}${icon(image)}</button></section>`;
}
function settingsDialog(afterSave) {
  if (workspace === "demo") {
    modal(
      "Your provider settings",
      '<p>The demo uses synthetic posts. Configure real provider keys in your personal workspace.</p><a class="button primary" href="/">Open my workspace</a>',
    );
    return;
  }
  const settings = state.settings || {};
  modal(
    "Settings",
    `<p>Make this space yours. Provider tools are optional; reading, notes, and local organization work without a key.</p><p class="helper">${hosted ? "Your keys are encrypted in your private cloud workspace and are never included in exports." : "Your keys stay in a separate local settings file."}</p><div class="provider-label">Post retrieval <span>${settings.extractor_available ? "Connected" : "Not connected"}</span></div>
    ${field("Apify API token", "apify_token", "", "input", `type="password" autocomplete="off" placeholder="${settings.extractor_available ? "Configured. Leave blank to keep it." : "Paste your Apify token"}"`)}
    <p class="helper"><a class="inline-link" href="https://console.apify.com/" target="_blank" rel="noopener noreferrer">Open Apify Console ↗</a> · Retrieval uses <a class="inline-link" href="https://apify.com/${esc(settings.actor || "data_minds/linkedin-post-scraper")}" target="_blank" rel="noopener noreferrer">${esc(settings.actor || "data_minds/linkedin-post-scraper")}</a>. Provider charges and plan limits apply.</p>
    <div class="provider-label">Idea organization <span>${settings.ai_available ? "Connected" : "Optional"}</span></div>
    ${field("OpenAI API key", "openai_key", "", "input", `type="password" autocomplete="off" placeholder="${settings.ai_available ? "Configured. Leave blank to keep it." : "Optional: enable AI project suggestions"}"`)}
    ${field("What would you like to build or learn?", "goals", state.goals || "", "textarea", 'maxlength="2000" placeholder="Optional: e.g. practical developer tools and small experiments with Rust."')}
    <details><summary>Advanced settings</summary>${field("Model", "model", settings.model || "gpt-4.1-mini", "input", 'maxlength="100"')}<label class="checkbox"><input name="clear_apify_token" type="checkbox"> Remove the saved Apify key</label><label class="checkbox"><input name="clear_openai_key" type="checkbox"> Remove the saved OpenAI key</label>${hosted ? "" : '<p class="helper">This does not unset keys provided through environment variables.</p>'}</details>`,
    '<button class="button" type="button" data-action="close">Cancel</button><button class="button primary" type="submit">Save settings</button>',
    true,
  );
  bindForm(async (form) => {
    const payload = Object.fromEntries(form);
    payload.clear_apify_token = form.has("clear_apify_token");
    payload.clear_openai_key = form.has("clear_openai_key");
    await api("/api/settings", payload);
    toast("Settings saved.");
    if (typeof afterSave === "function") return { afterRefresh: afterSave };
  });
}

function selectableRetrievalItems(retry = false) {
  return state.items.filter(item => {
    if (item.platform !== "linkedin" || (item.has_content ?? Boolean(item.content)) || ["done", "parked"].includes(item.status)) return false;
    const status = item.enrichment?.status || "new";
    return (retry ? ["error", "missing", "gated", "deleted", "empty"] : ["new"]).includes(status);
  }).sort(newestSavedFirst);
}
function renderRetrievalSelection() {
  const list = $("#retrieval-candidates");
  if (!list) return;
  const items = selectableRetrievalItems($("#retrieval-retry").checked);
  const count = Math.min(25, Number($("#f-limit").value) || 10);
  $("#f-limit").options[0].textContent = `${Math.min(10, items.length)} latest saves`;
  $("#f-limit").options[1].textContent = items.length > 10 ? `${Math.min(25, items.length)} latest saves` : `All ${items.length} eligible saves`;
  list.innerHTML = items.length ? items.map((item, index) => `<div class="retrieval-choice"><label><input type="checkbox" name="retrieval_id" value="${esc(item.id)}" ${index < count ? "checked" : ""} aria-label="Retrieve ${esc(dateLabel(item.saved_at))}: ${esc(item.url)}"><span>Saved ${esc(dateLabel(item.saved_at))}</span></label><a href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">${esc(item.url)} ${icon("external")}</a></div>`).join("") : '<p class="helper">No eligible saves in this selection. Your existing content stays available.</p>';
  syncRetrievalSelection();
}
function syncRetrievalSelection(changed) {
  let checked = [...document.querySelectorAll('[name="retrieval_id"]:checked')];
  const overLimit = checked.length > 25;
  if (overLimit && changed) { changed.checked = false; checked = checked.filter(input => input !== changed); }
  $("#retrieval-selection-error").textContent = overLimit ? "Choose up to 25 saves for one run." : "";
  $("#retrieval-count").textContent = `${checked.length} selected · maximum 25 per run`;
  $("#retrieval-submit").disabled = !checked.length || checked.length > 25;
}
function retrievalDialog() {
  if (hosted && pendingRetrieval()) return hostedJobDialog(pendingRetrieval());
  if (workspace === "demo") {
    modal(
      "Hosted retrieval",
      '<p>Demo URLs are synthetic. Switch to your personal workspace to import and process real saves.</p><a class="button primary" href="/">Open my workspace</a>',
    );
    return;
  }
  if (!state.settings?.extractor_available) return settingsDialog(retrievalDialog);
  const job = pendingRetrieval() || latestRetrieval();
  if (job && (job.status === "STARTING" || job.status === "UNCERTAIN")) {
    modal(
      "Check your hosted submission",
      `<div class="callout">${esc(job.error || "The submission was interrupted before its run ID was saved.")} We will not automatically submit it again.</div><p>Check the <a class="inline-link" href="https://console.apify.com/actors/runs" target="_blank" rel="noopener noreferrer">Apify Console</a> for an existing run before dismissing this submission.</p>`,
      '<button class="button" data-action="close">Close</button><button class="button primary" data-action="dismiss-retrieval">I checked the console. Dismiss.</button>',
    );
    return;
  }
  if (pendingRetrieval()) {
    modal(
      "Your retrieval is in progress",
      `<div class="summary"><strong>${esc(job.status)}</strong> · ${job.total} selected saves<br>The hosted run continues if you close this tab. Reopen the app to resume checking results.</div>${job.error ? `<div class="error-message">${esc(job.error)}</div>` : ""}<p><a class="inline-link" href="https://console.apify.com/actors/runs/${esc(job.run_id)}" target="_blank" rel="noopener noreferrer">View the hosted run ↗</a></p>`,
      '<button class="button" data-action="close">Close</button><button class="button" data-action="stop-retrieval">Stop hosted run</button><button class="button primary" data-action="poll-retrieval">Check results now</button>',
    );
    return;
  }
  const fresh = selectableRetrievalItems().length;
  const unavailable = selectableRetrievalItems(true).length;
  modal(
    "Find what’s worth keeping.",
    `<p><strong>${fresh} saves are waiting for content.</strong> Choose a few worth returning to. You can leave the rest for later.</p>
    <p class="helper">Only the selected original URLs go to your Apify account. Saved to Shipped is free. Apify charges your own provider account. Saving a key or importing an archive starts no provider work.</p>
    <div class="field-row">${select(
      "Select latest saved",
      "limit",
      [
        ["10", `${Math.min(10, fresh)} latest saves`],
        ["25", `${Math.min(25, fresh)} latest saves`],
      ],
      "10",
    )}${field("Maximum Apify charge (USD)", "max_charge", 1, "input", 'type="number" min="0.01" max="20" step="0.01" required')}</div>
    <label class="checkbox"><input id="retrieval-retry" name="retry" type="checkbox"> Choose from ${unavailable} previously unavailable saves instead</label>
    <div class="retrieval-selection-head"><strong>Preview the selected links</strong><span id="retrieval-count" role="status"></span></div><p class="helper">Latest saved first. Dates and original URLs identify each link; post text will be known after retrieval. Change any selection below.</p><div id="retrieval-selection-error" class="helper danger" role="alert"></div><div id="retrieval-candidates" class="retrieval-candidates"></div>
    <label class="checkbox charge-approval"><input id="retrieval-charge-approval" name="approve_charge" type="checkbox" required> I approve this Apify run up to the maximum charge above, using my own provider account.</label>
    <details><summary>Retrieval coverage</summary><p>Cached content is kept. Private or deleted posts may be unavailable; images and documents may have partial coverage. The charge cap is sent to Apify. Provider plan limits apply. Retrieval does not automatically organize your saves.</p></details>
    ${job?.counts ? `<div class="callout">Last run: ${job.counts.extracted} extracted, ${job.counts.partial} partial, ${job.counts.gated} gated, ${job.counts.deleted} deleted, ${job.counts.missing + job.counts.empty + job.counts.error} without usable content.</div>` : ""}`,
    '<button class="button" type="button" data-action="close">Cancel</button><button id="retrieval-submit" class="button primary" type="submit">Retrieve selected posts '+icon("arrow")+'</button>',
    true,
  );
  bindForm(async (form) => {
    const ids = form.getAll("retrieval_id");
    if (!ids.length || ids.length > 25 || new Set(ids).size !== ids.length) throw new Error("Choose between 1 and 25 saves for this run.");
    if (!form.has("approve_charge")) throw new Error("Approve the maximum Apify charge before starting this run.");
    await api("/api/retrieve/start", {
      ids,
      limit: ids.length,
      max_charge: Number(form.get("max_charge")),
      retry: form.has("retry"),
    });
    toast("Retrieving your saves. You can keep browsing.");
  });
  renderRetrievalSelection();
}

function scheduleRetrieval() {
  if (retrievalTimer || !pendingRetrieval() || (hosted && (document.visibilityState === "hidden" || hostedPollFailures >= 3 || ["UNCERTAIN", "QUOTA_BLOCKED"].includes(pendingRetrieval().status)))) return;
  const delay = hosted ? 30000 : pendingRetrieval().error ? 30000 : 5000;
  retrievalTimer = setTimeout(async () => {
    retrievalTimer = null;
    await pollRetrieval(false);
  }, delay);
}

async function pollRetrieval(manual) {
  const epoch = hosted?.epoch;
  // A manual check can finish after the user has closed its progress dialog and
  // opened an editor. Its result may refresh data, but only owns its original UI.
  const dialogContent = manual && $("#modal").open ? $("#dialog-title") : null;
  const ownsDialog = () => dialogContent && $("#modal").open && $("#dialog-title") === dialogContent;
  if (manual) hostedPollFailures = 0;
  clearTimeout(retrievalTimer);
  retrievalTimer = null;
  try {
    const result = await api(hosted ? "/api/jobs/poll" : "/api/retrieve/poll", {});
    if (hosted && epoch !== hosted.epoch) return;
    hostedPollFailures = 0;
    await refresh();
    if (hosted && epoch !== hosted.epoch) return;
    if (hosted) {
      const job = result.job || result;
      if (job.status === "COMPLETED") toast(job.kind === "classification" ? "Your drafts are ready to review." : "Retrieved content is ready to explore.");
      if (ownsDialog()) { if (pendingRetrieval()) hostedJobDialog(pendingRetrieval()); else $("#modal").close(); }
      return;
    }
    if (result.applied_at) {
      const counts = result.counts;
      toast(
        `${counts.extracted + counts.partial} saved items now have content. Review their classification options.`,
      );
      if (ownsDialog()) $("#modal").close();
    } else if (ownsDialog()) retrievalDialog();
  } catch (error) {
    if (hosted && epoch !== hosted.epoch) return;
    if (hosted) hostedPollFailures++;
    await refresh().catch(() => {});
    if (hosted && epoch !== hosted.epoch) return;
    if (manual) toast(error.message);
  }
}
document.addEventListener("visibilitychange", () => {
  if (!hosted) return;
  if (document.visibilityState === "hidden") { clearTimeout(retrievalTimer); retrievalTimer = null; }
  else scheduleRetrieval();
});
