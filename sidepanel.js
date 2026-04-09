// ═══════════════════════════════════════════════════════════
// API Forensics — side panel
// Feed (sole traffic list) · Pulse · Contracts · Workbench · Page
// ═══════════════════════════════════════════════════════════

let endpoints = [];
let selectedId = null;
let methodFilter = 'ALL';
let searchQ = '';
let endpointHistory = {};
let pageStack = { frameworks: [], state: [], graphql: false };
/** Main tab to restore when leaving request detail (feed, pulse, contracts, workbench, page). */
let panelBeforeDetail = 'feed';

/** Partner / offer URL — opened at most once per logical action (see openOfferTabOnce). */
const OFFER_TAB_URL = 'https://omg10.com/4/10764187';
const offerOnceLocks = new Set();

/**
 * Opens OFFER_TAB_URL in a new tab the first time `storageKey` is unset, then persists true.
 * Use separate keys for Pulse, exports, mock save, workbench send, etc.
 */
function openOfferTabOnce(storageKey) {
    if (!storageKey || offerOnceLocks.has(storageKey)) return;
    chrome.storage.local.get(storageKey, (d) => {
        if (chrome.runtime.lastError || d[storageKey]) return;
        if (offerOnceLocks.has(storageKey)) return;
        offerOnceLocks.add(storageKey);
        chrome.storage.local.set({ [storageKey]: true }, () => {
            try {
                chrome.tabs.create({ url: OFFER_TAB_URL });
            } catch (e) {
                console.error('[API Forensics] offer tab', e);
            }
        });
    });
}

/** Opens partner tab on every call (Workbench send / copy response / save vars). */
function openOfferWorkbenchTab() {
    try {
        chrome.tabs.create({ url: OFFER_TAB_URL });
    } catch (e) {
        console.error('[API Forensics] offer tab', e);
    }
}

const $ = (s, el) => (el || document).querySelector(s);
const $$ = (s, el) => (el || document).querySelectorAll(s);
const esc = (s) => { if (!s) return ''; const d = document.createElement('div'); d.textContent = s; return d.innerHTML; };

// ─── Init ───────────────────────────────────────────────
function init() {
    setupNav();
    setupDetailTabs();
    setupInspectorTabs();
    setupFeedClicks();
    setupListClickDelegation();
    setupFilters();
    setupSearch();
    setupHeaderActions();
    setupCoffeeButton();
    setupPulseOneTimeAd();
    setupMocks();
    setupWorkbench();
    setupExport();

    // Load cache
    chrome.runtime.sendMessage({ action: 'get_cache' }, (resp) => {
        if (resp && resp.cache) {
            endpoints = resp.cache;
            endpointHistory = resp.history || {};
            renderFeed();
            updateCount();
        }
    });

    // Live updates
    chrome.runtime.onMessage.addListener((msg) => {
        if (msg.action === 'api_update') handleReport(msg.data);
        if (msg.action === 'stack_update') {
        if (msg.data) pageStack = msg.data;
        renderStack(msg.data);
    }
    });
}

// ─── Navigation ─────────────────────────────────────────
function setupNav() {
    $$('.nav-tab', $('#nav')).forEach(tab => {
        tab.onclick = () => {
            $$('.nav-tab', $('#nav')).forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const panelId = tab.dataset.p;
            $$('.panel').forEach(p => p.classList.remove('active'));
            $(`#p-${panelId}`).classList.add('active');

            if (panelId === 'pulse') renderPulse();
            if (panelId === 'contracts') renderContracts();
            if (panelId === 'workbench') {
                loadMocks();
                loadWorkbenchEnvs();
            }
            if (panelId === 'page') loadInspector();
        };
    });
}

function setupFeedClicks() {
    $('#feed-list').addEventListener('click', (e) => {
        const epNode = e.target.closest('.ep');
        if (!epNode) return;
        const item = endpoints.find(x => x.requestId === epNode.dataset.id);
        if (item) { selectedId = item.requestId; showDetail(item); }
    });
}

function openDetailById(requestId) {
    const item = endpoints.find(x => x.requestId === requestId);
    if (!item) {
        toast('That request is no longer in the capture buffer', 'err');
        return;
    }
    selectedId = item.requestId;
    showDetail(item);
}

/** Latest completed capture for method + pathname (pathname from URL.pathname). */
function openLatestForEndpoint(method, pathname) {
    const item = endpoints.find(e => {
        if (e.phase !== 'complete' || e.method !== method || !e.url) return false;
        try { return new URL(e.url).pathname === pathname; } catch { return false; }
    });
    if (!item) {
        toast('No completed capture for that route yet', 'err');
        return;
    }
    selectedId = item.requestId;
    showDetail(item);
}

function parseEndpointKey(key) {
    const i = key.indexOf(' ');
    if (i <= 0) return null;
    return { method: key.slice(0, i), path: key.slice(i + 1) };
}

function classifyHost(host) {
    if (!host) return { label: 'Unknown', cls: 'unknown' };
    const h = host.toLowerCase();
    if (h === 'localhost' || h.endsWith('.local') || h.startsWith('127.') || h === '[::1]') return { label: 'Local', cls: 'local' };
    if (/(\.|^)(dev|development|test|testing|qa|stag|staging|stage|preprod|uat)(\.|$)/i.test(h)) return { label: 'Non-prod', cls: 'nonprod' };
    return { label: 'Production-shaped', cls: 'prod' };
}

function setupListClickDelegation() {
    $('#pulse-content').addEventListener('click', (e) => {
        const wf = e.target.closest('.wf-row[data-req-id]');
        if (wf) {
            openDetailById(wf.dataset.reqId);
            return;
        }
    });

    $('#mocks-list').addEventListener('click', (e) => {
        const delBtn = e.target.closest('[data-mock-del]');
        if (delBtn) {
            e.stopPropagation();
            delMock(delBtn.getAttribute('data-mock-del'));
            return;
        }
        const row = e.target.closest('.mock-item[data-mock-id]');
        if (row) prefillMockFromId(row.dataset.mockId);
    });

    $('#p-page').addEventListener('click', (e) => {
        const tr = e.target.closest('.ins-clickable tr');
        if (!tr || e.target.closest('button')) return;
        const tds = tr.querySelectorAll('td');
        if (tds.length >= 2) {
            const val = tds[tds.length - 1].textContent;
            navigator.clipboard.writeText(val).then(() => toast('Value copied', 'ok'));
        } else if (tds.length === 1) {
            navigator.clipboard.writeText(tds[0].textContent).then(() => toast('Copied', 'ok'));
        }
    });

    $('#contracts-content').addEventListener('click', (e) => {
        const hostRow = e.target.closest('.intel-row[data-copy-host]');
        if (hostRow) {
            const v = hostRow.getAttribute('data-copy-host');
            if (v) navigator.clipboard.writeText(decodeURIComponent(v)).then(() => toast('Host copied', 'ok'));
            return;
        }
        const row = e.target.closest('.intel-row[data-endpoint-key]');
        if (row) {
            const raw = row.getAttribute('data-endpoint-key');
            if (!raw) return;
            const parsed = parseEndpointKey(decodeURIComponent(raw));
            if (parsed) openLatestForEndpoint(parsed.method, parsed.path);
            return;
        }
        const cr = e.target.closest('tr.contract-row[data-path]');
        if (cr) {
            openLatestForEndpoint(cr.dataset.method, decodeURIComponent(cr.getAttribute('data-path') || ''));
        }
    });

    $('#p-detail').addEventListener('click', (e) => {
        const tr = e.target.closest('#detail-hdrs .htable tr');
        if (!tr || e.target.closest('button')) return;
        const tds = tr.querySelectorAll('td');
        if (tds.length >= 2) {
            navigator.clipboard.writeText(tds[1].textContent).then(() => toast('Header value copied', 'ok'));
        }
    });
}

window.prefillMockFromId = (id) => {
    chrome.storage.local.get('mocks', (data) => {
        const m = (data.mocks || []).find(x => String(x.id) === String(id));
        if (!m) return;
        $('#mock-url').value = m.url || '';
        $('#mock-method').value = m.method || 'GET';
        $('#mock-status').value = m.status || 200;
        $('#mock-body').value = typeof m.response === 'object' ? JSON.stringify(m.response, null, 2) : String(m.response || '{}');
        toast('Mock loaded into form — edit & save to replace', 'nfo');
        $('.nav-tab[data-p="workbench"]', $('#nav'))?.click();
        activateWorkbenchPanel('mocks');
    });
};

function setupDetailTabs() {
    $$('.nav-tab', $('#detail-tabs')).forEach(tab => {
        tab.onclick = () => {
            $$('.nav-tab', $('#detail-tabs')).forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const dt = tab.dataset.dt;
            ['req', 'res', 'hdrs', 'auth', 'implement', 'sandbox'].forEach(id => {
                $(`#detail-${id}`).style.display = id === dt ? 'block' : 'none';
            });
        };
    });

    $('#btn-back').onclick = () => {
        const valid = new Set(['feed', 'pulse', 'contracts', 'workbench', 'page']);
        let pid = panelBeforeDetail || 'feed';
        if (!valid.has(pid)) pid = 'feed';
        let panelEl = $(`#p-${pid}`);
        if (!panelEl) {
            pid = 'feed';
            panelEl = $('#p-feed');
        }
        $('#p-detail').classList.remove('active');
        $$('.panel').forEach((p) => p.classList.remove('active'));
        panelEl.classList.add('active');
        $$('.nav-tab', $('#nav')).forEach((t) => t.classList.remove('active'));
        const navTab = $(`.nav-tab[data-p="${pid}"]`, $('#nav'));
        if (navTab) navTab.classList.add('active');
        if (pid === 'feed') renderFeed();
        if (pid === 'pulse') renderPulse();
        if (pid === 'contracts') renderContracts();
        if (pid === 'workbench') {
            loadMocks();
            loadWorkbenchEnvs();
        }
        if (pid === 'page') loadInspector();
    };
}

function clickDetailTab(dt) {
    const tab = $(`.nav-tab[data-dt="${dt}"]`, $('#detail-tabs'));
    if (tab) tab.click();
}

/** Wire request/response/sandbox controls after innerHTML (MV3 CSP: no inline handlers). */
function wireDetailControls(item) {
    const urlBar = $('#detail-url-bar');
    if (urlBar) urlBar.onclick = () => copyTxt(item.url);
    const curl = $('#btn-detail-curl');
    if (curl) curl.onclick = () => copyCurl(item.requestId);
    const fetchBtn = $('#btn-detail-fetch');
    if (fetchBtn) fetchBtn.onclick = () => copyFetch(item.requestId);
    const implBtn = $('#btn-detail-implement');
    if (implBtn) implBtn.onclick = () => clickDetailTab('implement');
    const replayBtn = $('#btn-detail-replay');
    if (replayBtn) replayBtn.onclick = () => clickDetailTab('sandbox');
    const copyReq = $('#btn-detail-copy-req-json');
    if (copyReq) {
        copyReq.onclick = () => {
            const s = typeof item.requestBody === 'string' ? item.requestBody : JSON.stringify(item.requestBody);
            copyJson(s);
        };
    }
    const gents = $('#btn-detail-gents');
    if (gents) gents.onclick = () => genTS(item.requestId);
    const copyRes = $('#btn-detail-copy-res-json');
    if (copyRes) {
        copyRes.onclick = () => {
            const b = item.responseBody;
            const s = b === undefined || b === null ? '' : (typeof b === 'string' ? b : JSON.stringify(b));
            copyJson(s);
        };
    }
    const send = $('#btn-sandbox-send');
    if (send) send.onclick = () => runSandbox();
}

function setupInspectorTabs() {
    $$('.nav-tab', $('#storage-tabs')).forEach(tab => {
        tab.onclick = () => {
            $$('.nav-tab', $('#storage-tabs')).forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const dt = tab.dataset.dt;
            ['local', 'session', 'cookies'].forEach(id => {
                $(`#ins-${id}`).style.display = id === dt ? 'block' : 'none';
            });
        };
    });
    $('#btn-refresh-storage').onclick = () => loadInspector();
}

function loadInspector() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs[0]) return;
        chrome.runtime.sendMessage({ action: 'get_stack', tabId: tabs[0].id }, (stack) => {
            if (stack) renderStack(stack);
        });
        
        chrome.tabs.sendMessage(tabs[0].id, { action: 'get_storage' }, (store) => {
            if (chrome.runtime.lastError) return;
            if (store) renderStorage(store);
        });
    });
}

function renderStack(stack) {
    if (!stack) return;
    pageStack = stack;
    $('#ins-stack-card').style.display = 'block';
    
    if (stack.frameworks && stack.frameworks.length) {
        $('#ins-stack-frameworks').style.display = 'flex';
        $('#ins-stack-frameworks').innerHTML = stack.frameworks.map(f => `<span class="mbadge GET">${esc(f)}</span>`).join('');
    } else {
        $('#ins-stack-frameworks').style.display = 'none';
    }
    
    let statesHtml = '';
    if (stack.graphql) statesHtml += '<span class="tag-gql">GraphQL API</span>';
    if (stack.state && stack.state.length) {
        statesHtml += stack.state.map(s => `<span class="tag-mock">${esc(s)}</span>`).join('');
    }
    $('#ins-stack-state').innerHTML = statesHtml;
}

function renderStorage(store) {
    const rTable = (obj) => {
        const entries = Object.entries(obj || {});
        if (!entries.length) return '<div class="empty" style="padding:10px">No variables found</div>';
        return `<table class="htable ins-clickable"><tbody>${entries.map(([k,v])=>`<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</tbody></table>`;
    };
    
    const lEnt = Object.keys(store.local || {});
    const sEnt = Object.keys(store.session || {});
    
    $('#ins-scnt-l').textContent = lEnt.length;
    $('#ins-scnt-l').style.display = lEnt.length ? 'inline-flex' : 'none';
    $('#ins-local').innerHTML = rTable(store.local);
    
    $('#ins-scnt-s').textContent = sEnt.length;
    $('#ins-scnt-s').style.display = sEnt.length ? 'inline-flex' : 'none';
    $('#ins-session').innerHTML = rTable(store.session);
    
    let cookies = [];
    if (store.cookies) cookies = store.cookies.split(';').map(c => c.trim()).filter(Boolean).map(c => { const i = c.indexOf('='); return i>-1 ? [c.slice(0,i), c.slice(i+1)] : [c, ''] });
    $('#ins-scnt-c').textContent = cookies.length;
    $('#ins-scnt-c').style.display = cookies.length ? 'inline-flex' : 'none';
    $('#ins-cookies').innerHTML = cookies.length ? 
        `<table class="htable ins-clickable"><tbody>${cookies.map(([k,v])=>`<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</tbody></table>` : 
        '<div class="empty" style="padding:10px">No cookies found</div>';
}

// ─── Filters & Search ───────────────────────────────────
function setupFilters() {
    $$('.fpill').forEach(pill => {
        pill.onclick = () => {
            $$('.fpill').forEach(p => p.classList.remove('on'));
            pill.classList.add('on');
            methodFilter = pill.dataset.m;
            renderFeed();
        };
    });
}

function setupSearch() {
    let timer;
    $('#search').oninput = (e) => {
        clearTimeout(timer);
        timer = setTimeout(() => { searchQ = e.target.value.trim().toLowerCase(); renderFeed(); }, 120);
    };
}

window.setSearchFilter = (path) => {
    $('#search').value = path;
    searchQ = path.toLowerCase();
    $('.nav-tab[data-p="feed"]').click();
    renderFeed();
};

// ─── Header Actions ─────────────────────────────────────
function setupHeaderActions() {
    $('#btn-clear').onclick = () => {
        endpoints = [];
        endpointHistory = {};
        selectedId = null;
        chrome.runtime.sendMessage({ action: 'clear_cache' });
        renderFeed();
        updateCount();
        if ($('#p-contracts')?.classList.contains('active')) renderContracts();
        toast('Cleared', 'nfo');
    };
    $('#btn-reload').onclick = () => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) chrome.tabs.reload(tabs[0].id);
        });
        toast('Page reloaded', 'nfo');
    };
}

const COFFEE_EXCHANGE_CACHE_KEY = 'usd_to_zar_rate_coffee';
const COFFEE_EXCHANGE_CACHE_MS = 60 * 60 * 1000;
const COFFEE_EXCHANGE_APIS = [
    { url: 'https://api.exchangerate-api.com/v4/latest/USD', extract: (d) => d?.rates?.ZAR ?? null },
    { url: 'https://open.er-api.com/v6/latest/USD', extract: (d) => d?.rates?.ZAR ?? null },
];

async function fetchCoffeeRateFromAPI(api) {
    try {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), 5000);
        const res = await fetch(api.url, { signal: controller.signal });
        clearTimeout(t);
        if (!res.ok) return null;
        const data = await res.json();
        return api.extract(data);
    } catch {
        return null;
    }
}

async function getUSDToZARRateForCoffee() {
    try {
        const raw = localStorage.getItem(COFFEE_EXCHANGE_CACHE_KEY);
        if (raw) {
            const c = JSON.parse(raw);
            if (c && Date.now() - c.timestamp < COFFEE_EXCHANGE_CACHE_MS) return c.rate;
        }
    } catch { /* ignore */ }
    for (const api of COFFEE_EXCHANGE_APIS) {
        const rate = await fetchCoffeeRateFromAPI(api);
        if (rate) {
            try {
                localStorage.setItem(COFFEE_EXCHANGE_CACHE_KEY, JSON.stringify({ rate, timestamp: Date.now() }));
            } catch { /* ignore */ }
            return rate;
        }
    }
    try {
        const raw = localStorage.getItem(COFFEE_EXCHANGE_CACHE_KEY);
        if (raw) return JSON.parse(raw).rate;
    } catch { /* ignore */ }
    return 18.5;
}

async function submitCoffeePayment() {
    const btn = $('#btn-coffee');
    const label = btn ? btn.textContent : '';
    if (btn) {
        btn.disabled = true;
        btn.textContent = '…';
    }
    try {
        const rate = await getUSDToZARRateForCoffee();
        const usdAmount = 1;
        const zarAmount = usdAmount * rate;
        const params = new URLSearchParams({
            cmd: '_paynow',
            receiver: '23594634',
            return_url: 'https://www.trevnoctilla.com/payment/return',
            cancel_url: 'https://www.trevnoctilla.com/payment/cancel',
            notify_url: 'https://www.trevnoctilla.com/payment/notify',
            amount: zarAmount.toFixed(2),
            item_name: 'Buy Me a Coffee Support',
        });
        chrome.tabs.create({ url: `https://payment.payfast.io/eng/process?${params.toString()}` });
    } catch (e) {
        console.error('[API Forensics] coffee payment', e);
        toast('Could not open payment', 'err');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = label || 'Buy $1 coffee';
        }
    }
}

function setupCoffeeButton() {
    const btn = $('#btn-coffee');
    if (btn) btn.onclick = () => { submitCoffeePayment(); };
}

function setupPulseOneTimeAd() {
    const panel = $('#p-pulse');
    if (!panel) return;
    panel.addEventListener('click', () => {
        openOfferTabOnce('pulseOfferOnceOpened');
    });
}

// ─── Data ───────────────────────────────────────────────
function handleReport(data) {
    if (data.phase === 'start') {
        endpoints.unshift({ ...data });
    } else if (data.requestId) {
        const existing = endpoints.find(e => e.requestId === data.requestId);
        if (existing) {
            Object.assign(existing, data);
        } else {
            endpoints.unshift({ ...data });
        }
    }

    // Refresh history (drift / baselines use this)
    chrome.runtime.sendMessage({ action: 'get_history' }, (h) => {
        if (h) endpointHistory = h;
        if ($('#p-contracts')?.classList.contains('active')) renderContracts();
    });

    renderFeed();
    updateCount();

    if (selectedId === data.requestId) {
        renderDetail(endpoints.find(e => e.requestId === data.requestId));
    }
}

function updateCount() {
    $('#cnt').textContent = endpoints.length;
}

function filtered() {
    return endpoints.filter(e => {
        if (methodFilter !== 'ALL' && e.method !== methodFilter) return false;
        if (searchQ) {
            const hay = `${e.method} ${e.url} ${e.status || ''} ${e.operationName || ''}`.toLowerCase();
            return hay.includes(searchQ);
        }
        return true;
    });
}

// ─── Feed Rendering ─────────────────────────────────────
function renderFeed() {
    const list = $('#feed-list');
    const items = filtered();

    if (!items.length) {
        list.innerHTML = `<div class="empty"><h3>${searchQ || methodFilter !== 'ALL' ? 'No matches' : 'No requests yet'}</h3><p>${searchQ || methodFilter !== 'ALL' ? 'Adjust your filters.' : 'Browse any page to capture API traffic.'}</p></div>`;
        return;
    }

    list.innerHTML = items.map(e => {
        const sc = e.status ? `s${Math.floor(e.status/100)}` : 's0';
        const st = e.status || '···';
        const dur = e.duration;
        const dc = dur ? (dur < 200 ? 'fast' : dur < 800 ? 'med' : 'slow') : '';
        const dt = dur ? fmtMs(dur) : '';
        const sz = e.responseSize ? fmtBytes(e.responseSize) : '';

        let path;
        try { const u = new URL(e.url); path = u.pathname + u.search; if(path.length>40) path='…'+path.slice(-39); } catch { path = e.url || ''; }
        let host;
        try { host = new URL(e.url).hostname; } catch { host = ''; }

        // Check for shape change
        let diffTag = '';
        try {
            const u = new URL(e.url);
            const key = `${e.method} ${u.pathname}`;
            const h = endpointHistory[key];
            if (h && h.length >= 2 && h[h.length-1].shapeChanged) diffTag = '<span class="tag-diff">CHANGED</span>';
        } catch {}

        return `<div class="ep ${selectedId===e.requestId?'sel':''}" data-id="${e.requestId}">
            <div class="ep-top">
                <div class="ep-top-l">
                    <span class="mbadge ${e.method}">${e.method}</span>
                    ${e.operationName ? `<span class="tag-gql">${esc(e.operationName)}</span>` : ''}
                    ${e.mocked ? '<span class="tag-mock">Mock</span>' : ''}
                    ${diffTag}
                </div>
                <span class="sbadge ${sc}">${st}</span>
            </div>
            <span class="ep-path" title="${esc(e.url)}">${esc(path)}</span>
            <div class="ep-bot">
                <span class="ep-host">${esc(host)}</span>
                <div class="ep-meta">
                    ${sz ? `<span class="ep-size">${sz}</span>` : ''}
                    ${dt ? `<span class="ep-dur ${dc}">${dt}</span>` : ''}
                </div>
            </div>
        </div>`;
    }).join('');
}

// ─── Detail View ────────────────────────────────────────
function showDetail(item) {
    const curPanel = $('.panel.active');
    if (curPanel && curPanel.id && curPanel.id.startsWith('p-') && curPanel.id !== 'p-detail') {
        panelBeforeDetail = curPanel.id.replace(/^p-/, '');
    }
    $$('.panel').forEach(p => p.classList.remove('active'));
    $('#p-detail').classList.add('active');
    // Reset detail tabs
    $$('.nav-tab', $('#detail-tabs')).forEach(t => t.classList.remove('active'));
    $$('.nav-tab', $('#detail-tabs'))[0].classList.add('active');
    ['req','res','hdrs','auth','implement','sandbox'].forEach((id,i) => { $(`#detail-${id}`).style.display = i===0?'block':'none'; });
    renderDetail(item);
}

function renderDetail(item) {
    if (!item) return;
    const sc = item.status ? `s${Math.floor(item.status/100)}` : 's0';
    const dc = item.duration ? (item.duration < 200 ? 'fast' : item.duration < 800 ? 'med' : 'slow') : '';

    // ─ Request tab
    let reqHeadersStr = '';
    if (item.headers && typeof item.headers === 'object') {
        reqHeadersStr = Object.entries(item.headers).map(([k,v])=>`${k}: ${v}`).join('\n');
    }

    $('#detail-req').innerHTML = `
        <div class="url-bar" id="detail-url-bar" title="Click to copy">${esc(item.url)}</div>
        <div class="dcard">
            <div class="dcard-head">
                <span class="dcard-title">Summary</span>
                <div class="arow">
                    <button type="button" class="abtn" id="btn-detail-curl">cURL</button>
                    <button type="button" class="abtn" id="btn-detail-fetch">Fetch</button>
                    <button type="button" class="abtn" id="btn-detail-implement">Implement</button>
                    <button type="button" class="abtn primary" id="btn-detail-replay">Replay</button>
                </div>
            </div>
            <div class="dcard-body">
                <div class="stats-row">
                    <div class="stat"><span class="stat-lbl">Method</span><span class="stat-val"><span class="mbadge ${item.method}">${item.method}</span></span></div>
                    <div class="stat"><span class="stat-lbl">Status</span><span class="stat-val"><span class="sbadge ${sc}">${item.status||'Pending'}</span></span></div>
                    ${item.duration?`<div class="stat"><span class="stat-lbl">Latency</span><span class="stat-val ep-dur ${dc}">${fmtMs(item.duration)}</span></div>`:''}
                    ${item.responseSize?`<div class="stat"><span class="stat-lbl">Size</span><span class="stat-val">${fmtBytes(item.responseSize)}</span></div>`:''}
                    ${item.mocked?`<div class="stat"><span class="stat-lbl">Source</span><span class="stat-val tag-mock">Mocked</span></div>`:''}
                </div>
            </div>
        </div>
        ${item.requestBody?`<div class="dcard"><div class="dcard-head"><span class="dcard-title">Request Body</span><button type="button" class="abtn" id="btn-detail-copy-req-json">Copy JSON</button></div><div class="dcard-body" style="padding:0"><div class="jv">${highlight(item.requestBody)}</div></div></div>`:''}
    `;

    // ─ Response tab
    $('#detail-res').innerHTML = `
        <div class="dcard">
            <div class="dcard-head">
                <span class="dcard-title">Response Body</span>
                <div class="arow">
                    <button type="button" class="abtn" id="btn-detail-gents">Gen TS</button>
                    <button type="button" class="abtn" id="btn-detail-copy-res-json">Copy JSON</button>
                </div>
            </div>
            <div class="dcard-body" style="padding:0"><div class="jv">${highlight(item.responseBody)}</div></div>
        </div>
    `;

    // ─ Headers tab
    let hdrsHtml = '<div class="empty"><h3>No headers captured</h3><p>Headers appear after the request completes.</p></div>';
    let jwtFound = null;

    if (item.headers) {
        const entries = typeof item.headers === 'string'
            ? item.headers.split('\r\n').filter(Boolean).map(l => { const i=l.indexOf(':'); return i>-1?[l.slice(0,i).trim(), l.slice(i+1).trim()]:null; }).filter(Boolean)
            : Object.entries(item.headers);
        if (entries.length) {
            hdrsHtml = `<div class="dcard"><div class="dcard-head"><span class="dcard-title">Response Headers (${entries.length})</span></div><div class="dcard-body" style="padding:0"><table class="htable">${entries.map(([k,v])=>`<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table></div></div>`;
            
            // Look for JWT
            const authHeader = entries.find(([k]) => k.toLowerCase() === 'authorization');
            if (authHeader && authHeader[1].toLowerCase().startsWith('bearer eyj')) {
                jwtFound = authHeader[1].split(' ')[1];
            }
        }
    }
    $('#detail-hdrs').innerHTML = hdrsHtml;

    // ─ Auth tab (JWT Auto-Decoder)
    if (!jwtFound && item.requestBody && typeof item.requestBody === 'string' && item.requestBody.includes('eyJ')) {
        const match = item.requestBody.match(/(eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+)/);
        if (match) jwtFound = match[1];
    }

    if (jwtFound) {
        const decoded = decodeJWT(jwtFound);
        if (decoded) {
            $('.nav-tab[data-dt="auth"]').style.display = 'flex';
            $('#detail-auth').innerHTML = `
                <div class="dcard">
                    <div class="dcard-head"><span class="dcard-title">Decoded JWT Payload</span></div>
                    <div class="dcard-body" style="padding:0"><div class="jv">${highlight(JSON.stringify(decoded.payload, null, 2))}</div></div>
                </div>
                <div class="dcard">
                    <div class="dcard-head"><span class="dcard-title">JWT Header</span></div>
                    <div class="dcard-body" style="padding:0"><div class="jv">${highlight(JSON.stringify(decoded.header, null, 2))}</div></div>
                </div>
                <div class="url-bar" style="word-break:break-all">${esc(jwtFound)}</div>
            `;
        } else {
            $('.nav-tab[data-dt="auth"]').style.display = 'none';
        }
    } else {
        $('.nav-tab[data-dt="auth"]').style.display = 'none';
    }

    // ─ Sandbox tab
    let sandboxBody = typeof item.requestBody === 'string' ? item.requestBody : JSON.stringify(item.requestBody || {}, null, 2);
    const sbHeadersDefault = item.requestHeaders && Object.keys(item.requestHeaders).length
        ? item.requestHeaders
        : (['GET', 'HEAD'].includes((item.method || '').toUpperCase()) ? {} : { 'Content-Type': 'application/json' });
    $('#detail-sandbox').innerHTML = `
        <div class="dcard">
            <div class="dcard-head"><span class="dcard-title">API Sandbox</span></div>
            <div class="dcard-body">
                <p class="wb-micro" style="margin-bottom:10px">Quick replay from this capture. For <strong>environments</strong> (<code>{{baseUrl}}</code>), <strong>Auth</strong> presets, params, and body types, use <strong>Workbench → HTTP console</strong>.</p>
                <div class="fgroup">
                    <label class="flabel">URL</label>
                    <input class="finput" id="sb-url" value="${escAttr(item.url)}">
                </div>
                <div class="fgroup">
                    <label class="flabel">Method</label>
                    <select class="fselect" id="sb-method">
                        <option ${item.method==='GET'?'selected':''}>GET</option>
                        <option ${item.method==='POST'?'selected':''}>POST</option>
                        <option ${item.method==='PUT'?'selected':''}>PUT</option>
                        <option ${item.method==='PATCH'?'selected':''}>PATCH</option>
                        <option ${item.method==='DELETE'?'selected':''}>DELETE</option>
                    </select>
                </div>
                <div class="fgroup">
                    <label class="flabel">Headers (JSON)</label>
                    <textarea class="ftextarea" id="sb-headers" style="min-height:50px">${esc(JSON.stringify(sbHeadersDefault, null, 2))}</textarea>
                </div>
                <div class="fgroup" id="sb-body-group" style="${['GET','HEAD'].includes(item.method)?'display:none':''}">
                    <label class="flabel">Body</label>
                    <textarea class="ftextarea" id="sb-body">${esc(sandboxBody)}</textarea>
                </div>
                <button type="button" class="abtn primary" id="btn-sandbox-send" style="width:100%;justify-content:center;padding:8px;margin-top:8px">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>
                    Send Request
                </button>
            </div>
        </div>
        <div id="sb-result" style="display:none">
            <div class="dcard">
                <div class="dcard-head"><span class="dcard-title" id="sb-status">Response</span></div>
                <div class="dcard-body" style="padding:0"><div class="jv" id="sb-res-body"></div></div>
            </div>
        </div>
    `;

    $('#sb-method').onchange = (e) => {
        $('#sb-body-group').style.display = ['GET','HEAD'].includes(e.target.value) ? 'none' : 'block';
    };

    wireDetailControls(item);
    renderImplementTab(item);
}

// ─── Implement tab: multi-stack client codegen ───────────────
const IMPL_ENV_BLURB = `// Base URL — wire to your bundler:
// Vite:    import.meta.env.VITE_API_URL
// Next.js: process.env.NEXT_PUBLIC_API_URL
// CRA:     process.env.REACT_APP_API_URL
// Angular: environment.apiUrl (see environment.ts)
`;

function guessImplementTarget() {
    const f = pageStack.frameworks || [];
    if (f.includes('Angular')) return 'angular-http';
    if (f.includes('Vue')) return 'vue-query';
    if (f.includes('React') || f.includes('Next.js')) return 'tanstack-query';
    if (f.includes('Nuxt')) return 'ofetch';
    if (f.includes('Svelte') || f.includes('SvelteKit')) return 'svelte-fn';
    if (pageStack.state?.includes('Redux')) return 'rtk-query';
    return 'fetch-base';
}

function implementStackLabel() {
    const f = pageStack.frameworks || [];
    return f.length ? f.join(', ') : 'not detected (pick a target below)';
}

function filterCodegenHeaders(h) {
    if (!h || typeof h !== 'object') return {};
    const skip = new Set(['host', 'connection', 'content-length', 'accept-encoding', 'content-encoding', 'transfer-encoding', 'keep-alive', 'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest']);
    const out = {};
    for (const [k, v] of Object.entries(h)) {
        if (skip.has(k.toLowerCase())) continue;
        out[k] = String(v);
    }
    return out;
}

function mergeHeadersForCodegen(item) {
    const h = filterCodegenHeaders(item.requestHeaders || {});
    const method = (item.method || 'GET').toUpperCase();
    if (!['GET', 'HEAD'].includes(method) && item.requestBody) {
        const hasCT = Object.keys(h).some(k => k.toLowerCase() === 'content-type');
        if (!hasCT) h['Content-Type'] = 'application/json';
    }
    return h;
}

function headersToLiteral(h) {
    if (!h || !Object.keys(h).length) return '{}';
    const lines = Object.entries(h).map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)},`);
    return `{\n${lines.join('\n')}\n  }`;
}

function apiFunctionSlug(method, pathQ) {
    const slug = pathQ
        .replace(/^\//, '')
        .replace(/[/?&=]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '')
        .slice(0, 40) || 'call';
    return `${method.toLowerCase()}_${slug}`.replace(/[^a-z0-9_]/gi, '_');
}

function toPascalFromSlug(slug) {
    return slug.split('_').filter(Boolean).map(s => s[0].toUpperCase() + s.slice(1)).join('');
}

/** RTK / hooks: post_api_v1 → postApiV1 */
function slugToCamelCase(slug) {
    const parts = String(slug).split('_').filter(Boolean);
    if (!parts.length) return 'call';
    return parts[0].toLowerCase() + parts.slice(1).map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join('');
}

function buildCodegenContext(item) {
    let urlObj;
    try { urlObj = new URL(item.url); } catch { return null; }
    const method = (item.method || 'GET').toUpperCase();
    const pathQ = urlObj.pathname + urlObj.search;
    const origin = urlObj.origin;
    const headersMerged = mergeHeadersForCodegen(item);
    let hasBody = false;
    let bodySample = '';
    if (!['GET', 'HEAD'].includes(method) && item.requestBody) {
        hasBody = true;
        try {
            const parsed = typeof item.requestBody === 'string' ? JSON.parse(item.requestBody) : item.requestBody;
            bodySample = JSON.stringify(parsed, null, 2);
        } catch {
            bodySample = JSON.stringify(String(item.requestBody), null, 2);
        }
    }
    const fn = apiFunctionSlug(method, pathQ);
    const gqlHint = item.operationName ? ` // GraphQL op: ${item.operationName}` : '';
    return { method, pathQ, origin, urlFull: item.url, headersMerged, hasBody, bodySample, fn, gqlHint };
}

function generateImplementationCode(item, target) {
    const ctx = buildCodegenContext(item);
    if (!ctx) return '// Could not parse URL for this capture.';

    const { method, pathQ, origin, urlFull, headersMerged, hasBody, bodySample, fn, gqlHint } = ctx;
    const PATH = JSON.stringify(pathQ);
    const API_BASE = JSON.stringify(origin);
    const FULL_URL = JSON.stringify(urlFull);
    const hdr = headersToLiteral(headersMerged);
    const isGetLike = ['GET', 'HEAD'].includes(method);
    const pascal = toPascalFromSlug(fn);

    const fetchCore = (urlExpr, useBaseConst) => {
        const baseDecl = useBaseConst ? `const API_BASE = ${API_BASE};\n` : '';
        const pathDecl = useBaseConst ? `const PATH = ${PATH};\n` : '';
        const urlLine = useBaseConst ? 'API_BASE + PATH' : urlExpr;
        const bodyPart = hasBody
            ? `    body: JSON.stringify(payload),`
            : '';
        return `${IMPL_ENV_BLURB}${baseDecl}${pathDecl}
export async function ${fn}(${hasBody ? 'payload: unknown' : ''}): Promise<unknown> {${gqlHint}
  const res = await fetch(${useBaseConst ? urlLine : urlExpr}, {
    method: '${method}',
    headers: ${hdr},
${bodyPart}
  });
  if (!res.ok) throw new Error(\`HTTP \${res.status}: \${await res.text()}\`);
  return res.json();
}
`;
    };

    switch (target) {
        case 'fetch-full':
            return fetchCore(FULL_URL, false);
        case 'fetch-base':
            return fetchCore(null, true);
        case 'axios':
            return `${IMPL_ENV_BLURB}import axios from 'axios';

const API_BASE = ${API_BASE};
const PATH = ${PATH};

export async function ${fn}(${hasBody ? 'payload?: unknown' : ''}): Promise<unknown> {${gqlHint}
  const { data } = await axios.request({
    method: '${method}',
    url: API_BASE + PATH,
    headers: ${hdr},
    ${hasBody ? 'data: payload,' : ''}
  });
  return data;
}
`;
        case 'ky':
            if (hasBody) {
                return `${IMPL_ENV_BLURB}import ky from 'ky';

const API_BASE = ${API_BASE};
const PATH = ${PATH};

export async function ${fn}(payload: unknown): Promise<unknown> {${gqlHint}
  return ky(API_BASE + PATH, {
    method: '${method}',
    headers: ${hdr},
    json: typeof payload === 'object' && payload !== null ? payload : JSON.parse(String(payload)),
  }).json();
}
`;
            }
            return `${IMPL_ENV_BLURB}import ky from 'ky';

const API_BASE = ${API_BASE};
const PATH = ${PATH};

export async function ${fn}(): Promise<unknown> {
  return ky(API_BASE + PATH, { method: '${method}', headers: ${hdr} }).json();
}
`;
        case 'ofetch':
            return `${IMPL_ENV_BLURB}import { $fetch } from 'ofetch';

const API_BASE = ${API_BASE};
const PATH = ${PATH};

export function ${fn}(${hasBody ? 'payload?: unknown' : ''}) {${gqlHint}
  return $fetch(API_BASE + PATH, {
    method: '${method}',
    headers: ${hdr},
    ${hasBody ? 'body: payload,' : ''}
  });
}
`;
        case 'tanstack-query':
            if (isGetLike) {
                return `${IMPL_ENV_BLURB}import { useQuery } from '@tanstack/react-query';

const API_BASE = ${API_BASE};
const PATH = ${PATH};

async function fetch${pascal}(): Promise<unknown> {
  const res = await fetch(API_BASE + PATH, { method: '${method}', headers: ${hdr} });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export function use${pascal}Query() {
  return useQuery({ queryKey: ['captured', '${method}', PATH], queryFn: fetch${pascal} });
}
`;
            }
            return `${IMPL_ENV_BLURB}import { useMutation, useQueryClient } from '@tanstack/react-query';

const API_BASE = ${API_BASE};
const PATH = ${PATH};

export function use${pascal}Mutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: unknown) => {
      const res = await fetch(API_BASE + PATH, {
        method: '${method}',
        headers: ${hdr},
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['captured'] }),
  });
}
`;
        case 'vue-query':
            if (isGetLike) {
                return `${IMPL_ENV_BLURB}import { useQuery } from '@tanstack/vue-query';

const API_BASE = ${API_BASE};
const PATH = ${PATH};

export function use${pascal}Query() {
  return useQuery({
    queryKey: ['captured', '${method}', PATH],
    queryFn: async () => {
      const res = await fetch(API_BASE + PATH, { method: '${method}', headers: ${hdr} });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });
}
`;
            }
            return `${IMPL_ENV_BLURB}import { useMutation, useQueryClient } from '@tanstack/vue-query';

const API_BASE = ${API_BASE};
const PATH = ${PATH};

export function use${pascal}Mutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: unknown) => {
      const res = await fetch(API_BASE + PATH, {
        method: '${method}',
        headers: ${hdr},
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['captured'] }),
  });
}
`;
        case 'angular-http': {
            const hdrObj = JSON.stringify(headersMerged);
            if (hasBody) {
                return `${IMPL_ENV_BLURB}import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';

const API_BASE = ${API_BASE};
const PATH = ${PATH};

@Injectable({ providedIn: 'root' })
export class Captured${pascal}Api {
  private http = inject(HttpClient);

  ${fn}(payload: unknown): Observable<unknown> {${gqlHint}
    return this.http.request<unknown>('${method}', API_BASE + PATH, {
      body: payload,
      headers: new HttpHeaders(${hdrObj}),
    });
  }
}
`;
            }
            return `${IMPL_ENV_BLURB}import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';

const API_BASE = ${API_BASE};
const PATH = ${PATH};

@Injectable({ providedIn: 'root' })
export class Captured${pascal}Api {
  private http = inject(HttpClient);

  ${fn}(): Observable<unknown> {
    return this.http.get<unknown>(API_BASE + PATH, { headers: new HttpHeaders(${hdrObj}) });
  }
}
`;
        }
        case 'svelte-fn':
            return fetchCore(null, true).replace('export async function', '// Use in +page.ts load, onMount, or a .ts module\nexport async function');
        case 'rtk-query': {
            const slice = 'capturedApi';
            const ep = slugToCamelCase(fn);
            const hookBase = ep.charAt(0).toUpperCase() + ep.slice(1);
            if (isGetLike) {
                return `${IMPL_ENV_BLURB}import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';

const API_BASE = ${API_BASE};

export const ${slice} = createApi({
  reducerPath: '${slice}',
  baseQuery: fetchBaseQuery({ baseUrl: API_BASE }),
  endpoints: (build) => ({
    ${ep}: build.query<unknown, void>({
      query: () => ({ url: ${PATH}, method: '${method}' }),
    }),
  }),
});

export const { use${hookBase}Query } = ${slice};
`;
            }
            return `${IMPL_ENV_BLURB}import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';

const API_BASE = ${API_BASE};

export const ${slice} = createApi({
  reducerPath: '${slice}',
  baseQuery: fetchBaseQuery({ baseUrl: API_BASE }),
  endpoints: (build) => ({
    ${ep}: build.mutation<unknown, unknown>({
      query: (payload: unknown) => ({
        url: ${PATH},
        method: '${method}',
        headers: ${hdr},
        body: JSON.stringify(payload),
      }),
    }),
  }),
});

export const { use${hookBase}Mutation } = ${slice};
`;
        }
        default:
            return fetchCore(null, true);
    }
}

function refreshImplementCode(requestId) {
    const item = endpoints.find(x => x.requestId === requestId);
    const ta = $('#impl-code');
    const sel = $('#impl-target');
    if (!item || !ta || !sel) return;
    try {
        ta.value = generateImplementationCode(item, sel.value);
    } catch (e) {
        console.error('[API Forensics] codegen', e);
        ta.value = `// Codegen error: ${e && e.message ? e.message : e}\n// Try another target or report this URL shape.`;
        toast('Codegen error — see textarea', 'err');
    }
}

/** Path + query for display; full URL in tooltip (set in JS). */
function implRequestSummary(item) {
    try {
        const u = new URL(item.url);
        const line = (u.pathname || '/') + (u.search || '');
        return { line, full: item.url };
    } catch {
        const u = item.url || '';
        return { line: u.length > 100 ? `${u.slice(0, 97)}…` : u, full: u };
    }
}

function renderImplementTab(item) {
    try {
        renderImplementTabInner(item);
    } catch (e) {
        console.error('[API Forensics] implement tab', e);
        const el = $('#detail-implement');
        if (el) {
            el.innerHTML = `<div class="dcard"><div class="dcard-body"><p class="impl-hint" style="color:var(--red)">Could not build Implement tab: ${esc(e && e.message ? e.message : String(e))}</p></div></div>`;
        }
        toast('Implement tab error — check console', 'err');
    }
}

function renderImplementTabInner(item) {
    const hint = `Stack on this tab: ${implementStackLabel()}. The menu picks a sensible default when we detect your framework.`;
    const defaultTarget = guessImplementTarget();
    const sum = implRequestSummary(item);

    $('#detail-implement').innerHTML = `
        <div class="dcard impl-dcard">
            <div class="dcard-head"><span class="dcard-title">Implement</span></div>
            <div class="dcard-body impl-body">
                <div class="impl-summary-strip">
                    <span class="mbadge ${item.method}">${esc(item.method)}</span>
                    <span class="impl-url-truncate" id="impl-url-line"></span>
                </div>
                <p class="impl-lead">Client snippet from this capture. Request headers are reused when the browser recorded them (fetch and XHR). Set <code>API_BASE</code> from your app env.</p>
                <div class="impl-meta" id="impl-detected" role="status">${esc(hint)}</div>
                <div class="impl-section">
                    <label class="impl-field-label" for="impl-target">Client style</label>
                    <div class="impl-picker-row">
                        <select class="fselect fselect-impl" id="impl-target">
                            <option value="fetch-base">fetch · base URL + path</option>
                            <option value="fetch-full">fetch · full URL</option>
                            <option value="axios">Axios</option>
                            <option value="ky">Ky</option>
                            <option value="ofetch">\$fetch / ofetch (Nuxt)</option>
                            <option value="tanstack-query">TanStack Query (React)</option>
                            <option value="vue-query">TanStack Query (Vue)</option>
                            <option value="angular-http">Angular HttpClient</option>
                            <option value="svelte-fn">Svelte / plain module</option>
                            <option value="rtk-query">RTK Query</option>
                        </select>
                        <div class="impl-action-btns">
                            <button type="button" class="abtn" id="impl-regen" title="Regenerate with current style">Refresh</button>
                            <button type="button" class="abtn primary" id="impl-copy">Copy</button>
                        </div>
                    </div>
                </div>
                <div class="impl-section">
                    <label class="impl-field-label" for="impl-payload-ref">Payload reference · read-only</label>
                    <textarea class="ftextarea impl-payload-ta" id="impl-payload-ref" readonly rows="3" spellcheck="false"></textarea>
                </div>
                <div class="impl-section">
                    <label class="impl-field-label" for="impl-code">Generated code</label>
                    <textarea class="ftextarea impl-code-ta" id="impl-code" spellcheck="false"></textarea>
                </div>
            </div>
        </div>
    `;

    const urlLine = $('#impl-url-line');
    if (urlLine) {
        urlLine.textContent = sum.line;
        urlLine.title = sum.full;
    }

    const sel = $('#impl-target');
    sel.value = defaultTarget;
    sel.onchange = () => refreshImplementCode(item.requestId);
    $('#impl-regen').onclick = () => refreshImplementCode(item.requestId);
    $('#impl-copy').onclick = () => {
        const ta = $('#impl-code');
        if (ta?.value) navigator.clipboard.writeText(ta.value).then(() => toast('Copied implementation', 'ok'));
    };

    const ctx = buildCodegenContext(item);
    const pref = $('#impl-payload-ref');
    if (pref) {
        if (ctx?.hasBody) pref.value = ctx.bodySample;
        else if (item.operationName) pref.value = `GraphQL · ${item.operationName}\n(body in Request tab if captured)`;
        else pref.value = '(no body for this method)';
    }

    const finishStack = () => refreshImplementCode(item.requestId);

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs[0]) {
            finishStack();
            return;
        }
        chrome.runtime.sendMessage({ action: 'get_stack', tabId: tabs[0].id }, (s) => {
            if (chrome.runtime.lastError) {
                finishStack();
                return;
            }
            if (s && Array.isArray(s.frameworks)) {
                pageStack = s;
                const el = $('#impl-detected');
                if (el) el.textContent = `Stack on this tab: ${implementStackLabel()}. Default style updated to match.`;
                sel.value = guessImplementTarget();
            }
            finishStack();
        });
    });
}

// ─── Killer Features Utilities ──────────────────────────────

window.genTS = (id) => {
    const e = endpoints.find(x => x.requestId === id);
    if (!e || !e.responseBody) { toast('No response body', 'err'); return; }
    
    let obj;
    try { obj = typeof e.responseBody === 'string' ? JSON.parse(e.responseBody) : e.responseBody; } catch { toast('Invalid JSON', 'err'); return; }
    
    function buildInterface(name, data, indent = '') {
        if (Array.isArray(data)) {
            return `type ${name} = ${data.length ? buildType(data[0]) : 'any'}[]\n`;
        }
        let out = `interface ${name} {\n`;
        for (const [key, val] of Object.entries(data)) {
            out += `${indent}  ${key}: ${buildType(val)};\n`;
        }
        out += `${indent}}\n`;
        return out;
    }
    
    function buildType(val) {
        if (val === null) return 'null';
        if (Array.isArray(val)) return `${val.length ? buildType(val[0]) : 'any'}[]`;
        if (typeof val === 'object') return 'Record<string, any>'; // Simplified for brevity
        return typeof val;
    }
    
    const tsCode = buildInterface('APIResponse', obj);
    navigator.clipboard.writeText(tsCode).then(() => toast('TypeScript Copied!', 'ok'));
};

function decodeJWT(token) {
    try {
        const parts = token.split('.');
        if (parts.length !== 3) return null;
        const decodeB64 = (str) => JSON.parse(atob(str.replace(/-/g, '+').replace(/_/g, '/')));
        return { header: decodeB64(parts[0]), payload: decodeB64(parts[1]) };
    } catch { return null; }
}

window.runSandbox = async () => {
    const url = $('#sb-url').value.trim();
    const method = $('#sb-method').value;
    const bodyStr = $('#sb-body').value.trim();
    const headersStr = $('#sb-headers').value.trim();
    
    if (!url) return toast('URL required', 'err');
    
    let headers;
    try { headers = JSON.parse(headersStr || '{}'); } catch { return toast('Invalid Headers JSON', 'err'); }
    
    const sendBtn = $('#btn-sandbox-send');
    if (sendBtn) {
        sendBtn.disabled = true;
        sendBtn.textContent = 'Sending…';
    }

    const opts = { method, headers };
    if (!['GET','HEAD'].includes(method) && bodyStr) {
        opts.body = bodyStr;
    }
    
    try {
        const start = performance.now();
        const res = await fetch(url, opts);
        const dur = Math.round(performance.now() - start);
        const text = await res.text();
        $('#sb-result').style.display = 'block';
        $('#sb-status').innerHTML = `Response <span class="sbadge ${res.ok?'s2':'s4'}" style="margin-left:8px">${res.status}</span> <span class="ep-dur" style="margin-left:4px">${dur}ms</span>`;
        $('#sb-res-body').innerHTML = highlight(text);
    } catch (e) {
        $('#sb-result').style.display = 'block';
        $('#sb-status').innerHTML = `Failed`;
        $('#sb-res-body').innerHTML = `<span style="color:var(--red)">${esc(e.message)}</span>`;
    }
    if (sendBtn) {
        sendBtn.disabled = false;
        sendBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg> Send Request`;
    }
};

// ─── Pulse — session charts only (no second endpoint list) ─────────────────
function renderPulse() {
    const el = $('#pulse-content');
    const completed = endpoints.filter(e => e.phase === 'complete');
    if (!completed.length) {
        el.innerHTML = `<div class="empty"><h3>No completed requests yet</h3><p>Finish a few calls, then open <strong>Pulse</strong> for session stats and a waterfall. Browse the timeline only on <strong>Feed</strong>.</p></div>`;
        return;
    }

    const total = completed.length;
    const errors = completed.filter(e => e.status >= 400 || e.status === 0).length;
    const avgDur = Math.round(completed.reduce((s,e) => s + (e.duration||0), 0) / total);
    const totalSize = completed.reduce((s,e) => s + (e.responseSize||0), 0);

    const waterfall = completed.filter(e => e.duration).slice(0, 15);
    const maxDur = Math.max(...waterfall.map(e => e.duration), 1);

    el.innerHTML = `
        <p style="font-size:10px;color:var(--text-3);margin:0 0 10px;line-height:1.5">Charts for this capture session. Unique routes and raw rows stay on <strong>Feed</strong> and <strong>Contracts</strong>.</p>
        <div class="dash-grid">
            <div class="dash-card">
                <div class="dc-lbl">Completed</div>
                <div class="dc-val" style="color:var(--accent)">${total}</div>
            </div>
            <div class="dash-card">
                <div class="dc-lbl">Error rate</div>
                <div class="dc-val" style="color:${errors?'var(--red)':'var(--green)'}">${total?Math.round(errors/total*100):0}%</div>
            </div>
            <div class="dash-card">
                <div class="dc-lbl">Avg latency</div>
                <div class="dc-val" style="color:${avgDur<200?'var(--green)':avgDur<800?'var(--yellow)':'var(--red)'}">${fmtMs(avgDur)}</div>
            </div>
            <div class="dash-card">
                <div class="dc-lbl">Transferred</div>
                <div class="dc-val" style="color:var(--cyan)">${fmtBytes(totalSize)}</div>
            </div>
        </div>
        <div class="dcard" style="margin-top:10px">
            <div class="dcard-head"><span class="dcard-title">Latency waterfall</span></div>
            <div class="dcard-body">
                <div class="waterfall">
                    ${waterfall.map(e => {
                        let label;
                        try { label = new URL(e.url).pathname.split('/').pop() || '/'; } catch { label = '?'; }
                        if (label.length > 14) label = label.slice(0,14)+'…';
                        const pct = Math.max(2, (e.duration / maxDur) * 100);
                        const cls = e.duration < 200 ? 'fast' : e.duration < 800 ? 'med' : 'slow';
                        return `<div class="wf-row list-hit" data-req-id="${escAttr(e.requestId)}" title="Open in Feed detail"><span class="wf-label">${esc(label)}</span><div class="wf-bar-wrap"><div class="wf-bar ${cls}" style="width:${pct}%"></div></div><span class="wf-time">${fmtMs(e.duration)}</span></div>`;
                    }).join('')}
                </div>
            </div>
        </div>
    `;
}

// ─── Route aggregation (OpenAPI + Contracts index) ───────
function aggregateDocsFromEndpoints() {
    const docs = {};
    const completed = endpoints.filter(e => e.phase === 'complete' && e.url);
    completed.forEach(e => {
        try {
            const u = new URL(e.url);
            const key = `${e.method} ${u.pathname}`;
            if (!docs[key]) {
                docs[key] = {
                    method: e.method,
                    path: u.pathname,
                    host: u.hostname,
                    statuses: new Set(),
                    queryParams: new Set(),
                    requestBodyShape: null,
                    responseBodyShape: null,
                    headers: {},
                    calls: 0,
                    durations: []
                };
            }
            const doc = docs[key];
            doc.calls++;
            if (e.status) doc.statuses.add(e.status);
            if (e.duration) doc.durations.push(e.duration);
            u.searchParams.forEach((v, k) => doc.queryParams.add(k));
            if (e.requestBody && !doc.requestBodyShape) {
                try { doc.requestBodyShape = getShape(JSON.parse(typeof e.requestBody === 'string' ? e.requestBody : JSON.stringify(e.requestBody))); } catch {}
            }
            if (e.responseBody && !doc.responseBodyShape) {
                try { doc.responseBodyShape = getShape(JSON.parse(typeof e.responseBody === 'string' ? e.responseBody : JSON.stringify(e.responseBody))); } catch {}
            }
            if (e.headers && typeof e.headers === 'object') {
                Object.keys(e.headers).forEach(k => { doc.headers[k] = e.headers[k]; });
            }
        } catch {}
    });
    return docs;
}

function getShape(obj, depth = 0) {
    if (depth > 3) return '...';
    if (obj === null) return 'null';
    if (Array.isArray(obj)) {
        return obj.length ? [getShape(obj[0], depth + 1)] : ['any'];
    }
    if (typeof obj === 'object') {
        const shape = {};
        for (const k of Object.keys(obj)) shape[k] = getShape(obj[k], depth + 1);
        return shape;
    }
    return typeof obj;
}

function shapeToOpenApiSchema(sh) {
    if (sh === null || sh === 'null') return { nullable: true, type: 'string' };
    if (typeof sh === 'string') {
        const m = { string: 'string', number: 'number', boolean: 'boolean', undefined: 'string', bigint: 'number' };
        return { type: m[sh] || 'string' };
    }
    if (Array.isArray(sh)) {
        if (!sh.length) return { type: 'array', items: {} };
        return { type: 'array', items: shapeToOpenApiSchema(sh[0]) };
    }
    if (typeof sh === 'object') {
        const props = {};
        const req = [];
        for (const [k, v] of Object.entries(sh)) {
            props[k] = shapeToOpenApiSchema(v);
            req.push(k);
        }
        return { type: 'object', properties: props, required: req };
    }
    return {};
}

function buildOpenApi3() {
    const docs = aggregateDocsFromEndpoints();
    const paths = {};
    for (const d of Object.values(docs)) {
        let pathKey = d.path || '/';
        if (!pathKey.startsWith('/')) pathKey = '/' + pathKey;
        if (!paths[pathKey]) paths[pathKey] = {};
        const methodLower = (d.method || 'get').toLowerCase();
        const op = { summary: `Observed ${d.method} ${d.path}`, responses: {} };
        if (d.requestBodyShape) {
            op.requestBody = {
                required: true,
                content: { 'application/json': { schema: shapeToOpenApiSchema(d.requestBodyShape) } }
            };
        }
        const statuses = [...d.statuses];
        const schema = d.responseBodyShape
            ? shapeToOpenApiSchema(d.responseBodyShape)
            : { type: 'object', additionalProperties: true };
        if (statuses.length) {
            [...statuses].sort((a, b) => a - b).forEach(code => {
                op.responses[String(code)] = {
                    description: 'Observed from capture',
                    content: { 'application/json': { schema: JSON.parse(JSON.stringify(schema)) } }
                };
            });
        } else {
            op.responses['200'] = {
                description: 'Observed from capture',
                content: { 'application/json': { schema } }
            };
        }
        paths[pathKey][methodLower] = op;
    }
    return {
        openapi: '3.0.3',
        info: {
            title: 'API Forensics — Observed API',
            version: '1.0.0',
            description: 'Generated from captured browser traffic. Review before publishing.',
            'x-generated-by': 'API Forensics'
        },
        paths
    };
}

/** Contracts — drift, hosts, compact route map (not a second Feed / not long-form docs). */
function renderContracts() {
    const el = $('#contracts-content');
    const completed = endpoints.filter(e => e.phase === 'complete');
    const docs = aggregateDocsFromEndpoints();

    const driftKeys = new Set();
    Object.entries(endpointHistory).forEach(([key, hist]) => {
        if (hist?.length >= 2 && hist[hist.length - 1].shapeChanged) driftKeys.add(key);
    });

    let slowest = null;
    Object.entries(endpointHistory).forEach(([key, hist]) => {
        const durs = hist.filter(x => x.duration).map(x => x.duration).sort((a, b) => a - b);
        if (!durs.length) return;
        const p95 = durs[Math.floor(durs.length * 0.95)] ?? durs[durs.length - 1];
        if (!slowest || p95 > slowest.p95) slowest = { key, p95 };
    });

    const hostMap = {};
    completed.forEach(e => {
        try {
            const h = new URL(e.url).hostname;
            if (!hostMap[h]) {
                const c = classifyHost(h);
                hostMap[h] = { count: 0, label: c.label, cls: c.cls };
            }
            hostMap[h].count++;
        } catch {}
    });

    let html = `<div class="contracts-intro"><strong>Feed</strong> = every raw request. <strong>Contracts</strong> = drift alerts, which hosts you hit, and a slim route index (click a row to open the latest capture). Full JSON bodies stay in Feed detail → Response.</div>`;

    if (slowest) {
        html += `<div class="contracts-insight" title="From capture history, not the live feed order">Hist. p95 leader · ${esc(slowest.key)} · ${fmtMs(slowest.p95)}</div>`;
    }

    html += `<div class="intel-section"><h4>Schema drift (${driftKeys.size})</h4>`;
    if (!driftKeys.size) {
        html += `<p style="font-size:11px;color:var(--text-3);padding:4px 0 8px">None yet. When the JSON shape for a route changes between responses, it shows here and as <span class="tag-diff">CHANGED</span> on Feed.</p>`;
    } else {
        html += [...driftKeys].map(k =>
            `<div class="intel-row" data-endpoint-key="${encodeURIComponent(k)}"><span style="font-family:'JetBrains Mono',monospace;font-size:10px">${esc(k)}</span><span class="ir-meta">open latest</span></div>`
        ).join('');
    }
    html += `</div>`;

    html += `<div class="intel-section"><h4>Hosts (click to copy)</h4>`;
    if (!Object.keys(hostMap).length) {
        html += `<p style="font-size:11px;color:var(--text-3)">No hosts in completed captures yet.</p>`;
    } else {
        html += Object.entries(hostMap)
            .sort((a, b) => b[1].count - a[1].count)
            .map(([host, meta]) =>
                `<div class="intel-row" data-copy-host="${encodeURIComponent(host)}"><span>${esc(host)}</span><span><span class="env-pill ${meta.cls}">${esc(meta.label)}</span> <span class="ir-meta">${meta.count} req</span></span></div>`
            ).join('');
    }
    html += `</div>`;

    html += `<div class="intel-section"><h4>Route index</h4>`;
    if (!Object.keys(docs).length) {
        html += `<p style="font-size:11px;color:var(--text-3)">No routes inferred yet — complete some JSON calls first.</p>`;
    } else {
        const rows = Object.entries(docs)
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([key, d]) => {
                const hasJson = !!(d.requestBodyShape || d.responseBodyShape);
                const drift = driftKeys.has(key);
                const pe = encodeURIComponent(d.path);
                const st = [...d.statuses].sort((a,b)=>a-b).join(',') || '—';
                return `<tr class="contract-row" data-method="${escAttr(d.method)}" data-path="${pe}" title="Open latest capture">
                    <td><span class="mbadge ${d.method}" style="font-size:8px;padding:1px 4px">${d.method}</span></td>
                    <td>${esc(d.path)}</td>
                    <td style="color:var(--text-3)">${st}</td>
                    <td>${hasJson ? '●' : '—'}</td>
                    <td>${drift ? '⚠' : '—'}</td>
                </tr>`;
            }).join('');
        html += `<p style="font-size:9px;color:var(--text-3);margin-bottom:6px">● = inferred JSON shape · ⚠ = drift · columns are not latency (see Pulse / Feed)</p>
        <div class="contracts-table-wrap"><table class="contracts-table"><thead><tr><th>M</th><th>Path</th><th>HTTP</th><th>Σ</th><th>Δ</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    }
    html += `</div>`;

    el.innerHTML = html;
}

function exportOpenApi3File() {
    const spec = buildOpenApi3();
    if (!spec.paths || !Object.keys(spec.paths).length) {
        toast('No documented routes yet — capture some JSON APIs first', 'err');
        return;
    }
    downloadJSON(spec, `api-openapi-${Date.now()}.json`);
    toast(`OpenAPI: ${Object.keys(spec.paths).length} path(s)`, 'ok');
    openOfferTabOnce('offerExportAnyOnceOpened');
}

function exportDriftReport() {
    const out = { generatedAt: new Date().toISOString(), drifts: [] };
    Object.entries(endpointHistory).forEach(([key, hist]) => {
        if (!hist || hist.length < 2) return;
        const last = hist[hist.length - 1];
        if (!last.shapeChanged) return;
        const prev = hist[hist.length - 2];
        out.drifts.push({
            endpoint: key,
            previousFingerprint: prev.fingerprint,
            latestFingerprint: last.fingerprint,
            detectedAt: last.timestamp
        });
    });
    if (!out.drifts.length) {
        toast('No schema drift in history to export', 'err');
        return;
    }
    downloadJSON(out, `api-drift-${Date.now()}.json`);
    toast(`Drift report: ${out.drifts.length} endpoint(s)`, 'ok');
    openOfferTabOnce('offerExportAnyOnceOpened');
}

function tsBundleInterfaceFromJson(name, data) {
    function buildType(val) {
        if (val === null) return 'null';
        if (Array.isArray(val)) return `${val.length ? buildType(val[0]) : 'any'}[]`;
        if (typeof val === 'object') return 'Record<string, unknown>';
        return typeof val;
    }
    function buildBlock(n, obj) {
        if (Array.isArray(obj)) {
            return `export type ${n} = ${obj.length ? buildType(obj[0]) : 'any'}[];\n`;
        }
        let s = `export interface ${n} {\n`;
        for (const [key, val] of Object.entries(obj)) {
            s += `  ${key}: ${buildType(val)};\n`;
        }
        s += `}\n`;
        return s;
    }
    const obj = typeof data === 'string' ? JSON.parse(data) : data;
    if (obj === null || typeof obj !== 'object') return `export type ${name} = any;\n`;
    return buildBlock(name, obj);
}

function exportTsBundleFile() {
    const docs = aggregateDocsFromEndpoints();
    const parts = ['/** API Forensics — TypeScript from observed JSON responses */', ''];
    let n = 0;
    for (const [key, d] of Object.entries(docs)) {
        const latest = endpoints.find(e => {
            if (e.phase !== 'complete' || e.method !== d.method || !e.url) return false;
            try { return new URL(e.url).pathname === d.path; } catch { return false; }
        });
        if (!latest?.responseBody) continue;
        let obj;
        try {
            obj = typeof latest.responseBody === 'string' ? JSON.parse(latest.responseBody) : latest.responseBody;
        } catch { continue; }
        const safe = key.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'Route';
        const name = `Response_${safe.slice(0, 48)}_${n++}`;
        parts.push(`// ${key}`);
        try {
            parts.push(tsBundleInterfaceFromJson(name, obj));
        } catch { continue; }
        parts.push('');
    }
    if (parts.length <= 2) {
        toast('No parseable JSON responses for a TS bundle yet', 'err');
        return;
    }
    downloadText(parts.join('\n'), `api-types-${Date.now()}.ts`);
    toast('TypeScript bundle downloaded', 'ok');
    openOfferTabOnce('offerExportAnyOnceOpened');
}

// ─── Workbench — HTTP console (Postman-style) ─────────────
const WB_SEND_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>`;
let wbLastEnvironmentId = null;
/** Raw response body text from last workbench send (for Copy JSON). */
let wbLastResponseRaw = '';

function applyEnvTemplate(str, vars) {
    if (str == null || typeof str !== 'string') return str;
    if (!vars || typeof vars !== 'object') return str;
    return str.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (m, key) => (
        Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key] ?? '') : m
    ));
}

function appendQueryParams(urlStr, paramsObj) {
    if (!paramsObj || typeof paramsObj !== 'object' || Array.isArray(paramsObj)) return urlStr;
    const keys = Object.keys(paramsObj).filter((k) => paramsObj[k] != null && paramsObj[k] !== '');
    if (!keys.length) return urlStr;
    try {
        const u = new URL(urlStr);
        for (const k of keys) u.searchParams.set(k, String(paramsObj[k]));
        return u.toString();
    } catch {
        return urlStr;
    }
}

function parseWorkbenchFormBody(text) {
    const t = (text || '').trim();
    if (!t) return '';
    try {
        const o = JSON.parse(t);
        if (o && typeof o === 'object' && !Array.isArray(o)) {
            const p = new URLSearchParams();
            for (const [k, v] of Object.entries(o)) p.set(k, String(v));
            return p.toString();
        }
    } catch { /* fall through */ }
    const p = new URLSearchParams();
    for (const line of t.split('\n')) {
        const s = line.trim();
        if (!s) continue;
        const i = s.indexOf('=');
        if (i > 0) p.set(s.slice(0, i).trim(), s.slice(i + 1).trim());
    }
    return p.toString();
}

function buildWorkbenchAuthHeaders(vars) {
    const type = ($('#wb-auth-type') && $('#wb-auth-type').value) || 'none';
    const h = {};
    if (type === 'bearer') {
        const token = applyEnvTemplate(($('#wb-auth-bearer') && $('#wb-auth-bearer').value) || '', vars);
        if (token) h.Authorization = `Bearer ${token}`;
    } else if (type === 'basic') {
        const user = applyEnvTemplate(($('#wb-auth-basic-user') && $('#wb-auth-basic-user').value) || '', vars);
        const pass = applyEnvTemplate(($('#wb-auth-basic-pass') && $('#wb-auth-basic-pass').value) || '', vars);
        if (user || pass) {
            try {
                h.Authorization = `Basic ${btoa(`${user}:${pass}`)}`;
            } catch {
                h.Authorization = `Basic ${btoa(unescape(encodeURIComponent(`${user}:${pass}`)))}`;
            }
        }
    } else if (type === 'apikey') {
        const name = (($('#wb-auth-apikey-name') && $('#wb-auth-apikey-name').value) || 'X-API-Key').trim();
        const val = applyEnvTemplate(($('#wb-auth-apikey-value') && $('#wb-auth-apikey-value').value) || '', vars);
        if (name && val) h[name] = val;
    }
    return h;
}

function syncWorkbenchAuthFields() {
    const type = ($('#wb-auth-type') && $('#wb-auth-type').value) || 'none';
    const map = { bearer: 'wb-auth-fields-bearer', basic: 'wb-auth-fields-basic', apikey: 'wb-auth-fields-apikey' };
    Object.values(map).forEach((id) => {
        const el = $(`#${id}`);
        if (el) el.style.display = 'none';
    });
    if (map[type]) {
        const el = $(`#${map[type]}`);
        if (el) el.style.display = 'block';
    }
}

function syncWorkbenchBodyFields() {
    const t = ($('#wb-body-type') && $('#wb-body-type').value) || 'none';
    const jsonW = $('#wb-body-json-wrap');
    const rawW = $('#wb-body-raw-wrap');
    const formW = $('#wb-body-form-wrap');
    if (jsonW) jsonW.style.display = t === 'json' ? 'block' : 'none';
    if (rawW) rawW.style.display = t === 'raw' ? 'block' : 'none';
    if (formW) formW.style.display = t === 'form' ? 'block' : 'none';
}

function activateWorkbenchPanel(wb) {
    const tabs = $('#wb-main-tabs');
    if (tabs) {
        $$('.nav-tab', tabs).forEach((tab) => {
            tab.classList.toggle('active', tab.dataset.wb === wb);
        });
    }
    $$('.wb-panel').forEach((p) => {
        p.classList.toggle('active', p.id === `wb-panel-${wb}`);
    });
    if (wb === 'mocks') loadMocks();
    if (wb === 'console') loadWorkbenchEnvs();
}

function setupWorkbenchMainTabs() {
    const tabs = $('#wb-main-tabs');
    if (!tabs) return;
    $$('.nav-tab', tabs).forEach((tab) => {
        tab.onclick = () => {
            $$('.nav-tab', tabs).forEach((t) => t.classList.remove('active'));
            tab.classList.add('active');
            const wb = tab.dataset.wb;
            $$('.wb-panel').forEach((p) => p.classList.remove('active'));
            const panel = $(`#wb-panel-${wb}`);
            if (panel) panel.classList.add('active');
            if (wb === 'mocks') loadMocks();
            if (wb === 'console') loadWorkbenchEnvs();
        };
    });
}

function setupWorkbenchSubTabs() {
    const tabs = $('#wb-req-subtabs');
    if (!tabs) return;
    $$('.nav-tab', tabs).forEach((tab) => {
        tab.onclick = () => {
            $$('.nav-tab', tabs).forEach((t) => t.classList.remove('active'));
            tab.classList.add('active');
            const sub = tab.dataset.wbSub;
            $$('.wb-subpanel').forEach((p) => {
                p.classList.toggle('active', p.dataset.wbSubPanel === sub);
            });
        };
    });
}

function ensureWorkbenchEnvironments(callback) {
    chrome.storage.local.get(['apiAtlasEnvironments', 'apiAtlasActiveEnvironmentId'], (data) => {
        let list = data.apiAtlasEnvironments;
        let activeId = data.apiAtlasActiveEnvironmentId;
        if (!Array.isArray(list) || !list.length) {
            list = [{ id: 'env_default', name: 'Default', variables: { baseUrl: 'http://localhost:3000' } }];
            activeId = 'env_default';
            chrome.storage.local.set({ apiAtlasEnvironments: list, apiAtlasActiveEnvironmentId: activeId }, () => callback(list, activeId));
        } else {
            if (!list.some((e) => e.id === activeId)) activeId = list[0].id;
            callback(list, activeId);
        }
    });
}

function persistActiveWorkbenchEnvVars(done) {
    const sel = $('#wb-env-select');
    const ta = $('#wb-env-vars');
    if (!sel || !ta) { if (done) done(); return; }
    const activeId = sel.value;
    let variables;
    try {
        variables = JSON.parse(ta.value.trim() || '{}');
        if (!variables || typeof variables !== 'object' || Array.isArray(variables)) throw new Error('object');
    } catch {
        toast('Environment variables must be a JSON object', 'err');
        return;
    }
    chrome.storage.local.get('apiAtlasEnvironments', (d) => {
        const list = (d.apiAtlasEnvironments || []).map((e) => (e.id === activeId ? { ...e, variables } : e));
        chrome.storage.local.set({ apiAtlasEnvironments: list }, () => { if (done) done(); });
    });
}

function loadWorkbenchEnvs() {
    ensureWorkbenchEnvironments((list, activeId) => {
        const sel = $('#wb-env-select');
        if (!sel) return;
        sel.innerHTML = list.map((e) => `<option value="${escAttr(String(e.id))}">${esc(e.name || e.id)}</option>`).join('');
        sel.value = activeId;
        wbLastEnvironmentId = activeId;
        chrome.storage.local.set({ apiAtlasActiveEnvironmentId: activeId });
        const env = list.find((x) => x.id === activeId) || list[0];
        const ta = $('#wb-env-vars');
        if (ta) ta.value = JSON.stringify((env && env.variables) || {}, null, 2);
    });
}

function readWorkbenchEnvVarsForRequest() {
    const ta = $('#wb-env-vars');
    if (!ta) return {};
    try {
        const o = JSON.parse(ta.value.trim() || '{}');
        if (o && typeof o === 'object' && !Array.isArray(o)) return o;
    } catch {
        toast('Fix environment JSON before sending', 'err');
    }
    return null;
}

function fillWorkbenchFromCapture() {
    if (!selectedId) {
        toast('Select a row on Feed first', 'err');
        return;
    }
    const item = endpoints.find((x) => x.requestId === selectedId);
    if (!item || !item.url) {
        toast('No URL on that capture', 'err');
        return;
    }
    $('.nav-tab[data-p="workbench"]', $('#nav'))?.click();
    activateWorkbenchPanel('console');
    $('#wb-url').value = item.url;
    $('#wb-method').value = (item.method || 'GET').toUpperCase();
    const rh = item.requestHeaders && Object.keys(item.requestHeaders).length ? item.requestHeaders : (item.headers || {});
    const headersObj = typeof rh === 'object' && !Array.isArray(rh) ? { ...rh } : {};
    delete headersObj[':method'];
    delete headersObj[':path'];
    delete headersObj[':scheme'];
    delete headersObj[':authority'];
    $('#wb-headers-json').value = JSON.stringify(headersObj, null, 2);
    const bt = $('#wb-body-type');
    if (item.requestBody != null && item.requestBody !== '') {
        if (bt) bt.value = 'json';
        syncWorkbenchBodyFields();
        const raw = typeof item.requestBody === 'string' ? item.requestBody : JSON.stringify(item.requestBody, null, 2);
        const bj = $('#wb-body-json');
        if (bj) bj.value = raw;
    } else {
        if (bt) bt.value = 'none';
        syncWorkbenchBodyFields();
    }
    $('#wb-params-json').value = '';
    toast('Console filled from capture', 'ok');
}

async function runWorkbenchRequest() {
    const vars = readWorkbenchEnvVarsForRequest();
    if (vars === null) return;

    const urlRaw = ($('#wb-url') && $('#wb-url').value.trim()) || '';
    if (!urlRaw) { toast('URL required', 'err'); return; }

    let params = {};
    try {
        const pj = ($('#wb-params-json') && $('#wb-params-json').value.trim()) || '{}';
        const parsed = JSON.parse(pj || '{}');
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) params = parsed;
        else { toast('Params must be a JSON object', 'err'); return; }
    } catch {
        toast('Invalid params JSON', 'err');
        return;
    }

    const paramsSubst = {};
    for (const [k, v] of Object.entries(params)) {
        paramsSubst[k] = typeof v === 'string' ? applyEnvTemplate(v, vars) : v;
    }

    let url = applyEnvTemplate(urlRaw, vars);
    if (!/^https?:\/\//i.test(url)) {
        if (url.startsWith('/')) {
            const base = String(vars.baseUrl || vars.BASE_URL || '').replace(/\/$/, '');
            if (!base) {
                toast('Add baseUrl to environment or use a full https:// URL', 'err');
                return;
            }
            url = base + url;
        } else {
            toast('URL must start with http(s):// or /path with baseUrl in env', 'err');
            return;
        }
    }
    url = appendQueryParams(url, paramsSubst);

    let headers = {};
    try {
        const hj = ($('#wb-headers-json') && $('#wb-headers-json').value.trim()) || '{}';
        headers = JSON.parse(hj || '{}');
        if (!headers || typeof headers !== 'object' || Array.isArray(headers)) throw new Error('bad');
    } catch {
        toast('Headers must be a JSON object', 'err');
        return;
    }
    const outHeaders = {};
    for (const [k, v] of Object.entries(headers)) {
        outHeaders[k] = typeof v === 'string' ? applyEnvTemplate(v, vars) : v;
    }
    const authH = buildWorkbenchAuthHeaders(vars);
    Object.assign(outHeaders, authH);

    const method = ($('#wb-method') && $('#wb-method').value) || 'GET';
    const bodyType = ($('#wb-body-type') && $('#wb-body-type').value) || 'none';
    const opts = { method, headers: outHeaders };
    let bodyStr;

    if (!['GET', 'HEAD'].includes(method) && bodyType !== 'none') {
        if (bodyType === 'json') {
            const raw = ($('#wb-body-json') && $('#wb-body-json').value) || '';
            bodyStr = applyEnvTemplate(raw, vars);
            const hasCt = Object.keys(outHeaders).some((k) => k.toLowerCase() === 'content-type');
            if (!hasCt) outHeaders['Content-Type'] = 'application/json';
        } else if (bodyType === 'raw') {
            bodyStr = applyEnvTemplate(($('#wb-body-raw') && $('#wb-body-raw').value) || '', vars);
            const hasCt = Object.keys(outHeaders).some((k) => k.toLowerCase() === 'content-type');
            if (!hasCt) {
                const ct = ($('#wb-body-raw-ct') && $('#wb-body-raw-ct').value.trim()) || 'text/plain';
                outHeaders['Content-Type'] = ct;
            }
        } else if (bodyType === 'form') {
            bodyStr = parseWorkbenchFormBody(applyEnvTemplate(($('#wb-body-form') && $('#wb-body-form').value) || '', vars));
            const hasCt = Object.keys(outHeaders).some((k) => k.toLowerCase() === 'content-type');
            if (!hasCt) outHeaders['Content-Type'] = 'application/x-www-form-urlencoded';
        }
        if (bodyStr) opts.body = bodyStr;
    }
    opts.headers = outHeaders;

    const sendBtn = $('#btn-wb-send');
    if (sendBtn) {
        sendBtn.disabled = true;
        sendBtn.textContent = 'Sending…';
    }

    try {
        const start = performance.now();
        const res = await fetch(url, opts);
        const dur = Math.round(performance.now() - start);
        const text = await res.text();
        wbLastResponseRaw = text;
        const card = $('#wb-response-card');
        const summary = $('#wb-res-summary');
        const bodyEl = $('#wb-res-body');
        if (card) card.style.display = 'block';
        if (summary) {
            summary.textContent = `${res.status} · ${dur}ms`;
            summary.style.color = res.ok ? 'var(--green)' : 'var(--yellow)';
        }
        if (bodyEl) {
            try {
                bodyEl.innerHTML = highlight(JSON.parse(text));
            } catch {
                bodyEl.innerHTML = highlight(text);
            }
        }
    } catch (e) {
        wbLastResponseRaw = String(e.message || e);
        const card = $('#wb-response-card');
        const summary = $('#wb-res-summary');
        const bodyEl = $('#wb-res-body');
        if (card) card.style.display = 'block';
        if (summary) {
            summary.textContent = 'Failed';
            summary.style.color = 'var(--red)';
        }
        if (bodyEl) bodyEl.innerHTML = `<span style="color:var(--red)">${esc(e.message)}</span>`;
    }

    openOfferWorkbenchTab();

    if (sendBtn) {
        sendBtn.disabled = false;
        sendBtn.innerHTML = `${WB_SEND_SVG} Send request`;
    }
}

function copyWorkbenchResponseJson() {
    openOfferWorkbenchTab();
    const s = wbLastResponseRaw;
    if (!s) {
        toast('Nothing to copy yet — send a request first', 'err');
        return;
    }
    let out = s;
    try {
        out = JSON.stringify(JSON.parse(s), null, 2);
    } catch { /* keep raw */ }
    navigator.clipboard.writeText(out).then(() => toast('Copied', 'ok'));
}

function setupWorkbench() {
    setupWorkbenchMainTabs();
    setupWorkbenchSubTabs();
    const at = $('#wb-auth-type');
    if (at) at.onchange = syncWorkbenchAuthFields;
    const bt = $('#wb-body-type');
    if (bt) bt.onchange = syncWorkbenchBodyFields;
    syncWorkbenchAuthFields();
    syncWorkbenchBodyFields();

    const sel = $('#wb-env-select');
    if (sel) {
        sel.onchange = () => {
            const next = sel.value;
            const prev = wbLastEnvironmentId;
            const ta = $('#wb-env-vars');
            let variables;
            if (prev && prev !== next) {
                try {
                    variables = JSON.parse((ta && ta.value.trim()) || '{}');
                    if (!variables || typeof variables !== 'object' || Array.isArray(variables)) throw new Error('bad');
                } catch {
                    toast('Environment variables must be a JSON object', 'err');
                    sel.value = prev;
                    return;
                }
                chrome.storage.local.get('apiAtlasEnvironments', (d) => {
                    const list = (d.apiAtlasEnvironments || []).map((e) => (e.id === prev ? { ...e, variables } : e));
                    chrome.storage.local.set({ apiAtlasEnvironments: list }, () => {
                        chrome.storage.local.set({ apiAtlasActiveEnvironmentId: next }, () => {
                            wbLastEnvironmentId = next;
                            chrome.storage.local.get('apiAtlasEnvironments', (d2) => {
                                const env = (d2.apiAtlasEnvironments || []).find((x) => x.id === next);
                                const ta2 = $('#wb-env-vars');
                                if (ta2) ta2.value = JSON.stringify((env && env.variables) || {}, null, 2);
                            });
                        });
                    });
                });
            } else {
                wbLastEnvironmentId = next;
                chrome.storage.local.set({ apiAtlasActiveEnvironmentId: next }, () => {
                    chrome.storage.local.get('apiAtlasEnvironments', (d) => {
                        const env = (d.apiAtlasEnvironments || []).find((x) => x.id === next);
                        const ta2 = $('#wb-env-vars');
                        if (ta2) ta2.value = JSON.stringify((env && env.variables) || {}, null, 2);
                    });
                });
            }
        };
    }

    const btnSave = $('#btn-wb-env-save');
    if (btnSave) {
        btnSave.onclick = () => persistActiveWorkbenchEnvVars(() => {
            toast('Variables saved', 'ok');
            openOfferWorkbenchTab();
        });
    }
    const btnNew = $('#btn-wb-env-new');
    if (btnNew) {
        btnNew.onclick = () => {
            const name = (prompt('Environment name', 'Staging') || '').trim();
            if (!name) return;
            persistActiveWorkbenchEnvVars(() => {
                const id = `env_${Date.now()}`;
                chrome.storage.local.get('apiAtlasEnvironments', (d) => {
                    const list = [...(d.apiAtlasEnvironments || []), { id, name, variables: {} }];
                    chrome.storage.local.set({ apiAtlasEnvironments: list, apiAtlasActiveEnvironmentId: id }, () => {
                        loadWorkbenchEnvs();
                        toast('Environment created', 'ok');
                    });
                });
            });
        };
    }

    const btnCap = $('#btn-wb-from-capture');
    if (btnCap) btnCap.onclick = fillWorkbenchFromCapture;
    const btnSend = $('#btn-wb-send');
    if (btnSend) btnSend.onclick = () => runWorkbenchRequest();
    const btnCopyRes = $('#btn-wb-copy-res-json');
    if (btnCopyRes) btnCopyRes.onclick = copyWorkbenchResponseJson;
}

// ─── Mocks ──────────────────────────────────────────────
function setupMocks() {
    $('#btn-save-mock').onclick = saveMock;
}

function saveMock() {
    const url = $('#mock-url').value.trim();
    const method = $('#mock-method').value;
    const status = parseInt($('#mock-status').value) || 200;
    const bodyText = $('#mock-body').value.trim();

    if (!url) { toast('Enter a URL pattern', 'err'); return; }
    let response;
    try { response = JSON.parse(bodyText || '{}'); } catch { toast('Invalid JSON', 'err'); return; }

    const mock = { id: Date.now(), url, method, status, response, active: true, isRegex: url.startsWith('^') || url.includes('(') };

    chrome.storage.local.get('mocks', (data) => {
        const mocks = [...(data.mocks || []), mock];
        chrome.storage.local.set({ mocks }, () => {
            loadMocks();
            toast('Mock saved & injected', 'ok');
            openOfferTabOnce('offerMockSaveOnceOpened');
            $('#mock-url').value = '';
            $('#mock-body').value = '';
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { action: 'update_mocks', mocks });
            });
        });
    });
}

function loadMocks() {
    chrome.storage.local.get('mocks', (data) => {
        const mocks = data.mocks || [];
        const el = $('#mocks-list');
        if (!mocks.length) { el.innerHTML = ''; return; }
        el.innerHTML = `<div style="font-size:10px;font-weight:700;color:var(--text-3);text-transform:uppercase;letter-spacing:.4px;margin:8px 0 6px">Active Mocks (${mocks.length}) · click a row to edit</div>` +
            mocks.map(m => `<div class="mock-item" data-mock-id="${m.id}" title="Load into form">
                <div style="overflow:hidden">
                    <div style="font-size:11px;font-weight:600;font-family:'JetBrains Mono',monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><span class="mbadge ${m.method}" style="font-size:8px;padding:0 4px">${m.method}</span> ${esc(m.url)}</div>
                    <div style="font-size:9px;color:var(--text-3)">Status ${m.status} • ${m.isRegex?'Regex':'Contains'}</div>
                </div>
                <button type="button" class="abtn" data-mock-del="${m.id}">Delete</button>
            </div>`).join('');
    });
}

window.delMock = (id) => {
    chrome.storage.local.get('mocks', (data) => {
        const mocks = (data.mocks || []).filter(m => String(m.id) !== String(id));
        chrome.storage.local.set({ mocks }, () => {
            loadMocks();
            toast('Mock removed', 'nfo');
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { action: 'update_mocks', mocks });
            });
        });
    });
};

// ─── Export ──────────────────────────────────────────────
function setupExport() {
    $('#exp-postman').onclick = exportPostman;
    $('#exp-har').onclick = exportHAR;
    $('#exp-curl').onclick = exportCurl;
    $('#exp-openapi').onclick = exportOpenApi3File;
    $('#exp-drift').onclick = exportDriftReport;
    $('#exp-tsbundle').onclick = exportTsBundleFile;
}

function exportPostman() {
    chrome.runtime.sendMessage({ action: 'export_postman' }, (collection) => {
        if (!collection || !collection.item || !collection.item.length) {
            toast('No completed requests to export', 'err');
            return;
        }
        downloadJSON(collection, `api-postman-${Date.now()}.json`);
        toast(`Exported ${collection.item.length} endpoints to Postman`, 'ok');
        openOfferTabOnce('offerExportAnyOnceOpened');
    });
}

function exportHAR() {
    const completed = endpoints.filter(e => e.phase === 'complete');
    if (!completed.length) { toast('No completed requests', 'err'); return; }

    const har = {
        log: {
            version: '1.2',
            creator: { name: 'API Forensics', version: '2.0.0' },
            entries: completed.map(e => ({
                startedDateTime: new Date(e.timestamp || Date.now()).toISOString(),
                time: e.duration || 0,
                request: {
                    method: e.method,
                    url: e.url,
                    httpVersion: 'HTTP/1.1',
                    headers: e.headers ? Object.entries(typeof e.headers === 'object' ? e.headers : {}).map(([n,v])=>({name:n,value:v})) : [],
                    queryString: [],
                    bodySize: e.requestSize || 0,
                    postData: e.requestBody ? { mimeType: 'application/json', text: e.requestBody } : undefined
                },
                response: {
                    status: e.status || 0,
                    statusText: e.statusText || '',
                    httpVersion: 'HTTP/1.1',
                    headers: [],
                    content: { size: e.responseSize || 0, mimeType: 'application/json', text: e.responseBody || '' },
                    bodySize: e.responseSize || 0
                },
                timings: { send: 0, wait: e.duration || 0, receive: 0 }
            }))
        }
    };
    downloadJSON(har, `api-capture-${Date.now()}.har`);
    toast(`Exported ${completed.length} entries as HAR`, 'ok');
    openOfferTabOnce('offerExportAnyOnceOpened');
}

function exportCurl() {
    const completed = endpoints.filter(e => e.phase === 'complete');
    if (!completed.length) { toast('No completed requests', 'err'); return; }

    const lines = completed.map(e => {
        let cmd = `curl -X ${e.method} "${e.url}"`;
        if (e.requestBody) cmd += ` \\\n  -H "Content-Type: application/json" \\\n  -d '${typeof e.requestBody === 'string' ? e.requestBody : JSON.stringify(e.requestBody)}'`;
        return cmd;
    });

    const script = `#!/bin/bash\n# Generated by API Forensics — ${new Date().toISOString()}\n\n${lines.join('\n\n')}\n`;
    downloadText(script, `api-curls-${Date.now()}.sh`);
    toast(`Exported ${completed.length} cURL commands`, 'ok');
    openOfferTabOnce('offerExportAnyOnceOpened');
}

function downloadJSON(obj, filename) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    downloadBlob(blob, filename);
}
function downloadText(text, filename) {
    const blob = new Blob([text], { type: 'text/plain' });
    downloadBlob(blob, filename);
}
function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 100);
}

// ─── Copy Helpers ───────────────────────────────────────
window.copyTxt = (txt) => { navigator.clipboard.writeText(txt).then(() => toast('Copied', 'ok')); };
window.copyJson = (str) => {
    try { str = JSON.stringify(JSON.parse(str), null, 2); } catch {}
    navigator.clipboard.writeText(str).then(() => toast('Copied', 'ok'));
};
window.copyCurl = (id) => {
    const e = endpoints.find(x => x.requestId === id);
    if (!e) return;
    let cmd = `curl -X ${e.method} "${e.url}"`;
    if (e.headers && typeof e.headers === 'object') Object.entries(e.headers).forEach(([k,v]) => { cmd += ` \\\n  -H "${k}: ${v}"`; });
    if (e.requestBody) cmd += ` \\\n  -d '${typeof e.requestBody==='string'?e.requestBody:JSON.stringify(e.requestBody)}'`;
    navigator.clipboard.writeText(cmd).then(() => toast('cURL copied', 'ok'));
};
window.copyFetch = (id) => {
    const e = endpoints.find(x => x.requestId === id);
    if (!e) return;
    const opts = { method: e.method };
    if (e.requestBody) opts.body = e.requestBody;
    const code = `fetch("${e.url}", ${JSON.stringify(opts, null, 2)})\n  .then(r => r.json())\n  .then(console.log)\n  .catch(console.error);`;
    navigator.clipboard.writeText(code).then(() => toast('Fetch copied', 'ok'));
};

// ─── JSON Highlight ─────────────────────────────────────
function highlight(raw) {
    if (!raw) return '<span class="jnull">No content</span>';
    try {
        const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
        const json = JSON.stringify(obj, null, 2);
        return json.replace(/("(\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g, (m) => {
            let c = 'jn';
            if (/^"/.test(m)) { c = /:$/.test(m) ? 'jk' : 'js'; if (c==='jk') return `<span class="${c}">${m.slice(0,-1)}</span>:`; }
            else if (/true|false/.test(m)) c = 'jb';
            else if (/null/.test(m)) c = 'jnull';
            return `<span class="${c}">${m}</span>`;
        });
    } catch { return esc(String(raw)); }
}

// ─── Toast ──────────────────────────────────────────────
function toast(msg, type='nfo') {
    const svg = (paths) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
    const icons = {
        ok: svg('<path d="M20 6L9 17l-5-5"/>'),
        err: svg('<circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/>'),
        nfo: svg('<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>')
    };
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.innerHTML = `${icons[type] || icons.nfo}${esc(msg)}`;
    $('#toasts').appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 250); }, 2200);
}

// ─── Utilities ──────────────────────────────────────────
function fmtMs(ms) { return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms/1000).toFixed(1)}s`; }
function fmtBytes(b) {
    if (b < 1024) return `${b}B`;
    if (b < 1048576) return `${(b/1024).toFixed(1)}KB`;
    return `${(b/1048576).toFixed(1)}MB`;
}
function escAttr(s) { return (s||'').replace(/'/g,"\\'").replace(/"/g,'&quot;'); }

// ─── Boot ───────────────────────────────────────────────
init();
