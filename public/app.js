/* ══════════════════════════════════════════════════════════════════════════════
   ASC Workflow — Review Board (app.js)
   Tabbed interface: Pitch Deck · Financial Model · VC Shortlist
   ══════════════════════════════════════════════════════════════════════════════ */

/* ── State ────────────────────────────────────────────────────────────────── */
const state = {
  slug: null,
  draft: null,
  tab: 'deck', // 'deck' | 'model' | 'vc'
  versions: { deck: 'v1', model: 'v1', vcShortlist: 'v1' },
  slideApprovals: {}, // { 0: true, 1: true, ... }
  revisionLog: [],
};

const TABS = [
  { id: 'deck', label: 'Pitch Deck', section: 'deck' },
  { id: 'model', label: 'Financial Model', section: 'model' },
  { id: 'vc', label: 'VC Shortlist', section: 'vcShortlist' },
];

/* ── Boot ─────────────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', init);

async function init() {
  const params = new URLSearchParams(location.search);
  state.slug = params.get('slug');
  if (!state.slug) { showError('No slug provided — add ?slug=CompanyName to the URL'); return; }
  state.tab = params.get('tab') || 'deck';

  try {
    const draft = await fetchLatest(state.slug);
    state.draft = draft;
    const v = draft.version || 'v1';
    ['deck', 'model', 'vcShortlist'].forEach(s => (state.versions[s] = v));
    // Restore slide approvals
    state.slideApprovals = draft.slideApprovals || {};
    renderAll();
  } catch (err) {
    showError(`Failed to load outputs: ${err.message}`);
  }
}

/* ── API helpers ──────────────────────────────────────────────────────────── */
async function fetchLatest(slug) {
  const res = await fetch(`/outputs/${encodeURIComponent(slug)}/latest`);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

async function apiPost(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

/* ── Full render ─────────────────────────────────────────────────────────── */
function renderAll() {
  const d = state.draft;
  document.getElementById('case-header').hidden = false;
  document.getElementById('review-layout').hidden = false;

  renderCaseHeader(d);
  renderTabBar();
  renderSidebar(d);
  renderTab();

  document.getElementById('btn-export-all').onclick = handleExportAll;
}

/* ── Case header ─────────────────────────────────────────────────────────── */
function renderCaseHeader(d) {
  const ctx = d.context || {};
  const tabLabel = TABS.find(t => t.id === state.tab)?.label || '';
  document.getElementById('case-title').textContent =
    `${ctx.companyName || state.slug} — ${tabLabel}`;

  const parts = [ctx.sector, ctx.stage, ctx.geography,
    ctx.fundingAsk ? '$' + fmtNum(ctx.fundingAsk) + ' raise' : null,
    state.versions.deck, fmtDate(d.generatedAt)
  ].filter(Boolean);
  document.getElementById('case-subtitle').innerHTML =
    parts.map(p => esc(p)).join(' <span class="sep">&middot;</span> ');

  updateExportAllButton();
}

/* ── Tab bar ─────────────────────────────────────────────────────────────── */
function renderTabBar() {
  const bar = document.getElementById('tab-bar');
  bar.innerHTML = TABS.map(t => {
    const approved = state.draft.approvals?.[t.section];
    const dotCls = approved ? 'tab-dot--approved' : 'tab-dot--pending';
    const active = state.tab === t.id ? ' tab-link--active' : '';
    return `<a class="tab-link${active}" data-tab="${t.id}">
      <span class="tab-dot ${dotCls}"></span>${t.label}</a>`;
  }).join('');

  bar.querySelectorAll('.tab-link').forEach(el => {
    el.addEventListener('click', () => switchTab(el.dataset.tab));
  });
}

function switchTab(tab) {
  state.tab = tab;
  const url = new URL(location);
  url.searchParams.set('tab', tab);
  history.replaceState(null, '', url);
  renderAll();
}

/* ── Tab content router ──────────────────────────────────────────────────── */
function renderTab() {
  const main = document.getElementById('review-main');
  if (state.tab === 'deck') renderDeckTab(main);
  else if (state.tab === 'model') renderModelTab(main);
  else if (state.tab === 'vc') renderVCTab(main);
}

/* ══════════════════════════════════════════════════════════════════════════════
   TAB 1: PITCH DECK
   ══════════════════════════════════════════════════════════════════════════════ */
function renderDeckTab(container) {
  const slides = state.draft.deck;
  if (!Array.isArray(slides) || !slides.length) {
    container.innerHTML = '<p class="loading">No slides found.</p>';
    return;
  }

  container.innerHTML = slides.map((s, i) => {
    const approved = state.slideApprovals[i];
    const pillCls = approved ? 'pill--approved' : 'pill--pending';
    const pillText = approved ? 'Approved' : 'Needs review';
    return `
    <div class="card" id="slide-card-${i}">
      <div class="card-header">
        <div class="card-header-left">
          <span class="num-badge">${s.slideNumber || i + 1}</span>
          <span class="slide-title">${esc(s.title)}</span>
        </div>
        <div class="card-header-right">
          <span class="pill ${pillCls}">${pillText}</span>
        </div>
      </div>
      <div class="card-body">
        ${Array.isArray(s.bullets) && s.bullets.length ? `
          <ul class="slide-bullets">
            ${s.bullets.map(b => `<li>${esc(b)}</li>`).join('')}
          </ul>` : ''}
        ${s.presenterNote ? `<div class="slide-note">${esc(s.presenterNote)}</div>` : ''}
      </div>
      <div class="card-footer">
        <button class="btn btn--navy btn--sm" data-action="approve-slide" data-idx="${i}"
          ${approved ? 'disabled' : ''}>${approved ? 'Approved' : 'Approve slide'}</button>
        <button class="btn btn--outline btn--sm" data-action="feedback-slide" data-idx="${i}">Give feedback</button>
      </div>
      <div class="feedback-box" id="feedback-slide-${i}" hidden>
        <textarea class="feedback-textarea" id="feedback-text-slide-${i}"
          placeholder='e.g. Make this more urgent, add specific growth metrics...'></textarea>
        <div class="feedback-hint">Only this slide will be regenerated.</div>
        <div class="feedback-actions">
          <button class="btn btn--outline btn--sm" data-action="cancel-feedback-slide" data-idx="${i}">Cancel</button>
          <button class="btn btn--gold btn--sm" data-action="regen-slide" data-idx="${i}">Regenerate slide &rarr;</button>
        </div>
      </div>
    </div>`;
  }).join('') + `
    <div class="approve-all-bar">
      <button class="btn btn--navy btn--full" id="btn-approve-all-slides"
        ${allSlidesApproved(slides) ? 'disabled' : ''}>Approve all remaining</button>
    </div>`;

  // Wire events
  container.querySelectorAll('[data-action="approve-slide"]').forEach(btn => {
    btn.addEventListener('click', () => handleApproveSlide(+btn.dataset.idx));
  });
  container.querySelectorAll('[data-action="feedback-slide"]').forEach(btn => {
    btn.addEventListener('click', () => toggleFeedback('slide', +btn.dataset.idx, true));
  });
  container.querySelectorAll('[data-action="cancel-feedback-slide"]').forEach(btn => {
    btn.addEventListener('click', () => toggleFeedback('slide', +btn.dataset.idx, false));
  });
  container.querySelectorAll('[data-action="regen-slide"]').forEach(btn => {
    btn.addEventListener('click', () => handleReviseSlide(+btn.dataset.idx));
  });
  document.getElementById('btn-approve-all-slides')?.addEventListener('click', handleApproveAllSlides);
}

function allSlidesApproved(slides) {
  return slides.every((_, i) => state.slideApprovals[i]);
}

async function handleApproveSlide(idx) {
  const btn = document.querySelector(`[data-action="approve-slide"][data-idx="${idx}"]`);
  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }
  try {
    await apiPost(`/outputs/${encodeURIComponent(state.slug)}/approve-slide`, { slideIndex: idx });
    state.slideApprovals[idx] = true;
    // Check if all slides approved → mark deck section as approved
    if (allSlidesApproved(state.draft.deck)) {
      state.draft.approvals = state.draft.approvals || {};
      state.draft.approvals.deck = true;
    }
    renderAll();
  } catch (err) {
    alert(`Failed: ${err.message}`);
    if (btn) { btn.disabled = false; btn.textContent = 'Approve slide'; }
  }
}

async function handleApproveAllSlides() {
  const slides = state.draft.deck || [];
  const unapproved = slides.map((_, i) => i).filter(i => !state.slideApprovals[i]);
  const btn = document.getElementById('btn-approve-all-slides');
  if (btn) { btn.disabled = true; btn.textContent = 'Approving...'; }
  try {
    for (const idx of unapproved) {
      await apiPost(`/outputs/${encodeURIComponent(state.slug)}/approve-slide`, { slideIndex: idx });
      state.slideApprovals[idx] = true;
    }
    state.draft.approvals = state.draft.approvals || {};
    state.draft.approvals.deck = true;
    renderAll();
  } catch (err) {
    alert(`Failed: ${err.message}`);
    renderAll();
  }
}

async function handleReviseSlide(idx) {
  const textarea = document.getElementById(`feedback-text-slide-${idx}`);
  const instruction = textarea?.value?.trim();
  if (!instruction) { alert('Please enter feedback.'); return; }

  const regenBtn = document.querySelector(`[data-action="regen-slide"][data-idx="${idx}"]`);
  if (regenBtn) { regenBtn.disabled = true; regenBtn.textContent = 'Regenerating...'; }

  try {
    const result = await apiPost(`/outputs/${encodeURIComponent(state.slug)}/revise-slide`, {
      slideIndex: idx, instruction
    });
    // Update local state
    state.draft.deck[idx] = result.slide;
    state.draft.version = result.version;
    state.versions.deck = result.version;
    state.slideApprovals[idx] = false;
    state.draft.approvals = state.draft.approvals || {};
    state.draft.approvals.deck = false;
    addRevisionLog(`Revised slide ${idx + 1}: ${instruction}`);
    renderAll();
  } catch (err) {
    alert(`Revision failed: ${err.message}`);
    if (regenBtn) { regenBtn.disabled = false; regenBtn.innerHTML = 'Regenerate slide &rarr;'; }
  }
}

/* ══════════════════════════════════════════════════════════════════════════════
   TAB 2: FINANCIAL MODEL
   ══════════════════════════════════════════════════════════════════════════════ */
function renderModelTab(container) {
  const model = state.draft.model;
  if (!model?.base) {
    container.innerHTML = '<p class="loading">No model data found.</p>';
    return;
  }

  // Y1 revenue from each scenario for summary boxes
  const y1 = s => {
    const rev = (model[s] || []).find(r => /revenue/i.test(r.metric));
    return rev?.year1 || 0;
  };

  const scenarios = ['bear', 'base', 'bull'];
  const colorMap = { bear: 'bear', base: 'base', bull: 'bull' };

  container.innerHTML = `
    <!-- Scenario summary boxes -->
    <div class="scenario-summary">
      ${scenarios.map(s => `
        <div class="scenario-box" data-scenario="${s}">
          <div class="scenario-box-label">${s.charAt(0).toUpperCase() + s.slice(1)} Case</div>
          <div class="scenario-box-value scenario-box-value--${colorMap[s]}">${fmtUSD(y1(s))}</div>
          <div class="scenario-box-sub">Y1 Revenue</div>
        </div>`).join('')}
    </div>

    <!-- Scenario cards -->
    ${scenarios.map(s => renderScenarioCard(s, model)).join('')}

    <!-- Assumptions -->
    ${Array.isArray(model.assumptions) && model.assumptions.length ? `
      <div class="card">
        <div class="card-body">
          <div class="assumptions-heading">Key Assumptions</div>
          <ul class="assumptions-list">
            ${model.assumptions.map(a => `<li>${esc(a)}</li>`).join('')}
          </ul>
        </div>
      </div>` : ''}

    <!-- Excel download -->
    <div class="card">
      <div class="card-body" style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
        <span class="xls-badge">XLS</span>
        <div style="flex:1;min-width:200px">
          <div class="xls-filename">${esc(state.draft.context?.companyName || state.slug)}_Financial_Model_${esc(state.versions.model)}.xlsx</div>
          <div class="xls-meta">3 scenarios &middot; 8 metrics &middot; 3-year projection</div>
        </div>
        <button class="btn btn--navy" id="btn-download-xlsx">Download Excel</button>
      </div>
      <div class="card-body" style="border-top:1px solid var(--border);padding-top:14px">
        <div style="font-size:11px;color:var(--gray-500);margin-bottom:6px">Edit in Excel, then upload your changes below</div>
        <div class="upload-zone" id="upload-zone">
          <input type="file" id="upload-model-file" accept=".xlsx,.csv" />
          Drop your edited Excel here or <strong>click to browse</strong>
        </div>
      </div>
    </div>

    <div class="or-divider">or give written feedback</div>

    <!-- Written feedback for model -->
    <div class="card">
      <div class="card-body">
        <div class="hint-pills">
          ${['Cut OpEx 20%', 'Extend runway', 'Push profitability to Y2', 'Improve gross margin', 'Reduce headcount Y1']
            .map(h => `<span class="hint-pill" data-hint="${esc(h)}">${esc(h)}</span>`).join('')}
        </div>
        <textarea class="feedback-textarea" id="model-feedback-text"
          placeholder="e.g. Increase Year 2 revenue growth to 3x and adjust EBITDA accordingly..."></textarea>
        <div class="feedback-actions">
          <button class="btn btn--green" id="btn-approve-model"
            ${state.draft.approvals?.model ? 'disabled' : ''}>${state.draft.approvals?.model ? 'Model approved' : 'Approve model'}</button>
          <button class="btn btn--gold" id="btn-regen-model">Regenerate &rarr;</button>
        </div>
      </div>
    </div>

    <!-- Version history -->
    <div class="card">
      <div class="card-header"><div class="card-header-left" style="font-size:12px;font-weight:600">Version History</div></div>
      <div class="card-body" id="model-version-history">
        <div class="version-row">
          <span class="version-label">${esc(state.versions.model)}</span>
          <span class="version-desc">Current version</span>
          <button class="btn btn--outline btn--sm" id="btn-download-xlsx-vh">Download</button>
        </div>
      </div>
    </div>
  `;

  // Wire events
  document.getElementById('btn-download-xlsx')?.addEventListener('click', handleDownloadXlsx);
  document.getElementById('btn-download-xlsx-vh')?.addEventListener('click', handleDownloadXlsx);
  document.getElementById('btn-approve-model')?.addEventListener('click', () => handleApproveSection('model'));
  document.getElementById('btn-regen-model')?.addEventListener('click', handleRegenModel);

  // Hint pills
  container.querySelectorAll('.hint-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      const ta = document.getElementById('model-feedback-text');
      if (ta) ta.value = pill.dataset.hint;
    });
  });

  // Per-scenario feedback
  container.querySelectorAll('[data-action="feedback-scenario"]').forEach(btn => {
    btn.addEventListener('click', () => toggleFeedback('scenario', btn.dataset.scenario, true));
  });
  container.querySelectorAll('[data-action="cancel-feedback-scenario"]').forEach(btn => {
    btn.addEventListener('click', () => toggleFeedback('scenario', btn.dataset.scenario, false));
  });
  container.querySelectorAll('[data-action="regen-scenario"]').forEach(btn => {
    btn.addEventListener('click', () => handleReviseScenario(btn.dataset.scenario));
  });

  // Upload zone
  const uploadZone = document.getElementById('upload-zone');
  const fileInput = document.getElementById('upload-model-file');
  uploadZone?.addEventListener('click', () => fileInput?.click());
  uploadZone?.addEventListener('dragover', e => { e.preventDefault(); uploadZone.classList.add('dragover'); });
  uploadZone?.addEventListener('dragleave', () => uploadZone.classList.remove('dragover'));
  uploadZone?.addEventListener('drop', e => { e.preventDefault(); uploadZone.classList.remove('dragover'); if (e.dataTransfer.files.length) handleUploadModel(e.dataTransfer.files[0]); });
  fileInput?.addEventListener('change', () => { if (fileInput.files.length) handleUploadModel(fileInput.files[0]); });
}

function renderScenarioCard(scenario, model) {
  const label = scenario.charAt(0).toUpperCase() + scenario.slice(1);
  const rows = model[scenario] || [];
  return `
    <div class="card">
      <div class="card-header">
        <div class="card-header-left">
          <span style="font-family:Georgia,serif;font-size:15px;font-weight:600">${label} Case</span>
        </div>
        <div class="card-header-right">
          <button class="btn btn--outline btn--sm" data-action="feedback-scenario" data-scenario="${scenario}">Give feedback</button>
        </div>
      </div>
      <div class="card-body" style="padding:0;overflow-x:auto">
        <table class="model-table">
          <thead><tr><th>Metric</th><th>Year 1</th><th>Year 2</th><th>Year 3</th></tr></thead>
          <tbody>
            ${rows.map(r => {
              const isEbitda = /ebitda/i.test(r.metric);
              const isMoney = !/(headcount|runway)/i.test(r.metric);
              const isRunway = /runway/i.test(r.metric);
              const fmt = isMoney ? fmtUSD : (n => isRunway ? `${n}mo` : String(n));
              const cls = v => v < 0 ? ' class="negative"' : (v > 0 && isMoney ? ' class="positive"' : '');
              const rowCls = isEbitda ? ' class="row-ebitda"' : '';
              return `<tr${rowCls}>
                <td>${esc(r.metric)}</td>
                <td${cls(r.year1)}>${fmt(r.year1)}</td>
                <td${cls(r.year2)}>${fmt(r.year2)}</td>
                <td${cls(r.year3)}>${fmt(r.year3)}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
      <div class="feedback-box" id="feedback-scenario-${scenario}" hidden>
        <textarea class="feedback-textarea" id="feedback-text-scenario-${scenario}"
          placeholder="e.g. Increase Y2 revenue by 30%..."></textarea>
        <div class="feedback-hint">${label === 'Base' ? 'Bear and bull will remain unchanged.' : 'Base and ' + (scenario === 'bear' ? 'bull' : 'bear') + ' remain unchanged.'}</div>
        <div class="feedback-actions">
          <button class="btn btn--outline btn--sm" data-action="cancel-feedback-scenario" data-scenario="${scenario}">Cancel</button>
          <button class="btn btn--gold btn--sm" data-action="regen-scenario" data-scenario="${scenario}">Regenerate ${esc(label.toLowerCase())} case &rarr;</button>
        </div>
      </div>
    </div>`;
}

async function handleReviseScenario(scenario) {
  const textarea = document.getElementById(`feedback-text-scenario-${scenario}`);
  const instruction = textarea?.value?.trim();
  if (!instruction) { alert('Please enter feedback.'); return; }

  const btn = document.querySelector(`[data-action="regen-scenario"][data-scenario="${scenario}"]`);
  if (btn) { btn.disabled = true; btn.textContent = 'Regenerating...'; }

  try {
    const result = await apiPost(`/outputs/${encodeURIComponent(state.slug)}/revise-scenario`, {
      scenario, instruction
    });
    state.draft.model[scenario] = result.scenario;
    state.draft.version = result.version;
    state.versions.model = result.version;
    state.draft.approvals = state.draft.approvals || {};
    state.draft.approvals.model = false;
    addRevisionLog(`Revised ${scenario} case: ${instruction}`);
    renderAll();
  } catch (err) {
    alert(`Revision failed: ${err.message}`);
    if (btn) { btn.disabled = false; btn.innerHTML = `Regenerate ${scenario} case &rarr;`; }
  }
}

async function handleRegenModel() {
  const textarea = document.getElementById('model-feedback-text');
  const instruction = textarea?.value?.trim();
  if (!instruction) { alert('Please enter feedback.'); return; }

  const btn = document.getElementById('btn-regen-model');
  if (btn) { btn.disabled = true; btn.textContent = 'Regenerating...'; }

  try {
    const result = await apiPost(`/outputs/${encodeURIComponent(state.slug)}/revise`, {
      section: 'model', instruction
    });
    state.draft.model = result.model;
    state.draft.approvals = result.approvals || state.draft.approvals;
    state.versions.model = result.version;
    addRevisionLog(`Revised full model: ${instruction}`);
    renderAll();
  } catch (err) {
    alert(`Revision failed: ${err.message}`);
    if (btn) { btn.disabled = false; btn.innerHTML = 'Regenerate &rarr;'; }
  }
}

async function handleDownloadXlsx() {
  window.location.href = `/outputs/${encodeURIComponent(state.slug)}/download-model`;
}

async function handleUploadModel(file) {
  const zone = document.getElementById('upload-zone');
  if (zone) zone.textContent = `Uploading ${file.name}...`;

  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await fetch(`/outputs/${encodeURIComponent(state.slug)}/upload-model`, {
      method: 'POST',
      body: formData,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);

    state.draft.model = json.model;
    state.draft.version = json.version;
    state.versions.model = json.version;
    state.draft.approvals = state.draft.approvals || {};
    state.draft.approvals.model = false;
    addRevisionLog(`Uploaded revised model: ${file.name}`);
    renderAll();
  } catch (err) {
    alert(`Upload failed: ${err.message}`);
    if (zone) zone.innerHTML = 'Drop your edited Excel here or <strong>click to browse</strong>';
  }
}

/* ══════════════════════════════════════════════════════════════════════════════
   TAB 3: VC SHORTLIST
   ══════════════════════════════════════════════════════════════════════════════ */
function renderVCTab(container) {
  const vcs = state.draft.vcShortlist;
  if (!Array.isArray(vcs) || !vcs.length) {
    container.innerHTML = '<p class="loading">No VC matches found.</p>';
    return;
  }

  container.innerHTML = vcs.map(vc => {
    const fillCls = vc.score >= 70 ? 'vc-score-fill--high' : vc.score >= 40 ? 'vc-score-fill--mid' : 'vc-score-fill--low';
    return `
    <div class="card">
      <div class="card-body">
        <div class="vc-card-info">
          <span class="num-badge num-badge--circle">${vc.rank}</span>
          <div>
            <div class="vc-card-name">${esc(vc.name)}</div>
            <div class="vc-card-firm">${esc(vc.firm)}</div>
          </div>
        </div>
        <div class="vc-score-row">
          <div class="vc-score-track">
            <div class="vc-score-fill ${fillCls}" style="width:${vc.score}%"></div>
          </div>
          <span class="vc-score-num">${vc.score}/100</span>
        </div>
        <div class="vc-sub-scores">
          Stage ${vc.stageScore} &middot; Sector ${vc.sectorScore} &middot; Check ${vc.checkScore} &middot; Geo ${vc.geoScore}
        </div>
        <div class="vc-reason">${esc(vc.reason)}</div>
        ${vc.website ? `<a class="vc-website" href="${esc(vc.website.startsWith('http') ? vc.website : 'https://' + vc.website)}" target="_blank">${esc(vc.website)}</a>` : ''}
      </div>
      <div class="card-footer">
        <button class="btn btn--navy btn--sm" data-action="approve-vc-match" data-rank="${vc.rank}" disabled>Approve match</button>
        <button class="btn btn--red-outline btn--sm" data-action="remove-vc" data-rank="${vc.rank}">Remove from list</button>
      </div>
    </div>`;
  }).join('') + `
    <!-- VC feedback section -->
    <div class="card">
      <div class="card-body">
        <textarea class="feedback-textarea" id="vc-feedback-text"
          placeholder='e.g. Remove PropTech investors, add more B2B SaaS specialists in NY...'></textarea>
        <div class="feedback-hint">This will re-score all VCs and return a new top 10.</div>
        <div class="feedback-actions">
          <button class="btn btn--green" id="btn-approve-vc"
            ${state.draft.approvals?.vcShortlist ? 'disabled' : ''}>${state.draft.approvals?.vcShortlist ? 'VC list approved' : 'Approve VC list'}</button>
          <button class="btn btn--gold" id="btn-regen-vc">Regenerate shortlist &rarr;</button>
        </div>
      </div>
    </div>`;

  // Wire events
  document.getElementById('btn-approve-vc')?.addEventListener('click', () => handleApproveSection('vcShortlist'));
  document.getElementById('btn-regen-vc')?.addEventListener('click', handleRegenVC);

  container.querySelectorAll('[data-action="remove-vc"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const rank = +btn.dataset.rank;
      state.draft.vcShortlist = state.draft.vcShortlist.filter(v => v.rank !== rank);
      // Re-rank
      state.draft.vcShortlist.forEach((v, i) => v.rank = i + 1);
      renderAll();
    });
  });
}

async function handleRegenVC() {
  const textarea = document.getElementById('vc-feedback-text');
  const instruction = textarea?.value?.trim();

  const btn = document.getElementById('btn-regen-vc');
  if (btn) { btn.disabled = true; btn.textContent = 'Regenerating...'; }

  try {
    const result = await apiPost(`/outputs/${encodeURIComponent(state.slug)}/revise-vc`, {
      instruction: instruction || null
    });
    state.draft.vcShortlist = result.vcShortlist;
    state.draft.version = result.version;
    state.versions.vcShortlist = result.version;
    state.draft.approvals = state.draft.approvals || {};
    state.draft.approvals.vcShortlist = false;
    addRevisionLog(`Regenerated VC shortlist${instruction ? ': ' + instruction : ''}`);
    renderAll();
  } catch (err) {
    alert(`Revision failed: ${err.message}`);
    if (btn) { btn.disabled = false; btn.innerHTML = 'Regenerate shortlist &rarr;'; }
  }
}

/* ══════════════════════════════════════════════════════════════════════════════
   SHARED: Approve section, sidebar, export, utilities
   ══════════════════════════════════════════════════════════════════════════════ */

async function handleApproveSection(section) {
  try {
    await apiPost(`/outputs/${encodeURIComponent(state.slug)}/approve`, { section });
    state.draft.approvals = state.draft.approvals || {};
    state.draft.approvals[section] = true;
    renderAll();
  } catch (err) {
    alert(`Approve failed: ${err.message}`);
  }
}

function toggleFeedback(type, id, show) {
  const box = document.getElementById(`feedback-${type}-${id}`);
  if (box) box.hidden = !show;
}

/* ── Sidebar ─────────────────────────────────────────────────────────────── */
function renderSidebar(d) {
  const sidebar = document.getElementById('review-sidebar');
  const ctx = d.context || {};
  const approvals = d.approvals || {};

  sidebar.innerHTML = `
    <!-- Approval progress -->
    <div class="sidebar-card">
      <div class="sidebar-card-title">Approval Progress</div>
      <div class="sidebar-card-body">
        ${TABS.map(t => {
          const ok = approvals[t.section];
          return `<div class="approval-row">
            <span class="approval-label">
              <span class="tab-dot ${ok ? 'tab-dot--approved' : 'tab-dot--pending'}" style="width:6px;height:6px"></span>
              ${t.label}
            </span>
            <span>
              <span class="approval-version">${esc(state.versions[t.section])}</span>
              <span class="pill ${ok ? 'pill--approved' : 'pill--pending'}" style="margin-left:4px">${ok ? 'Approved' : 'Pending'}</span>
            </span>
          </div>`;
        }).join('')}
      </div>
    </div>

    <!-- Company context -->
    <div class="sidebar-card">
      <div class="sidebar-card-title">Company Context</div>
      <div class="sidebar-card-body">
        ${ctxRow('Sector', ctx.sector)}
        ${ctxRow('Stage', ctx.stage)}
        ${ctxRow('ARR', ctx.arr ? fmtUSD(ctx.arr) : null)}
        ${ctxRow('Burn/mo', ctx.burnRate ? fmtUSD(ctx.burnRate) : null)}
        ${ctxRow('Runway', ctx.runway ? ctx.runway + 'mo' : null)}
        ${ctxRow('Ask', ctx.fundingAsk ? fmtUSD(ctx.fundingAsk) : null)}
        ${ctxRow('Geography', ctx.geography)}
      </div>
    </div>

    <!-- Revision log -->
    <div class="sidebar-card">
      <div class="sidebar-card-title">Revision Log</div>
      <div class="sidebar-card-body">
        ${state.revisionLog.length ? state.revisionLog.map(entry => `
          <div class="rev-log-item">
            <div class="rev-log-time">${esc(entry.time)}</div>
            <div class="rev-log-action">${esc(entry.action)}</div>
          </div>`).join('') : '<div style="font-size:11px;color:var(--gray-500)">No revisions yet.</div>'}
      </div>
    </div>`;
}

function ctxRow(label, value) {
  return `<div class="ctx-row"><span class="ctx-label">${label}</span><span class="ctx-value">${esc(value || '—')}</span></div>`;
}

function addRevisionLog(action) {
  state.revisionLog.unshift({
    time: new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
    action,
  });
}

/* ── Export All ───────────────────────────────────────────────────────────── */
function updateExportAllButton() {
  const btn = document.getElementById('btn-export-all');
  const a = state.draft.approvals || {};
  const allOk = a.deck && a.model && a.vcShortlist;
  btn.disabled = !allOk;
  btn.title = allOk ? '' : 'All outputs must be approved before exporting';
}

async function handleExportAll() {
  const btn = document.getElementById('btn-export-all');
  btn.disabled = true;
  btn.textContent = 'Exporting...';

  try {
    const res = await apiPost(`/outputs/${encodeURIComponent(state.slug)}/export`, {});
    btn.textContent = 'Export All';
    updateExportAllButton();

    const bar = document.getElementById('export-result-bar');
    const msg = document.getElementById('export-result-msg');
    msg.innerHTML = `
      <div class="export-success-inner">
        <span class="export-check">&#10003;</span>
        <div>
          <div class="export-success-title">Exported successfully</div>
          <div class="export-path">${esc(res.exportPath)}/</div>
          <ul class="export-files">
            ${res.files.map(f => `<li>${esc(f)}</li>`).join('')}
          </ul>
        </div>
      </div>`;
    bar.hidden = false;
  } catch (err) {
    btn.textContent = 'Export All';
    updateExportAllButton();
    alert(`Export failed: ${err.message}`);
  }
}

/* ── Utilities ────────────────────────────────────────────────────────────── */
function esc(str) {
  if (str == null) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtUSD(n) {
  if (n == null || n === '') return '—';
  const num = Number(n);
  if (isNaN(num)) return '—';
  const abs = Math.abs(num);
  const sign = num < 0 ? '-' : '';
  if (abs >= 1_000_000) return sign + '$' + (abs / 1_000_000).toFixed(1) + 'M';
  if (abs >= 1_000) return sign + '$' + (abs / 1_000).toFixed(0) + 'K';
  return sign + '$' + abs.toLocaleString();
}

function fmtNum(n) {
  if (n == null) return '';
  const num = Number(n);
  if (isNaN(num)) return '';
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + 'M';
  if (num >= 1_000) return (num / 1_000).toFixed(0) + 'K';
  return String(num);
}

function fmtDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch { return iso; }
}

function showError(msg) {
  const banner = document.getElementById('error-banner');
  document.getElementById('error-text').textContent = msg;
  banner.hidden = false;
}
