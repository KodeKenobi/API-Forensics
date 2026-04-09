// ═══════════════════════════════════════════════════════
// API Forensics — page interceptor (MAIN world)
// Injected via manifest world:"MAIN" at document_start
// ═══════════════════════════════════════════════════════

(function() {
    if (window.__API_ATLAS_ACTIVE__) return;
    window.__API_ATLAS_ACTIVE__ = true;

    const originalFetch = window.fetch;
    const originalXHROpen = XMLHttpRequest.prototype.open;
    const originalXHRSend = XMLHttpRequest.prototype.send;
    const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;

    function report(data) {
        window.postMessage({ __API_ATLAS__: true, ...data }, '*');
    }

    function genId() {
        return Math.random().toString(36).substring(2, 10);
    }

    function safeStringify(val) {
        if (val === undefined || val === null) return null;
        if (typeof val === 'string') return val;
        try { return JSON.stringify(val); } catch { return String(val); }
    }

    function getBodySize(body) {
        if (!body) return 0;
        if (typeof body === 'string') return new Blob([body]).size;
        if (body instanceof Blob) return body.size;
        if (body instanceof ArrayBuffer) return body.byteLength;
        try { return new Blob([JSON.stringify(body)]).size; } catch { return 0; }
    }

    // ─── Stack Detection Engine ─────────────────────
    let lastStackSignature = '';
    function detectStack() {
        const stack = { frameworks: [], state: [], graphql: false };

        // Frameworks
        if (window.__REACT_DEVTOOLS_GLOBAL_HOOK__) stack.frameworks.push('React');
        if (window.__VUE__ || window.__VUE_DEVTOOLS_GLOBAL_HOOK__) stack.frameworks.push('Vue');
        if (window.angular || window.ng) stack.frameworks.push('Angular');
        if (window.next) stack.frameworks.push('Next.js');
        if (window.Nuxt) stack.frameworks.push('Nuxt');
        if (window.__sveltekit || window.__SVELTEKIT_DEV__) stack.frameworks.push('SvelteKit');
        if (document.querySelector('[data-svelte-h], [class*="svelte-"]')) stack.frameworks.push('Svelte');

        // State Management
        if (window.__REDUX_DEVTOOLS_EXTENSION__) stack.state.push('Redux');
        if (window.__MOBX__) stack.state.push('MobX');
        // Zustand doesn't have a reliable global unless Redux Devtools is used, 
        // but we can check if it's explicitly exposed or rely on Redux Devtools hook
        
        // GraphQL
        if (window.__APOLLO_CLIENT__) { stack.graphql = true; stack.state.push('Apollo'); }
        if (window.__URQL__) stack.graphql = true;
        if (window.__RELAY__) stack.graphql = true;

        const sig = JSON.stringify(stack);
        if (sig !== lastStackSignature) {
            lastStackSignature = sig;
            report({ action: 'STACK_REPORT', stack });
        }
    }

    // Run stack detection periodically to catch deferred loading
    setInterval(detectStack, 2500);
    setTimeout(detectStack, 500);

    // ─── Mocking Engine ─────────────────────────────
    function getMock(url, method) {
        const mocks = window.__API_ATLAS_MOCKS__ || [];
        return mocks.find(m => {
            const urlMatch = m.isRegex ? new RegExp(m.url).test(url) : url.includes(m.url);
            return urlMatch && m.method.toUpperCase() === method.toUpperCase() && m.active;
        });
    }

    // Listen for mock updates from content script
    window.addEventListener('message', function(e) {
        if (e.data && e.data.type === 'UPDATE_MOCKS') {
            window.__API_ATLAS_MOCKS__ = e.data.mocks || [];
        }
    });

    function mergeHeadersFromFetchArgs(args) {
        const out = {};
        try {
            const input = args[0];
            const init = args[1] || {};
            if (input instanceof Request) {
                input.headers.forEach((v, k) => { out[k] = v; });
            }
            const h = init.headers;
            if (h) {
                if (h instanceof Headers) h.forEach((v, k) => { out[k] = v; });
                else if (Array.isArray(h)) h.forEach((pair) => { if (pair && pair[0]) out[pair[0]] = pair[1]; });
                else Object.assign(out, h);
            }
        } catch (_) {}
        return out;
    }

    XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
        this.__ep_req_headers = this.__ep_req_headers || {};
        this.__ep_req_headers[name] = value;
        return originalSetRequestHeader.call(this, name, value);
    };

    // ─── Fetch Interceptor ──────────────────────────
    window.fetch = function(...args) {
        const request = args[0];
        const url = request instanceof Request ? request.url : String(request);
        const options = args[1] || (request instanceof Request ? {} : {});
        const method = (options.method || (request instanceof Request ? request.method : 'GET')).toUpperCase();
        const requestHeaders = mergeHeadersFromFetchArgs(args);
        const requestId = genId();
        const startTime = performance.now();

        // Check for mock
        const mock = getMock(url, method);
        if (mock) {
            const mockBody = JSON.stringify(mock.response);
            report({
                requestId, url, method,
                status: mock.status,
                mocked: true,
                requestBody: safeStringify(options.body),
                responseBody: mockBody,
                requestSize: getBodySize(options.body),
                responseSize: getBodySize(mockBody),
                duration: 0,
                phase: 'complete'
            });
            return Promise.resolve(new Response(mockBody, {
                status: mock.status,
                headers: { 'Content-Type': 'application/json', 'X-Mocked-By': 'API Forensics' }
            }));
        }

        // Parse GraphQL operation name
        let operationName = '';
        let bodyStr = safeStringify(options.body);
        if (method === 'POST' && bodyStr) {
            try {
                const parsed = JSON.parse(bodyStr);
                if (parsed.operationName) operationName = parsed.operationName;
                if (parsed.query && !operationName) {
                    const match = parsed.query.match(/(?:query|mutation|subscription)\s+(\w+)/);
                    if (match) operationName = match[1];
                }
            } catch {}
        }

        report({
            requestId, url, method, operationName,
            requestBody: bodyStr,
            requestHeaders,
            requestSize: getBodySize(options.body),
            startTime,
            phase: 'start'
        });

        // Do not use 'await' to ensure the original promise is returned unmodified
        const fetchPromise = originalFetch.apply(this, args);

        fetchPromise.then(response => {
            const clone = response.clone();
            clone.text().then(responseBody => {
                report({
                    requestId,
                    status: response.status,
                    statusText: response.statusText,
                    headers: Object.fromEntries(response.headers.entries()),
                    responseBody,
                    responseSize: getBodySize(responseBody),
                    duration: Math.round(performance.now() - startTime),
                    phase: 'complete'
                });
            }).catch(err => {
                report({
                    requestId,
                    status: response.status,
                    statusText: response.statusText,
                    responseBody: `[Unreadable: ${response.type}]`,
                    duration: Math.round(performance.now() - startTime),
                    phase: 'complete'
                });
            });
        }).catch(error => {
            report({
                requestId,
                status: 0,
                error: error.message,
                duration: Math.round(performance.now() - startTime),
                phase: 'error'
            });
        });

        return fetchPromise;
    };

    // ─── XHR Interceptor ────────────────────────────
    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
        this.__ep_method = method.toUpperCase();
        this.__ep_url = typeof url === 'string' ? url : String(url);
        this.__ep_id = genId();
        this.__ep_req_headers = {};
        return originalXHROpen.call(this, method, url, ...rest);
    };

    XMLHttpRequest.prototype.send = function(body) {
        const url = this.__ep_url;
        const method = this.__ep_method;
        const requestId = this.__ep_id;
        const startTime = performance.now();

        if (!url || !method) {
            return originalXHRSend.call(this, body);
        }

        // Check for mock
        const mock = getMock(url, method);
        if (mock) {
            const mockBody = JSON.stringify(mock.response);
            Object.defineProperty(this, 'status', { writable: true, value: mock.status });
            Object.defineProperty(this, 'responseText', { writable: true, value: mockBody });
            Object.defineProperty(this, 'readyState', { writable: true, value: 4 });
            
            report({
                requestId, url, method,
                status: mock.status,
                mocked: true,
                requestBody: safeStringify(body),
                responseBody: mockBody,
                requestSize: getBodySize(body),
                responseSize: getBodySize(mockBody),
                duration: 0,
                phase: 'complete'
            });
            
            setTimeout(() => {
                this.dispatchEvent(new Event('readystatechange'));
                this.dispatchEvent(new Event('load'));
                this.dispatchEvent(new Event('loadend'));
            }, 0);
            return;
        }

        report({
            requestId, url, method,
            requestBody: safeStringify(body),
            requestHeaders: this.__ep_req_headers ? { ...this.__ep_req_headers } : {},
            requestSize: getBodySize(body),
            startTime,
            phase: 'start'
        });

        this.addEventListener('load', () => {
            const duration = performance.now() - startTime;
            let headers = {};
            try {
                const raw = this.getAllResponseHeaders();
                raw.split('\r\n').filter(Boolean).forEach(line => {
                    const idx = line.indexOf(':');
                    if (idx > -1) headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
                });
            } catch {}

            let responseBody = '';
            try {
                if (!this.responseType || this.responseType === 'text' || this.responseType === '') {
                    responseBody = this.responseText;
                } else if (this.responseType === 'json') {
                    responseBody = JSON.stringify(this.response);
                } else {
                    responseBody = `[Binary Data: ${this.responseType}]`;
                }
            } catch (e) {
                responseBody = '[Read Error]';
            }

            report({
                requestId,
                status: this.status,
                statusText: this.statusText,
                headers,
                responseBody,
                responseSize: getBodySize(responseBody),
                duration: Math.round(duration),
                phase: 'complete'
            });
        });

        this.addEventListener('error', () => {
            report({
                requestId,
                status: 0,
                error: 'Network Error',
                duration: Math.round(performance.now() - startTime),
                phase: 'error'
            });
        });

        return originalXHRSend.call(this, body);
    };

    console.log('%c[API Forensics]%c Interceptor active', 'color:#60a5fa;font-weight:bold', 'color:#94a3b8');
})();
