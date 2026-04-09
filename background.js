// ═══════════════════════════════════════════════════════
// API Forensics — background service worker
// ═══════════════════════════════════════════════════════

const CACHE_LIMIT = 200;
let apiCache = [];
let endpointHistory = {}; // { urlKey: [{ status, responseBody, timestamp }] } for diff tracking
let stackCache = {}; // { tabId: stackData }

// ─── STAGE: Load cache on wake up
chrome.storage.local.get(['apiCache', 'endpointHistory', 'stackCache'], (data) => {
    if (data.apiCache) apiCache = data.apiCache;
    if (data.endpointHistory) endpointHistory = data.endpointHistory;
    if (data.stackCache) stackCache = data.stackCache;
});

function saveCache() {
    chrome.storage.local.set({ apiCache, endpointHistory, stackCache });
}

// Side Panel behavior
if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
        .catch(() => {});
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'api_report') {
        const report = { ...msg.data, tabId: sender.tab?.id };

        if (report.phase === 'start') {
            apiCache.unshift(report);
            if (apiCache.length > CACHE_LIMIT) apiCache.pop();
            saveCache();
        } else if (report.requestId) {
            const existing = apiCache.find(e => e.requestId === report.requestId);
            if (existing) {
                Object.assign(existing, report);
                // Track response history for diff detection
                if (report.phase === 'complete' && existing.url) {
                    trackHistory(existing);
                }
            } else {
                // Mocked or standalone
                apiCache.unshift(report);
                if (apiCache.length > CACHE_LIMIT) apiCache.pop();
                if (report.phase === 'complete') trackHistory(report);
            }
            saveCache();
        }

        // Forward to side panel
        try {
            chrome.runtime.sendMessage({ action: 'api_update', data: report });
        } catch {}
    }

    if (msg.action === 'stack_report') {
        const tabId = sender.tab?.id;
        if (tabId) {
            stackCache[tabId] = msg.data;
            saveCache();
            try { chrome.runtime.sendMessage({ action: 'stack_update', tabId, data: msg.data }); } catch {}
        }
    }

    if (msg.action === 'get_cache') {
        sendResponse({ cache: apiCache, history: endpointHistory });
    }

    if (msg.action === 'get_history') {
        sendResponse(endpointHistory);
    }

    if (msg.action === 'get_stack') {
        sendResponse(stackCache[msg.tabId] || null);
    }

    if (msg.action === 'clear_cache') {
        apiCache = [];
        endpointHistory = {};
        stackCache = {};
        saveCache();
        sendResponse(true);
    }

    if (msg.action === 'triggerAudit') {
        const tabId = msg.tabId || sender.tab?.id;
        if (tabId) chrome.tabs.reload(tabId);
        sendResponse(true);
    }

    if (msg.action === 'export_postman') {
        const collection = buildPostmanCollection(apiCache);
        sendResponse(collection);
    }

    return true;
});

function trackHistory(entry) {
    try {
        const urlObj = new URL(entry.url);
        const key = `${entry.method} ${urlObj.pathname}`;
        if (!endpointHistory[key]) endpointHistory[key] = [];

        // Compute a response fingerprint (shape, not values)
        let fingerprint = '';
        try {
            const body = typeof entry.responseBody === 'string' ? JSON.parse(entry.responseBody) : entry.responseBody;
            fingerprint = getObjectShape(body);
        } catch {
            fingerprint = typeof entry.responseBody === 'string' ? `string:${entry.responseBody.length}` : 'unknown';
        }

        const record = {
            status: entry.status,
            responseSize: entry.responseSize || 0,
            duration: entry.duration || 0,
            fingerprint,
            timestamp: Date.now()
        };

        const hist = endpointHistory[key];
        hist.push(record);
        if (hist.length > 20) hist.shift();

        // Check if shape changed
        if (hist.length >= 2) {
            const prev = hist[hist.length - 2];
            if (prev.fingerprint && record.fingerprint && prev.fingerprint !== record.fingerprint) {
                record.shapeChanged = true;
            }
        }
    } catch {}
}

function getObjectShape(obj, depth = 0) {
    if (depth > 4) return '...';
    if (obj === null) return 'null';
    if (Array.isArray(obj)) {
        if (obj.length === 0) return '[]';
        return `[${getObjectShape(obj[0], depth + 1)}]`;
    }
    if (typeof obj === 'object') {
        const keys = Object.keys(obj).sort();
        return `{${keys.map(k => `${k}:${getObjectShape(obj[k], depth + 1)}`).join(',')}}`;
    }
    return typeof obj;
}

function buildPostmanCollection(cache) {
    const items = cache
        .filter(e => e.url && e.method && e.phase === 'complete')
        .map(e => {
            let urlObj;
            try { urlObj = new URL(e.url); } catch { return null; }

            const item = {
                name: `${e.method} ${urlObj.pathname}`,
                request: {
                    method: e.method,
                    header: [],
                    url: {
                        raw: e.url,
                        protocol: urlObj.protocol.replace(':', ''),
                        host: urlObj.hostname.split('.'),
                        path: urlObj.pathname.split('/').filter(Boolean),
                        query: Array.from(urlObj.searchParams.entries()).map(([k, v]) => ({ key: k, value: v }))
                    }
                }
            };

            if (e.headers && typeof e.headers === 'object') {
                item.request.header = Object.entries(e.headers).map(([k, v]) => ({ key: k, value: v }));
            }

            if (e.requestBody) {
                item.request.body = {
                    mode: 'raw',
                    raw: typeof e.requestBody === 'string' ? e.requestBody : JSON.stringify(e.requestBody),
                    options: { raw: { language: 'json' } }
                };
            }

            if (e.responseBody) {
                item.response = [{
                    name: `${e.status} Response`,
                    status: e.statusText || '',
                    code: e.status,
                    body: typeof e.responseBody === 'string' ? e.responseBody : JSON.stringify(e.responseBody)
                }];
            }

            return item;
        })
        .filter(Boolean);

    // Deduplicate by name
    const seen = new Set();
    const unique = items.filter(i => {
        if (seen.has(i.name)) return false;
        seen.add(i.name);
        return true;
    });

    return {
        info: {
            name: `API Forensics — ${new Date().toLocaleDateString()}`,
            schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
        },
        item: unique
    };
}

chrome.action.onClicked.addListener((tab) => {
    if (chrome.sidePanel && chrome.sidePanel.open) {
        chrome.sidePanel.open({ tabId: tab.id }).catch(() => {});
    }
});
