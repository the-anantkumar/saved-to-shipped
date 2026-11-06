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
  const recovered = state.items.filter((item) => item.content?.trim()).length;
  const eligible = state.items.filter(
    (item) =>
      item.has_context && item.kind === "untriaged" && item.status === "inbox",
  ).length;
  const job = latestRetrieval();
  return `<section class="pipeline" aria-label="Process your saved archive">
    <div class="pipeline-step"><span class="step-number">1</span><div><strong>Bring your saves</strong><p>${state.items.length ? `${state.items.length} ideas imported` : "Start with your LinkedIn archive ZIP"}</p><button data-action="import">${state.items.length ? "Import another archive" : "Import archive"} ↗</button></div></div>
    <div class="pipeline-step"><span class="step-number">2</span><div><strong>Recover the content</strong><p>${recovered} ${recovered === 1 ? "save has" : "saves have"} post text${job ? ` · ${esc(job.status.toLowerCase().replaceAll("_", " "))}` : ""}</p><button data-action="retrieve">${state.settings?.extractor_available ? "Retrieve posts" : "Set up hosted retrieval"} ↗</button></div></div>
    <div class="pipeline-step"><span class="step-number">3</span><div><strong>Find your next project</strong><p>${eligible} ${eligible === 1 ? "idea is" : "ideas are"} ready for classification</p><button data-action="classify">Review classification options ↗</button></div></div>
  </section>${job?.error ? `<div class="callout retrieval-notice">${esc(job.error)} <button class="inline-link" data-action="retrieve">View run</button></div>` : ""}`;
}

function settingsDialog() {
  if (workspace === "demo") {
    modal(
      "Your provider settings",
      '<p>The demo uses synthetic posts. Configure real provider keys in your personal workspace.</p><a class="button primary" href="/">Open my workspace</a>',
    );
    return;
  }
  const settings = state.settings || {};
  modal(
    "Set up your workspace",
    `<p>Bring your own hosted extractor key. Your ZIP stays on this computer; retrieval sends selected post URLs to Apify when you start a run.</p>
    <div class="callout">Keys are saved in a private local settings file, separate from your saves and exports. Environment variables take precedence over saved settings.</div>
    ${field("Apify API token", "apify_token", "", "input", `type="password" autocomplete="off" placeholder="${settings.extractor_available ? "Configured. Leave blank to keep it." : "Paste your Apify token"}"`)}
    <p class="helper"><a class="inline-link" href="https://console.apify.com/" target="_blank" rel="noopener noreferrer">Open Apify Console ↗</a> · Retrieval uses <a class="inline-link" href="https://apify.com/${esc(settings.actor || "data_minds/linkedin-post-scraper")}" target="_blank" rel="noopener noreferrer">${esc(settings.actor || "data_minds/linkedin-post-scraper")}</a>. Provider charges and plan limits apply.</p>
    <div class="details-section">Optional AI classification</div>
    ${field("OpenAI API key", "openai_key", "", "input", `type="password" autocomplete="off" placeholder="${settings.ai_available ? "Configured. Leave blank to keep it." : "Optional: enable AI project suggestions"}"`)}
    ${field("Model", "model", settings.model || "gpt-4.1-mini", "input", 'maxlength="100"')}
    ${field("What would you like to build or learn?", "goals", state.goals || "", "textarea", 'maxlength="2000" placeholder="Optional: e.g. practical developer tools and small experiments with Rust."')}
    <details><summary>Remove saved keys</summary><label class="checkbox"><input name="clear_apify_token" type="checkbox"> Remove the saved Apify key</label><label class="checkbox"><input name="clear_openai_key" type="checkbox"> Remove the saved OpenAI key</label><p class="helper">This does not unset keys provided through environment variables.</p></details>`,
    '<button class="button" type="button" data-action="close">Cancel</button><button class="button primary" type="submit">Save settings</button>',
    true,
  );
  bindForm(async (form) => {
    const payload = Object.fromEntries(form);
    payload.clear_apify_token = form.has("clear_apify_token");
    payload.clear_openai_key = form.has("clear_openai_key");
    await api("/api/settings", payload);
    toast("Settings saved. Import your archive, then choose Process saves.");
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
  if (!state.settings?.extractor_available) return settingsDialog();
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
    "Recover your saved post content",
    `<div class="summary"><strong>${fresh} saves have not been retrieved.</strong><br>${unavailable} saves have unavailable or incomplete results and can be retried explicitly.</div>
    <p>This sends selected LinkedIn post URLs to Apify. It does not send your ZIP, notes, messages, or model API key. Private, removed, and inaccessible posts may remain unavailable.</p>
    <div class="field-row">${select(
      "Run size",
      "limit",
      [
        ["10", "First 10 saves"],
        ["50", "Up to 50 saves"],
        ["1000", "All eligible saves (up to 1000)"],
      ],
      "10",
    )}${field("Maximum provider charge for this run (USD)", "max_charge", 1, "input", 'type="number" min="0.01" max="20" step="0.01" required')}</div>
    <label class="checkbox"><input name="retry" type="checkbox"> Retry unavailable saves instead of new ones</label>
    <p class="helper">The charge cap is sent to Apify. Account plans can limit returned results. We recommend starting with 10. Successful content is cached and skipped on later runs.</p>
    ${job?.counts ? `<div class="callout">Last run: ${job.counts.extracted} extracted, ${job.counts.partial} partial, ${job.counts.gated} gated, ${job.counts.deleted} deleted, ${job.counts.missing + job.counts.empty + job.counts.error} without usable content.</div>` : ""}`,
    '<button class="button" type="button" data-action="close">Cancel</button><button class="button primary" type="submit">Start hosted retrieval</button>',
    true,
  );
  bindForm(async (form) => {
    await api("/api/retrieve/start", {
      limit: Number(form.get("limit")),
      max_charge: Number(form.get("max_charge")),
      retry: form.has("retry"),
    });
    toast("Hosted retrieval started. Results will be checked automatically.");
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
