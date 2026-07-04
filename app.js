import { fetchDepartures, searchStops } from './api-client.js';

// ─── Produktkategorie-Mapping ────────────────────────────────────────────────
const CAT = {
    fernverkehr: ['IC','EC','TGV','RJ','RJX','IR','ICE','NJ','EN'],
    regional:    ['RE','IRE', 'TER','RB'],
    sbahn:       ['S','R','SN'],
    tram:        ['T','TRAM'],
    bus:         ['B','RUB','EBX','NFB','NFT','BN'],
    spezial:     ['EXT','PE','EV','BUS','UUU','BP'],
    schiff:      ['BAT','FAE'],
    bergbahn:    ['FUN','ASC','PB','CC'],
};
function getCategory(departure) {
    // Nutze zuerst das 'cat'-Feld (der ShortName von der API)
    const code = (departure.cat || '').toUpperCase();
    for (const [cat, codes] of Object.entries(CAT)) {
        if (codes.includes(code)) return cat;
    }
    // Fallback auf 'line', falls cat nicht hilfreich ist
    const lineCode = (departure.line || '').replace(/\s*\d+.*$/, '').trim().toUpperCase();
    for (const [cat, codes] of Object.entries(CAT)) {
        if (codes.includes(lineCode)) return cat;
    }
    return 'sonstige';
}

// ─── Formation-fähige Betreiber (siehe /formation/betreiber.txt) ────────────
// Der Formation-Link ("Wagen"-Nummer klickbar) wird nur angezeigt, wenn der
// Betreiber der Abfahrt (operatorRef) in dieser Liste vorkommt. Sowohl der
// EVU-Kürzel (z.B. "SBBP") als auch die numerische Business-Org-ID (z.B. "11")
// werden akzeptiert, da OJP je nach Betreiber unterschiedliche Werte liefert.
const FORMATION_OPERATORS = new Set([
    'blsp', '33',
    'sbbp', '11',
    'sob', '82',
    'zb', '86',
    'tpf', '53',
    'rhb', '72',
    'thurbo', '65',
    'trn', '73',
]);

function hasFormationSupport(dep) {
    const ref = (dep.operatorRef ?? '').toString().trim();
    if (!ref) return false;
    return FORMATION_OPERATORS.has(ref.toLowerCase());
}

// ─── Favoriten ───────────────────────────────────────────────────────────────
// Initiales Laden aus dem Speicher oder Standardwerte
function loadFavorites() {
    const saved = localStorage.getItem('ojp_favs');
    return saved ? JSON.parse(saved) : [
        { name: 'Zürich HB', id: 'ch:1:sloid:3000' },
        { name: 'Bern', id: 'ch:1:sloid:7000' },
        { name: 'Olten', id: 'ch:1:sloid:218' },
        { name: 'Biel/Bienne', id: 'ch:1:sloid:4300' },
        { name: 'Basel SBB', id: 'ch:1:sloid:10' },
        { name: 'Luzern', id: 'ch:1:sloid:5000' },
        { name: 'Spiez', id: 'ch:1:sloid:7483' },
        { name: 'Langenthal', id: 'ch:1:sloid:8100' },
        { name: 'Bellinzona', id: 'ch:1:sloid:5213' },

    ];
}

let FAVORITES = loadFavorites();

function saveToStorage() {
    localStorage.setItem('ojp_favs', JSON.stringify(FAVORITES));
}

function addCurrentToFavs() {
    const name = DOM.stopInput().value;
    if (!STOP_ID || !name) return;

    if (!FAVORITES.find(f => f.id === STOP_ID)) {
        FAVORITES.push({ name: name, id: STOP_ID });
        saveToStorage();
        renderFavBar();
        showStatus('Favorit hinzugefügt', 'success');
    }
}

// ─── Favoriten-Highlight aktualisieren ────────────────────────────────────
function updateFavHighlight() {
    const bar = DOM.favBar();
    if (!bar) return;
    
    bar.querySelectorAll('.fav-btn').forEach(btn => {
        const isActive = STOP_ID === btn.dataset.id;
        btn.classList.toggle('active', isActive);
        btn.dataset.confirm = "false"; // Reset Lösch-Modus
        btn.innerText = FAVORITES.find(f => f.id === btn.dataset.id)?.name || '';
    });
}

// ─── Es beginnt mit COMBINED_STATIONS... -────────────────────────────────────

const COMBINED_STATIONS = {
    // Beispiel: Bahnhof X mit IDs für verschiedene Bereiche (SLOID-Format)
    'ch:1:sloid:8508100': ['ch:1:sloid:8508100', 'ch:1:sloid:8576937'],
	// Du kannst hier beliebig viele Gruppen hinzufügen
};

// Hilfsfunktion, um die Gruppe zu finden
function getStationGroup(idOrName) {
    // Suche zuerst als exakter Key im COMBINED_STATIONS
    if (COMBINED_STATIONS[idOrName]) {
        return COMBINED_STATIONS[idOrName];
    }
    // Fallback: Nur die ID/Name selbst zurückgeben
    return [idOrName];
}



// Hilfsfunktion, um die Gruppe basierend auf dem Namen zu finden
function getStationGroupByName(stationName) {
    // Zuerst im COMBINED_STATIONS nach dem Namen als Key suchen
    if (COMBINED_STATIONS[stationName]) {
        return COMBINED_STATIONS[stationName];
    }
    
    // Dann in window.combinedStations suchen (externe Daten)
    if (!window.combinedStations) return null;
    
    if (window.combinedStations[stationName]) {
        return window.combinedStations[stationName];
    }
    
    return null;
}




// ─── DOM-Refs ────────────────────────────────────────────────────────────────
const DOM = {
    board:          () => document.getElementById('departure-board'),
    status:         () => document.getElementById('status-message'),
    stopInput:      () => document.getElementById('stop-input'),
    dateInput:      () => document.getElementById('date-input'),
    timeInput:      () => document.getElementById('time-input'),
    refreshBtn:     () => document.getElementById('btn-refresh'),
    dtClearBtn:     () => document.getElementById('btn-datetime-clear'),
    homeBtn:        () => document.getElementById('btn-home'),
    favBar:         () => document.getElementById('fav-bar'),
    filterBar:      () => document.getElementById('filter-bar'),
    stopDropdown:   () => document.getElementById('stop-dropdown'),
};

// ─── Zustand ─────────────────────────────────────────────────────────────────
const urlParams  = new URLSearchParams(window.location.search);
let STOP_ID      = urlParams.get('stop')   ?? '';
let QUERY_DATE   = urlParams.get('date')   ?? '';
let QUERY_TIME   = urlParams.get('time')   ?? '';
let ACTIVE_CAT = new Set(['all']); 
let ALL_DEPS     = [];
let searchDebounce = null;
let VIA_VISIBLE  = localStorage.getItem('via_visible') !== 'false'; // Standardmäßig sichtbar

const REFRESH_MS = 120_000;
let   refreshTimer = null;

// ─── Hilfsfunktionen Zeit/Datum ───────────────────────────────────────────────

function todayISO() {
    const d = new Date();
    const offset = d.getTimezoneOffset() * 60000;
    const localISOTime = (new Date(d - offset)).toISOString().slice(0, 10);
    return localISOTime;
}

function buildISO(dateStr, timeStr) {
    if (!dateStr && !timeStr) {
        return new Date().toISOString();
    }
    const date = dateStr || todayISO();
    const time = timeStr || '00:00';
    return `${date}T${time}:00`;
}

function isoToDate(iso) {
    return iso ? iso.slice(0, 10) : '';
}

function isoToTime(iso) {
    if (!iso) return '';
    const match = iso.match(/T(\d{2}):(\d{2})/);
    return match ? `${match[1]}:${match[2]}` : '';
}

function compareISO(a, b) {
    if (!a && !b) return 0;
    if (!a) return -1;
    if (!b) return 1;
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
}

// ─── URL & State setzen ───────────────────────────────────────────────────────

function updateUrlParams() {
    const url = new URL(window.location);
    if (STOP_ID)     url.searchParams.set('stop', STOP_ID);
    else             url.searchParams.delete('stop');
    if (QUERY_DATE)  url.searchParams.set('date', QUERY_DATE);
    else             url.searchParams.delete('date');
    if (QUERY_TIME)  url.searchParams.set('time', QUERY_TIME);
    else             url.searchParams.delete('time');
    window.history.pushState({}, '', url);
}

function syncInputsFromState() {
    const si = DOM.stopInput();
    if (si) si.value = STOP_ID;
    const di = DOM.dateInput();
    if (di) di.value = QUERY_DATE;
    const ti = DOM.timeInput();
    if (ti) ti.value = QUERY_TIME;
}

// ─── Station Name → ID Mapping (lazy loading) ────────────────────────────
const STATION_NAME_TO_ID = {};
const MAPPING_CACHE = {}; // Verhindert doppeltes Abfragen

// Nur mappen, wenn wir eine spezifische Station brauchen
async function mapStationNameToId(stationName) {
    // Wenn schon gecacht, gib es zurück
    if (STATION_NAME_TO_ID[stationName]) {
        return STATION_NAME_TO_ID[stationName];
    }
    
    // Wenn wir gerade versucht haben diese zu suchen, skippe
    if (MAPPING_CACHE[stationName] === 'pending') return null;
    if (MAPPING_CACHE[stationName] === 'failed') return null;
    
    try {
        MAPPING_CACHE[stationName] = 'pending';
        const results = await searchStops(stationName);
        
        if (results && results.length > 0) {
            STATION_NAME_TO_ID[stationName] = results[0].ref;
            MAPPING_CACHE[stationName] = 'success';
            console.log(`✓ ${stationName} → ${results[0].ref}`);
            return results[0].ref;
        } else {
            MAPPING_CACHE[stationName] = 'failed';
            console.warn(`✗ Keine ID gefunden für: ${stationName}`);
            return null;
        }
    } catch (err) {
        MAPPING_CACHE[stationName] = 'failed';
        console.error(`Fehler beim Suchen von ${stationName}:`, err);
        return null;
    }
}

// ─── Hilfsfunktion: Stationsnamen zu IDs konvertieren (mit lazy loading) ────
async function getStationIdsByName(stationName) {
    if (!window.combinedStations) return null;
    
    // Suche in window.combinedStations
    for (const groupKey in window.combinedStations) {
        const group = window.combinedStations[groupKey];
        if (group.includes(stationName) || groupKey === stationName) {
            // Konvertiere Namen zu IDs (lazy: nur wenn nötig)
            const ids = [];
            for (const name of group) {
                let id = STATION_NAME_TO_ID[name];
                if (!id) {
                    id = await mapStationNameToId(name);
                }
                if (id) ids.push(id);
            }
            return ids.length > 0 ? ids : null;
        }
    }
    return null;
}

// ─── Board laden ──────────────────────────────────────────────────────────────

async function loadBoard(stopId = STOP_ID, date = QUERY_DATE, time = QUERY_TIME) {
    if (!stopId) return;
    let idsToFetch = [stopId];
    
    // 1. Versuche, nach ID zu suchen (EINSEITIG: nur wenn stopId ein Key ist)
    if (COMBINED_STATIONS[stopId]) {
        console.log(`✓ Gefunden in COMBINED_STATIONS: ${stopId}`);
        idsToFetch = COMBINED_STATIONS[stopId];
    } 
    // 2. Wenn stopId eine ID ist und nicht als Key existiert, versuche in window.combinedStations zu suchen
    else if (window.combinedStations && window.combinedStations[stopId]) {
        console.log(`✓ Gefunden in window.combinedStations: ${stopId}`);
        idsToFetch = window.combinedStations[stopId];
    }
    
        // 2.1. Wenn stopId eine ID ist und nicht als Key existiert, versuche in window.includedStations zu suchen
    else if (window.includedStations && window.includedStations[stopId]) {
        console.log(`✓ Gefunden in window.includedStations: ${stopId}`);
        idsToFetch = window.includedStations[stopId];
    }
    

    // 3. Falls stopId ein Name ist (nicht numerisch und nicht SLOID und nicht externe ID), versuche zu mappen
    // Regex erklärt: ch:1:sloid:XXXXX, 7-8-stellige IDs, und externe IDs mit _ oder : sind keine Namen
    else if (!/^(ch:1:sloid:\d+|\d{7,8}|[A-Z0-9]+[_:].+)$/.test(stopId) && window.combinedStations) {
        const group = getStationGroupByName(stopId);
        if (group) {
            console.log(`✓ Gefunden als Gruppenschlüssel: ${stopId}`, group);
            // Konvertiere Namen zu IDs (lazy: nur wenn nötig)
            const ids = [];
            for (const name of group) {
                let id = STATION_NAME_TO_ID[name];
                if (!id) {
                    id = await mapStationNameToId(name);
                }
                if (id) ids.push(id);
            }
            if (ids.length > 0) {
                idsToFetch = ids;
            }
        }
    }
    
    try {
        showStatus('Lade kombinierte Fahrplandaten…', 'info');
        const isoTime = buildISO(date, time);
        const requests = idsToFetch.map(id => fetchDepartures(id, isoTime));
        const results = await Promise.all(requests);
        ALL_DEPS = results.flat();
        
        ALL_DEPS.sort((a, b) => {
            const timeA = a.timetabledIso || a.estimatedIso;
            const timeB = b.timetabledIso || b.estimatedIso;
            return new Date(timeA) - new Date(timeB);
        });
        renderBoard(ALL_DEPS);
 
        const boardTitle = document.getElementById('status-message');
        if (boardTitle) {
            boardTitle.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        
        const timestamp = new Date().toLocaleTimeString('de-CH');
        showStatus(`Aktualisiert: ${timestamp} (${idsToFetch.length} Stationen)`, 'success');
    } catch (error) {
        showStatus(`Fehler: ${error.message}`, 'error');
    }
}

// Hilfsfunktion
function getDelayClass(delayMinutes) {
    if (delayMinutes < 0) return 'chain-delay-early';      // Verfrühung (blau)
    if (delayMinutes < 1) return 'chain-delay-minor';      // <1 Min (grün)
    return '';                                              // ≥1 Min (rot, default)
}

function renderBoard(departures) {
	//console.log("Sichtbare Stationen:", departures.map(d => d.stopName));
    // 1. Filtern der Abfahrten (Unterstützt Multi-Select Sets)
    
    const visible = ACTIVE_CAT.has('all')
    	? departures
    	: departures.filter(d => ACTIVE_CAT.has(getCategory(d))); // ← Ganzes Objekt übergeben!
    
    const board = DOM.board();
    if (!board) return;

    if (visible.length === 0) {
        board.innerHTML = '<p class="empty">Keine Abfahrten für diesen Filter gefunden.</p>';
        return;
    }

    // Prüfen, ob wir Daten von verschiedenen Stationen haben (für den StationHint)
    const distinctStations = new Set(visible.map(d => d.stopName));
    const showStationHint = distinctStations.size > 1;

    let html = `
        <table class="departure-table">
            <thead>
                <tr>
                    <th class="th-time">Zeit</th>
                    <th class="th-line">Linie</th>
                    <th class="th-dest">Ziel</th>
                    <th class="th-platform">Gl.<br>Kante</th>
                </tr>
            </thead>
            <tbody>
    `;

	let depRowCount = 0; // ← Neuer Counter
	
    visible.forEach((dep, index) => {
        depRowCount++; // ← Inkrementieren für jede echte Abfahrtszeile
    	const bgClass = depRowCount % 2 === 1 ? 'row-odd' : 'row-even'; // ← Neue CSS-Klassen
        let fullLine = dep.line;
        if (dep.cat && !dep.line.startsWith(dep.cat)) {
            fullLine = `${dep.cat}${dep.line}`;
        }

        // ✅ VBZ-spezifische data-type Logik mit gezielter Bus-Whitelist
        let lineType;

        if (dep.operatorName === '3849' || dep.operatorName === '849' || dep.operatorName === '46' || dep.operatorName === '41' ) {
            const cleanCat = dep.cat.replace(/[0-9\s]/g, '').trim().toUpperCase();
            
            // Liste der Buslinien, für die du spezifische Farben definiert hast
            const coloredBuses = ['31', '32', '33', '46', '61', '62', '72', '80', '89', '301', '302', '303', '304', '305', '306', '307', '308', '309', '314', '317', '325']; // Hier einfach deine Linien als Strings eintragen
            if (cleanCat === 'T') {
                if (dep.line === '18') {
                    fullLine = `S18`;
                }
                // Trams bekommen immer die spezifische Kennung
                lineType = `VBZ-${dep.line}`;
            } else if (cleanCat === 'B' && coloredBuses.includes(String(dep.line))) {
                // Busse nur, wenn sie in der Whitelist stehen
                lineType = `VBZ-${dep.line}`;
            } else if (cleanCat === 'T' && dep.line === '20' ) {
                lineType = `VBZ-${dep.line}`;
            }
            
            else {
                // Fallback für alle anderen Busse und VBZ-Verkehrsmittel
                lineType = 'VBZ';
            }
        }
            else if (dep.operatorName === '801') { lineType = 'PAG'; }
        
            else {
            lineType = dep.cat.replace(/[0-9\s]/g, '').trim().toUpperCase();
        }

        const isCancelledAtCurrent = dep.calls.current?.cancelled;

        // Zeit & Verspätung
        const delayBadge = (dep.delayed && dep.delayMinutes > 0.9)
            ? `<span class="delay-badge">${dep.delayDisplay}</span>`
            : '';

        let timeCell = `<span class="time">${dep.time}</span><br>${delayBadge}`;
        if (isCancelledAtCurrent) {
            timeCell = `<span style="color:red; font-weight:bold; text-decoration:line-through;">${dep.time}</span><br><span style="color:red; font-size: 0.85em;">Ausfall</span>`;
        }

        const viaClass = VIA_VISIBLE ? '' : 'hidden';
        const viaHtml = dep.vias.length > 0
            ? `<span class="via ${viaClass}">via ${dep.vias.join(' · ')}</span>`
            : '';

        // StationHint: Zeigt den Bahnhofsnamen nur bei kombinierten Ansichten an
        const stationHint = showStationHint && dep.stopName
            ? `<div class="station-hint">ab ${dep.stopName}</div>` 
            : '';
			

        // Ersatzzug Style
        const unplannedStyle = dep.unplanned
            ? 'background-color: #00cc44; color: #000; border-radius: 3px; padding: 1px 5px; display: inline-block; border: 1px solid #009933; font-weight: bold;'
            : '';

        // Formation-Link nur anzeigen, wenn der Betreiber in betreiber.txt gelistet ist
        const journeyNumHtml = dep.journeyNumber
            ? (hasFormationSupport(dep)
                ? `<div class="journey-num" style="${unplannedStyle}"><a href="/formation/?train=${dep.journeyNumber}" class="journey-num">${dep.journeyNumber}</a></div>`
                : `<div class="journey-num" style="${unplannedStyle}">${dep.journeyNumber}</div>`)
            : '';

        // Ereigniszeile
        let situationRowHtml = '';
        let infoBtn = '';

        if (dep.situations && dep.situations.length > 0) {
            infoBtn = `<button class="btn-sit-info" style="background: #e60000; color: white; border: none; border-radius: 50%; width: 22px; height: 22px; font-weight: bold; cursor: pointer; margin-left: 8px; line-height: 1;">i</button>`;

            const sitContent = dep.situations.map(s => {
                const parts = [];
                if (s.summary) parts.push(`<strong>${s.summary}</strong>`);
                if (s.reason) parts.push(`<strong style="color:#c00;">Grund:</strong> ${s.reason}`);
                if (s.desc) parts.push(`<strong>Info:</strong> ${s.desc}`);
                if (s.consequence) parts.push(`<strong style="color:#e60000;">Folge:</strong> ${s.consequence}`);
                if (s.rec) parts.push(`<strong style="color:#006600;">Empfehlung:</strong> ${s.rec}`);
                if (s.duration) parts.push(`<strong style="color:#0066cc;">Dauer:</strong> ${s.duration}`);
                return parts.join('<br>');
            }).join('<hr style="margin:8px 0; border:none; border-top:1px solid #ccc;">');

            situationRowHtml = `
                <tr class="ereignisgrund-row" id="situation-${index}" style="display: none;">
                    <td colspan="4">
                        <div class="ereignis-content">
                            <span class="ereignis-icon">⚠️</span>
                            <div style="margin-top:8px; line-height:1.5;">${sitContent}</div>
                        </div>
                    </td>
                </tr>
            `;
        }

        const chainHtml = buildChain(dep);
        const platClass = dep.platformChanged ? 'plat-change' : '';

        html += `
            <tr class="dep-row ${bgClass} ${dep.delayed ? 'row-delayed' : ''} ${isCancelledAtCurrent ? 'row-cancelled' : ''}" data-index="${index}">
                <td class="col-time">${timeCell}</td>
                <td class="col-line">
                    <div class="line-container">
                        <a href="/trip/?sjyid=${dep.journeyRef}"><span class="line-badge" data-type="${lineType}">${fullLine}</span></a>
                        ${journeyNumHtml}
                    </div>
                </td>
                <td class="col-dest">
                    <span class="destination" style="${isCancelledAtCurrent ? 'color:#999;' : ''}">${dep.destination}</span> 
                    ${infoBtn}
                    ${viaHtml ? '<br>' + viaHtml : ''}<br>
                    ${stationHint}
                </td>
                <td class="col-platform">
                    <span class="platform-value ${platClass}">${dep.platform}</span>
                    ${dep.calls.current?.requestStop ? '<span style="border:1.5px solid var(--sbb-red); color:var(--sbb-red); font-size:0.72em; margin-left:6px; font-weight:bold; padding:1px 6px; border-radius:3px; letter-spacing:0.03em;">HaV</span>' : ''}
                </td>
            </tr>
            ${situationRowHtml}
            <tr class="chain-row" id="chain-${index}" style="display:none;">
                <td colspan="4">${chainHtml}</td>
            </tr>
        `;
    });

    html += '</tbody></table>';
    board.innerHTML = html;

    // Event-Listener
    document.querySelectorAll('.dep-row').forEach(row => {
        row.addEventListener('click', () => {
            const idx = row.dataset.index;
            const chainRow = document.getElementById(`chain-${idx}`);
            const isOpen = chainRow.style.display !== 'none';
            document.querySelectorAll('.chain-row').forEach(r => r.style.display = 'none');
            document.querySelectorAll('.dep-row').forEach(r => r.classList.remove('active'));
            if (!isOpen) {
                chainRow.style.display = 'table-row';
                row.classList.add('active');
            }
        });
    });

    document.querySelectorAll('.btn-sit-info').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const idx = btn.closest('.dep-row').dataset.index;
            const sitRow = document.getElementById(`situation-${idx}`);
            if (sitRow) {
                const isVisible = sitRow.style.display === 'table-row';
                sitRow.style.display = isVisible ? 'none' : 'table-row';
            }
        });
    });

    document.querySelectorAll('.chain-clickable').forEach(el => {
        el.addEventListener('click', e => {
            e.stopPropagation();
            const stopRef = el.dataset.stopRef;
            const stopName = el.dataset.stopName;
            const arrivalIso = el.dataset.arrivalIso;
            if (!stopRef) return;
            STOP_ID = stopRef;
            DOM.stopInput().value = stopName || stopRef;
            QUERY_DATE = arrivalIso ? isoToDate(arrivalIso) : (QUERY_DATE || todayISO());
            QUERY_TIME = arrivalIso ? isoToTime(arrivalIso) : QUERY_TIME;
            // Date/Time Inputs aktualisieren
            const di = DOM.dateInput();
            if (di) di.value = QUERY_DATE;
            const ti = DOM.timeInput();
            if (ti) ti.value = QUERY_TIME;
            // Nicht syncInputsFromState() aufrufen, weil das den Namen überschreiben würde!
            updateUrlParams();
            loadBoard(STOP_ID, QUERY_DATE, QUERY_TIME);
            startAutoRefresh();
        });
    });
}

// ─── Live-Position berechnen ─────────────────────────────────────────────────
function computeTrainPosition(dep, allStops) {
    // ✅ IMMER echte Zeit nutzen (nicht QUERY_DATE/QUERY_TIME)
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const seconds = String(d.getSeconds()).padStart(2, '0');
    const nowISO = `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;

    if (!nowISO) return { state: 'unknown' };
    
    for (let i = 0; i < allStops.length; i++) {
        const stop = allStops[i];
        const arrIso = stop.arrivalEstimated ?? stop.arrivalTime;
        const depIso = stop.departureEstimated ?? stop.departureTime;
        const afterArr = !arrIso || compareISO(nowISO, arrIso) >= 0;
        const beforeDep = !depIso || compareISO(nowISO, depIso) <= 0;
        if (afterArr && beforeDep) {
            return { state: 'at-stop', stopIndex: i };
        }
        if (depIso && compareISO(nowISO, depIso) > 0 && i < allStops.length - 1) {
            const nextStop = allStops[i + 1];
            const nextArrIso = nextStop.arrivalEstimated ?? nextStop.arrivalTime;
            if (nextArrIso && compareISO(nowISO, nextArrIso) < 0) {
                return { state: 'between', fromIndex: i, toIndex: i + 1 };
            }
        }
    }
    return { state: 'unknown' };
}

// ─── Perlschnur aufbauen ─────────────────────────────────────────────────────

// ─── Perlschnur aufbauen ─────────────────────────────────────────────────────

function buildChain(dep) {
    const calls = dep.calls;
    if (!calls) return '<p class="chain-empty">Keine Haltedaten verfügbar.</p>';

    const all = [
        ...calls.previous.map(c => ({ ...c, type: 'previous' })),
        calls.current ? { ...calls.current, type: 'current' } : null,
        ...calls.onward.map(c => ({ ...c, type: 'onward' }))
    ].filter(Boolean);

    if (all.length <= 1) return '<p class="chain-empty">Keine weiteren Halte.</p>';

    const pos = computeTrainPosition(dep, all);

    const fmt = iso => iso
        ? (() => {
            const match = iso.match(/T(\d{2}):(\d{2})/);
            return match ? `${match[1]}:${match[2]}` : '';
          })()
        : '';

    let html = '<div class="chain">';

    all.forEach((stop, i) => {
        const isLast    = i === all.length - 1;
        const stopRef   = stop.stopRef ?? '';
        const clickable = (stop.type === 'onward' || stop.type === 'previous') && stopRef;
        const arrIso    = stop.arrivalTime ?? '';
        const arrTime   = fmt(stop.arrivalTime);
        const depTime   = fmt(stop.departureTime);

        // Verspätungs-Badges für An/Abfahrt
        const arrDelayHtml = stop.arrivalDelayMinutes !== 0
            ? `<span class="chain-delay ${getDelayClass(stop.arrivalDelayMinutes)}">${stop.arrivalDelayDisplay}</span>`
            : '';
        const depDelayHtml = stop.departureDelayMinutes !== 0
            ? `<span class="chain-delay ${getDelayClass(stop.departureDelayMinutes)}">${stop.departureDelayDisplay}</span>`
            : '';

        const arrDisplay = arrTime || '';
        const depDisplay = depTime || '';

        const isTrainHere  = pos.state === 'at-stop'  && pos.stopIndex  === i;
        const isTrainAfter = pos.state === 'between'   && pos.fromIndex  === i;

        // ✅ FIX #1: Gleisänderung in Perlschnur - KORREKTE Property-Namen
        const platHtml = stop.platformChanged
            ? `<del style="margin-right:4px;">${stop.plannedPlatform}</del><strong>${stop.estimatedPlatform}</strong>`
            : (stop.platform || '');

        // ✅ FIX #2: Ausfall-Status Rendering
        const stopNameStyle = stop.cancelled 
            ? 'text-decoration: line-through; color: #666;' 
            : '';
        const cancelledBadge = stop.cancelled
            ? '<span style="background:#e60000; color:#fff; font-size:0.72em; margin-left:6px; font-weight:bold; padding:1px 6px; border-radius:3px; letter-spacing:0.03em;">Ausfall</span>'
            : '';

        // ✅ FIX #3: Diensthalt-Status (NoBoardingAtStop && NoAlightingAtStop)
        const isServiceStop = stop.noBoardingAtStop && stop.noAlightingAtStop;
        const serviceStopBadge = isServiceStop
            ? '<span style="background:#000; color:#aaa; font-size:0.72em; margin-left:6px; font-weight:bold; padding:1px 6px; border-radius:3px; letter-spacing:0.03em;">Diensthalt</span>'
            : '';


        // ✅ FIX #4: Request-Stop (Halt auf Verlangen)
        const requestStopBadge = stop.requestStop
            ? '<span style="border:1.5px solid var(--sbb-red); color:var(--sbb-red); font-size:0.72em; margin-left:6px; font-weight:bold; padding:1px 6px; border-radius:3px; letter-spacing:0.03em;">HaV</span>'
            : '';

        // Dot-Farbe: ausgefallene Halte grau, Diensthalte schwarz
        const dotStyle = stop.cancelled 
            ? ' style="background:#555;"' 
            : isServiceStop 
                ? ' style="background:#000; box-shadow: 0 0 0 2px #444;"'
                : '';

        html += `
            <div class="chain-stop chain-${stop.type}${clickable ? ' chain-clickable' : ''}${stop.cancelled ? ' chain-cancelled' : ''}"
                 ${clickable ? `data-stop-ref="${stopRef}" data-stop-name="${stop.name}" data-arrival-iso="${arrIso}"` : ''}>

                <div class="chain-dot-col">
                    <div class="chain-dot-wrapper">
                        <div class="chain-dot${stop.type === 'current' ? ' dot-current' : ''}"${dotStyle}></div>
                        ${isTrainHere ? '<div class="dot-train-live"></div>' : ''}
                    </div>
                    ${!isLast ? `
                        <div class="chain-line-wrapper">
                            <div class="chain-line"${stop.cancelled ? ' style="background:rgba(255,255,255,0.05);"' : ''}></div>
                            ${isTrainAfter ? '<div class="dot-train-between"></div>' : ''}
                        </div>
                    ` : ''}
                </div>

                <div class="chain-times" style="${stop.cancelled ? 'color:#555;' : ''}">
                    <div class="time-row">
                        ${arrDisplay
                            ? `<span class="label">An</span> ${arrDisplay}${!stop.cancelled ? arrDelayHtml : ''}`
                            : '&nbsp;'}
                    </div>
                    <div class="time-row">
                        ${depDisplay
                            ? `<span class="label">Ab</span> ${depDisplay}${!stop.cancelled ? depDelayHtml : ''}`
                            : '&nbsp;'}
                    </div>
                </div>

                <div class="chain-info">
                    <div class="chain-name" style="${stopNameStyle}">${stop.name}${cancelledBadge}${serviceStopBadge}${requestStopBadge}</div>
                    ${platHtml ? `<div class="chain-platform">Gl. ${platHtml}</div>` : ''}
                </div>
            </div>
        `;
    });

    html += '</div>';

    const metaParts = [];
    if (dep.journeyRef) {
        metaParts.push(`
            <span class="meta-journeyref"
                  style="cursor:pointer; font-family:monospace;"
                  onclick="navigator.clipboard.writeText('${dep.journeyRef}'); const t=this; const o=t.innerText; t.innerText='✅ Kopiert!'; setTimeout(() => t.innerText=o, 1000);">
                ${dep.journeyRef}
            </span>`);
    }
    if (dep.operatorName) metaParts.push(`<span class="meta-operator">Betreiber: ${dep.operatorName}</span>`);
    if (metaParts.length > 0) {
        html += `<div class="chain-meta-footer">${metaParts.join('<span class="meta-sep"> | </span>')}</div>`;
    }

    return html;
}

// ─── Status ───────────────────────────────────────────────────────────────────

function showStatus(msg, type) {
    const el = DOM.status();
    if (el) {
        el.textContent = msg;
        el.className   = `status-${type}`;
    }
}

// ─── Auto-Refresh ─────────────────────────────────────────────────────────────

function startAutoRefresh() {
    stopAutoRefresh();
    if (!QUERY_DATE && !QUERY_TIME) {
        refreshTimer = setInterval(() => loadBoard(), REFRESH_MS);
    }
}

function stopAutoRefresh() {
    if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
}

// ─── Favoritenleiste rendern ──────────────────────────────────────────────────

function renderFavBar() {
    const bar = DOM.favBar();
    if (!bar) return;

    bar.innerHTML = FAVORITES.map(fav => {
        const isActive = STOP_ID === fav.id;
        // Wir fügen eine CSS-Klasse hinzu, wenn er "bereit zum Löschen" ist
        return `<button class="fav-btn${isActive ? ' active' : ''}" 
                        data-id="${fav.id}" 
                        data-confirm="false">
            ${fav.name}
        </button>`;
    }).join('');

    bar.querySelectorAll('.fav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.id;
            const isCurrentlyActive = (STOP_ID === id);
            const isConfirming = btn.dataset.confirm === "true";

            // FALL 1: Normaler Klick auf einen inaktiven Favoriten
            if (!isCurrentlyActive) {
                STOP_ID = id;
                DOM.stopInput().value = btn.innerText;
                updateUrlParams();
                loadBoard();
                updateFavHighlight();
                return;
            }

            // FALL 2: Klick auf den bereits aktiven Favoriten (Lösch-Modus aktivieren)
            if (isCurrentlyActive && !isConfirming) {
                // Alle anderen Buttons zurücksetzen, falls da noch einer im Lösch-Modus war
                bar.querySelectorAll('.fav-btn').forEach(b => {
                    b.dataset.confirm = "false";
                    b.innerText = FAVORITES.find(f => f.id === b.dataset.id).name;
                });

                btn.dataset.confirm = "true";
                btn.innerText = "Löschen?"; // Text ändert sich zur Bestätigung
                btn.style.backgroundColor = "#e60000"; // Signalfarbe Rot
                return;
            }

            // FALL 3: Zweiter Klick zur Bestätigung (Endgültig löschen)
            if (isCurrentlyActive && isConfirming) {
                FAVORITES = FAVORITES.filter(f => f.id !== id);
                saveToStorage();
                renderFavBar();
                showStatus('Favorit entfernt', 'info');
            }
        });

        // Falls du den Rechtsklick für Desktop trotzdem behalten willst:
        btn.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            FAVORITES = FAVORITES.filter(f => f.id !== btn.dataset.id);
            saveToStorage();
            renderFavBar();
        });
    });
}

// ─── Filterleiste ─────────────────────────────────────────────────────────────

function initFilterBar() {
    const bar = DOM.filterBar();
    if (!bar) return;

    bar.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const cat = btn.dataset.cat;

            if (cat === 'all') {
                // Wenn "Alle" geklickt wird: Alles andere abwählen
                ACTIVE_CAT.clear();
                ACTIVE_CAT.add('all');
            } else {
                // "Alle" entfernen, wenn eine spezifische Kategorie gewählt wird
                ACTIVE_CAT.delete('all');

                // Toggle-Logik: Wenn schon drin, dann raus. Wenn nicht drin, dann rein.
                if (ACTIVE_CAT.has(cat)) {
                    ACTIVE_CAT.delete(cat);
                } else {
                    ACTIVE_CAT.add(cat);
                }

                // Falls am Ende gar nichts mehr angewählt ist, automatisch wieder auf "Alle"
                if (ACTIVE_CAT.size === 0) {
                    ACTIVE_CAT.add('all');
                }
            }

            // Visuelles Update: Alle Buttons, deren Kategorie im Set ist, werden "active"
            bar.querySelectorAll('.filter-btn').forEach(b => {
                b.classList.toggle('active', ACTIVE_CAT.has(b.dataset.cat));
            });

            renderBoard(ALL_DEPS);
        });
    });

    // ─── Via-Toggle-Button ───────────────────────────────────────────────────
    const toggleViaBtn = document.getElementById('btn-toggle-via');
    if (toggleViaBtn) {
        // Setze initial den Status basierend auf VIA_VISIBLE
        updateViaButtonState(toggleViaBtn);

        toggleViaBtn.addEventListener('click', () => {
            VIA_VISIBLE = !VIA_VISIBLE;
            localStorage.setItem('via_visible', VIA_VISIBLE);
            updateViaButtonState(toggleViaBtn);
            renderBoard(ALL_DEPS);
        });
    }
}

function updateViaButtonState(btn) {
    if (VIA_VISIBLE) {
        btn.classList.add('active');
        btn.textContent = '✓ Ein';
    } else {
        btn.classList.remove('active');
        btn.textContent = 'x';
    }
}

// ─── Stop-Autocomplete ────────────────────────────────────────────────────────

/**
 * Prüft, ob ein Query in didokmapping vorhanden ist.
 * Gibt ein Objekt { id (SLOID), name } zurück oder null.
 * ✅ Löst DiDok-ID immer zu SLOID auf
 */
function checkDidokMapping(query) {
    if (!window.didokMapping) return null;
    
    const q = query.trim().toUpperCase();
    
    // 1. Direkte Suche (Key ist exakt oder in Großbuchstaben)
    if (window.didokMapping[q]) {
        const name = window.didokMapping[q];
        return { id: q, name, isDidokMatch: true };
    }
    
    // 2. Fallback: Alle Keys durchsuchen (Case-insensitive)
    for (const [key, value] of Object.entries(window.didokMapping)) {
        if (key.toUpperCase() === q) {
            return { id: key, name: value, isDidokMatch: true };
        }
    }
    
    // 3. Numerische ID: Suche ob diese ID im didokmapping vorhanden ist
    if (/^\d{7,8}$/.test(q)) {
        if (window.didokMapping[q]) {
            const name = window.didokMapping[q];
            // ✅ DiDok-ID zu SLOID konvertieren: 85XXXXX → ch:1:sloid:XXXXX
            const sloidId = /^85\d{5}$/.test(q) 
                ? `ch:1:sloid:${q.substring(2)}`
                : q;
            return { id: sloidId, name, isDidokMatch: true };
        }
    }
    
    return null;
}

function initStopSearch() {
    const input    = DOM.stopInput();
    const dropdown = DOM.stopDropdown();
    if (!input || !dropdown) return;

    input.addEventListener('input', () => {
        clearTimeout(searchDebounce);
        const q = input.value.trim();

        if (/^\d+$/.test(q)) {
            closeDropdown();
            return;
        }

        if (q.length < 2) {
            closeDropdown();
            return;
        }

        searchDebounce = setTimeout(async () => {
            try {
                // 1. Zuerst in didokmapping prüfen
                const didokResult = checkDidokMapping(q);
                
                if (didokResult) {
                    console.log(`✓ didokmapping Match: "${q}" → "${didokResult.name}" (ID: ${didokResult.id})`);
                    // Zeige nur das didokmapping-Ergebnis
                    dropdown.innerHTML = `
                        <li data-id="${didokResult.id}" data-name="${didokResult.name}" class="didok-match">
                            <span class="dd-name">${didokResult.name}</span>
                            <span class="dd-id">${didokResult.id}</span>
                            <span style="font-size: 0.75em; color: #666; margin-left: 4px;">(Didok)</span>
                        </li>
                    `;
                    dropdown.classList.remove('hidden');
                    return;
                }
                
                // 2. Falls kein didokmapping-Match: API-Suche
                console.log(`✗ didokmapping kein Match, frage API…`);
                const results = await searchStops(q);

                if (!results || results.length === 0) {
                    dropdown.innerHTML = '<li class="no-res">Keine Treffer</li>';
                    dropdown.classList.remove('hidden');
                    return;
                }

                dropdown.innerHTML = results.map(r => `
                    <li data-id="${r.ref}" data-name="${r.name}">
                        <span class="dd-name">${r.name}</span>
                        <span class="dd-id">${r.ref}</span>
                    </li>
                `).join('');

                dropdown.classList.remove('hidden');
            } catch (err) {
                console.error("Suche fehlgeschlagen:", err);
                closeDropdown();
            }
        }, 300);
    });

    dropdown.addEventListener('click', e => {
        const li = e.target.closest('li');
        if (!li || li.classList.contains('no-res')) return;

        STOP_ID = li.dataset.id;
        input.value = li.dataset.name;

        closeDropdown();
        updateUrlParams();
        loadBoard();
        updateFavHighlight();
        startAutoRefresh();
    });

    input.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
            const first = dropdown.querySelector('li:not(.no-res)');
            if (first) {
                STOP_ID     = first.dataset.id;
                input.value = first.dataset.name;
                closeDropdown();
            } else {
                const v = input.value.trim();
                // Erst didokmapping prüfen
                const didokResult = checkDidokMapping(v);
                if (didokResult) {
                    STOP_ID = didokResult.id; // Bereits SLOID
                    input.value = didokResult.name;
                } else if (/^\d{7,8}$/.test(v)) {
                    // ✅ Falls es eine DiDok-ID ist (85XXXXX), konvertiere zu SLOID
                    if (/^85\d{5}$/.test(v)) {
                        STOP_ID = `ch:1:sloid:${v.substring(2)}`;
                    } else {
                        STOP_ID = v;
                    }
                }
            }

            if (STOP_ID) {
                updateUrlParams();
                loadBoard();
                updateFavHighlight();
                startAutoRefresh();
            }
        }

        if (e.key === 'Escape') {
            closeDropdown();
        }
    });

    document.addEventListener('click', e => {
        if (!input.contains(e.target) && !dropdown.contains(e.target)) {
            closeDropdown();
        }
    });
}

function closeDropdown() {
    const dd = DOM.stopDropdown();
    if (dd) { dd.innerHTML = ''; dd.classList.add('hidden'); }
}

// ─── Uhr ──────────────────────────────────────────────────────────────────────

function updateClock() {
    const el = document.getElementById('live-clock');
    if (!el) return;
    const now = new Date();
    el.textContent =
        String(now.getHours()).padStart(2,'0') + ':' +
        String(now.getMinutes()).padStart(2,'0') + ':' +
        String(now.getSeconds()).padStart(2,'0');
}
// ─── Zeit-Controlls ───────────────────────────────────────────────────────

// ─── Zeit-Controlls ───────────────────────────────────────────────────────

function offsetTime(minutes) {
    const now = new Date();
    
    // Nutze deine bestehenden State-Variablen QUERY_DATE und QUERY_TIME
    const baseDate = QUERY_DATE || todayISO();
    const baseTime = QUERY_TIME || now.toTimeString().substring(0, 5);
    
    // Erzeuge ein Date-Objekt für die Berechnung (Parsing als lokale Zeit)
    let dateObj = new Date(`${baseDate}T${baseTime}:00`);
    
    // Minuten addieren oder subtrahieren
    dateObj.setMinutes(dateObj.getMinutes() + minutes);
    
    // ✅ Konvertiere zurück zu lokaler ISO-Zeit (ohne UTC-Versatz)
    const offset = dateObj.getTimezoneOffset() * 60000;
    QUERY_TIME = dateObj.toTimeString().substring(0, 5);
    QUERY_DATE = (new Date(dateObj - offset)).toISOString().slice(0, 10);
    
    // Nur Date/Time Inputs aktualisieren, nicht das Stop-Feld
    const di = DOM.dateInput();
    if (di) di.value = QUERY_DATE;
    const ti = DOM.timeInput();
    if (ti) ti.value = QUERY_TIME;
    updateUrlParams();
    loadBoard();
    
    // Auto-Refresh stoppen, wenn wir in der Zukunft/Vergangenheit suchen
    stopAutoRefresh();
}

document.addEventListener('DOMContentLoaded', () => {
    const btnPrev = document.getElementById('btn-time-prev');
    const btnNext = document.getElementById('btn-time-next');
    const btnNow = document.getElementById('btn-time-now');

    if (btnPrev) btnPrev.onclick = () => offsetTime(-20);
    if (btnNext) btnNext.onclick = () => offsetTime(20);
    
    if (btnNow) {
        btnNow.onclick = () => {
            QUERY_DATE = '';
            QUERY_TIME = '';
            // Nur Date/Time Inputs aktualisieren, nicht das Stop-Feld
            const di = DOM.dateInput();
            if (di) di.value = '';
            const ti = DOM.timeInput();
            if (ti) ti.value = '';
            updateUrlParams();
            loadBoard();
            startAutoRefresh(); // Zurück im "Live"-Modus
        };
    }
});

// ─── Browser-Navigation ───────────────────────────────────────────────────────

window.addEventListener('popstate', () => {
    const p   = new URLSearchParams(window.location.search);
    STOP_ID    = p.get('stop')  ?? '';
    QUERY_DATE = p.get('date')  ?? '';
    QUERY_TIME = p.get('time')  ?? '';
    syncInputsFromState();
    if (STOP_ID) loadBoard();
});

// ─── DOMContentLoaded ────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {

    syncInputsFromState();
    renderFavBar();
    initFilterBar();
    initStopSearch();
    updateClock();
    setInterval(updateClock, 1000);
    

    DOM.homeBtn()?.addEventListener('click', () => {
        STOP_ID    = '8582597';
        QUERY_DATE = '';
        QUERY_TIME = '';
        ALL_DEPS   = [];
        syncInputsFromState();
        closeDropdown();
        updateUrlParams();
        updateFavHighlight();
        stopAutoRefresh();
        DOM.board().innerHTML = '';
        showStatus('', '');
    });

    DOM.dateInput()?.addEventListener('change', e => {
        QUERY_DATE = e.target.value;
        updateUrlParams();
        if (STOP_ID) loadBoard();
        startAutoRefresh();
    });

    DOM.timeInput()?.addEventListener('change', e => {
        QUERY_TIME = e.target.value;
        updateUrlParams();
        if (STOP_ID) loadBoard();
        startAutoRefresh();
    });

    DOM.dtClearBtn()?.addEventListener('click', () => {
        const now = new Date();
        // ✅ Nutze die gleiche Logik wie todayISO() für korrekte lokale Zeit
        const offset = now.getTimezoneOffset() * 60000;
        QUERY_DATE = (new Date(now - offset)).toISOString().slice(0, 10);
        QUERY_TIME = now.toTimeString().substring(0, 5);
        // Aktualisiere die Input-Felder
        const di = DOM.dateInput();
        if (di) di.value = QUERY_DATE;
        const ti = DOM.timeInput();
        if (ti) ti.value = QUERY_TIME;
        updateUrlParams();
        if (STOP_ID) loadBoard();
        stopAutoRefresh(); // Auto-Refresh stoppen, da wir jetzt ein fixes Datum haben
    });

    DOM.refreshBtn()?.addEventListener('click', () => {
        if (STOP_ID) loadBoard();
    });

    if (STOP_ID) {
        loadBoard();
        startAutoRefresh();
    }
	// In deinen Event-Listenern (DOMContentLoaded)
	const addFavBtn = document.getElementById('btn-add-fav');
		if (addFavBtn) {
			addFavBtn.addEventListener('click', () => {
				const name = DOM.stopInput().value;
				// Nur speichern, wenn eine ID vorhanden ist und der Name nicht "Suchen..." oder leer ist
				if (STOP_ID && name && name !== 'Suchen...') {
					
					// Prüfen, ob die ID schon existiert
					if (!FAVORITES.find(f => f.id === STOP_ID)) {
						FAVORITES.push({ name: name, id: STOP_ID });
						saveToStorage(); // Speichert in den LocalStorage
						renderFavBar();  // Aktualisiert die Anzeige oben
						showStatus(`${name} gespeichert`, 'success');
					} else {
						showStatus('Bereits in Favoriten', 'info');
					}
				}
			});
		}
});