import { fetchDepartures, searchStops, searchStopsNearLocation } from './api-client.js';
import { initDidokSources, resolveAbbreviation, findAbbreviationByName, findAbbreviationsByName } from '../script/didok-sources.js';
import { formatCountdown, parseCountdownTime, formatZurichDateTime, isCountdownDefault, withCountdownParam, bindTimeToggle, startCountdownTicker } from '../shared/countdown.js';
import { initHeaderHeight, blockZoom } from '../shared/header.js?v=1';

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
    const code = (departure.cat || '').toUpperCase();
    for (const [cat, codes] of Object.entries(CAT)) {
        if (codes.includes(code)) return cat;
    }
    const lineCode = (departure.line || '').replace(/\s*\d+.*$/, '').trim().toUpperCase();
    for (const [cat, codes] of Object.entries(CAT)) {
        if (codes.includes(lineCode)) return cat;
    }
    return 'sonstige';
}

// ─── Formation-fähige Betreiber (siehe /formation/betreiber.txt) ────────────
// Der Formation-Link (Zugnummer klickbar) wird nur angezeigt, wenn der
// Betreiber (operatorRef) in dieser Liste vorkommt. Sowohl das EVU-Kürzel
// (z.B. "SBBP") als auch die numerische Business-Org-ID (z.B. "ojp:11")
// werden akzeptiert, da OJP je nach Betreiber unterschiedliche Werte liefert.
const FORMATION_OPERATORS = new Set([
    'blsp', 'ojp:33',
    'sbbp', 'ojp:11',
    'sob', 'ojp:82',
    'zb', 'ojp:86',
    'tpf', 'ojp:53',
    'rhb', 'ojp:72',
    'thurbo', 'ojp:65',
    'trn', 'ojp:73',
]);

function hasFormationSupport(dep) {
    const ref = (dep.operatorRef ?? '').toString().trim();
    if (!ref) return false;
    return FORMATION_OPERATORS.has(ref.toLowerCase());
}

const toCodeMap = {
    '33': 'BLSP',
    '11': 'SBBP',
    '82': 'SOB',
    '86': 'zb',
    '53': 'TPF',
    '72': 'RhB',
    '65': 'THURBO',
    '73': 'TRN',
};

function getEvuFromOperatorRef(operatorRef) {
    if (!operatorRef) return '';
    const cleanRef = operatorRef.toString().toLowerCase().replace('ojp:', '').trim();
    return toCodeMap[cleanRef] || '';
}

// ─── Favoriten ───────────────────────────────────────────────────────────────
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

function updateFavHighlight() {
    const bar = DOM.favBar();
    if (!bar) return;
    
    bar.querySelectorAll('.fav-btn').forEach(btn => {
        const isActive = STOP_ID === btn.dataset.id;
        btn.classList.toggle('active', isActive);
        btn.dataset.confirm = "false";
        btn.innerText = FAVORITES.find(f => f.id === btn.dataset.id)?.name || '';
    });
}

const COMBINED_STATIONS = {
    'ch:1:sloid:8508100': ['ch:1:sloid:8508100', 'ch:1:sloid:8576937'],
};

function getStationGroupByName(stationName) {
    if (COMBINED_STATIONS[stationName]) {
        return COMBINED_STATIONS[stationName];
    }
    
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
    nearbyBtn:      () => document.getElementById('btn-nearby'),
};

// ─── Zustand ─────────────────────────────────────────────────────────────────
const urlParams  = new URLSearchParams(window.location.search);
let STOP_ID      = urlParams.get('stop')   ?? '';
let QUERY_DATE   = urlParams.get('date')   ?? '';
let QUERY_TIME   = urlParams.get('time')   ?? '';
let ACTIVE_CAT   = new Set(['all']); 
let ALL_DEPS     = [];
let searchDebounce = null;
let VIA_VISIBLE  = localStorage.getItem('via_visible') !== 'false';

const REFRESH_MS = 120_000;
let   refreshTimer = null;

// ─── Zeit-Hilfsfunktionen ────────────────────────────────────────────────────

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

// ─── Station Name → ID Mapping ────────────────────────────────────────────────
const STATION_NAME_TO_ID = {};
const MAPPING_CACHE = {};

async function mapStationNameToId(stationName) {
    if (STATION_NAME_TO_ID[stationName]) {
        return STATION_NAME_TO_ID[stationName];
    }
    
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

function getDepartureSortTime(departure) {
    const iso = isCountdownDefault()
        ? (departure.estimatedIso || departure.timetabledIso)
        : (departure.timetabledIso || departure.estimatedIso);
    return parseCountdownTime(iso)?.getTime() ?? Number.POSITIVE_INFINITY;
}

// ─── Board laden ──────────────────────────────────────────────────────────────

async function loadBoard(stopId = STOP_ID, date = QUERY_DATE, time = QUERY_TIME) {
    if (!stopId) return;
    let idsToFetch = [stopId];
    
    if (COMBINED_STATIONS[stopId]) {
        console.log(`✓ Gefunden in COMBINED_STATIONS: ${stopId}`);
        idsToFetch = COMBINED_STATIONS[stopId];
    } 
    else if (window.combinedStations && window.combinedStations[stopId]) {
        console.log(`✓ Gefunden in window.combinedStations: ${stopId}`);
        idsToFetch = window.combinedStations[stopId];
    }
    else if (window.includedStations && window.includedStations[stopId]) {
        console.log(`✓ Gefunden in window.includedStations: ${stopId}`);
        idsToFetch = window.includedStations[stopId];
    }
    else if (!/^(ch:1:sloid:\d+|\d{7,8}|[A-Z0-9]+[_:].+)$/.test(stopId) && window.combinedStations) {
        const group = getStationGroupByName(stopId);
        if (group) {
            console.log(`✓ Gefunden als Gruppenschlüssel: ${stopId}`, group);
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
        showStatus('Lade Fahrplandaten…', 'info');
        const isoTime = buildISO(date, time);
        const requests = idsToFetch.map(id => fetchDepartures(id, isoTime));
        const results = await Promise.all(requests);
        ALL_DEPS = results.flat();
        
        ALL_DEPS.sort((a, b) => getDepartureSortTime(a) - getDepartureSortTime(b));
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

function getDelayClass(delayMinutes) {
    if (delayMinutes < 0) return 'chain-delay-early';
    if (delayMinutes < 1) return 'chain-delay-minor';
    return '';
}

function updateBoardControls(hasBoard) {
    document.getElementById('departure-time-controls')?.classList.toggle('hidden', !hasBoard);
    document.getElementById('departure-time-controls-next')?.classList.toggle('hidden', !hasBoard);
}

function restripeRows() {
    let visibleIndex = 0;
    document.querySelectorAll('.dep-row').forEach(row => {
        row.classList.remove('row-odd', 'row-even');
        if (row.classList.contains('filtered-dest')) return;
        visibleIndex++;
        row.classList.add(visibleIndex % 2 === 1 ? 'row-odd' : 'row-even');
    });
}

function renderBoard(departures) {
    const visible = ACTIVE_CAT.has('all')
    	? departures
    	: departures.filter(d => ACTIVE_CAT.has(getCategory(d)));
    
    const board = DOM.board();
    if (!board) return;
    updateBoardControls(visible.length > 0);

    if (visible.length === 0) {
        board.innerHTML = '<p class="empty">Keine Ankünfte für diesen Filter gefunden.</p>';
        return;
    }

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

    visible.forEach((dep, index) => {
        const viasStr = dep.vias ? dep.vias.join(' · ') : '';
        const destinationTerms = [
            ...getDestinationTerms(dep.destination),
            ...(dep.vias || []).flatMap(getDestinationTerms),
            ...(dep.onwardvias || []).flatMap(getDestinationTerms)
        ];

        let fullLine = dep.line;
        if (dep.cat && !dep.line.startsWith(dep.cat)) {
            fullLine = `${dep.cat}${dep.line}`;
        }

        let lineType;

        if (dep.operatorName === 'ojp:3849' || dep.operatorName === 'ojp:849' || dep.operatorName === 'ojp:46' || dep.operatorName === 'ojp:41' ) {
            const cleanCat = dep.cat.replace(/[0-9\s]/g, '').trim().toUpperCase();
            
            const coloredBuses = ['31', '32', '33', '46', '61', '62', '72', '80', '89', '301', '302', '303', '304', '305', '306', '307', '308', '309', '314', '317', '325'];
            if (cleanCat === 'T') {
                if (dep.line === '18') {
                    fullLine = `S18`;
                }
                lineType = `VBZ-${dep.line}`;
            } else if (cleanCat === 'B' && coloredBuses.includes(String(dep.line))) {
                lineType = `VBZ-${dep.line}`;
            } else if (cleanCat === 'T' && dep.line === '20' ) {
                lineType = `VBZ-${dep.line}`;
            }
            else {
                lineType = 'VBZ';
            }
        }
        else if (dep.operatorName === 'ojp:801' && dep.cat === 'RUB') { lineType = 'RUB-PAG'; }
        else if (dep.operatorName === 'ojp:801') { lineType = 'PAG'; }
        else if (dep.operatorName === 'ojp:865') { lineType = 'RhB'; }
        else {
            lineType = dep.cat.replace(/[0-9\s]/g, '').trim().toUpperCase();
        }

        const isCancelledAtCurrent = dep.calls.current?.cancelled;

        const delayBadge = (dep.delayed && dep.delayMinutes > 0.9)
            ? `<span class="delay-badge">${dep.delayDisplay}</span>`
            : '';

        const countdownTarget = dep.estimatedIso || dep.timetabledIso || '';
        const countdownDefault = isCountdownDefault() && !isCancelledAtCurrent && countdownTarget;
        const timeText = countdownDefault ? formatCountdown(countdownTarget) : dep.time;
        const timeAttributes = ` data-clock="${dep.time}"${countdownDefault ? ` data-cd-target="${countdownTarget}"` : ''}`;
        const displayedDelayBadge = countdownDefault
            ? delayBadge.replace('class="delay-badge"', 'class="delay-badge" style="display:none"')
            : delayBadge;
        let timeCell = `<span class="time"${timeAttributes}>${timeText}</span><br>${displayedDelayBadge}`;
        if (isCancelledAtCurrent) {
            timeCell = `<span style="color:red; font-weight:bold; text-decoration:line-through;">${dep.time}</span><br><span style="color:red; font-size: 0.85em;">Ausfall</span>`;
        }

        const viaClass = VIA_VISIBLE ? '' : 'hidden';
        const viaHtml = dep.vias.length > 0
            ? `<span class="via ${viaClass}">von ${dep.vias.join(' · ')}</span>`
            : '';

        const onwardviaHtml = dep.onwardvias.length > 0
            ? `<span class="via ${viaClass}">nach ${dep.onwardvias.join(' · ')}</span>`
            : '';

        const stationHint = showStationHint && dep.stopName
            ? `<div class="station-hint">an ${dep.stopName}</div>` 
            : '';

        const unplannedStyle = dep.unplanned
            ? 'background-color: #00cc44; color: #000; border-radius: 3px; padding: 1px 5px; display: inline-block; border: 1px solid #009933; font-weight: bold;'
            : '';

        let formationUrl = `/formation-new/?train=${dep.journeyNumber}`;
        const evuCode = getEvuFromOperatorRef(dep.operatorRef);
        if (evuCode) {
            formationUrl += `&evu=${encodeURIComponent(evuCode)}`;
        }
        formationUrl = withCountdownParam(formationUrl);

        const journeyNumHtml = dep.journeyNumber
            ? (hasFormationSupport(dep)
                ? `<div class="journey-num" style="${unplannedStyle}"><a href="${formationUrl}" class="journey-num">${dep.journeyNumber}</a></div>`
                : `<div class="journey-num" style="${unplannedStyle}">${dep.journeyNumber}</div>`)
            : '';

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
        const operatingDay = dep.timetabledIso ? dep.timetabledIso.slice(0, 10) : QUERY_DATE;

        html += `
            <tr class="dep-row ${dep.delayed ? 'row-delayed' : ''} ${isCancelledAtCurrent ? 'row-cancelled' : ''}" 
                data-index="${index}"
                data-dest="${dep.destination || ''}"
                data-vias="${viasStr}"
                data-dest-terms="${destinationTerms.join('|')}"
                data-line="${dep.line || ''}"
                data-trip="${dep.journeyNumber || ''}"
                data-cat="${dep.cat || ''}"
                data-operator-name="${dep.operatorName || ''}"
                data-operator-ref="${dep.operatorRef || ''}">
                <td class="col-time" data-tt="${dep.timetabledIso || ''}" data-est="${dep.estimatedIso || ''}">${timeCell}</td>
                <td class="col-line">
                    <div class="line-container">
                        <a href="${withCountdownParam(`/trip/?sjyid=${encodeURIComponent(dep.journeyRef)}&date=${encodeURIComponent(operatingDay)}`)}"><span class="line-badge" data-type="${lineType}" operator="${dep.operatorName}" data-line="${dep.line}">${fullLine}</span></a>
                        ${journeyNumHtml}
                    </div>
                </td>
                <td class="col-dest">
                    <span class="destination" style="${isCancelledAtCurrent ? 'color:#999;' : ''}">${dep.destination}</span> 
                    ${infoBtn}
                    ${viaHtml ? '<br>' + viaHtml : ''}${onwardviaHtml ? '<br>' + onwardviaHtml : ''}<br>
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
    updateDestFilterOptions(visible);
    restripeRows();
    applyDestFilter();

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

    document.querySelectorAll('.col-time').forEach(cell => {
        if (cell.closest('.row-cancelled')) return;
        const time = cell.querySelector('.time');
        const badge = cell.querySelector('.delay-badge');
        bindTimeToggle(cell, time, badge);
    });
    startCountdownTicker();

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
            const di = DOM.dateInput();
            if (di) di.value = QUERY_DATE;
            const ti = DOM.timeInput();
            if (ti) ti.value = QUERY_TIME;
            updateUrlParams();
            loadBoard(STOP_ID, QUERY_DATE, QUERY_TIME);
            startAutoRefresh();
        });
    });
}

function computeTrainPosition(dep, allStops) {
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
        const arrIso    = stop.arrivalTime ?? stop.departureTime ?? '';
        const arrTime   = fmt(stop.arrivalTime);
        const depTime   = fmt(stop.departureTime);

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

        const platHtml = stop.platformChanged
            ? `<del style="margin-right:4px;">${stop.plannedPlatform}</del><strong>${stop.estimatedPlatform}</strong>`
            : (stop.platform || '');

        const stopNameStyle = stop.cancelled 
            ? 'text-decoration: line-through; color: #666;' 
            : '';
        const cancelledBadge = stop.cancelled
            ? '<span style="background:#e60000; color:#fff; font-size:0.72em; margin-left:6px; font-weight:bold; padding:1px 6px; border-radius:3px; letter-spacing:0.03em;">Ausfall</span>'
            : '';

        const isServiceStop = stop.noBoardingAtStop && stop.noAlightingAtStop;
        const serviceStopBadge = isServiceStop
            ? '<span style="background:#000; color:#aaa; font-size:0.72em; margin-left:6px; font-weight:bold; padding:1px 6px; border-radius:3px; letter-spacing:0.03em;">Diensthalt</span>'
            : '';

        const requestStopBadge = stop.requestStop
            ? '<span style="border:1.5px solid var(--sbb-red); color:var(--sbb-red); font-size:0.72em; margin-left:6px; font-weight:bold; padding:1px 6px; border-radius:3px; letter-spacing:0.03em;">HaV</span>'
            : '';

        // Ausserordentlicher Halt (UnplannedStop) in roter Schrift
        const unplannedStopStyle = stop.unplannedStop 
            ? 'color: #a20013; font-weight: normal'
            : '';

        // Halt nur zum Aussteigen (SD) oder nur zum Einsteigen (SM)
        let boardingBadge = '';
        if (stop.noBoardingAtStop && !stop.noAlightingAtStop) {
            boardingBadge = '<span style="color: #91a7bd; font-size:0.72em; margin-left:6px; font-weight:bold; padding:1px 6px; border-radius:3px; letter-spacing:0.03em;">SD</span>';
        } else if (stop.noAlightingAtStop && !stop.noBoardingAtStop) {
            boardingBadge = '<span style="color: #91a7bd; font-size:0.72em; margin-left:6px; font-weight:bold; padding:1px 6px; border-radius:3px; letter-spacing:0.03em;">SM</span>';
        }

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
                    <div class="chain-name" style="${stopNameStyle}${unplannedStopStyle}">${stop.name}${cancelledBadge}${serviceStopBadge}${requestStopBadge}${boardingBadge}</div>
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

    // Service-Attribute anzeigen (Fahrplanänderung, Niederflur, etc.)
    if (dep.serviceAttributes && dep.serviceAttributes.length > 0) {
        const attrTexts = dep.serviceAttributes.map(attr => attr.text).join(', ');
        metaParts.push(`<span class="meta-attributes">Attribute: ${attrTexts}</span>`);
    }

    if (metaParts.length > 0) {
        html += `<div class="chain-meta-footer">${metaParts.join('<span class="meta-sep"> | </span>')}</div>`;
    }

    return html;
}

function showStatus(msg, type) {
    const el = DOM.status();
    if (el) {
        el.textContent = msg;
        el.className   = `status-${type}`;
    }
}

function startAutoRefresh() {
    stopAutoRefresh();
    if (!QUERY_DATE && !QUERY_TIME) {
        refreshTimer = setInterval(() => loadBoard(), REFRESH_MS);
    }
}

function stopAutoRefresh() {
    if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
}

function renderFavBar() {
    const bar = DOM.favBar();
    if (!bar) return;

    bar.innerHTML = FAVORITES.map(fav => {
        const isActive = STOP_ID === fav.id;
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

            if (!isCurrentlyActive) {
                STOP_ID = id;
                DOM.stopInput().value = btn.innerText;
                updateUrlParams();
                loadBoard();
                updateFavHighlight();
                return;
            }

            if (isCurrentlyActive && !isConfirming) {
                bar.querySelectorAll('.fav-btn').forEach(b => {
                    b.dataset.confirm = "false";
                    b.innerText = FAVORITES.find(f => f.id === b.dataset.id).name;
                });

                btn.dataset.confirm = "true";
                btn.innerText = "Löschen?";
                btn.style.backgroundColor = "#e60000";
                return;
            }

            if (isCurrentlyActive && isConfirming) {
                FAVORITES = FAVORITES.filter(f => f.id !== id);
                saveToStorage();
                renderFavBar();
                showStatus('Favorit entfernt', 'info');
            }
        });

        btn.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            FAVORITES = FAVORITES.filter(f => f.id !== btn.dataset.id);
            saveToStorage();
            renderFavBar();
        });
    });
}

function initFilterBar() {
    const bar = DOM.filterBar();
    if (!bar) return;

    bar.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const cat = btn.dataset.cat;

            if (cat === 'all') {
                ACTIVE_CAT.clear();
                ACTIVE_CAT.add('all');
            } else {
                ACTIVE_CAT.delete('all');

                if (ACTIVE_CAT.has(cat)) {
                    ACTIVE_CAT.delete(cat);
                } else {
                    ACTIVE_CAT.add(cat);
                }

                if (ACTIVE_CAT.size === 0) {
                    ACTIVE_CAT.add('all');
                }
            }

            bar.querySelectorAll('.filter-btn').forEach(b => {
                b.classList.toggle('active', ACTIVE_CAT.has(b.dataset.cat));
            });

            renderBoard(ALL_DEPS);
        });
    });

    const toggleViaBtn = document.getElementById('btn-toggle-via');
    if (toggleViaBtn) {
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

function checkDidokMapping(query) {
    const q = query.trim().toUpperCase();
    const name = resolveAbbreviation(q);
    if (name) {
        return { id: q, name, isDidokMatch: true };
    }
    if (/^\d{7,8}$/.test(q) && name) {
        const sloidId = /^85\d{5}$/.test(q) ? `ch:1:sloid:${q.substring(2)}` : q;
        return { id: sloidId, name, isDidokMatch: true };
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
                await initDidokSources();
                const didokResult = checkDidokMapping(q);
                
                if (didokResult) {
                    console.log(`✓ didokmapping Match: "${q}" → "${didokResult.name}" (ID: ${didokResult.id})`);
                    const displayCode = q.toUpperCase() !== didokResult.id.toUpperCase() ? q.toUpperCase() : '';
                    
                    dropdown.innerHTML = `
                        <li data-id="${didokResult.id}" data-name="${didokResult.name}" class="didok-match">
                            <span class="dd-name">${didokResult.name}</span>
                            <span class="dd-code-center">${displayCode}</span>
                            <span class="dd-id">${didokResult.id}</span>
                        </li>
                    `;
                    dropdown.classList.remove('hidden');
                    return;
                }
                
                console.log(`✗ didokmapping kein Match, frage API…`);
                const results = await searchStops(q);

                if (!results || results.length === 0) {
                    dropdown.innerHTML = '<li class="no-res">Keine Treffer</li>';
                    dropdown.classList.remove('hidden');
                    return;
                }

                dropdown.innerHTML = results.map(r => {
                    let shortcut = '';
                    
                    shortcut = findAbbreviationByName(r.name) || '';

                    return `
                        <li data-id="${r.ref}" data-name="${r.name}">
                            <span class="dd-name">${r.name}</span>
                            <span class="dd-code-center">${shortcut ? `(${shortcut})` : ''}</span>
                            <span class="dd-id">${r.ref}</span>
                        </li>
                    `;
                }).join('');

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

    input.addEventListener('keydown', async e => {
        if (e.key === 'Enter') {
            await initDidokSources();
            const first = dropdown.querySelector('li:not(.no-res)');
            if (first) {
                STOP_ID     = first.dataset.id;
                input.value = first.dataset.name;
                closeDropdown();
            } else {
                const v = input.value.trim();
                const didokResult = checkDidokMapping(v);
                if (didokResult) {
                    STOP_ID = didokResult.id;
                    input.value = didokResult.name;
                } else if (/^\d{7,8}$/.test(v)) {
                    if (/^85\d{5}$/.test(v)) {
                        STOP_ID = `ch:1:sloid:${v.substring(2)}`;
                    } else {
                        STOP_ID = v;
                    }
                }
            }

            if (STOP_ID) {
                updateUrlParams();
                initDidokSources().then(() => loadBoard());
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

function distanceInMetres(latitude1, longitude1, latitude2, longitude2) {
    const earthRadius = 6371000;
    const toRadians = degrees => degrees * Math.PI / 180;
    const latitudeDelta = toRadians(latitude2 - latitude1);
    const longitudeDelta = toRadians(longitude2 - longitude1);
    const a = Math.sin(latitudeDelta / 2) ** 2
        + Math.cos(toRadians(latitude1)) * Math.cos(toRadians(latitude2))
        * Math.sin(longitudeDelta / 2) ** 2;
    return 2 * earthRadius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getCurrentPosition() {
    return new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 30000
        });
    });
}

async function findNearbyStations() {
    const button = DOM.nearbyBtn();
    const dropdown = DOM.stopDropdown();
    if (!button || !dropdown) return;

    if (!window.isSecureContext && !['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)) {
        showStatus('Standortsuche funktioniert nur über HTTPS.', 'error');
        return;
    }

    button.disabled = true;
    button.textContent = '📍 Suche läuft…';
    closeDropdown();

    try {
        const position = await getCurrentPosition();
        const { latitude, longitude } = position.coords;
        let stations = await searchStopsNearLocation(latitude, longitude, 1000);
        if (stations.length === 0) stations = await searchStopsNearLocation(latitude, longitude, 3000);

        const uniqueStations = new Map();
        stations.forEach(station => {
            const distance = distanceInMetres(latitude, longitude, station.latitude, station.longitude);
            const current = uniqueStations.get(station.ref);
            if (!current || distance < current.distance) {
                uniqueStations.set(station.ref, { ...station, distance });
            }
        });

        const nearbyStations = [...uniqueStations.values()].sort((a, b) => a.distance - b.distance);
        if (nearbyStations.length === 0) {
            showStatus('Keine Station im Umkreis gefunden.', 'error');
            return;
        }

        dropdown.innerHTML = nearbyStations.map(station => `
            <li data-id="${station.ref}" data-name="${station.name}">
                <span class="dd-name">${station.name}</span>
                <span class="dd-distance">${Math.round(station.distance)} m</span>
            </li>
        `).join('');
        dropdown.classList.remove('hidden');
        showStatus('', '');
    } catch (error) {
        const message = error.code === 1
            ? 'Standortberechtigung verweigert.'
            : error.code === 2 || error.code === 3
                ? 'Standort nicht verfügbar oder Zeitüberschreitung.'
            : 'OJP-Fehler bei der Stationssuche.';
        showStatus(message, 'error');
    } finally {
        button.disabled = false;
        button.textContent = '📍 In meiner Nähe';
    }
}

function updateClock() {
    const el = document.getElementById('live-clock');
    if (!el) return;
    const now = new Date();
    el.textContent =
        String(now.getHours()).padStart(2,'0') + ':' +
        String(now.getMinutes()).padStart(2,'0') + ':' +
        String(now.getSeconds()).padStart(2,'0');
}

// ─── Zeit-Controls ───────────────────────────────────────────────────────────

function offsetTime(minutes) {
    const now = new Date();
    const currentZurich = formatZurichDateTime(now);
    const baseDate = QUERY_DATE || currentZurich.date;
    const baseTime = QUERY_TIME || currentZurich.time;
    const dateObj = parseCountdownTime(`${baseDate}T${baseTime}:00`) || now;
    const target = new Date(dateObj.getTime() + minutes * 60000);
    setQueryDateTime(target);
}

function setQueryDateTime(dateObj) {
    const formatted = formatZurichDateTime(dateObj);
    QUERY_DATE = formatted.date;
    QUERY_TIME = formatted.time;
    const di = DOM.dateInput();
    if (di) di.value = QUERY_DATE;
    const ti = DOM.timeInput();
    if (ti) ti.value = QUERY_TIME;
    updateUrlParams();
    stopAutoRefresh();
    loadBoard();
}

function visibleDepartureTimes() {
    return [...document.querySelectorAll('.dep-row:not(.filtered-dest)')]
        .map(row => {
            const timeCell = row.querySelector('.col-time');
            const iso = isCountdownDefault() ? timeCell?.dataset.est : timeCell?.dataset.tt;
            return parseCountdownTime(iso);
        })
        .filter(Boolean)
        .sort((a, b) => a - b);
}

function navigateByVisibleDepartures(direction) {
    const times = visibleDepartureTimes();
    if (times.length === 0) {
        offsetTime(direction * 20);
        return;
    }

    const first = times[0];
    const last = times[times.length - 1];
    if (direction > 0) {
        setQueryDateTime(new Date(last.getTime() + 60000));
        return;
    }

    const spanMinutes = Math.min(180, Math.max(20, Math.round((last - first) / 60000)));
    setQueryDateTime(new Date(first.getTime() - spanMinutes * 60000));
}

document.addEventListener('DOMContentLoaded', () => {
    initHeaderHeight();
    blockZoom();
    updateBoardControls(ALL_DEPS.length > 0);
    const btnPrev = document.getElementById('btn-time-prev');
    const btnNext = document.getElementById('btn-time-next');
    const btnNow = document.getElementById('btn-time-now');

    if (btnPrev) btnPrev.onclick = () => navigateByVisibleDepartures(-1);
    if (btnNext) btnNext.onclick = () => navigateByVisibleDepartures(1);
    
    if (btnNow) {
        btnNow.onclick = () => {
            QUERY_DATE = '';
            QUERY_TIME = '';
            const di = DOM.dateInput();
            if (di) di.value = '';
            const ti = DOM.timeInput();
            if (ti) ti.value = '';
            updateUrlParams();
            loadBoard();
            startAutoRefresh();
        };
    }
});

window.addEventListener('popstate', () => {
    const p   = new URLSearchParams(window.location.search);
    STOP_ID    = p.get('stop')  ?? '';
    QUERY_DATE = p.get('date')  ?? '';
    QUERY_TIME = p.get('time')  ?? '';
    syncInputsFromState();
    if (STOP_ID) loadBoard();
});

// ─── ZIELFILTER (hier: Herkunft) ─────────────────────────────────────────────

function initDestFilter() {
    const destFilterEl = document.getElementById('destFilter');
    const dropdown = document.getElementById('dest-filter-dropdown');
    if (!destFilterEl) return;
    const clear = document.querySelector('[data-filter-clear]');
    
    destFilterEl.addEventListener('input', () => {
        updateDestFilterDropdown();
        applyDestFilter();
    });
    destFilterEl.addEventListener('focus', updateDestFilterDropdown);

    clear?.addEventListener('click', () => {
        destFilterEl.value = '';
        closeDestFilterDropdown();
        applyDestFilter();
    });

    dropdown?.addEventListener('mousedown', event => {
        const option = event.target.closest('[data-dest-value]');
        if (!option) return;
        event.preventDefault();
        destFilterEl.value = option.dataset.destValue;
        dropdown.classList.add('hidden');
        applyDestFilter();
    });

    destFilterEl.addEventListener('keydown', event => {
        if (event.key === 'Escape') closeDestFilterDropdown();
    });

    document.addEventListener('pointerdown', event => {
        if (!event.target.closest('#dest-filter-bar')) closeDestFilterDropdown();
    });
}

function closeDestFilterDropdown() {
    document.getElementById('dest-filter-dropdown')?.classList.add('hidden');
}

function normalizeDestFilterValue(value) {
    return String(value || '').trim().toLocaleLowerCase('de-CH').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function getDestinationTerms(value) {
    const name = String(value || '').trim();
    if (!name) return [];

    const normalizedName = normalizeDestFilterValue(name);
    const terms = [normalizedName];
    terms.push(...findAbbreviationsByName(name).map(code => normalizeDestFilterValue(code)));
    return terms;
}

function updateDestFilterOptions(departures) {
    const options = document.getElementById('dest-filter-dropdown');
    if (!options) return;

    const values = new Map();
    departures.forEach(dep => {
        [dep.destination, ...(dep.vias || []), ...(dep.onwardvias || [])].forEach(value => {
            const name = String(value || '').trim();
            if (!name) return;
            const terms = getDestinationTerms(name);
            values.set(terms[0], { name, terms });
        });
    });

    options._values = [...values.values()]
        .sort((a, b) => a.name.localeCompare(b.name, 'de-CH'));
    options.innerHTML = '';
    closeDestFilterDropdown();
}

function updateDestFilterDropdown() {
    const input = document.getElementById('destFilter');
    const dropdown = document.getElementById('dest-filter-dropdown');
    if (!input || !dropdown?._values) return;

    const query = normalizeDestFilterValue(input.value);
    const matches = dropdown._values
        .filter(({ name, terms }) => !query || [name, ...terms.slice(1).map(code => code.toUpperCase())]
            .some(value => normalizeDestFilterValue(value).includes(query)))
        .slice(0, 8);

    dropdown.innerHTML = matches.map(({ name, terms }) => {
        const code = terms[1] ? ` <span class="dd-code-center">${terms[1].toUpperCase()}</span>` : '';
        const escapedName = name.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
        return `<li data-dest-value="${escapedName}"><span class="dd-name">${escapedName}</span>${code}</li>`;
    }).join('');
    dropdown.classList.toggle('hidden', matches.length === 0);
}

/**
 * Filtert nach Herkunft oder Via (inkl. DiDok-Kürzeln).
 */
function applyDestFilter() {
    const destFilterEl = document.getElementById('destFilter');
    if (!destFilterEl) return;
    
    const query = destFilterEl.value.trim().toLowerCase();
    const normalizedQuery = normalizeDestFilterValue(query);

    document.querySelectorAll('.dep-row').forEach(tr => {
        const terms = (tr.dataset.destTerms || '').split('|');
        
        if (!query) {
            tr.classList.remove('filtered-dest');
            return;
        }
        
        const matches = terms.some(term => term.includes(normalizedQuery));
        tr.classList.toggle('filtered-dest', !matches);
    });
    restripeRows();
}

// ─── DOMContentLoaded ────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {

    syncInputsFromState();
    renderFavBar();
    initFilterBar();
    initStopSearch();
    DOM.nearbyBtn()?.addEventListener('click', findNearbyStations);
    updateClock();
    setInterval(updateClock, 1000);
    
    DOM.homeBtn()?.addEventListener('click', () => {
        STOP_ID    = 'ch:1:sloid:8582597';
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
        const offset = now.getTimezoneOffset() * 60000;
        QUERY_DATE = (new Date(now - offset)).toISOString().slice(0, 10);
        QUERY_TIME = now.toTimeString().substring(0, 5);
        const di = DOM.dateInput();
        if (di) di.value = QUERY_DATE;
        const ti = DOM.timeInput();
        if (ti) ti.value = QUERY_TIME;
        updateUrlParams();
        if (STOP_ID) loadBoard();
        stopAutoRefresh();
    });

    DOM.refreshBtn()?.addEventListener('click', () => {
        if (STOP_ID) loadBoard();
    });

    if (STOP_ID) {
        initDidokSources().then(() => {
            const didokResult = checkDidokMapping(STOP_ID);
            if (didokResult) STOP_ID = didokResult.id;
            syncInputsFromState();
            loadBoard();
            startAutoRefresh();
        });
    }
    
	const addFavBtn = document.getElementById('btn-add-fav');
	if (addFavBtn) {
		addFavBtn.addEventListener('click', () => {
			const name = DOM.stopInput().value;
			if (STOP_ID && name && name !== 'Suchen...') {
				if (!FAVORITES.find(f => f.id === STOP_ID)) {
					FAVORITES.push({ name: name, id: STOP_ID });
					saveToStorage();
					renderFavBar();
					showStatus(`${name} gespeichert`, 'success');
				} else {
					showStatus('Bereits in Favoriten', 'info');
				}
			}
		});
	}

    initDestFilter();
});