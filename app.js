/* ============================================================
   Client CRM — vanilla JS, localStorage-backed
   ============================================================ */

/* ---------- tiny helpers ---------- */
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const todayStr = () => new Date().toISOString().slice(0, 10);
const nowIso = () => new Date().toISOString();
function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(d + (String(d).length <= 10 ? 'T00:00:00' : ''));
  if (isNaN(dt)) return '—';
  return dt.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
function fmtDateTime(d) {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt)) return '—';
  return dt.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ' · ' + dt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}
function daysBetween(a, b) {
  const A = new Date(a + 'T00:00:00'), B = new Date(b + 'T00:00:00');
  return Math.round((B - A) / 86400000);
}
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('on'), 2200);
}
function lines(s) { return String(s || '').split('\n').map((x) => x.trim()).filter(Boolean); }

/* ---------- constants / vocabulary ---------- */
const STAGES = ['New', 'Contacted', 'Interested', 'Quote Sent', 'Follow-Up', 'Application', 'Won', 'Lost'];
const CLOSED_STAGES = ['Won', 'Lost'];
const STAGE_CLASS = {
  'New': 'new', 'Contacted': 'contacted', 'Interested': 'interested', 'Quote Sent': 'quoted',
  'Follow-Up': 'followup', 'Application': 'application', 'Won': 'won', 'Lost': 'lost',
};
const STAGE_DEFAULT_PROB = { 'New': 10, 'Contacted': 25, 'Interested': 40, 'Quote Sent': 60, 'Follow-Up': 55, 'Application': 80, 'Won': 100, 'Lost': 0 };
const INTERACTION_TYPES = ['Phone call', 'WhatsApp', 'Email', 'Meeting', 'No answer', 'Follow-up', 'Quote sent', 'Other'];
const LEAD_SOURCES = ['Referral', 'Facebook Ads', 'Google Ads', 'Website', 'Walk-in', 'Cold Call', 'Existing Client', 'Other'];
const CONTACT_METHODS = ['Phone call', 'WhatsApp', 'Email', 'SMS'];

const KNOWLEDGE_ITEMS = [
  { key: 'personal', label: 'Personal situation', check: (c) => !!(c.age || c.occupation || c.familyStatus), question: 'What can you tell me about your current situation — work, family, that kind of thing?' },
  { key: 'provider', label: 'Current provider', check: (c) => !!c.currentProvider, question: 'Who are you currently with, and what plan are you on?' },
  { key: 'price', label: 'Current price', check: (c) => !!c.currentPrice, question: 'What are you paying per month right now?' },
  { key: 'need', label: 'Main need', check: (c) => !!c.mainNeeds, question: "What's the main thing you're looking for?" },
  { key: 'budget', label: 'Budget', check: (c) => !!c.budget, question: 'What monthly amount would you be comfortable spending?' },
  { key: 'decisionMaker', label: 'Decision maker', check: (c) => !!c.decisionMaker, question: 'Will you be making the decision yourself, or will someone else need to be involved?' },
  { key: 'objection', label: 'Main objection', check: (c) => !!c.mainObjection, question: 'Is there anything currently stopping you from going ahead?' },
  { key: 'motivation', label: 'Buying motivation', check: (c) => !!c.lookingFor, question: "What's making you consider a change right now?" },
  { key: 'contactTime', label: 'Preferred contact time', check: (c) => !!c.bestTime, question: "What's the best time of day to reach you?" },
  { key: 'dependants', label: 'Family/dependants', check: (c) => !!c.dependants, question: 'Do you have any dependants I should factor in?' },
  { key: 'competitor', label: 'Competitor information', check: (c) => !!(c.currentProvider && c.reasonForChange), question: "What don't you love about your current provider — why look elsewhere?" },
  { key: 'nextStep', label: 'Next step', check: (c) => !!(c.standing && c.standing.nextAction), question: 'Decide and record the next action for this client.' },
];

/* ---------- storage ---------- */
const KEY = 'crm.v1';
const Store = {
  _d: null,
  load() {
    if (this._d) return this._d;
    let raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) {}
    try { this._d = raw ? JSON.parse(raw) : null; } catch (e) { this._d = null; }
    if (!this._d) this._d = { clients: [], customFields: [], salespeople: ['Me'], settings: { theme: 'system' }, seeded: false };
    if (!Array.isArray(this._d.clients)) this._d.clients = [];
    if (!Array.isArray(this._d.customFields)) this._d.customFields = [];
    if (!Array.isArray(this._d.salespeople) || !this._d.salespeople.length) this._d.salespeople = ['Me'];
    if (!this._d.settings) this._d.settings = { theme: 'system' };
    return this._d;
  },
  save() {
    try { localStorage.setItem(KEY, JSON.stringify(this._d)); }
    catch (e) { toast('Storage full — export a backup'); }
  },
  clients() { return this.load().clients; },
  get(id) { return this.clients().find((c) => c.id === id) || null; },
  put(c) {
    const l = this.clients();
    const i = l.findIndex((x) => x.id === c.id);
    if (i >= 0) l[i] = c; else l.push(c);
    this.save();
  },
  remove(id) {
    const d = this.load();
    d.clients = d.clients.filter((c) => c.id !== id);
    this.save();
  },
};

/* ---------- client model ---------- */
function newClient(overrides) {
  const now = nowIso();
  return Object.assign({
    id: uid(),
    name: '', phone: '', email: '', location: '', age: '', occupation: '',
    familyStatus: '', dependants: '', currentProvider: '', currentPrice: '',
    lookingFor: '', budget: '', mainNeeds: '', mainConcerns: '', objections: '',
    mainObjection: '', reasonForChange: '', productInterest: '', quoteAmount: '',
    decisionMaker: '', preferredContact: '', bestTime: '', leadSource: '',
    dateAdded: todayStr(), lastContact: '', nextFollowUp: '', stage: 'New',
    probability: STAGE_DEFAULT_PROB['New'], assignedTo: 'Me', notes: '',
    closedDate: '',
    standing: { whereIStand: '', whatIKnow: '', needToFindOut: '', nextAction: '' },
    interactions: [], stageHistory: [{ stage: 'New', date: now }],
    followUpHistory: [], customFields: {}, createdAt: now, updatedAt: now,
  }, overrides || {});
}
function normaliseClient(r) {
  const c = newClient();
  Object.keys(c).forEach((k) => { if (r[k] !== undefined) c[k] = r[k]; });
  c.id = r.id || c.id;
  c.standing = Object.assign({ whereIStand: '', whatIKnow: '', needToFindOut: '', nextAction: '' }, r.standing || {});
  c.interactions = Array.isArray(r.interactions) ? r.interactions : [];
  c.stageHistory = Array.isArray(r.stageHistory) && r.stageHistory.length ? r.stageHistory : [{ stage: c.stage, date: c.createdAt }];
  c.followUpHistory = Array.isArray(r.followUpHistory) ? r.followUpHistory : [];
  c.customFields = (r.customFields && typeof r.customFields === 'object') ? r.customFields : {};
  return c;
}

function knowledgePct(c) {
  const got = KNOWLEDGE_ITEMS.filter((k) => k.check(c)).length;
  return Math.round((got / KNOWLEDGE_ITEMS.length) * 100);
}
function missingKnowledge(c) { return KNOWLEDGE_ITEMS.filter((k) => !k.check(c)); }

function followUpBucket(c) {
  if (!c.nextFollowUp || CLOSED_STAGES.includes(c.stage)) return null;
  const t = todayStr();
  const d = daysBetween(t, c.nextFollowUp);
  if (d < 0) return 'overdue';
  if (d === 0) return 'today';
  if (d <= 7) return 'upcoming';
  return null;
}

/* ---------- app state ---------- */
const State = {
  page: 'dashboard',
  filters: { q: '', stage: '', source: '', location: '', assignedTo: '', product: '', overdueOnly: false, noFollowup: false },
  openClientId: null,
};

/* ---------- boot / demo data ---------- */
function seedDemoData() {
  const d = Store.load();
  if (d.seeded) return;
  const mk = (o) => normaliseClient(newClient(o));
  const ago = (n) => { const x = new Date(); x.setDate(x.getDate() - n); return x.toISOString().slice(0, 10); };
  const fut = (n) => { const x = new Date(); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
  const demo = [
    mk({ name: 'Naledi Khumalo', phone: '+27 82 123 4567', email: 'naledi.k@example.com', location: 'Johannesburg', age: '34', occupation: 'Accountant', familyStatus: 'Married', dependants: '2 kids', currentProvider: 'Discovery', currentPrice: 'R2,450/mo', lookingFor: 'Cheaper hospital plan with same cover', budget: 'R2,000/mo', mainNeeds: 'Hospital cover, dental', mainConcerns: 'Waiting periods', objections: 'Worried about losing chronic medication cover', mainObjection: 'Price', decisionMaker: 'Joint with husband', preferredContact: 'WhatsApp', bestTime: 'After 17:00', leadSource: 'Referral', dateAdded: ago(18), lastContact: ago(2), nextFollowUp: todayStr(), stage: 'Quote Sent', probability: 60, assignedTo: 'Me', notes: 'Very engaged, compares numbers carefully.', productInterest: 'Comprehensive Hospital Plan', quoteAmount: 'R1,890/mo', reasonForChange: 'Premiums keep rising with no better cover', standing: { whereIStand: 'Client is interested but wants to discuss it with her husband.', whatIKnow: 'Wants hospital cover\nBudget around R2,000/month\nCurrently with another provider\nConcerned about waiting periods', needToFindOut: 'Whether husband is willing to switch\nExact number of dependants', nextAction: 'Call client Thursday at 17:30' } }),
    mk({ name: 'Sipho Dlamini', phone: '+27 71 555 2211', email: 'sipho.d@example.com', location: 'Pretoria', age: '41', occupation: 'Truck driver', familyStatus: 'Single', dependants: '', currentProvider: '', currentPrice: '', lookingFor: 'Basic life cover', budget: '', mainNeeds: 'Life cover for family back home', mainConcerns: '', objections: '', mainObjection: '', decisionMaker: 'Himself', preferredContact: 'Phone call', bestTime: '', leadSource: 'Facebook Ads', dateAdded: ago(3), lastContact: '', nextFollowUp: '', stage: 'New', probability: 10, assignedTo: 'Me', notes: 'Came in via FB lead form, not yet contacted.' }),
    mk({ name: 'Priya Naidoo', phone: '+27 83 777 9090', email: 'priya.n@example.com', location: 'Durban', age: '29', occupation: 'Teacher', familyStatus: 'Engaged', dependants: '', currentProvider: 'Bonitas', currentPrice: 'R1,780/mo', lookingFor: 'Better maternity benefits', budget: 'R1,900/mo', mainNeeds: 'Maternity, dental', mainConcerns: 'Network of doctors', objections: '', mainObjection: 'Not sure yet', decisionMaker: 'Herself', preferredContact: 'Email', bestTime: 'Lunchtime', leadSource: 'Google Ads', dateAdded: ago(9), lastContact: ago(1), nextFollowUp: ago(1), stage: 'Follow-Up', probability: 55, assignedTo: 'Me', notes: 'Planning a wedding, timeline is tight.' }),
    mk({ name: 'Johan van Wyk', phone: '+27 84 222 3344', email: 'johan.vw@example.com', location: 'Cape Town', age: '52', occupation: 'Business owner', familyStatus: 'Married', dependants: '3 kids', currentProvider: 'Momentum', currentPrice: 'R6,100/mo', lookingFor: 'Family plan review', budget: 'R6,500/mo', mainNeeds: 'Comprehensive family cover', mainConcerns: 'Gap cover', objections: 'Happy with current provider', mainObjection: 'Loyalty to current provider', decisionMaker: 'Himself', preferredContact: 'Phone call', bestTime: 'Mornings', leadSource: 'Referral', dateAdded: ago(40), lastContact: ago(20), nextFollowUp: fut(3), stage: 'Interested', probability: 40, assignedTo: 'Me', notes: 'Slow mover, needs nurturing.' }),
    mk({ name: 'Ayesha Patel', phone: '+27 76 444 8811', email: 'ayesha.p@example.com', location: 'Johannesburg', age: '38', occupation: 'Pharmacist', familyStatus: 'Married', dependants: '1 kid', currentProvider: 'Fedhealth', currentPrice: 'R2,900/mo', lookingFor: 'Lower premium', budget: 'R2,300/mo', mainNeeds: 'Chronic medication cover', mainConcerns: 'Downgrade risk', objections: 'Scared of losing existing cover', mainObjection: 'Fear of downgrading cover', decisionMaker: 'Joint', preferredContact: 'WhatsApp', bestTime: 'Evenings', leadSource: 'Existing Client', dateAdded: ago(65), lastContact: ago(30), nextFollowUp: ago(4), stage: 'Follow-Up', probability: 55, assignedTo: 'Me', notes: 'Went quiet after last quote.' }),
    mk({ name: 'Thabo Mokoena', phone: '+27 79 900 1122', email: 'thabo.m@example.com', location: 'Bloemfontein', age: '45', occupation: 'Teacher', familyStatus: 'Divorced', dependants: '1 kid', currentProvider: '', currentPrice: '', lookingFor: 'Affordable hospital plan', budget: 'R1,200/mo', mainNeeds: 'Basic hospital plan', mainConcerns: '', objections: '', mainObjection: '', decisionMaker: 'Himself', preferredContact: 'Phone call', bestTime: '', leadSource: 'Cold Call', dateAdded: ago(6), lastContact: ago(5), nextFollowUp: '', stage: 'Contacted', probability: 25, assignedTo: 'Me', notes: '' }),
    mk({ name: 'Lerato Mahlangu', phone: '+27 82 333 5566', email: 'lerato.m@example.com', location: 'Johannesburg', age: '31', occupation: 'Software developer', familyStatus: 'Single', dependants: '', currentProvider: 'Discovery', currentPrice: 'R2,100/mo', lookingFor: 'Digital-first insurer', budget: 'R2,200/mo', mainNeeds: 'Gym benefits, low admin', mainConcerns: '', objections: '', mainObjection: '', decisionMaker: 'Herself', preferredContact: 'Email', bestTime: '', leadSource: 'Website', dateAdded: ago(120), lastContact: ago(90), nextFollowUp: '', stage: 'Won', probability: 100, assignedTo: 'Me', notes: 'Signed up, happy client.', closedDate: ago(85), productInterest: 'Smart Plan', quoteAmount: 'R2,150/mo' }),
    mk({ name: 'Riaan Botha', phone: '+27 78 111 2200', email: 'riaan.b@example.com', location: 'Pretoria', age: '48', occupation: 'Engineer', familyStatus: 'Married', dependants: '2 kids', currentProvider: 'Bestmed', currentPrice: 'R3,300/mo', lookingFor: 'Nothing, happy where he is', budget: '', mainNeeds: '', mainConcerns: '', objections: 'Not interested, staying put', mainObjection: 'Not interested', decisionMaker: 'Himself', preferredContact: 'Phone call', bestTime: '', leadSource: 'Cold Call', dateAdded: ago(50), lastContact: ago(48), nextFollowUp: '', stage: 'Lost', probability: 0, assignedTo: 'Me', notes: 'Declined twice, marked lost.', closedDate: ago(45) }),
  ];
  d.clients = demo;
  d.seeded = true;
  Store.save();
}

/* ---------- theme ---------- */
function applyTheme() {
  const t = Store.load().settings.theme || 'system';
  const root = document.documentElement;
  if (t === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', t);
}

/* ---------- nav / render dispatch ---------- */
const PAGES = [
  { id: 'dashboard', label: 'Dashboard', icon: 'grid' },
  { id: 'clients', label: 'Clients', icon: 'users' },
  { id: 'pipeline', label: 'Pipeline', icon: 'columns' },
  { id: 'followups', label: 'Follow-Ups', icon: 'clock' },
  { id: 'analytics', label: 'Analytics', icon: 'chart' },
  { id: 'settings', label: 'Settings', icon: 'gear' },
];
const ICONS = {
  grid: '<path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/>',
  users: '<circle cx="9" cy="8" r="3"/><path d="M2 20c0-3.5 3-6 7-6s7 2.5 7 6"/><circle cx="17" cy="8" r="2.5"/><path d="M17 12c2.4 0 5 1.8 5 5"/>',
  columns: '<path d="M4 4h4v16H4zM10 4h4v10h-4zM16 4h4v13h-4z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  chart: '<path d="M4 20V10M11 20V4M18 20v-7"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 13a7.6 7.6 0 000-2l2-1.5-2-3.4-2.3 1a7.7 7.7 0 00-1.8-1L15 3.5h-4l-.3 2.6a7.7 7.7 0 00-1.8 1l-2.3-1-2 3.4L6.6 11a7.6 7.6 0 000 2l-2 1.5 2 3.4 2.3-1a7.7 7.7 0 001.8 1l.3 2.6h4l.3-2.6a7.7 7.7 0 001.8-1l2.3 1 2-3.4z"/>',
};

function icon(name, cls) { return `<svg class="ic ${cls||''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`; }

function buildShell() {
  $('#sidebar').innerHTML = `
    <div class="brand">${icon('grid')}<span>ClientCRM</span></div>
    <nav class="sidenav">
      ${PAGES.map((p) => `<button class="navitem" data-page="${p.id}">${icon(p.icon)}<span>${p.label}</span></button>`).join('')}
    </nav>
    <div class="sidefoot">
      <button class="navitem" id="themeToggleDesktop">${icon('gear')}<span>Toggle theme</span></button>
    </div>`;
  $('#bottomnav').innerHTML = PAGES.map((p) => `<button class="navitem" data-page="${p.id}">${icon(p.icon)}<span>${p.label}</span></button>`).join('');
  $$('.navitem[data-page]').forEach((b) => b.addEventListener('click', () => setPage(b.dataset.page)));
  $('#themeToggleDesktop').addEventListener('click', cycleTheme);
  $('#themeToggleMobile').addEventListener('click', cycleTheme);
  $('#globalSearch').addEventListener('input', (e) => {
    State.filters.q = e.target.value;
    if (State.page !== 'clients') setPage('clients'); else render();
  });
  $('#hamburger').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
  $('#scrim').addEventListener('click', () => $('#sidebar').classList.remove('open'));
}
function cycleTheme() {
  const order = ['system', 'light', 'dark'];
  const cur = Store.load().settings.theme || 'system';
  const next = order[(order.indexOf(cur) + 1) % order.length];
  Store.load().settings.theme = next;
  Store.save();
  applyTheme();
  toast('Theme: ' + next);
  if (State.page === 'settings') render();
}
function setPage(id) {
  State.page = id;
  $$('.navitem[data-page]').forEach((b) => b.classList.toggle('active', b.dataset.page === id));
  $('#sidebar').classList.remove('open');
  window.scrollTo(0, 0);
  render();
}
function render() {
  const root = $('#pageRoot');
  $('#pageTitle').textContent = PAGES.find((p) => p.id === State.page)?.label || '';
  if (State.page === 'dashboard') return renderDashboard(root);
  if (State.page === 'clients') return renderClients(root);
  if (State.page === 'pipeline') return renderPipeline(root);
  if (State.page === 'followups') return renderFollowups(root);
  if (State.page === 'analytics') return renderAnalytics(root);
  if (State.page === 'settings') return renderSettings(root);
}

/* ---------- shared UI bits ---------- */
function stageBadge(stage) { return `<span class="badge stage ${STAGE_CLASS[stage] || ''}">${esc(stage)}</span>`; }
function probBar(p) { return `<div class="probwrap" title="${p}% probability"><div class="probbar"><div class="probfill" style="width:${p}%"></div></div><span class="probn">${p}%</span></div>`; }
function knowledgeChip(c) {
  const pct = knowledgePct(c);
  const cls = pct >= 75 ? 'good' : pct >= 40 ? 'warn' : 'bad';
  return `<span class="chip know ${cls}">Knowledge ${pct}%</span>`;
}
function followUpChip(c) {
  const b = followUpBucket(c);
  if (!b) return c.nextFollowUp ? `<span class="chip fu upcoming">Due ${fmtDate(c.nextFollowUp)}</span>` : '';
  const labels = { overdue: 'Overdue', today: 'Due today', upcoming: 'Upcoming ' + fmtDate(c.nextFollowUp) };
  return `<span class="chip fu ${b}">${labels[b]}</span>`;
}
function waLink(phone) { return 'https://wa.me/' + String(phone || '').replace(/[^0-9]/g, ''); }
function telLink(phone) { return 'tel:' + String(phone || '').replace(/\s+/g, ''); }

function clientCard(c) {
  return `
  <div class="ccard" data-open="${c.id}">
    <div class="ccard-top">
      <div class="cname">${esc(c.name || 'Unnamed')}</div>
      ${stageBadge(c.stage)}
    </div>
    <div class="cmeta">
      <span>${esc(c.location || '—')}</span>
      <span>${esc(c.leadSource || '—')}</span>
      <span>${esc(c.assignedTo || '—')}</span>
    </div>
    <div class="cchips">${knowledgeChip(c)} ${followUpChip(c)}</div>
    ${probBar(c.probability)}
  </div>`;
}

/* ============================================================
   DASHBOARD
   ============================================================ */
function renderDashboard(root) {
  const all = Store.clients();
  const count = (s) => all.filter((c) => c.stage === s).length;
  const today = todayStr();
  const dueToday = all.filter((c) => followUpBucket(c) === 'today').length;
  const overdue = all.filter((c) => followUpBucket(c) === 'overdue').length;
  const stats = [
    ['Total clients', all.length, ''],
    ['New leads', count('New'), 'new'],
    ['Contacted', count('Contacted'), 'contacted'],
    ['Interested', count('Interested'), 'interested'],
    ['Quote sent', count('Quote Sent'), 'quoted'],
    ['Follow-up required', count('Follow-Up'), 'followup'],
    ['Application requested', count('Application'), 'application'],
    ['Won', count('Won'), 'won'],
    ['Lost', count('Lost'), 'lost'],
    ['Due today', dueToday, 'today'],
    ['Overdue follow-ups', overdue, 'overdue'],
  ];
  const funnelStages = ['New', 'Contacted', 'Interested', 'Quote Sent', 'Follow-Up', 'Application'];
  root.innerHTML = `
    <div class="statgrid">
      ${stats.map(([l, n, c]) => `<div class="stat glass ${c}"><div class="stat-n">${n}</div><div class="stat-l">${esc(l)}</div></div>`).join('')}
    </div>
    <h2>Pipeline</h2>
    <div class="funnel">
      ${funnelStages.map((s, i) => `<div class="funnelstep"><div class="funnelbox ${STAGE_CLASS[s]}"><div class="fn">${count(s)}</div><div class="fl">${esc(s)}</div></div>${i < funnelStages.length - 1 ? '<div class="funnelarrow">→</div>' : ''}</div>`).join('')}
      <div class="funnelarrow">→</div>
      <div class="funnelstep">
        <div class="funnelbox wonlost"><div class="fn">${count('Won')} / ${count('Lost')}</div><div class="fl">Won / Lost</div></div>
      </div>
    </div>
    <h2>Needs attention</h2>
    <div class="list">
      ${all.filter((c) => followUpBucket(c) === 'overdue' || followUpBucket(c) === 'today')
        .sort((a, b) => (a.nextFollowUp || '').localeCompare(b.nextFollowUp || ''))
        .slice(0, 8).map(clientCard).join('') || '<p class="empty">Nothing needs attention right now.</p>'}
    </div>`;
  bindCardOpens(root);
}

/* ============================================================
   CLIENTS
   ============================================================ */
function filteredClients() {
  const f = State.filters;
  const q = f.q.trim().toLowerCase();
  return Store.clients().filter((c) => {
    if (f.stage && c.stage !== f.stage) return false;
    if (f.source && c.leadSource !== f.source) return false;
    if (f.location && (c.location || '').toLowerCase() !== f.location.toLowerCase()) return false;
    if (f.assignedTo && c.assignedTo !== f.assignedTo) return false;
    if (f.product && (c.productInterest || '') !== f.product) return false;
    if (f.overdueOnly && followUpBucket(c) !== 'overdue') return false;
    if (f.noFollowup && c.nextFollowUp) return false;
    if (q) {
      const hay = [c.name, c.phone, c.email, c.notes, c.objections, c.mainObjection, c.mainNeeds, c.location, c.currentProvider, c.leadSource].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}
function uniqueVals(key) { return Array.from(new Set(Store.clients().map((c) => c[key]).filter(Boolean))); }

function renderClients(root) {
  const list = filteredClients();
  const f = State.filters;
  root.innerHTML = `
    <div class="toolbar">
      <div class="tb-search"><input type="text" id="clientsSearch" placeholder="Search name, phone, email, notes, objections…" value="${esc(f.q)}"></div>
      <button class="btn secondary" id="toggleFilters">Filters</button>
      <button class="btn" id="addClientBtn">+ Add Client</button>
    </div>
    <div class="filterbar" id="filterBar" hidden>
      <select id="fStage"><option value="">All stages</option>${STAGES.map((s) => `<option ${f.stage === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
      <select id="fSource"><option value="">All sources</option>${uniqueVals('leadSource').map((s) => `<option ${f.source === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>
      <select id="fLocation"><option value="">All locations</option>${uniqueVals('location').map((s) => `<option ${f.location === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>
      <select id="fAssigned"><option value="">All salespeople</option>${Store.load().salespeople.map((s) => `<option ${f.assignedTo === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>
      <select id="fProduct"><option value="">All products</option>${uniqueVals('productInterest').map((s) => `<option ${f.product === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>
      <label class="chkline"><input type="checkbox" id="fOverdue" ${f.overdueOnly ? 'checked' : ''}> Overdue only</label>
      <label class="chkline"><input type="checkbox" id="fNoFollowup" ${f.noFollowup ? 'checked' : ''}> No follow-up scheduled</label>
      <button class="btn secondary" id="clearFilters">Clear</button>
    </div>
    <p class="muted small">${list.length} of ${Store.clients().length} clients</p>
    <div class="list">
      ${list.map(clientCard).join('') || '<p class="empty">No clients match. Try clearing filters, or add your first client.</p>'}
    </div>`;
  $('#clientsSearch').addEventListener('input', (e) => { State.filters.q = e.target.value; renderClients(root); });
  $('#addClientBtn').addEventListener('click', () => openClientForm(null));
  $('#toggleFilters').addEventListener('click', () => $('#filterBar').hidden = !$('#filterBar').hidden);
  $('#fStage').addEventListener('change', (e) => { State.filters.stage = e.target.value; renderClients(root); });
  $('#fSource').addEventListener('change', (e) => { State.filters.source = e.target.value; renderClients(root); });
  $('#fLocation').addEventListener('change', (e) => { State.filters.location = e.target.value; renderClients(root); });
  $('#fAssigned').addEventListener('change', (e) => { State.filters.assignedTo = e.target.value; renderClients(root); });
  $('#fProduct').addEventListener('change', (e) => { State.filters.product = e.target.value; renderClients(root); });
  $('#fOverdue').addEventListener('change', (e) => { State.filters.overdueOnly = e.target.checked; renderClients(root); });
  $('#fNoFollowup').addEventListener('change', (e) => { State.filters.noFollowup = e.target.checked; renderClients(root); });
  $('#clearFilters').addEventListener('click', () => { State.filters = { q: '', stage: '', source: '', location: '', assignedTo: '', product: '', overdueOnly: false, noFollowup: false }; renderClients(root); });
  bindCardOpens(root);
  $('#filterBar').hidden = !(f.stage || f.source || f.location || f.assignedTo || f.product || f.overdueOnly || f.noFollowup) ? true : false;
}
function bindCardOpens(root) {
  $$('[data-open]', root).forEach((el) => el.addEventListener('click', () => openClientProfile(el.dataset.open)));
}

/* ============================================================
   PIPELINE (Kanban)
   ============================================================ */
function renderPipeline(root) {
  const all = Store.clients();
  root.innerHTML = `<div class="board">
    ${STAGES.map((s) => `
      <div class="col" data-col="${s}">
        <div class="colhead ${STAGE_CLASS[s]}"><span>${esc(s)}</span><span class="colcount">${all.filter((c) => c.stage === s).length}</span></div>
        <div class="coldrop" data-drop="${s}">
          ${all.filter((c) => c.stage === s).map((c) => `
            <div class="kcard" draggable="true" data-id="${c.id}" data-open="${c.id}">
              <div class="kname">${esc(c.name || 'Unnamed')}</div>
              <div class="kmeta">${esc(c.leadSource || '')}</div>
              ${probBar(c.probability)}
            </div>`).join('')}
        </div>
      </div>`).join('')}
  </div>`;
  bindCardOpens(root);
  $$('.kcard', root).forEach((card) => {
    card.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', card.dataset.id); card.classList.add('dragging'); });
    card.addEventListener('dragend', () => card.classList.remove('dragging'));
  });
  $$('.coldrop', root).forEach((col) => {
    col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('over'); });
    col.addEventListener('dragleave', () => col.classList.remove('over'));
    col.addEventListener('drop', (e) => {
      e.preventDefault(); col.classList.remove('over');
      const id = e.dataTransfer.getData('text/plain');
      moveClientStage(id, col.dataset.drop);
      renderPipeline(root);
    });
  });
}
function moveClientStage(id, stage) {
  const c = Store.get(id); if (!c || c.stage === stage) return;
  c.stage = stage;
  c.stageHistory.push({ stage, date: nowIso() });
  c.probability = STAGE_DEFAULT_PROB[stage] ?? c.probability;
  if (CLOSED_STAGES.includes(stage) && !c.closedDate) c.closedDate = todayStr();
  if (!CLOSED_STAGES.includes(stage)) c.closedDate = '';
  c.updatedAt = nowIso();
  Store.put(c);
  toast(`${c.name || 'Client'} moved to ${stage}`);
}

/* ============================================================
   FOLLOW-UPS
   ============================================================ */
function renderFollowups(root) {
  const all = Store.clients().filter((c) => !CLOSED_STAGES.includes(c.stage));
  const overdue = all.filter((c) => followUpBucket(c) === 'overdue').sort((a, b) => a.nextFollowUp.localeCompare(b.nextFollowUp));
  const today = all.filter((c) => followUpBucket(c) === 'today');
  const upcoming = all.filter((c) => followUpBucket(c) === 'upcoming').sort((a, b) => a.nextFollowUp.localeCompare(b.nextFollowUp));
  const section = (title, items, cls) => `
    <div class="sectionhead"><span>${title}</span><span class="count">${items.length}</span></div>
    <div class="list">
      ${items.map((c) => `
        <div class="fucard ${cls}">
          <div class="fucard-main" data-open="${c.id}">
            <div class="cname">${esc(c.name || 'Unnamed')} ${stageBadge(c.stage)}</div>
            <div class="cmeta"><span>${esc(fmtDate(c.nextFollowUp))}</span><span>${esc(c.phone || '')}</span></div>
            ${c.standing.nextAction ? `<div class="hint">${esc(c.standing.nextAction)}</div>` : ''}
          </div>
          <div class="fuactions">
            <button class="btn small" data-complete="${c.id}">Complete</button>
            ${cls === 'overdue' ? `<button class="btn small secondary" data-missed="${c.id}">Missed</button>` : ''}
          </div>
        </div>`).join('') || `<p class="empty">Nothing here.</p>`}
    </div>`;
  root.innerHTML = section('Overdue', overdue, 'overdue') + section('Today', today, 'today') + section('Upcoming (7 days)', upcoming, 'upcoming');
  bindCardOpens(root);
  $$('[data-complete]', root).forEach((b) => b.addEventListener('click', () => completeFollowUp(b.dataset.complete, false)));
  $$('[data-missed]', root).forEach((b) => b.addEventListener('click', () => completeFollowUp(b.dataset.missed, true)));
}
function completeFollowUp(id, missed) {
  const c = Store.get(id); if (!c) return;
  openFollowUpModal(c, missed);
}

/* ============================================================
   ANALYTICS
   ============================================================ */
function barList(rows, max) {
  const m = Math.max(1, ...rows.map((r) => r.n));
  return `<div class="glass bars">${rows.slice(0, max || 8).map((r) => `
    <div class="bar"><span class="lab">${esc(r.label)}</span><span class="val">${r.n}</span>
    <div class="track"><div class="fill" style="width:${(r.n / m) * 100}%"></div></div></div>`).join('') || '<p class="empty">No data yet.</p>'}</div>`;
}
function tally(list, fn) {
  const map = {};
  list.forEach((c) => {
    const v = fn(c);
    (Array.isArray(v) ? v : [v]).forEach((x) => { const k = String(x || '').trim(); if (!k) return; map[k] = (map[k] || 0) + 1; });
  });
  return Object.entries(map).map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n);
}
function renderAnalytics(root) {
  const all = Store.clients();
  const won = all.filter((c) => c.stage === 'Won');
  const lost = all.filter((c) => c.stage === 'Lost');
  const decided = won.length + lost.length;
  const leadsAdded = all.length;
  const contacted = all.filter((c) => c.interactions.length > 0 || c.stage !== 'New').length;
  const quotesSent = all.filter((c) => c.stage === 'Quote Sent' || c.quoteAmount).length;
  const applications = all.filter((c) => c.stage === 'Application' || c.stageHistory.some((h) => h.stage === 'Application')).length;
  const avgDays = won.length ? Math.round(won.reduce((a, c) => a + Math.max(0, daysBetween(c.dateAdded, c.closedDate || c.dateAdded)), 0) / won.length) : null;
  let fuCompleted = 0, fuMissed = 0;
  all.forEach((c) => c.followUpHistory.forEach((h) => { if (h.completedAt) fuCompleted++; if (h.missed) fuMissed++; }));
  const stats = [
    ['Leads added', leadsAdded], ['Contacts made', contacted], ['Quotes sent', quotesSent],
    ['Applications', applications], ['Won clients', won.length], ['Lost clients', lost.length],
    ['Conversion rate', decided ? Math.round((won.length / decided) * 100) + '%' : '—'],
    ['Avg. lead → won', avgDays !== null ? avgDays + ' days' : '—'],
    ['Follow-ups completed', fuCompleted], ['Follow-ups missed', fuMissed],
  ];
  const objections = tally(all, (c) => c.mainObjection);
  const sources = tally(all, (c) => c.leadSource);
  const needs = tally(all, (c) => String(c.mainNeeds || '').split(/[,;]/));
  root.innerHTML = `
    <div class="statgrid">${stats.map(([l, n]) => `<div class="stat glass"><div class="stat-n">${n}</div><div class="stat-l">${esc(l)}</div></div>`).join('')}</div>
    <h2>Most common objections</h2>${barList(objections)}
    <h2>Most common lead sources</h2>${barList(sources)}
    <h2>Most common client needs</h2>${barList(needs)}`;
}

/* ============================================================
   SETTINGS
   ============================================================ */
function renderSettings(root) {
  const d = Store.load();
  root.innerHTML = `
    <h2>Appearance</h2>
    <div class="card glass">
      <div class="field"><label>Theme</label>
        <div class="pickrow">
          ${['system', 'light', 'dark'].map((t) => `<button class="pick" data-theme="${t}" aria-pressed="${(d.settings.theme || 'system') === t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}
        </div>
      </div>
    </div>
    <h2>Salespeople</h2>
    <div class="card glass">
      <div class="taglist">${d.salespeople.map((s) => `<span class="tag">${esc(s)} <button data-rmsales="${esc(s)}">&times;</button></span>`).join('')}</div>
      <form class="inline" id="addSalesForm"><input type="text" id="newSalesName" placeholder="Add salesperson name" required><button class="btn secondary" type="submit">Add</button></form>
    </div>
    <h2>Custom Fields</h2>
    <div class="card glass">
      <div class="taglist">${d.customFields.map((f) => `<span class="tag">${esc(f.label)} (${f.type}) <button data-rmfield="${f.key}">&times;</button></span>`).join('') || '<span class="muted small">No custom fields yet.</span>'}</div>
      <form class="inline" id="addFieldForm">
        <input type="text" id="newFieldLabel" placeholder="Field label" required>
        <select id="newFieldType"><option value="text">Text</option><option value="number">Number</option><option value="date">Date</option><option value="select">Dropdown</option></select>
        <input type="text" id="newFieldOptions" placeholder="Options (comma-separated, if dropdown)">
        <button class="btn secondary" type="submit">Add field</button>
      </form>
    </div>
    <h2>Data</h2>
    <div class="card glass">
      <div class="btnrow">
        <button class="btn" id="exportJsonBtn">Export JSON backup</button>
        <button class="btn secondary" id="exportCsvBtn">Export CSV</button>
      </div>
      <div class="btnrow" style="margin-top:10px">
        <button class="btn secondary" id="importJsonBtn">Import JSON</button>
        <input type="file" id="importJsonFile" accept="application/json,.json" hidden>
      </div>
      <div class="btnrow" style="margin-top:10px">
        <button class="btn danger" id="resetBtn">Erase all data</button>
      </div>
      <p class="hint">All data lives only in this browser's local storage. Nothing is sent anywhere.</p>
    </div>`;
  $$('[data-theme]', root).forEach((b) => b.addEventListener('click', () => { d.settings.theme = b.dataset.theme; Store.save(); applyTheme(); renderSettings(root); }));
  $('#addSalesForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = $('#newSalesName').value.trim(); if (!v) return;
    if (!d.salespeople.includes(v)) d.salespeople.push(v);
    Store.save(); renderSettings(root);
  });
  $$('[data-rmsales]', root).forEach((b) => b.addEventListener('click', () => { d.salespeople = d.salespeople.filter((s) => s !== b.dataset.rmsales); Store.save(); renderSettings(root); }));
  $('#addFieldForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const label = $('#newFieldLabel').value.trim(); if (!label) return;
    const type = $('#newFieldType').value;
    const opts = $('#newFieldOptions').value.split(',').map((s) => s.trim()).filter(Boolean);
    d.customFields.push({ key: uid(), label, type, options: opts });
    Store.save(); renderSettings(root); toast('Custom field added');
  });
  $$('[data-rmfield]', root).forEach((b) => b.addEventListener('click', () => { d.customFields = d.customFields.filter((f) => f.key !== b.dataset.rmfield); Store.save(); renderSettings(root); }));
  $('#exportJsonBtn').addEventListener('click', exportJson);
  $('#exportCsvBtn').addEventListener('click', exportCsv);
  $('#importJsonBtn').addEventListener('click', () => $('#importJsonFile').click());
  $('#importJsonFile').addEventListener('change', importJson);
  $('#resetBtn').addEventListener('click', async () => {
    if (await confirmDialog('Erase all data?', 'This deletes every client and setting from this browser. This cannot be undone.', 'Erase everything')) {
      localStorage.removeItem(KEY); Store._d = null; Store.load(); seedDemoData(); render(); toast('All data erased');
    }
  });
}

/* ---------- import / export ---------- */
function exportJson() {
  const data = JSON.stringify(Store.load(), null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `crm-backup-${todayStr()}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('Backup downloaded');
}
const CSV_COLS = ['id', 'name', 'phone', 'email', 'location', 'age', 'occupation', 'familyStatus', 'dependants', 'currentProvider', 'currentPrice', 'lookingFor', 'budget', 'mainNeeds', 'mainConcerns', 'objections', 'mainObjection', 'decisionMaker', 'preferredContact', 'bestTime', 'leadSource', 'dateAdded', 'lastContact', 'nextFollowUp', 'stage', 'probability', 'assignedTo', 'notes'];
function exportCsv() {
  const escCsv = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [CSV_COLS.join(',')].concat(Store.clients().map((c) => CSV_COLS.map((k) => escCsv(c[k])).join(',')));
  const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `crm-clients-${todayStr()}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('CSV exported');
}
function importJson(e) {
  const file = e.target.files && e.target.files[0]; e.target.value = ''; if (!file) return;
  const r = new FileReader();
  r.onload = () => {
    let p; try { p = JSON.parse(r.result); } catch (err) { toast('Not a valid backup file'); return; }
    const incoming = Array.isArray(p) ? p : p.clients;
    if (!Array.isArray(incoming)) { toast('No clients found in that file'); return; }
    const d = Store.load();
    const byId = new Map(d.clients.map((c) => [c.id, c]));
    let added = 0, updated = 0;
    incoming.forEach((raw) => {
      const c = normaliseClient(raw);
      if (byId.has(c.id)) updated++; else added++;
      byId.set(c.id, c);
    });
    d.clients = Array.from(byId.values());
    if (p.customFields) d.customFields = p.customFields;
    if (p.salespeople) d.salespeople = p.salespeople;
    Store.save();
    toast(`${added} added, ${updated} updated`);
    render();
  };
  r.readAsText(file);
}

/* ---------- generic confirm dialog ---------- */
function confirmDialog(title, text, confirmLabel) {
  return new Promise((resolve) => {
    const ov = $('#dialogRoot');
    ov.innerHTML = `<div class="overlay" id="dlgOverlay">
      <div class="dialog">
        <h2>${esc(title)}</h2><p>${esc(text)}</p>
        <div class="btnrow"><button class="btn secondary" id="dlgCancel">Cancel</button><button class="btn danger" id="dlgOk">${esc(confirmLabel || 'Confirm')}</button></div>
      </div></div>`;
    const done = (v) => { ov.innerHTML = ''; resolve(v); };
    $('#dlgCancel').addEventListener('click', () => done(false));
    $('#dlgOk').addEventListener('click', () => done(true));
    $('#dlgOverlay').addEventListener('click', (e) => { if (e.target.id === 'dlgOverlay') done(false); });
  });
}

/* ---------- Add/Edit client form ---------- */
function openClientForm(id) {
  const c = id ? Store.get(id) : null;
  const v = c || newClient();
  const custom = Store.load().customFields;
  $('#sheetRoot').innerHTML = `
  <div class="overlay" id="sheetOverlay"><div class="sheet">
    <div class="sheettop"><button class="x" id="closeSheet">Close</button><span class="t">${c ? 'Edit Client' : 'New Client'}</span></div>
    <div class="sheetbody">
      <form id="clientForm">
        <h3>Personal Information</h3>
        <div class="grid2">
          <div class="field"><label>Full name *</label><input name="name" required value="${esc(v.name)}"></div>
          <div class="field"><label>Phone</label><input name="phone" value="${esc(v.phone)}"></div>
          <div class="field"><label>Email</label><input name="email" type="email" value="${esc(v.email)}"></div>
          <div class="field"><label>Location</label><input name="location" value="${esc(v.location)}"></div>
          <div class="field"><label>Age</label><input name="age" value="${esc(v.age)}"></div>
          <div class="field"><label>Occupation</label><input name="occupation" value="${esc(v.occupation)}"></div>
          <div class="field"><label>Family/marital status</label><input name="familyStatus" value="${esc(v.familyStatus)}"></div>
          <div class="field"><label>Dependants</label><input name="dependants" value="${esc(v.dependants)}"></div>
        </div>
        <h3>Sales Information</h3>
        <div class="grid2">
          <div class="field"><label>Current provider/plan</label><input name="currentProvider" value="${esc(v.currentProvider)}"></div>
          <div class="field"><label>Current monthly price</label><input name="currentPrice" value="${esc(v.currentPrice)}"></div>
          <div class="field"><label>What they're looking for</label><input name="lookingFor" value="${esc(v.lookingFor)}"></div>
          <div class="field"><label>Budget</label><input name="budget" value="${esc(v.budget)}"></div>
          <div class="field"><label>Product/plan interested in</label><input name="productInterest" value="${esc(v.productInterest)}"></div>
          <div class="field"><label>Quote amount</label><input name="quoteAmount" value="${esc(v.quoteAmount)}"></div>
          <div class="field"><label>Reason for considering change</label><input name="reasonForChange" value="${esc(v.reasonForChange)}"></div>
          <div class="field"><label>Decision maker</label><input name="decisionMaker" value="${esc(v.decisionMaker)}"></div>
          <div class="field"><label>Main objection</label><input name="mainObjection" value="${esc(v.mainObjection)}"></div>
        </div>
        <div class="field"><label>Main needs</label><textarea name="mainNeeds">${esc(v.mainNeeds)}</textarea></div>
        <div class="field"><label>Main concerns</label><textarea name="mainConcerns">${esc(v.mainConcerns)}</textarea></div>
        <div class="field"><label>Objections (detail)</label><textarea name="objections">${esc(v.objections)}</textarea></div>
        <h3>Contact &amp; Pipeline</h3>
        <div class="grid2">
          <div class="field"><label>Preferred contact method</label>
            <select name="preferredContact">${CONTACT_METHODS.map((m) => `<option ${v.preferredContact === m ? 'selected' : ''}>${m}</option>`).join('')}</select></div>
          <div class="field"><label>Best time to contact</label><input name="bestTime" value="${esc(v.bestTime)}"></div>
          <div class="field"><label>Lead source</label>
            <select name="leadSource"><option value="">—</option>${LEAD_SOURCES.map((s) => `<option ${v.leadSource === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
          <div class="field"><label>Assigned salesperson</label>
            <select name="assignedTo">${Store.load().salespeople.map((s) => `<option ${v.assignedTo === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></div>
          <div class="field"><label>Pipeline stage</label>
            <select name="stage">${STAGES.map((s) => `<option ${v.stage === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
          <div class="field"><label>Probability (%)</label><input name="probability" type="number" min="0" max="100" value="${esc(v.probability)}"></div>
          <div class="field"><label>Date added</label><input name="dateAdded" type="date" value="${esc(v.dateAdded)}"></div>
          <div class="field"><label>Last contact date</label><input name="lastContact" type="date" value="${esc(v.lastContact)}"></div>
          <div class="field"><label>Next follow-up date</label><input name="nextFollowUp" type="date" value="${esc(v.nextFollowUp)}"></div>
        </div>
        <div class="field"><label>Notes</label><textarea name="notes">${esc(v.notes)}</textarea></div>
        ${custom.length ? `<h3>Custom Fields</h3><div class="grid2">${custom.map((f) => customFieldInput(f, v.customFields[f.key])).join('')}</div>` : ''}
        <div class="btnrow" style="margin-top:16px">
          <button type="button" class="btn secondary" id="cancelClientForm">Cancel</button>
          <button type="submit" class="btn">${c ? 'Save Changes' : 'Add Client'}</button>
        </div>
      </form>
    </div>
  </div></div>`;
  $('#closeSheet').addEventListener('click', closeSheet);
  $('#cancelClientForm').addEventListener('click', closeSheet);
  $('#sheetOverlay').addEventListener('click', (e) => { if (e.target.id === 'sheetOverlay') closeSheet(); });
  $('#clientForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const rec = c ? Object.assign({}, c) : newClient();
    ['name', 'phone', 'email', 'location', 'age', 'occupation', 'familyStatus', 'dependants', 'currentProvider', 'currentPrice', 'lookingFor', 'budget', 'mainNeeds', 'mainConcerns', 'objections', 'mainObjection', 'decisionMaker', 'preferredContact', 'bestTime', 'leadSource', 'dateAdded', 'lastContact', 'nextFollowUp', 'stage', 'notes', 'productInterest', 'quoteAmount', 'reasonForChange', 'assignedTo'].forEach((k) => { rec[k] = fd.get(k) || ''; });
    rec.probability = Math.max(0, Math.min(100, Number(fd.get('probability')) || 0));
    custom.forEach((f) => { rec.customFields[f.key] = fd.get('cf_' + f.key) || ''; });
    if (!c) { rec.stageHistory = [{ stage: rec.stage, date: nowIso() }]; }
    else if (rec.stage !== c.stage) { rec.stageHistory = c.stageHistory.concat([{ stage: rec.stage, date: nowIso() }]); }
    rec.updatedAt = nowIso();
    Store.put(rec);
    closeSheet();
    toast(c ? 'Client updated' : 'Client added');
    render();
    if (State.openClientId === rec.id) openClientProfile(rec.id);
  });
}
function customFieldInput(f, val) {
  if (f.type === 'select') return `<div class="field"><label>${esc(f.label)}</label><select name="cf_${f.key}"><option value="">—</option>${(f.options || []).map((o) => `<option ${val === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></div>`;
  return `<div class="field"><label>${esc(f.label)}</label><input name="cf_${f.key}" type="${f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}" value="${esc(val || '')}"></div>`;
}
function closeSheet() { $('#sheetRoot').innerHTML = ''; }

/* ---------- Client Profile ---------- */
function openClientProfile(id) {
  State.openClientId = id;
  drawProfile();
}
function patchClient(id, fn) {
  const c = Store.get(id); if (!c) return;
  fn(c); c.updatedAt = nowIso(); Store.put(c);
  drawProfile();
}
function drawProfile() {
  const c = Store.get(State.openClientId);
  const root = $('#sheetRoot');
  if (!c) { root.innerHTML = ''; return; }
  const missing = missingKnowledge(c);
  const pct = knowledgePct(c);
  const custom = Store.load().customFields;
  root.innerHTML = `
  <div class="overlay" id="profOverlay"><div class="sheet wide">
    <div class="sheettop"><button class="x" id="closeProfile">Close</button><span class="t">${esc(c.name || 'Unnamed')}</span></div>
    <div class="sheetbody">
      <div class="quickactions">
        <a class="btn small" href="${telLink(c.phone)}">${icon('clock')}Call</a>
        <a class="btn small" href="${waLink(c.phone)}" target="_blank" rel="noopener">WhatsApp</a>
        <a class="btn small" href="mailto:${esc(c.email)}">Email</a>
        <button class="btn small secondary" id="qaNote">Add Note</button>
        <button class="btn small secondary" id="qaInteraction">Add Interaction</button>
        <button class="btn small secondary" id="qaFollowup">Schedule Follow-Up</button>
        <button class="btn small secondary" id="qaStage">Change Stage</button>
        <button class="btn small secondary" id="qaEdit">Edit Client</button>
        <button class="btn small danger" id="qaDelete">Delete</button>
      </div>

      <div class="standing glass">
        <div class="standing-head"><h2>Where I Stand</h2>${stageBadge(c.stage)}${probBar(c.probability)}</div>
        <div class="field"><label>Where I stand</label><textarea data-field="standing.whereIStand" placeholder="e.g. Client is interested but wants to discuss it with her husband.">${esc(c.standing.whereIStand)}</textarea></div>
        <div class="grid2">
          <div class="field"><label>What I know (one per line)</label><textarea data-field="standing.whatIKnow" placeholder="Wants hospital cover&#10;Budget around R2,000/month">${esc(c.standing.whatIKnow)}</textarea></div>
          <div class="field"><label>What I need to find out (one per line)</label><textarea data-field="standing.needToFindOut" placeholder="Whether husband is willing to switch">${esc(c.standing.needToFindOut)}</textarea></div>
        </div>
        <div class="grid2">
          <div class="field"><label>Main objection</label><input data-field="mainObjection" value="${esc(c.mainObjection)}" placeholder="e.g. Price"></div>
          <div class="field"><label>Next action</label><input data-field="standing.nextAction" value="${esc(c.standing.nextAction)}" placeholder="e.g. Call client Thursday at 17:30"></div>
        </div>
        <div class="field"><label>Next follow-up</label><input type="date" data-field="nextFollowUp" value="${esc(c.nextFollowUp)}"></div>
      </div>

      <div class="knowledge glass">
        <div class="standing-head"><h2>Client Knowledge</h2><span class="chip know ${pct >= 75 ? 'good' : pct >= 40 ? 'warn' : 'bad'}">${pct}%</span></div>
        <ul class="checklist">${KNOWLEDGE_ITEMS.map((k) => `<li class="${k.check(c) ? 'done' : ''}">${k.check(c) ? '☑' : '☐'} ${esc(k.label)}</li>`).join('')}</ul>
        ${missing.length ? `<h3>Things I still need to know</h3><ul class="asklist">${missing.map((k) => `<li>Ask: “${esc(k.question)}”</li>`).join('')}</ul>` : '<p class="hint">Full picture — nothing missing.</p>'}
      </div>

      <h3>Personal Information</h3>
      <div class="card glass kv">
        ${kv('Phone', c.phone)}${kv('Email', c.email)}${kv('Location', c.location)}${kv('Age', c.age)}
        ${kv('Occupation', c.occupation)}${kv('Family status', c.familyStatus)}${kv('Dependants', c.dependants)}
      </div>

      <h3>What I Know</h3>
      <div class="card glass kv">
        ${kv('Looking for', c.lookingFor)}${kv('Main needs', c.mainNeeds)}${kv('Main concerns', c.mainConcerns)}
        ${kv('Preferred contact', c.preferredContact)}${kv('Best time', c.bestTime)}
      </div>

      <h3>Sales Information</h3>
      <div class="card glass kv">
        ${kv('Product interested in', c.productInterest)}${kv('Quote amount', c.quoteAmount)}${kv('Budget', c.budget)}
        ${kv('Objections', c.objections)}${kv('Current provider', c.currentProvider)}${kv('Current price', c.currentPrice)}
        ${kv('Reason for change', c.reasonForChange)}${kv('Decision maker', c.decisionMaker)}
      </div>

      ${custom.length ? `<h3>Custom Fields</h3><div class="card glass kv">${custom.map((f) => kv(f.label, c.customFields[f.key])).join('')}</div>` : ''}

      <h3>Communication History</h3>
      <ul class="tl">
        ${c.interactions.slice().sort((a, b) => b.date.localeCompare(a.date)).map((i) => `
          <li><span class="dir">${esc(i.type)}</span>
            <div class="what"><b>${esc(fmtDateTime(i.date))}</b> — ${esc(i.summary || '')}
            ${i.learned ? `<small>Learned: ${esc(i.learned)}</small>` : ''}
            ${i.result ? `<small>Result: ${esc(i.result)}</small>` : ''}
            ${i.nextAction ? `<small>Next: ${esc(i.nextAction)}</small>` : ''}</div>
          </li>`).join('') || '<li class="empty">No interactions logged yet.</li>'}
      </ul>

      <h3>Notes</h3>
      <div class="field"><textarea data-field="notes" placeholder="Free-form notes">${esc(c.notes)}</textarea></div>

      <div class="stagehist">
        <h3>Stage history</h3>
        <ul class="tl">${c.stageHistory.slice().reverse().map((h) => `<li><span class="dir">${esc(h.stage)}</span><div class="what">${esc(fmtDateTime(h.date))}</div></li>`).join('')}</ul>
      </div>
    </div>
  </div></div>`;

  $('#closeProfile').addEventListener('click', () => { State.openClientId = null; $('#sheetRoot').innerHTML = ''; render(); });
  $('#profOverlay').addEventListener('click', (e) => { if (e.target.id === 'profOverlay') $('#closeProfile').click(); });
  $$('[data-field]', root).forEach((el) => {
    el.addEventListener('change', () => {
      const path = el.dataset.field.split('.');
      patchClient(c.id, (x) => { if (path.length === 2) x[path[0]][path[1]] = el.value; else x[path[0]] = el.value; });
    });
  });
  $('#qaNote').addEventListener('click', () => openNoteModal(c.id));
  $('#qaInteraction').addEventListener('click', () => openInteractionModal(c.id));
  $('#qaFollowup').addEventListener('click', () => openScheduleFollowupModal(c.id));
  $('#qaStage').addEventListener('click', () => openStagePicker(c.id));
  $('#qaEdit').addEventListener('click', () => openClientForm(c.id));
  $('#qaDelete').addEventListener('click', async () => {
    if (await confirmDialog('Delete this client?', `Permanently delete ${c.name || 'this client'} and their full history? This cannot be undone.`, 'Delete')) {
      Store.remove(c.id); State.openClientId = null; $('#sheetRoot').innerHTML = ''; render(); toast('Client deleted');
    }
  });
}
function kv(label, val) { return `<div class="kvrow"><span class="k">${esc(label)}</span><span class="v">${val ? esc(val) : '<span class="muted">—</span>'}</span></div>`; }

function openNoteModal(id) {
  const c = Store.get(id);
  $('#dialogRoot').innerHTML = `<div class="overlay" id="noteOverlay"><div class="dialog">
    <h2>Add Note</h2>
    <div class="field"><textarea id="noteText" placeholder="Quick note…" autofocus></textarea></div>
    <div class="btnrow"><button class="btn secondary" id="noteCancel">Cancel</button><button class="btn" id="noteSave">Save</button></div>
  </div></div>`;
  const close = () => $('#dialogRoot').innerHTML = '';
  $('#noteCancel').addEventListener('click', close);
  $('#noteOverlay').addEventListener('click', (e) => { if (e.target.id === 'noteOverlay') close(); });
  $('#noteSave').addEventListener('click', () => {
    const t = $('#noteText').value.trim(); if (!t) return close();
    patchClient(id, (x) => { x.notes = (x.notes ? x.notes + '\n' : '') + `[${fmtDateTime(nowIso())}] ${t}`; });
    close(); drawProfile(); toast('Note added');
  });
}
function openInteractionModal(id) {
  $('#dialogRoot').innerHTML = `<div class="overlay" id="intOverlay"><div class="dialog wide">
    <h2>Add Interaction</h2>
    <form id="intForm">
      <div class="grid2">
        <div class="field"><label>Date</label><input type="datetime-local" name="date" value="${new Date().toISOString().slice(0, 16)}"></div>
        <div class="field"><label>Type</label><select name="type">${INTERACTION_TYPES.map((t) => `<option>${t}</option>`).join('')}</select></div>
      </div>
      <div class="field"><label>Summary</label><textarea name="summary" placeholder="What happened"></textarea></div>
      <div class="field"><label>Important information learned</label><textarea name="learned"></textarea></div>
      <div class="grid2">
        <div class="field"><label>Result</label><input name="result" placeholder="e.g. Interested, sent quote"></div>
        <div class="field"><label>Next action</label><input name="nextAction" placeholder="e.g. Follow up Friday"></div>
      </div>
      <div class="btnrow"><button type="button" class="btn secondary" id="intCancel">Cancel</button><button type="submit" class="btn">Save</button></div>
    </form>
  </div></div>`;
  const close = () => $('#dialogRoot').innerHTML = '';
  $('#intCancel').addEventListener('click', close);
  $('#intOverlay').addEventListener('click', (e) => { if (e.target.id === 'intOverlay') close(); });
  $('#intForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    patchClient(id, (x) => {
      x.interactions.push({ id: uid(), date: new Date(fd.get('date')).toISOString(), type: fd.get('type'), summary: fd.get('summary') || '', learned: fd.get('learned') || '', result: fd.get('result') || '', nextAction: fd.get('nextAction') || '' });
      x.lastContact = todayStr();
      if (fd.get('nextAction')) x.standing.nextAction = fd.get('nextAction');
    });
    close(); drawProfile(); toast('Interaction logged');
  });
}
function openScheduleFollowupModal(id) {
  const c = Store.get(id);
  $('#dialogRoot').innerHTML = `<div class="overlay" id="sfOverlay"><div class="dialog">
    <h2>Schedule Follow-Up</h2>
    <div class="field"><label>Next follow-up date</label><input type="date" id="sfDate" value="${esc(c.nextFollowUp || todayStr())}"></div>
    <div class="btnrow"><button class="btn secondary" id="sfCancel">Cancel</button><button class="btn" id="sfSave">Save</button></div>
  </div></div>`;
  const close = () => $('#dialogRoot').innerHTML = '';
  $('#sfCancel').addEventListener('click', close);
  $('#sfOverlay').addEventListener('click', (e) => { if (e.target.id === 'sfOverlay') close(); });
  $('#sfSave').addEventListener('click', () => {
    const d = $('#sfDate').value; if (!d) return close();
    patchClient(id, (x) => { x.nextFollowUp = d; });
    close(); drawProfile(); toast('Follow-up scheduled');
  });
}
function openFollowUpModal(c, missed) {
  $('#dialogRoot').innerHTML = `<div class="overlay" id="fuOverlay"><div class="dialog">
    <h2>${missed ? 'Mark Missed' : 'Complete Follow-Up'}</h2>
    <p>${esc(c.name || 'Client')} — due ${fmtDate(c.nextFollowUp)}</p>
    <div class="field"><label>Next follow-up date</label><input type="date" id="fuNextDate" value="${todayStr()}"></div>
    <div class="btnrow"><button class="btn secondary" id="fuCancel">Cancel</button><button class="btn" id="fuSave">${missed ? 'Mark Missed & Reschedule' : 'Complete & Reschedule'}</button></div>
  </div></div>`;
  const close = () => $('#dialogRoot').innerHTML = '';
  $('#fuCancel').addEventListener('click', close);
  $('#fuOverlay').addEventListener('click', (e) => { if (e.target.id === 'fuOverlay') close(); });
  $('#fuSave').addEventListener('click', () => {
    const next = $('#fuNextDate').value;
    patchClient(c.id, (x) => {
      x.followUpHistory.push({ due: x.nextFollowUp, completedAt: missed ? null : nowIso(), missed: !!missed });
      if (!missed) { x.interactions.push({ id: uid(), date: nowIso(), type: 'Follow-up', summary: 'Follow-up completed', learned: '', result: 'Completed', nextAction: '' }); x.lastContact = todayStr(); }
      x.nextFollowUp = next || '';
    });
    close();
    if (State.openClientId === c.id) drawProfile();
    if (State.page === 'followups') renderFollowups($('#pageRoot'));
    toast(missed ? 'Marked missed' : 'Follow-up completed');
  });
}
function openStagePicker(id) {
  const c = Store.get(id);
  $('#dialogRoot').innerHTML = `<div class="overlay" id="stOverlay"><div class="dialog">
    <h2>Change Stage</h2>
    <div class="pickrow">${STAGES.map((s) => `<button class="pick" data-stage="${s}" aria-pressed="${c.stage === s}">${s}</button>`).join('')}</div>
    <div class="btnrow" style="margin-top:14px"><button class="btn secondary" id="stCancel">Close</button></div>
  </div></div>`;
  const close = () => $('#dialogRoot').innerHTML = '';
  $('#stCancel').addEventListener('click', close);
  $('#stOverlay').addEventListener('click', (e) => { if (e.target.id === 'stOverlay') close(); });
  $$('[data-stage]').forEach((b) => b.addEventListener('click', () => { moveClientStage(id, b.dataset.stage); close(); drawProfile(); }));
}

/* ---------- boot ---------- */
function boot() {
  seedDemoData();
  applyTheme();
  buildShell();
  setPage('dashboard');
}
document.addEventListener('DOMContentLoaded', boot);
