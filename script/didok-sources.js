import localDidokMapping from './didokMappingNOWE.js';

const DIDOK_SOURCE_URLS = [
    'https://tragic.stellwerksim.ch/didok/custom.json'
];
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
        const response = await fetch(url, { signal: controller.signal });
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
    return Promise.allSettled(DIDOK_SOURCE_URLS.map(async url => {
        const cached = readCache(url);
        if (cached) mergeSource(cached);

        try {
            const fresh = await fetchSource(url);
            mergeSource(fresh);
        } catch {
            if (!cached) return;
        }
    }));
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
    const normalizedName = String(name || '').trim();
    for (const [code, mappedName] of didokMap) {
        if (!/^\d+$/.test(code) && mappedName === normalizedName) return code;
    }
    return null;
}
