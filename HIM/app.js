// ─── API-Client für SIRI-SX ────────────────────────────────────────────────

const API_CONFIG = {
    API_URL: './api.php',
    SIRI_DATA_DIR: './siri_data/',
    REFRESH_MS: 30_000
};

let autoRefreshEnabled = true;
let autoRefreshTimer = null;

// ─── Situationen laden von SQLite-API ──────────────────────────────────────

async function fetchSituations(scope = 'all') {
    try {
        const url = `${API_CONFIG.API_URL}?action=list&scope=${scope}&limit=200`;
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const json = await response.json();
        
        if (json.error) {
            throw new Error(json.error);
        }
        
        // Konvertiere DB-Rows zu Situations-Format
        return (json.data || []).map(row => ({
            id: row.item_identifier || 'unknown',
            summary: row.title || 'Unbekanntes Ereignis',
            description: row.description || '',
            reason: '',
            consequence: '',
            recommendation: '',
            duration: '',
            publishing: 'create',
            isUnplanned: !row.valid_from || new Date(row.valid_from) <= new Date(),
            category: detectCategory(row.title + ' ' + row.description),
            affectedLines: [],
            affectedStops: [],
            creationTime: new Date().toISOString(),
            validFrom: row.valid_from || '',
            validTo: row.valid_until || ''
        }));
    } catch (error) {
        console.error('API Fehler:', error);
        showStatus(`Fehler: ${error.message}`, 'error');
        return [];
    }
}

// ─── Kategorisierung ──────────────────────────────────────────────────────

function detectCategory(text) {
    const lower = (text || '').toLowerCase();
    if (lower.includes('störung') || lower.includes('ausfall') || lower.includes('beeinträchtigung')) {
        return 'disruption';
    } else if (lower.includes('empfehlung') || lower.includes('hinweis')) {
        return 'recommendation';
    }
    return 'information';
}



// ─── DOM Refs ──────────────────────────────────────────────────────────────

const DOM = {
    board:          () => document.getElementById('situations-board'),
    status:         () => document.getElementById('status-message'),
    filterBar:      () => document.getElementById('filter-bar'),
    searchInput:    () => document.getElementById('search-input'),
    searchClearBtn: () => document.getElementById('btn-search-clear'),
    refreshAutoBtn: () => document.getElementById('btn-refresh-auto'),
    modeToggleBtn:  () => document.getElementById('btn-mode-toggle'),
    fileUploadBtn:  () => document.getElementById('btn-upload-file'),
    fileInput:      () => document.getElementById('file-input'),
    footerInfo:     () => document.getElementById('footer-info'),
};

// ─── State ─────────────────────────────────────────────────────────────────

let ALL_SITUATIONS = [];
let ACTIVE_SCOPE = new Set(['all']);
let ACTIVE_TYPE = new Set(['all']);
let SEARCH_QUERY = '';

// ─── Zeit-Hilfsfunktionen ──────────────────────────────────────────────────

function formatTime(isoString) {
    if (!isoString) return '--:--';
    try {
        const date = new Date(isoString);
        return date.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' });
    } catch {
        return '--:--';
    }
}

function formatDate(isoString) {
    if (!isoString) return '';
    try {
        const date = new Date(isoString);
        return date.toLocaleDateString('de-CH');
    } catch {
        return '';
    }
}

function timeAgo(isoString) {
    if (!isoString) return '';
    try {
        const date = new Date(isoString);
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);
        
        if (diffMins < 1) return 'gerade eben';
        if (diffMins < 60) return `vor ${diffMins}m`;
        
        const diffHours = Math.floor(diffMins / 60);
        if (diffHours < 24) return `vor ${diffHours}h`;
        
        const diffDays = Math.floor(diffHours / 24);
        return `vor ${diffDays}d`;
    } catch {
        return '';
    }
}

// ─── Uhr aktualisieren ─────────────────────────────────────────────────────

function updateClock() {
    const el = document.getElementById('live-clock');
    if (!el) return;
    const now = new Date();
    el.textContent =
        String(now.getHours()).padStart(2,'0') + ':' +
        String(now.getMinutes()).padStart(2,'0') + ':' +
        String(now.getSeconds()).padStart(2,'0');
}

// ─── Tafel rendern ────────────────────────────────────────────────────────

function renderBoard() {
    const visible = ALL_SITUATIONS.filter(sit => {
        if (!ACTIVE_SCOPE.has('all')) {
            const scope = sit.isUnplanned ? 'unplanned' : 'planned';
            if (!ACTIVE_SCOPE.has(scope)) return false;
        }
        
        if (!ACTIVE_TYPE.has('all')) {
            if (!ACTIVE_TYPE.has(sit.category)) return false;
        }
        
        if (SEARCH_QUERY) {
            const q = SEARCH_QUERY.toLowerCase();
            const text = `
                ${sit.summary} ${sit.description} ${sit.reason} ${sit.consequence}
                ${sit.affectedLines.map(l => l.name).join(' ')}
                ${sit.affectedStops.map(s => s.name).join(' ')}
            `.toLowerCase();
            if (!text.includes(q)) return false;
        }
        
        return true;
    });
    
    const board = DOM.board();
    if (!board) return;
    
    if (visible.length === 0) {
        board.innerHTML = '<div class="empty">Keine Ereignisse gefunden.</div>';
        return;
    }
    
    let html = '<div class="situations-list">';
    
    visible.forEach((sit, index) => {
        const categoryIcon = {
            disruption: '⚠️',
            information: 'ℹ️',
            recommendation: '💡'
        }[sit.category] || '•';
        
        const plannedBadge = sit.isUnplanned 
            ? '<span class="badge badge-unplanned">Ungeplant</span>'
            : '<span class="badge badge-planned">Geplant</span>';
        
        const categoryBadge = `<span class="badge badge-${sit.category}">${sit.category}</span>`;
        
        const linesBadges = sit.affectedLines.length > 0
            ? `<div class="affected-lines">
                ${sit.affectedLines.map(line => 
                    `<span class="affected-badge">${line.name}</span>`
                ).join('')}
                </div>`
            : '';
        
        const stopsBadges = sit.affectedStops.length > 0
            ? `<div class="affected-stops">
                ${sit.affectedStops.slice(0, 3).map(stop => 
                    `<span class="affected-badge affected-stop">${stop.name}</span>`
                ).join('')}
                ${sit.affectedStops.length > 3 ? `<span class="affected-badge">+${sit.affectedStops.length - 3}</span>` : ''}
                </div>`
            : '';
        
        const createdTime = formatTime(sit.creationTime);
        const createdAgo = timeAgo(sit.creationTime);
        
        const validityHtml = sit.validFrom || sit.validTo
            ? `<div class="validity">
                ${sit.validFrom ? `<strong>Von:</strong> ${formatDate(sit.validFrom)} ${formatTime(sit.validFrom)}` : ''}
                ${sit.validTo ? `<br><strong>Bis:</strong> ${formatDate(sit.validTo)} ${formatTime(sit.validTo)}` : ''}
                </div>`
            : '';
        
        html += `
            <div class="situation-card situation-${sit.category}${sit.isUnplanned ? ' unplanned' : ''}" data-index="${index}">
                <div class="situation-header">
                    <div class="situation-title">
                        <span class="category-icon">${categoryIcon}</span>
                        <h3>${sit.summary}</h3>
                    </div>
                    <div class="situation-badges">
                        ${plannedBadge}
                        ${categoryBadge}
                    </div>
                </div>
                
                ${linesBadges}
                ${stopsBadges}
                
                <div class="situation-body">
                    ${sit.description ? `<p class="description">${sit.description}</p>` : ''}
                    ${sit.reason ? `<p class="reason"><strong>Grund:</strong> ${sit.reason}</p>` : ''}
                    ${sit.consequence ? `<p class="consequence"><strong>Auswirkung:</strong> ${sit.consequence}</p>` : ''}
                    ${sit.recommendation ? `<p class="recommendation"><strong>Empfehlung:</strong> ${sit.recommendation}</p>` : ''}
                    ${sit.duration ? `<p class="duration"><strong>Dauer:</strong> ${sit.duration}</p>` : ''}
                </div>
                
                ${validityHtml}
                
                <div class="situation-footer">
                    <span class="footer-time">Erstellt: ${createdTime} (${createdAgo})</span>
                    <span class="footer-id">${sit.id}</span>
                </div>
            </div>
        `;
    });
    
    html += '</div>';
    board.innerHTML = html;
    
    const footerInfo = DOM.footerInfo();
    if (footerInfo) {
        const timestamp = new Date().toLocaleTimeString('de-CH');
        const mode = USE_LOCAL_FILES ? '(lokal)' : '(API)';
        footerInfo.textContent = `${visible.length}/${ALL_SITUATIONS.length} Ereignisse ${mode} • ${timestamp}`;
    }
}

// ─── Filter initialisieren ─────────────────────────────────────────────────

function initFilterBar() {
    const bar = DOM.filterBar();
    if (!bar) return;
    
    bar.querySelectorAll('.scope-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const scope = btn.dataset.scope;
            
            if (scope === 'all') {
                ACTIVE_SCOPE.clear();
                ACTIVE_SCOPE.add('all');
            } else {
                ACTIVE_SCOPE.delete('all');
                if (ACTIVE_SCOPE.has(scope)) {
                    ACTIVE_SCOPE.delete(scope);
                } else {
                    ACTIVE_SCOPE.add(scope);
                }
                if (ACTIVE_SCOPE.size === 0) {
                    ACTIVE_SCOPE.add('all');
                }
            }
            
            bar.querySelectorAll('.scope-btn').forEach(b => {
                b.classList.toggle('active', ACTIVE_SCOPE.has(b.dataset.scope));
            });
            
            renderBoard();
        });
    });
    
    bar.querySelectorAll('.type-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const type = btn.dataset.type;
            
            if (type === 'all') {
                ACTIVE_TYPE.clear();
                ACTIVE_TYPE.add('all');
            } else {
                ACTIVE_TYPE.delete('all');
                if (ACTIVE_TYPE.has(type)) {
                    ACTIVE_TYPE.delete(type);
                } else {
                    ACTIVE_TYPE.add(type);
                }
                if (ACTIVE_TYPE.size === 0) {
                    ACTIVE_TYPE.add('all');
                }
            }
            
            bar.querySelectorAll('.type-btn').forEach(b => {
                b.classList.toggle('active', ACTIVE_TYPE.has(b.dataset.type));
            });
            
            renderBoard();
        });
    });
}

// ─── Suche initialisieren ──────────────────────────────────────────────────

function initSearchBar() {
    const input = DOM.searchInput();
    const clearBtn = DOM.searchClearBtn();
    
    if (input) {
        input.addEventListener('input', (e) => {
            SEARCH_QUERY = e.target.value.trim();
            renderBoard();
        });
    }
    
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            SEARCH_QUERY = '';
            if (input) input.value = '';
            renderBoard();
        });
    }
}

// ─── Auto-Refresh ────────────────────────────────────────────────────────

function startAutoRefresh() {
    stopAutoRefresh();
    
    if (!autoRefreshEnabled) return;
    
    const loadData = async () => {
        const situations = await fetchSituations('all');
        ALL_SITUATIONS = situations;
        renderBoard();
    };
    
    loadData();
    autoRefreshTimer = setInterval(loadData, API_CONFIG.REFRESH_MS);
}

function stopAutoRefresh() {
    if (autoRefreshTimer) {
        clearInterval(autoRefreshTimer);
        autoRefreshTimer = null;
    }
}

function toggleAutoRefresh() {
    autoRefreshEnabled = !autoRefreshEnabled;
    const btn = DOM.refreshAutoBtn();
    if (btn) {
        btn.classList.toggle('active', autoRefreshEnabled);
    }
    
    if (autoRefreshEnabled) {
        showStatus('Auto-Refresh an', 'info');
        startAutoRefresh();
    } else {
        showStatus('Auto-Refresh aus', 'info');
        stopAutoRefresh();
    }
}

// ─── Sync erzwingen ───────────────────────────────────────────────────

function forceSync() {
    showStatus('Synchronisiere Daten…', 'info');
    
    fetch(`${API_CONFIG.API_URL}?action=force-sync`)
        .then(res => res.json())
        .then(data => {
            showStatus('Synchronisierung gestartet', 'success');
            setTimeout(() => startAutoRefresh(), 2000);
        })
        .catch(err => {
            showStatus('Sync-Fehler: ' + err.message, 'error');
        });
}

// ─── Status-Meldung ────────────────────────────────────────────────────

function showStatus(msg, type = 'info') {
    const el = DOM.status();
    if (el) {
        el.textContent = msg;
        el.className = `status-${type}`;
    }
}

// ─── Initialisierung ──────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    updateClock();
    setInterval(updateClock, 1000);
    
    initFilterBar();
    initSearchBar();
    
    const refreshBtn = DOM.refreshAutoBtn();
    if (refreshBtn) {
        refreshBtn.addEventListener('click', toggleAutoRefresh);
    }
    
    const homeBtn = document.getElementById('btn-home');
    if (homeBtn) {
        homeBtn.addEventListener('click', () => {
            window.location.href = '../index.html';
        });
    }
    
    const syncBtn = document.getElementById('btn-sync');
    if (syncBtn) {
        syncBtn.addEventListener('click', forceSync);
    }
    
    showStatus('Lade Ereignisse…', 'info');
    startAutoRefresh();
});

window.addEventListener('beforeunload', () => {
    stopAutoRefresh();
});