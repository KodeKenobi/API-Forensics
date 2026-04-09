// ═══════════════════════════════════════════════════════
// API Forensics — content script (ISOLATED world)
// Bridge between page (postMessage) ↔ extension (chrome.runtime)
// ═══════════════════════════════════════════════════════

(function() {
    // 1. Relay interceptor reports → background service worker
    window.addEventListener('message', function(e) {
        if (e.source !== window) return;
        if (!e.data || !e.data.__API_ATLAS__) return;

        const payload = { ...e.data };
        delete payload.__API_ATLAS__;

        try {
            if (payload.action === 'STACK_REPORT') {
                chrome.runtime.sendMessage({ action: 'stack_report', data: payload.stack });
            } else {
                chrome.runtime.sendMessage({ action: 'api_report', data: payload });
            }
        } catch (err) {
            // Extension context invalidated (e.g. after update)
        }
    });

    // 2. Receive commands from sidepanel
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (msg.action === 'update_mocks') {
            window.postMessage({ type: 'UPDATE_MOCKS', mocks: msg.mocks }, '*');
        }
        
        if (msg.action === 'get_storage') {
            const data = { local: {}, session: {}, cookies: '' };
            
            try {
                for (let i = 0; i < window.localStorage.length; i++) {
                    const k = window.localStorage.key(i);
                    data.local[k] = window.localStorage.getItem(k);
                }
            } catch {}
            
            try {
                for (let i = 0; i < window.sessionStorage.length; i++) {
                    const k = window.sessionStorage.key(i);
                    data.session[k] = window.sessionStorage.getItem(k);
                }
            } catch {}
            
            try {
                data.cookies = document.cookie;
            } catch {}

            sendResponse(data);
        }
    });

    // 3. Load saved mocks on page load and inject into page
    try {
        chrome.storage.local.get('mocks', (data) => {
            if (data.mocks && data.mocks.length) {
                window.postMessage({ type: 'UPDATE_MOCKS', mocks: data.mocks }, '*');
            }
        });
    } catch {}
})();