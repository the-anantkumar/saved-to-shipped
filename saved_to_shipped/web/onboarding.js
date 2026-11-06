"use strict";

function pendingRetrieval() {
  return (state.retrieval_jobs || []).find(
    (job) => job.run_id && !job.applied_at,
  );
}

function latestRetrieval() {
  return (state.retrieval_jobs || []).find((job) => job.status !== "DISMISSED");
}

function pipeline() {
  const reviews = reviewItems().length;
  const eligible = state.items.filter(item => item.has_context && item.kind === "untriaged" && item.status === "inbox").length;
  const missing = state.items.filter(item => !item.has_context && !["done","parked"].includes(item.status)).length;
  const job = pendingRetrieval() || latestRetrieval();
  let title, description, action, label, image = "arrow";
  if (job && (["STARTING","UNCERTAIN"].includes(job.status) || pendingRetrieval())) {
    title = job.status === "UNCERTAIN" ? "Your last run needs a look." : "Your saves are on their way.";
    description = job.error || `${job.total} selected saves. You can keep browsing while we check for results.`;
    action = 'data-action="retrieve"'; label = "Check run"; image = "clock";
  } else if (reviews) {
    title = `${reviews} ${reviews === 1 ? "idea, ready for a decision." : "ideas, ready for a decision."}`;
    description = "Keep a useful next step. Park the rest. Make room to begin.";
    action = 'data-action="review-next"'; label = "Start reviewing";
  } else if (eligible) {
    title = `${eligible} readable ${eligible === 1 ? "save. Let’s find its next step." : "saves. Let’s find their next steps."}`;
    description = "Turn the useful bits into project groups and small actions.";
    action = 'data-action="classify"'; label = "Organize saves"; image = "spark";
  } else if (missing) {
    title = "There’s something in your saves.";
    description = `${missing} links are waiting for content. Start with a small batch.`;
    action = 'data-action="retrieve"'; label = `Process ${Math.min(10, missing)} ${missing === 1 ? "save" : "saves"}`; image = "download";
  } else {
    title = "A little space to make something.";
    description = "Your reviewed next steps are waiting in the backlog.";
    action = 'data-view="backlog"'; label = "Open backlog"; image = "check";
  }
  return `<section class="next-step" aria-label="Your next step"><div class="next-symbol" aria-hidden="true">✳</div><div class="next-copy"><span class="eyebrow">UP NEXT</span><h2>${esc(title)}</h2><p>${esc(description)}</p></div><button class="button primary" ${action}>${label}${icon(image)}</button></section>`;
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
    "Make yourself at home.",
    `<p>Connect your tools once. Your keys stay in a separate local settings file.</p><div class="provider-label">Post retrieval <span>${settings.extractor_available ? "Connected" : "Not connected"}</span></div>
    ${field("Apify API token", "apify_token", "", "input", `type="password" autocomplete="off" placeholder="${settings.extractor_available ? "Configured. Leave blank to keep it." : "Paste your Apify token"}"`)}
    <p class="helper"><a class="inline-link" href="https://console.apify.com/" target="_blank" rel="noopener noreferrer">Open Apify Console ↗</a> · Retrieval uses <a class="inline-link" href="https://apify.com/${esc(settings.actor || "data_minds/linkedin-post-scraper")}" target="_blank" rel="noopener noreferrer">${esc(settings.actor || "data_minds/linkedin-post-scraper")}</a>. Provider charges and plan limits apply.</p>
    <div class="provider-label">Idea organization <span>${settings.ai_available ? "Connected" : "Optional"}</span></div>
    ${field("OpenAI API key", "openai_key", "", "input", `type="password" autocomplete="off" placeholder="${settings.ai_available ? "Configured. Leave blank to keep it." : "Optional: enable AI project suggestions"}"`)}
    ${field("What would you like to build or learn?", "goals", state.goals || "", "textarea", 'maxlength="2000" placeholder="Optional: e.g. practical developer tools and small experiments with Rust."')}
    <details><summary>Advanced settings</summary>${field("Model", "model", settings.model || "gpt-4.1-mini", "input", 'maxlength="100"')}<label class="checkbox"><input name="clear_apify_token" type="checkbox"> Remove the saved Apify key</label><label class="checkbox"><input name="clear_openai_key" type="checkbox"> Remove the saved OpenAI key</label><p class="helper">This does not unset keys provided through environment variables.</p></details>`,
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

function retrievalDialog() {
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
  const missing = state.items.filter(
    (item) =>
      item.platform === "linkedin" &&
      !item.content &&
      !["done", "parked"].includes(item.status),
  );
  const fresh = missing.filter(
    (item) => !item.enrichment || item.enrichment.status === "new",
  ).length;
  const unavailable = missing.length - fresh;
  modal(
    "Find what’s worth keeping.",
    `<p><strong>${fresh} saves are waiting for content.</strong> Recover the post text first, then organize the ideas.</p>
    <p class="helper">Selected URLs go to Apify. Provider charges apply. Your archive stays local.</p>
    <div class="field-row">${select(
      "Run size",
      "limit",
      [
        ["10", "10 saves"],
        ["50", "50 saves"],
        ["1000", "All eligible saves (up to 1000)"],
      ],
      "10",
    )}${field("Maximum Apify charge (USD)", "max_charge", 1, "input", 'type="number" min="0.01" max="20" step="0.01" required')}</div>
    <details><summary>Retrieval options & coverage</summary><label class="checkbox"><input name="retry" type="checkbox"> Retry ${unavailable} unavailable saves instead of new ones</label><p>Cached content is kept. Private or deleted posts may be unavailable; images and documents may have partial coverage. The charge cap is sent to Apify. Provider plan limits apply.</p></details>
    ${job?.counts ? `<div class="callout">Last run: ${job.counts.extracted} extracted, ${job.counts.partial} partial, ${job.counts.gated} gated, ${job.counts.deleted} deleted, ${job.counts.missing + job.counts.empty + job.counts.error} without usable content.</div>` : ""}`,
    '<button class="button" type="button" data-action="close">Cancel</button><button class="button primary" type="submit">Retrieve post content '+icon("arrow")+'</button>',
    true,
  );
  bindForm(async (form) => {
    await api("/api/retrieve/start", {
      limit: Number(form.get("limit")),
      max_charge: Number(form.get("max_charge")),
      retry: form.has("retry"),
    });
    toast("Retrieving your saves. You can keep browsing.");
  });
}

function scheduleRetrieval() {
  if (retrievalTimer || !pendingRetrieval()) return;
  const delay = pendingRetrieval().error ? 30000 : 5000;
  retrievalTimer = setTimeout(async () => {
    retrievalTimer = null;
    await pollRetrieval(false);
  }, delay);
}

async function pollRetrieval(manual) {
  clearTimeout(retrievalTimer);
  retrievalTimer = null;
  try {
    const result = await api("/api/retrieve/poll", {});
    await refresh();
    if (result.applied_at) {
      const counts = result.counts;
      toast(
        `${counts.extracted + counts.partial} saved items now have content. Review their classification options.`,
      );
      if (manual) $("#modal").close();
    } else if (manual) retrievalDialog();
  } catch (error) {
    await refresh().catch(() => {});
    if (manual) toast(error.message);
  }
}
