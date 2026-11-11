import localDidokMapping from './didokMappingNOWE.js';

const DIDOK_SOURCE_URLS = [
    'https://tragic.stellwerksim.ch/didok/custom.json',
    'https://tragic.stellwerksim.ch/didok/ch.json',
    'https://tragic.stellwerksim.ch/didok/libero.json',
    'https://tragic.stellwerksim.ch/didok/zvv.json',
    'https://tragic.stellwerksim.ch/didok/awelle.json',
];
const DIDOK_PROXY_URL = './didok-proxy.php?url=';
const CACHE_PREFIX = 'nowe-didok-source:';
const FETCH_TIMEOUT_MS = 5000;

const didokMap = new Map(
    Object.entries(localDidokMapping).map(([code, name]) => [
        code.trim().toUpperCase(),
        String(name).trim()
    ])
);

let initPromise;

function cacheKey(url) {
    return `${CACHE_PREFIX}${url}`;
}

function mergeSource(source) {
    Object.entries(source).forEach(([code, name]) => {
        const normalizedCode = String(code).trim().toUpperCase();
        const normalizedName = String(name).trim();
        if (normalizedCode && normalizedName) didokMap.set(normalizedCode, normalizedName);
    });
}

function readCache(url) {
    try {
        const cached = JSON.parse(localStorage.getItem(cacheKey(url)) || 'null');
        return cached?.data && typeof cached.data === 'object' ? cached.data : null;
    } catch {
        return null;
    }
}

function writeCache(url, data) {
    try {
        localStorage.setItem(cacheKey(url), JSON.stringify({ timestamp: Date.now(), data }));
    } catch {
        // Caching is optional.
    }
}

async function fetchSource(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
        const requestUrl = new URL(url).origin === window.location.origin
            ? url
            : `${DIDOK_PROXY_URL}${encodeURIComponent(url)}`;
        const response = await fetch(requestUrl, { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (!data || Array.isArray(data) || typeof data !== 'object') throw new Error('Ungültiges DiDok-Format');
        writeCache(url, data);
        return data;
    } finally {
        clearTimeout(timeout);
    }
}

function loadExternalSources() {
    const cachedSources = DIDOK_SOURCE_URLS.map(readCache);
    cachedSources.forEach(source => {
        if (source) mergeSource(source);
    });

    const refresh = Promise.allSettled(DIDOK_SOURCE_URLS.map(fetchSource)).then(results => {
        results.forEach((result, index) => {
            if (result.status === 'fulfilled') mergeSource(result.value);
        });
    });

    if (cachedSources.some(Boolean)) {
        void refresh;
        return Promise.resolve();
    }
    return refresh;
}

export function initDidokSources() {
    if (!initPromise) initPromise = loadExternalSources();
    return initPromise;
}

export function resolveAbbreviation(code) {
    const normalizedCode = String(code || '').trim().toUpperCase();
    return didokMap.get(normalizedCode) || null;
}

export function findAbbreviationByName(name) {
    return findAbbreviationsByName(name)[0] || null;
}

export function findAbbreviationsByName(name) {
    const normalizedName = String(name || '').trim();
    const matches = [];
    for (const [code, mappedName] of didokMap) {
        if (!/^\d+$/.test(code) && mappedName === normalizedName) matches.push(code);
    }
    return matches;
}
