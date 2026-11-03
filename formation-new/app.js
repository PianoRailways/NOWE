import { fetchTripInfo } from '../trip/trip-api-client.js';

let tripRefreshTimer = null;
let tripRefreshRunning = false;
let tripListenersBound = false;
let stopNames = {};
window.wagonRegistry = new Map();

function updateClock() {
    const el = document.getElementById('live-clock');
    if (!el) return;
    const now = new Date();
    el.textContent = now.toLocaleTimeString('de-CH');
}

function closeModal() {
    document.getElementById('modal-overlay')?.classList.remove('active');
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[character]));
}

window.toggleStop = toggleStop;
window.showDetails = showDetails;

document.addEventListener("DOMContentLoaded", () => {
    document.getElementById('date').valueAsDate = new Date();
    updateClock();
    setInterval(updateClock, 1000);
    document.getElementById('btn-home')?.addEventListener('click', () => { window.location = '../'; });
    document.getElementById('live-clock')?.addEventListener('click', () => { window.location = './?train='; });
    document.getElementById('fetch-button')?.addEventListener('click', fetchFormation);
    document.getElementById('modal-close')?.addEventListener('click', closeModal);
    document.getElementById('modal-overlay')?.addEventListener('click', (event) => {
        if (event.target === event.currentTarget) closeModal();
    });
    document.addEventListener('click', (event) => {
        const card = event.target.closest('#stopChain .wagon-card:not([disabled])');
        if (!card) return;
        event.stopPropagation();
        const vehicle = window.wagonRegistry.get(`${card.dataset.stopIndex}-${card.dataset.wagonIndex}`);
        const stop = window.formationData?.stops[Number(card.dataset.stopIndex)];
        if (vehicle && stop) showDetails(vehicle, stop);
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') closeModal();
    });

    const trainInput = document.getElementById('trainNumber');
    const evuSelect = document.getElementById('evu');
    const urlParams = new URLSearchParams(window.location.search);
    
    const trainParam = urlParams.get('train');
    const evuParam = urlParams.get('evu');
    const sjyidParam = urlParams.get('sjyid');
    const dateParam = urlParams.get('date');

    if (dateParam) document.getElementById('date').value = dateParam;

    if (evuParam && evuSelect) {
        evuSelect.value = evuParam;
    }

    if (sjyidParam) {
        loadTripOnly(sjyidParam, urlParams.get('date') || document.getElementById('date').value);
    } else if (trainParam && trainInput) {
        trainInput.value = trainParam;
        fetchFormation();
    }

    if (trainInput) {
        trainInput.addEventListener("keypress", function(event) {
            if (event.key === "Enter") {
                event.preventDefault();
                fetchFormation();
            }
        });

    }
});

async function loadTripOnly(sjyid, date) {
    try {
        const trip = await fetchTripInfo(sjyid, date);
        if (!trip?.stops?.length) return;
        const stops = [];
        const rows = trip.stops.map((stop) => ({
            ...stop,
            fIdx: undefined
        }));
        document.getElementById('result').innerHTML = `
            <div class="trip-only-status">${trip.category || ''} ${trip.line || ''} · ${trip.trainNumber || ''}</div>
            <div class="stop-chain" id="stopChain"></div>`;
        window.formationData = { formations: [], stops, rows, trip, relationships: [] };
        renderStopChain();
        startTripRefresh();
    } catch {
        // Ein Trip-Link darf die Formationsseite nicht stoeren.
    }
}

async function fetchFormation() {
    stopTripRefresh();
    const resultDiv = document.getElementById('result');
    const train = document.getElementById('trainNumber').value;
    const date = document.getElementById('date').value;
    const evu = document.getElementById('evu').value;

    if (!train || !date) {
        resultDiv.innerHTML = `<div class="error-message">⚠ Bitte Zugnummer und Datum eingeben.</div>`;
        return;
    }

    resultDiv.innerHTML = `<div class="info-message">⏳ Lade Formation...</div>`;

    const operators = evu ? [evu] : ['SBBP', 'SOB', 'BLSP', 'TPF', 'RhB', 'THURBO', 'TRN', 'ZB', 'MBC', 'OeBB', 'VDBB'];
    let foundData = null;
    let successfulEvu = '';
    let rateLimitHit = false;
    const errors = [];

    for (const operator of operators) {
        resultDiv.innerHTML = `<div class="info-message">⏳ Suche bei ${operator}...</div>`;

        try {
            const response = await fetch(`./proxy.php?trainNumber=${encodeURIComponent(train)}&operationDate=${encodeURIComponent(date)}&evu=${encodeURIComponent(operator)}`);
            const responseText = await response.text();

            try {
                const jsonStartIndex = responseText.indexOf('{');
                if (jsonStartIndex !== -1) {
                    const cleanJson = responseText.substring(jsonStartIndex);
                    const data = JSON.parse(cleanJson);

                    const errorMessage = typeof data.error === 'string'
                        ? data.error
                        : data.error?.message;
                    if (errorMessage?.includes('Rate Limit')) {
                        rateLimitHit = true;
                        continue;
                    }

                    if (data.error) {
                        errors.push({ operator, message: errorMessage || 'Unbekannter API-Fehler' });
                        continue;
                    }

                    if (data.formations && data.formations.length > 0) {
                        foundData = data;
                        successfulEvu = operator;
                        break;
                    }
                } else {
                    errors.push({ operator, message: `HTTP ${response.status}: ${responseText.slice(0, 150)}` });
                }
            } catch (jsonError) {
                errors.push({ operator, message: `HTTP ${response.status}: ${responseText.slice(0, 150)}` });
                console.warn(`Kein JSON bei ${operator}`);
            }
        } catch (error) {
            errors.push({ operator, message: error.message || 'Netzwerkfehler' });
            console.warn(`Fehler bei ${operator}`);
        }
    }

    if (!foundData) {
        if (rateLimitHit) {
            resultDiv.innerHTML = `<div class="error-message">⚠ API Rate Limit erreicht. Bitte versuchen Sie es in einer Minute erneut.</div>`;
        } else {
            const groupedErrors = [...new Map(errors.map(({ message }) => [message, errors.filter((error) => error.message === message).map((error) => error.operator)])).entries()]
                .map(([message, operatorsForError]) => `<small>${escapeHtml(message)} (${operatorsForError.join(', ')})</small>`).join('<br>');
            resultDiv.innerHTML = `<div class="error-message">❌ Keine Formationsdaten gefunden.${groupedErrors ? `<br>${groupedErrors}` : ''}</div>`;
        }
        return;
    }

    let trip = null;
    const journeyMeta = foundData.journeyMetaInformation || {};
    const swissJourneyId = journeyMeta.sjyid || journeyMeta.SJYID || journeyMeta.swissJourneyId;
    const operationDate = journeyMeta.operationDate || date;
    if (swissJourneyId) {
        try {
            trip = await fetchTripInfo(swissJourneyId, operationDate);
        } catch {
            trip = null;
        }
    }

    const stops = (foundData.formationsAtScheduledStops || []).map((entry, index) => {
        const scheduledStop = entry.scheduledStop || entry;
        const point = scheduledStop.stopPoint || {};
        return {
            name: point.name || null,
            uic: point.uic,
            index,
            arrivalTime: (scheduledStop.stopTime || entry.stopTime || {}).arrivalTime,
            departureTime: (scheduledStop.stopTime || entry.stopTime || {}).departureTime,
            track: entry.track || entry.stopTime?.track || scheduledStop.track || scheduledStop.quay || point.track || point.quay,
            formationShort: entry.formationShort || {},
            vehicleGoals: entry.formationShort?.vehicleGoals || []
        };
    });
    try {
        const response = await fetch('./uic-namen.json');
        if (response.ok) stopNames = await response.json();
    } catch {
        stopNames = {};
    }

    const html = `
        <div class="stop-chain" id="stopChain"></div>
        <div class="related-journeys" aria-label="Verbundene Fahrten">
            <div class="related-journey">
                <span class="related-journey-label">Vorherige Fahrt</span>
                <a class="related-journey-value" id="previousTrainNumber">-</a>
            </div>
            <div class="related-journey">
                <span class="related-journey-label">Nachfolgende Fahrt</span>
                <a class="related-journey-value" id="nextTrainNumber">-</a>
            </div>
        </div>
    `;

    resultDiv.innerHTML = html;

    window.formationData = {
        formations: foundData.formations || [],
        stops: stops,
        trip,
        journeyMeta,
        rows: createMasterRows(trip, stops),
        metaInformation: foundData.metaInformation || {},
        hints: foundData.hints,
        relationships: foundData.relationships || []
    };
    syncFormationUrl(train, successfulEvu, operationDate);

    updateRelatedJourneys(foundData.relationships || []);

    renderStopChain();
    startTripRefresh();
}

function syncFormationUrl(train, evu, date) {
    const url = new URL(window.location.href);
    url.searchParams.set('train', train);
    if (evu) url.searchParams.set('evu', evu);
    if (date) url.searchParams.set('date', date);
    url.searchParams.delete('sjyid');
    window.history.replaceState({}, '', url);
}

function operationDateLabel(date) {
    if (!date) return '';
    const current = window.formationData?.journeyMeta?.operationDate;
    if (!current || date === current) return '';
    const parsed = new Date(`${date}T12:00:00`);
    return Number.isNaN(parsed.getTime()) ? '' : ` <small class="journey-date">${parsed.toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit' })}</small>`;
}

function stopTripRefresh() {
    if (tripRefreshTimer) window.clearInterval(tripRefreshTimer);
    tripRefreshTimer = null;
}

function updateTripRows(trip) {
    if (!trip?.stops) return;
    window.formationData.trip = trip;
    trip.stops.forEach((row, index) => {
        const element = document.querySelectorAll('.formation-stop')[index];
        if (!element) return;
        const timeRows = element.querySelectorAll('.time-row');
        const values = [row.arrival, row.departure].filter(Boolean);
        timeRows.forEach((timeRow, timeIndex) => {
            const value = values[timeIndex];
            if (!value) return;
            timeRow.dataset.est = value.estimated || '';
            timeRow.dataset.delay = value.delaySec || 0;
            const time = timeRow.querySelector('.ps-time');
            if (time) time.textContent = fmtTime(value.timetabled) || '--:--';
        });
    });
    setupTimeRows();
    updateVehicleMarker();
}

async function refreshTrip() {
    if (tripRefreshRunning || document.hidden || !window.formationData?.trip) return;
    const meta = window.formationData.trip;
    const journeyId = meta.swissJourneyId || meta.sjyid || meta.journeyId;
    if (!journeyId) return;
    tripRefreshRunning = true;
    try {
        const updated = await fetchTripInfo(journeyId, document.getElementById('date').value);
        updateTripRows(updated);
        if (updated?.isFinal) stopTripRefresh();
    } catch {
        // Live-Daten sind optional.
    } finally {
        tripRefreshRunning = false;
    }
}

function startTripRefresh() {
    stopTripRefresh();
    if (!window.formationData?.trip) return;
    tripRefreshTimer = window.setInterval(refreshTrip, 15000);
    if (tripListenersBound) return;
    tripListenersBound = true;
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) refreshTrip();
    });
    window.addEventListener('resize', () => {
        if (!document.hidden) updateTripRows(window.formationData?.trip);
    });
    window.addEventListener('pagehide', stopTripRefresh);
}

function createMasterRows(trip, stops) {
    if (!trip?.stops?.length) {
        return stops.map((stop, fIdx) => ({
            name: stopLabel(stop.uic, stop.name),
            stopPointRef: String(stop.uic || ''),
            quay: stop.track,
            fIdx,
            arrival: { timetabled: stop.arrivalTime, estimated: null, delaySec: null },
            departure: { timetabled: stop.departureTime, estimated: null, delaySec: null },
            accessibility: null,
            requestStop: false,
            isThisCall: false
        }));
    }
    let formationCursor = 0;
    return trip.stops.map((row) => {
        const match = stops.findIndex((stop, index) => {
            if (index < formationCursor) return false;
            const ref = String(row.stopPointRef || '').match(/sloid:(\d+)/i)?.[1];
            const stopName = stopLabel(stop.uic, stop.name);
            return (ref && Number(ref) === Number(stop.uic) % 100000)
                || (row.name && stopName && row.name.trim().toLowerCase() === stopName.trim().toLowerCase());
        });
        if (match >= 0) formationCursor = match + 1;
        return { ...row, fIdx: match >= 0 ? match : undefined };
    });
}

function updateRelatedJourneys(relationships) {
    // Mapping der TOCodes auf die entsprechenden EVU-Kürzel
    const toCodeMap = {
        '33': 'BLSP',
        '11': 'SBBP',
        '82': 'SOB',
        '86': 'zb',
        '53': 'TPF',
        '72': 'RhB',
        '65': 'THURBO',
        '43': 'CJ',
        '73': 'TRN',
    };

    const currentJourneyId = window.formationData?.journeyMeta?.SJYID || window.formationData?.journeyMeta?.sjyid;
    const previousJourney = relationships.find((relationship) =>
        relationship.vehicleRelationshipDetails?.direction === 'V'
    );
    const nextJourney = relationships.find((relationship) =>
        relationship.vehicleRelationshipDetails?.direction === 'N'
    );

    // Vorherige Fahrt verarbeiten
    const relationMeta = (direction) => {
        const relation = direction === 'V' ? 'previousVehicleJourney' : 'nextVehicleJourney';
        for (const formation of window.formationData?.formations || []) {
            for (const vehicle of formation.formationVehicles || []) {
                const info = vehicle.vehicleProperties?.vehicleRelation?.[relation];
                const meta = info?.journeyMetaInformation;
                const trainMeta = info?.trainMetaInformation;
                if (meta?.SJYID && trainMeta?.trainNumber > 0 && meta.SJYID !== currentJourneyId) {
                    return { ...trainMeta, operationDate: meta.operationDate };
                }
            }
        }
        return null;
    };
    const prevMeta = previousJourney?.advancedJourneyInformation1?.trainMetaInformation || relationMeta('V');
    const prevNumber = prevMeta?.trainNumber;
    const prevToCode = prevMeta?.toCode;
    const prevElement = document.getElementById('previousTrainNumber');
    
    if (prevNumber) {
        prevElement.innerHTML = `${prevNumber}${operationDateLabel(prevMeta.operationDate)}`;
        let prevUrl = `./?train=${encodeURIComponent(prevNumber)}`;
        if (toCodeMap[prevToCode]) prevUrl += `&evu=${encodeURIComponent(toCodeMap[prevToCode])}`;
        if (prevMeta.operationDate) prevUrl += `&date=${encodeURIComponent(prevMeta.operationDate)}`;
        if (prevToCode && toCodeMap[prevToCode]) {
            prevUrl += `&evu=${encodeURIComponent(toCodeMap[prevToCode])}`;
        }
        prevElement.href = prevUrl;
    } else {
        prevElement.textContent = '-';
        prevElement.removeAttribute('href');
    }

    // Nachfolgende Fahrt verarbeiten
    const nextMeta = nextJourney?.advancedJourneyInformation1?.trainMetaInformation || relationMeta('N');
    const nextNumber = nextMeta?.trainNumber;
    const nextToCode = nextMeta?.toCode;
    const nextElement = document.getElementById('nextTrainNumber');

    if (nextNumber) {
        nextElement.innerHTML = `${nextNumber}${operationDateLabel(nextMeta.operationDate)}`;
        let nextUrl = `./?train=${encodeURIComponent(nextNumber)}`;
        if (toCodeMap[nextToCode]) nextUrl += `&evu=${encodeURIComponent(toCodeMap[nextToCode])}`;
        if (nextMeta.operationDate) nextUrl += `&date=${encodeURIComponent(nextMeta.operationDate)}`;
        if (nextToCode && toCodeMap[nextToCode]) {
            nextUrl += `&evu=${encodeURIComponent(toCodeMap[nextToCode])}`;
        }
        nextElement.href = nextUrl;
    } else {
        nextElement.textContent = '-';
        nextElement.removeAttribute('href');
    }
}

const FLIP_DIRECTION = true;

const UNKNOWN_ATTRIBUTES = new Set();
const KNOWN_WAGON_CODES = new Set(['W', 'W1', 'W2']);
const FORMATION_ATTRIBUTES = new Set(['NF', 'VH', 'VR', 'KW', 'BHP', 'FZ', 'BZ']);
const BIKE_ICON = '<svg class="ic" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="5" cy="16" r="3.5"/><circle cx="19" cy="16" r="3.5"/><path d="M5 16 9 9h6l4 7M9 9l2 7 4-7M5 16h6M7.5 7.5h3M14 7h2.5"/></svg>';

function parseFormationShort(value) {
    if (!value) return [];
    const normalized = String(value).replace(/@([A-Z]+)/g, ',@$1,').replace(/,{2,}/g, ',');
    const result = [];
    const stack = [{ items: [] }];
    let sector = '';
    const addAttributes = (items, value) => {
        String(value || '').replace(/^#/, '').split(';').filter(Boolean).forEach((attr) => {
            if (!FORMATION_ATTRIBUTES.has(attr) && !UNKNOWN_ATTRIBUTES.has(attr)) {
                UNKNOWN_ATTRIBUTES.add(attr);
                console.warn(`Unbekanntes Formationsattribut: ${attr}`);
            }
            items.forEach((item) => item.attrs.add(attr));
        });
    };
    const addToken = (token) => {
        let clean = token.trim();
        if (!clean || clean === 'F') return;
        if (clean.startsWith('@')) {
            sector = clean.slice(1);
            return;
        }
        const counted = !clean.startsWith('-');
        clean = clean.replace(/^-/, '');
        const [base, attrPart] = clean.split('#');
        const [kindPart, numberPart] = base.split(':');
        const percentKind = /^%[A-Z0-9]+$/i.test(kindPart);
        const kind = /^(WL|CC)$/i.test(kindPart) ? kindPart.toUpperCase() : '';
        const type = /^LK$/i.test(kindPart) ? 'loco' : 'wagon';
        const classes = /^\d+$/.test(kindPart) ? kindPart.replace(/[^12]/g, '') : '';
        const code = percentKind ? kindPart.slice(1).toUpperCase() : '';
        if (!classes && !kind && type === 'wagon' && !percentKind && !/^[A-Z]+$/i.test(kindPart)) return;
        if (percentKind && !KNOWN_WAGON_CODES.has(code) && !UNKNOWN_ATTRIBUTES.has(code)) {
            UNKNOWN_ATTRIBUTES.add(code);
            console.warn(`Unbekannter Formationscode: ${code}`);
        } else if (/^[A-Z]+$/i.test(kindPart) && !['WL', 'CC', 'LK'].includes(kindPart.toUpperCase()) && !UNKNOWN_ATTRIBUTES.has(kindPart)) {
            UNKNOWN_ATTRIBUTES.add(kindPart);
            console.warn(`Unbekannte Wagenart: ${kindPart}`);
        }
        const label = percentKind ? '' : kind || (type === 'loco' ? 'Lok' : (!classes && /^[A-Z]+$/i.test(kindPart) ? kindPart.toUpperCase() : ''));
        const item = { type, classes: classes === '21' ? '12' : classes, kind, label, code, number: numberPart && /^\d+$/.test(numberPart) ? Number(numberPart) : null, attrs: new Set(), sector, counted };
        addAttributes([item], attrPart);
        stack.at(-1).items.push(item);
    };
    const tokens = normalized.match(/@[^,()[\]]+|#[^,()[\]]+|[()[\],]|[^,()[\]]+/g) || [];
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i].trim();
        if (token === '(' || token === '[') {
            stack.push({ items: [] });
        } else if (token === ')' || token === ']') {
            const group = stack.length > 1 ? stack.pop() : stack[0];
            const following = tokens[i + 1]?.trim();
            if (following?.startsWith(':')) {
                const suffix = following.match(/^:(\d+)(?:#(.+))?$/);
                const last = group.items.at(-1);
                if (suffix && last && last.number === null) {
                    last.number = Number(suffix[1]);
                    if (suffix[2]) addAttributes([last], suffix[2]);
                }
                i++;
            } else if (following?.startsWith('#')) {
                addAttributes(group.items, following);
                i++;
            }
            stack.at(-1).items.push(...group.items);
        } else if (token !== ',') {
            addToken(token);
        }
    }
    result.push(...stack[0].items);
    return result;
}

function stopEntryFor(vehicle, stop) {
    return (vehicle.formationVehicleAtScheduledStops || []).find((entry) =>
        entry.stopPoint?.uic === stop.uic
    );
}

function formationForStop(stopIdx) {
    const stop = window.formationData.stops[stopIdx];
    const parserData = parseFormationShort(stop.formationShort?.formationShortString);
    const candidates = window.formationData.formations.map((formation, index) => ({
        formation, index,
        vehicles: (formation.formationVehicles || []).filter((vehicle) => stopEntryFor(vehicle, stop))
    })).filter((candidate) => candidate.vehicles.length);
    if (!candidates.length) return { formation: null, vehicles: [], parserData };

    const hasNumbers = parserData.some((token) => token.number !== null);
    if (hasNumbers) {
        for (let c = candidates.length - 1; c >= 0; c--) {
            const candidate = candidates[c];
            const vehicles = parserData.map((token) => token.number === null
                ? null
                : candidate.vehicles.find((vehicle) => Number(vehicle.number) === token.number) || null);
            if (vehicles.some(Boolean)) return { formation: candidate.formation, vehicles, parserData };
        }
    } else {
        const matching = candidates.filter((candidate) => candidate.vehicles.length === parserData.length);
        const candidate = matching.at(-1) || candidates.at(-1);
        const vehicles = [...candidate.vehicles].sort((a, b) => (a.position || 0) - (b.position || 0));
        if (!parserData.length || vehicles.length === parserData.length) {
            return { formation: candidate.formation, vehicles, parserData };
        }
        console.warn('FormationShort und Wagenanzahl stimmen nicht überein.');
        return { formation: candidate.formation, vehicles, parserData: [] };
    }
    return { formation: candidates.at(-1).formation, vehicles: candidates.at(-1).vehicles, parserData: [] };
}

function orderedFormation(vehicles, parserData) {
    const items = vehicles.map((vehicle, index) => ({ vehicle, sourceIndex: index, parsed: parserData[index] }));
    return FLIP_DIRECTION ? items.reverse() : items;
}

function fmtTime(value) {
    if (!value) return null;
    const match = String(value).match(/T(\d{2}):(\d{2})/);
    return match ? `${match[1]}:${match[2]}` : formatTime(value);
}

function delayLabel(seconds) {
    if (!seconds) return '';
    const sign = seconds > 0 ? '+' : '−';
    const absolute = Math.abs(seconds);
    const type = seconds < 0 ? ' delay-badge--early' : '';
    return `<span class="delay-badge${type}">${sign}${Math.floor(absolute / 60)}:${String(absolute % 60).padStart(2, '0')}</span>`;
}

function accessIcon(type) {
    return type ? `<span class="access-icon" title="${type}">♿</span>` : '';
}

function stopLabel(uic, name) {
    if (name) return name;
    const tripStop = window.formationData?.trip?.stops?.find((stop) => {
        const ref = String(stop.stopPointRef || '').match(/sloid:(\d+)/i)?.[1];
        return ref && Number(ref) === Number(uic) % 100000;
    });
    return tripStop?.name || stopNames[String(uic)] || `UIC ${uic || '-'}`;
}

function timeRow(value, estimated, delay, kind) {
    return `<div class="time-row" data-tt="${value || ''}" data-est="${estimated || ''}" data-delay="${delay || 0}">
        <span class="ps-time ps-time--${kind}">${fmtTime(value) || '--:--'}</span>${delayLabel(delay)}
    </div>`;
}

function renderStopChain() {
    const { stops, rows } = window.formationData;
    const chain = document.getElementById('stopChain');
    let previousDay = null;
    chain.innerHTML = rows.map((row, idx) => {
        const fIdx = row.fIdx;
        const stop = fIdx === undefined ? row : stops[fIdx];
        const isFirst = idx === 0;
        const isLast = idx === rows.length - 1;
        const arrival = row.arrival?.timetabled || stop.arrivalTime;
        const departure = row.departure?.timetabled || stop.departureTime;
        const rowTime = arrival || departure;
        const day = rowTime ? rowTime.slice(0, 10) : null;
        let daySeparator = '';
        if (day && day !== previousDay && previousDay !== null) {
            const date = new Date(`${day}T12:00:00`);
            daySeparator = `<div class="day-separator">${date.toLocaleDateString('de-CH', { weekday: 'short', day: '2-digit', month: '2-digit' })}</div>`;
        }
        if (day) previousDay = day;
        const times = isFirst
            ? timeRow(departure, row.departure?.estimated, row.departure?.delaySec, 'dep')
            : isLast
                ? timeRow(arrival, row.arrival?.estimated, row.arrival?.delaySec, 'arr')
                : `${timeRow(arrival, row.arrival?.estimated, row.arrival?.delaySec, 'arr')}${timeRow(departure, row.departure?.estimated, row.departure?.delaySec, 'dep')}`;
        const quay = fIdx !== undefined ? stops[fIdx].track : row.quay;
        const link = `https://nowe.stellwerksim.ch/?stop=${encodeURIComponent(row.stopPointRef || row.name)}&date=${encodeURIComponent(document.getElementById('date').value)}${arrival ? `&time=${encodeURIComponent(formatTime(arrival))}` : ''}`;
        const rowBody = `<span class="chain-stop-text"><a href="${link}">${stopLabel(stop.uic, row.name)}</a>${accessIcon(row.accessibility)}${row.requestStop ? '<b class="hav-badge">HaV</b>' : ''}${quay ? `<small>Gl. ${quay}</small>` : ''}</span>`;
        return `${daySeparator}
            <section class="formation-stop" data-stop-index="${fIdx ?? ''}" data-row-index="${idx}">
                <button class="formation-stop-row" type="button" data-formation-index="${fIdx ?? ''}" ${fIdx === undefined ? 'disabled' : ''}>
                    <span class="chain-times">${times}</span>
                    <span class="chain-marker"><span class="chain-dot"></span></span>
                    ${rowBody}
                    ${fIdx === undefined ? '' : '<span class="stop-arrow" aria-hidden="true">›</span>'}
                </button>
                ${fIdx === undefined ? '' : `<div class="formation-panel" id="formation-panel-${fIdx}"></div>`}
            </section>`;
    }).join('');

    chain.querySelectorAll('.formation-stop-row:not([disabled])').forEach((row) => {
        row.addEventListener('click', (event) => {
            if (event.target.closest('a')) return;
            toggleStop(Number(row.dataset.formationIndex));
        });
    });

    const now = Date.now();
    let openIndex = rows.findIndex((row, rowIndex) => row.fIdx !== undefined && (() => {
        const stop = stops[row.fIdx];
        const time = rowIndex === rows.length - 1 ? row.arrival?.timetabled || stop.arrivalTime : row.departure?.timetabled || stop.departureTime;
        return time && new Date(time).getTime() >= now;
    })());
    toggleStop(openIndex >= 0 ? rows[openIndex].fIdx : (rows.find(row => row.fIdx !== undefined)?.fIdx ?? -1));
    setupTimeRows();
    updateVehicleMarker();
}

function setupTimeRows() {
    document.querySelectorAll('.time-row').forEach((row) => {
        row.addEventListener('click', (event) => {
            event.stopPropagation();
            const estimate = row.dataset.est;
            if (!estimate) return;
            const time = row.querySelector('.ps-time');
            const original = time.textContent;
            time.textContent = fmtTime(estimate) || original;
            window.setTimeout(() => { time.textContent = original; }, 5000);
        });
    });
}

function toggleStop(stopIdx) {
    const openStop = document.querySelector('.formation-stop.is-open')?.dataset.stopIndex;
    if (String(stopIdx) === openStop) stopIdx = -1;
    document.querySelectorAll('.formation-stop').forEach((stop) => {
        const formationIndex = stop.dataset.stopIndex;
        const open = formationIndex !== '' && Number(formationIndex) === stopIdx;
        stop.classList.toggle('is-open', open);
        const panel = stop.querySelector('.formation-panel');
        if (open) {
            panel.innerHTML = renderFormationStrip(stopIdx);
        } else {
            panel.innerHTML = '';
        }
    });
    updateVehicleMarker();
}

function updateVehicleMarker() {
    const chain = document.getElementById('stopChain');
    const trip = window.formationData?.trip;
    if (!chain || !trip?.stops?.length || typeof window.calculateVehiclePosition !== 'function') return;

    let marker = chain.querySelector('.vehicle-position-marker');
    if (!marker) {
        marker = document.createElement('span');
        marker.className = 'vehicle-position-marker';
        marker.title = 'Aktuelle Zugposition';
        chain.appendChild(marker);
    }

    const position = window.calculateVehiclePosition(trip.stops, new Date(), trip);
    if (!position) {
        marker.hidden = true;
        return;
    }

    const rows = [...chain.querySelectorAll('.formation-stop')];
    const currentRow = rows.find((row) => Number(row.dataset.rowIndex) === position.stopIndex);
    if (!currentRow) {
        marker.hidden = true;
        return;
    }
    const nextRow = position.nextStopIndex === undefined
        ? currentRow
        : rows.find((row) => Number(row.dataset.rowIndex) === position.nextStopIndex) || currentRow;
    const chainRect = chain.getBoundingClientRect();
    const currentDot = currentRow.querySelector('.chain-dot').getBoundingClientRect();
    const nextDot = nextRow.querySelector('.chain-dot').getBoundingClientRect();
    const progress = position.progress || 0;
    const currentY = currentDot.top + currentDot.height / 2 - chainRect.top;
    const nextY = nextDot.top + nextDot.height / 2 - chainRect.top;
    marker.style.top = `${currentY + (nextY - currentY) * progress}px`;
    marker.style.left = `${currentDot.left + currentDot.width / 2 - chainRect.left}px`;
    marker.hidden = false;
}

function renderFormationStrip(stopIdx) {
    const { vehicles, parserData } = formationForStop(stopIdx);
    const stop = window.formationData.stops[stopIdx];
    const parsed = parserData.length === vehicles.length ? parserData : [];
    if (parserData.length && !parsed.length) {
        console.warn('FormationShort und Wagenanzahl stimmen nicht überein.');
    }
    const available = vehicles.map((vehicle, index) => ({
        vehicle,
        stopData: vehicle ? stopEntryFor(vehicle, stop) : { sectors: parsed[index]?.sector },
        index
    }));
    const ordered = orderedFormation(available.map((item) => item.vehicle), parsed)
        .map((item) => ({ ...available[item.sourceIndex], sourceIndex: item.sourceIndex, parsed: item.parsed }));
    for (const key of window.wagonRegistry.keys()) {
        if (key.startsWith(`${stopIdx}-`)) window.wagonRegistry.delete(key);
    }
    const sectors = [];
    ordered.forEach((item, index) => {
        const sector = item.parsed?.sector || (item.stopData.sectors || '').charAt(0);
        const previous = sectors[sectors.length - 1];
        if (previous && previous.sector === sector) previous.count++;
        else sectors.push({ sector, count: 1 });
    });
    const sectorHtml = sectors.map(group => `<span class="sector-group" style="--span:${group.count}">${group.sector ? `<b><span>Sektor ${group.sector}</span></b>` : ''}</span>`).join('');
    const goals = stop.vehicleGoals || [];
    const direction = goals.length === 1 ? `← Richtung ${goalName(goals[0])}` : '';
    const goalLabels = goals.length > 1 ? renderGoalLabels(goals, parserData, ordered.length, stopLabel(stop.uic, stop.name), ordered) : '';
    const wagonHtml = ordered.map((item, index) => {
        if (item.vehicle) window.wagonRegistry.set(`${stopIdx}-${index}`, item.vehicle);
        return renderWagon(item.vehicle, item.stopData, item.index, index, ordered, stopIdx);
    }).join('');
    const meta = window.formationData.metaInformation || {};
    const lastUpdate = meta.lastUpdate ? formatTime(meta.lastUpdate) : '';
    const hints = window.formationData.hints;
    return `<div class="formation-strip" style="--wagon-count:${ordered.length}">
        ${direction ? `<div class="formation-direction">${direction}</div>` : ''}
        <div class="formation-scroll"><div class="formation-inner">
            <div class="sector-bar">${sectorHtml}</div>
            ${goalLabels}
            <div class="wagon-row">${wagonHtml}</div>
        </div></div>
        <div class="formation-meta">
            ${meta.length ? `Länge ${meta.length} m` : ''}${meta.numberSeats ? ` · ${meta.numberSeats} Sitzplätze` : ''}${lastUpdate ? ` · Stand ${lastUpdate}` : ''}
        </div>
        ${hints ? `<div class="formation-hints">${Array.isArray(hints) ? hints.map(hint => `<span>${typeof hint === 'string' ? hint : JSON.stringify(hint)}</span>`).join('') : JSON.stringify(hints)}</div>` : ''}
    </div>`;
}

function goalName(goal) {
    return stopLabel(
        goal.destinationStopPoint?.uic || goal.toStop?.uic || goal.stopPoint?.uic,
        goal.destinationStopPoint?.name || goal.toStop?.name || goal.stopPoint?.name || goal.name || goal.destination
    );
}

function renderGoalLabels(goals, parserData, wagonCount, stopName, ordered) {
    const counted = [
        parserData.filter((token) => token.counted).length,
        parserData.filter((token) => token.counted && token.type !== 'loco').length,
        parserData.length
    ];
    const maxPosition = Math.max(...goals.map((goal) => Number(goal.toVehicleAtPosition) || 0));
    counted.push(wagonCount);
    const total = counted.find((count) => count === maxPosition);
    if (!total) {
        console.warn('Zugteil-Ziele passen nicht zur Wagenreihung. Fallback über vehicle.position', {
            halt: stopName,
            maxPosition,
            counted,
            wagonCount,
            goals: goals.length
        });
        console.table(ordered.map((item, index) => ({
            anzeige: index,
            nummer: item.vehicle?.number ?? null,
            position: item.vehicle?.position ?? null,
            typ: item.parsed?.type ?? null
        })));
        const fallbackGroups = goals.map((goal) => {
            const from = Number(goal.fromVehicleAtPosition);
            const to = Number(goal.toVehicleAtPosition);
            const indexes = ordered
                .map((item, index) => ({ item, index }))
                .filter(({ item }) => Number.isFinite(from) && Number.isFinite(to)
                    && item.vehicle?.position >= from && item.vehicle.position <= to)
                .map(({ index }) => index);
            if (!indexes.length) return '';
            const first = Math.min(...indexes);
            const last = Math.max(...indexes);
            return `<span class="goal-group" style="grid-column:${first + 1} / span ${last - first + 1}">${goalName(goal)}</span>`;
        }).join('');
        return fallbackGroups ? `<div class="goal-bar" style="--wagon-count:${wagonCount}">${fallbackGroups}</div>` : '';
    }
    return `<div class="goal-bar" style="--wagon-count:${wagonCount}">${goals.map((goal) => {
        let from = Math.max(1, Number(goal.fromVehicleAtPosition) || 1);
        let to = Math.max(from, Number(goal.toVehicleAtPosition) || from);
        if (FLIP_DIRECTION) {
            [from, to] = [wagonCount - to + 1, wagonCount - from + 1];
        }
        return `<span class="goal-group" style="grid-column:${from} / span ${to - from + 1}">${goalName(goal)}</span>`;
    }).join('')}</div>`;
}

function iconSvg(type) {
    const paths = {
        wheelchair: '<circle cx="7" cy="3" r="2"/><path d="M7 7h3l2 3m-5-3-1 5 4 3m-4-3H4m3-5 4 5h3"/>',
        bike: '<circle cx="4" cy="14" r="2"/><circle cx="14" cy="14" r="2"/><path d="m4 14 3-7h4l3 7M7 7l-2-2h3m2 2 2-3"/>',
        stroller: '<circle cx="5" cy="15" r="1.5"/><circle cx="14" cy="15" r="1.5"/><path d="M4 13h8l2-7H6m0 0L5 3H3"/>'
    };
    return `<svg viewBox="0 0 18 18" aria-hidden="true">${paths[type]}</svg>`;
}

function renderWagon(vehicle, stopData, vIdx, index, ordered, stopIdx) {
    if (!vehicle) {
        const parsed = ordered[index].parsed || {};
        return `<div class="wagon-unit wagon-placeholder"><span class="wagon-card wagon-empty"><span class="wagon-badges">${parsed.kind || parsed.classes || ''}</span>${parsed.number ? `<span class="wagon-number">${parsed.number}</span>` : ''}</span><span class="wagon-icons"></span>${index < ordered.length - 1 ? '<span class="wagon-connection"></span>' : ''}</div>`;
    }
    const props = vehicle.vehicleProperties || {};
    const accessibility = props.accessibilityProperties || {};
    const parsed = ordered[index].parsed;
    const classes = parsed?.classes || `${props.number1class > 0 ? '1' : ''}${props.number2class > 0 ? '2' : ''}`;
    const isLoco = parsed?.type === 'loco';
    const hasSeats = props.number1class > 0 || props.number2class > 0 || props.numberRestaurantSpace > 0;
    const nextItem = ordered[index + 1];
    const transitionOpen = !nextItem || (() => {
        const a = ordered[index];
        const b = nextItem;
        const later = a.sourceIndex > b.sourceIndex ? a : b;
        return a.parsed?.type === 'loco'
            || b.parsed?.type === 'loco'
            || !a.vehicle
            || !b.vehicle
            || later.stopData?.accessToPreviousVehicle !== false;
    })();
    const restaurantBadge = parsed?.code?.startsWith('W')
        ? `<span class="class-badge restaurant">${parsed.code}</span>`
        : props.numberRestaurantSpace > 0 ? '<span class="class-badge restaurant">W</span>' : '';
    const badges = isLoco ? '<span class="wagon-kind">Lok</span>' : parsed?.label ? `<span class="wagon-kind" title="${parsed.kind === 'WL' ? 'Schlafwagen' : parsed.kind === 'CC' ? 'Liegewagen' : ''}">${parsed.label}</span>` : `${restaurantBadge}${classes.includes('1') ? '<span class="class-badge first">1</span>' : ''}${classes.includes('2') ? '<span class="class-badge second">2</span>' : ''}`;
    const icons = [
        (parsed?.attrs.has('BHP') || accessibility.numberWheelchairSpaces > 0 || accessibility.wheelchairToilet || props.pictoProperties?.wheelchairPicto) ? iconSvg('wheelchair') : '',
        (!isLoco && (parsed?.attrs.has('VH') || parsed?.attrs.has('VR') || props.bikePlatform || props.pictoProperties?.bikePicto)) ? BIKE_ICON : '',
        (parsed?.attrs.has('KW') || props.pictoProperties?.strollerPicto) ? iconSvg('stroller') : '',
        (parsed?.attrs.has('NF') || props.lowFloorTrolley) ? '<strong>NF</strong>' : ''
    ].filter(Boolean).join('');
    const number = Number(vehicle.number) > 0 ? vehicle.number : parsed?.number || '';
    const currentStop = window.formationData.stops[stopIdx];
    const willBePutAwayHere = props.vehicleWillBePutAway === true
        && props.toStop?.uic === currentStop?.uic;
    const status = props.closed === true ? 'gesperrt' : willBePutAwayHere ? 'wird abgestellt' : '';
    return `<div class="wagon-unit">
        <button class="wagon-card ${isLoco ? 'wagon-loco' : ''} ${!hasSeats ? 'wagon-empty' : ''} ${props.numberRestaurantSpace > 0 ? 'wagon-restaurant' : ''}" type="button" data-stop-index="${stopIdx}" data-wagon-index="${index}" ${isLoco ? 'disabled' : ''}>
            <span class="wagon-class-bar"></span><span class="wagon-badges">${badges}</span><span class="wagon-number">${number}</span>${status ? `<small class="wagon-status">${status}</small>` : ''}
        </button>
        <span class="wagon-icons">${icons}</span>
        ${index < ordered.length - 1 ? `<span class="wagon-connection ${transitionOpen ? '' : 'is-closed'}"></span>` : ''}
    </div>`;
}

function showDetails(vehicle, stop) {
    const props = vehicle.vehicleProperties || {};
    const accessibility = props.accessibilityProperties || {};
    const stopData = stopEntryFor(vehicle, stop);
    const willBePutAwayHere = props.vehicleWillBePutAway === true
        && props.toStop?.uic === stop?.uic;
    const parsed = parseFormationShort(stop.formationShort?.formationShortString)
        .find((item) => item.number !== null && Number(vehicle.number) === item.number);
    const parserChips = parsed ? [...parsed.attrs].map((attr) => `<span class="attribute-chip">${attr}</span>`).join('') : '';

    // Die "vehicle.number" entspricht der Anzeigennummer (Perron), 
    // "vehicle.position" ist die physische Reihung (z.B. 1. Wagen ab Lok).
    let html = `
        <div class="modal-title">
            <div class="modal-title-main">${vehicle.vehicleIdentifier.typeCodeName}</div>
            <div class="modal-title-meta">
                <span class="modal-badges">${parsed?.code?.startsWith('W') ? `<span class="class-badge restaurant">${parsed.code}</span>` : props.numberRestaurantSpace > 0 ? '<span class="class-badge restaurant">W</span>' : ''}${props.number1class > 0 ? '<span class="class-badge first">1</span>' : ''}${props.number2class > 0 ? '<span class="class-badge second">2</span>' : ''}${parsed?.kind ? `<span class="wagon-kind">${parsed.kind}</span>` : ''}${accessibility.numberWheelchairSpaces > 0 || accessibility.wheelchairToilet ? iconSvg('wheelchair') : ''}${props.bikePlatform ? BIKE_ICON : ''}${props.pictoProperties?.strollerPicto ? iconSvg('stroller') : ''}${props.lowFloorTrolley ? '<strong>NF</strong>' : ''}${parserChips}</span>
                ${Number(vehicle.number) > 0 ? `Wagen ${vehicle.number}` : ''} (Pos. ${vehicle.position || '-'})
                ${props.closed === true ? '<span class="wagon-status">gesperrt</span>' : ''}${willBePutAwayHere ? '<span class="wagon-status">wird abgestellt</span>' : ''}
            </div>
        </div>

        <div class="modal-grid">
            <div class="detail-group">
                <div class="detail-group-title">Allgemein</div>
                ${parsed?.kind ? `<div class="detail-row"><span class="detail-label">Art:</span> <span class="detail-value">${parsed.kind} · ${vehicle.vehicleIdentifier?.typeCodeName || '-'}</span></div>` : ''}
                <div class="detail-row"><span class="detail-label">Wagennummer:</span> <span class="detail-value">${vehicle.number || '-'}</span></div>
                <div class="detail-row"><span class="detail-label">Physische Position:</span> <span class="detail-value">${vehicle.position || '-'}</span></div>
                <div class="detail-row"><span class="detail-label">Tech. Wagennr.:</span> <span class="detail-value">${vehicle.vehicleIdentifier?.vehicleNumber || '-'}</span></div>
                <div class="detail-row"><span class="detail-label">EVN:</span> <span class="detail-value detail-value--small">${vehicle.vehicleIdentifier?.evn || '-'}</span></div>
                ${vehicle.vehicleIdentifier?.parentEvn ? `<div class="detail-row"><span class="detail-label">Parent-EVN:</span> <span class="detail-value detail-value--small">${vehicle.vehicleIdentifier.parentEvn}</span></div>` : ''}
                <div class="detail-row"><span class="detail-label">Velohaken:</span> <span class="detail-value">${props.numberBikeHooks || 0}</span></div>
                <div class="detail-row"><span class="detail-label">Verkehrt ab/bis:</span> <span class="detail-value">${props.fromStop?.name || '-'} / ${props.toStop?.name || '-'}</span></div>
                ${props.vehicleWillBePutAway === true ? `<div class="detail-row"><span class="detail-label">Wird abgestellt in:</span> <span class="detail-value">${stopLabel(props.toStop?.uic, props.toStop?.name)}</span></div>` : ''}
                ${props.trolleyStatus && props.trolleyStatus !== 'Normal' ? `<div class="detail-row"><span class="detail-label">Zustand:</span> <span class="detail-value">${props.trolleyStatus}</span></div>` : ''}
                <div class="detail-row"><span class="detail-label">Länge:</span> <span class="detail-value">${props.length || '-'} m</span></div>
                <div class="detail-row"><span class="detail-label">Sektoren:</span> <span class="detail-value">${stopData?.sectors || '-'}</span></div>
            </div>

            <div class="detail-group">
                <div class="detail-group-title">Plätze</div>
                <div class="detail-row"><span class="detail-label">1. Klasse:</span> <span class="detail-value">${props.number1class || 0}</span></div>
                <div class="detail-row"><span class="detail-label">2. Klasse:</span> <span class="detail-value">${props.number2class || 0}</span></div>
                <div class="detail-row"><span class="detail-label">Restaurant:</span> <span class="detail-value">${props.numberRestaurantSpace || 0}</span></div>
                <div class="detail-row"><span class="detail-label">Betten:</span> <span class="detail-value">${props.numberBeds || 0}</span></div>
            </div>

            <div class="detail-group">
                <div class="detail-group-title">Barrierefreiheit</div>
                <div class="detail-row"><span class="detail-label">Rollstuhlplätze:</span> <span class="detail-value">${accessibility.numberWheelchairSpaces || 0}</span></div>
                <div class="detail-row"><span class="detail-label">1. Kl. Rollstuhl:</span> <span class="detail-value">${accessibility.numberWheelchairSpaces1class || 0}</span></div>
                <div class="detail-row"><span class="detail-label">2. Kl. Rollstuhl:</span> <span class="detail-value">${accessibility.numberWheelchairSpaces2class || 0}</span></div>
                <div class="detail-row"><span class="detail-label">Behindertenkompartiment:</span> <span class="detail-value">${accessibility.disabledCompartment ? '✓' : '✗'}</span></div>
            </div>

            <div class="detail-group">
                <div class="detail-group-title">Einstieg & WC</div>
                <div class="detail-row"><span class="detail-label">Klapprampe:</span> <span class="detail-value">${accessibility.wheelchairSymbolProperties?.foldingRamp ? '✓' : '✗'}</span></div>
                <div class="detail-row"><span class="detail-label">Brückenlösung:</span> <span class="detail-value">${accessibility.wheelchairSymbolProperties?.gapBridging ? '✓' : '✗'}</span></div>
                <div class="detail-row"><span class="detail-label">Einstiegshöhe:</span> <span class="detail-value">${accessibility.wheelchairSymbolProperties?.heightBoardingPlatform || 0} cm</span></div>
                <div class="detail-row"><span class="detail-label">Rollstuhl-WC:</span> <span class="detail-value">${accessibility.wheelchairToilet ? '✓' : '✗'}</span></div>
            </div>

            <div class="detail-group">
                <div class="detail-group-title">Ausstattung</div>
                <div class="detail-row"><span class="detail-label">Klima:</span> <span class="detail-value">${props.climated ? '✓' : '✗'}</span></div>
                <div class="detail-row"><span class="detail-label">Velo-Plattform:</span> <span class="detail-value">${props.bikePlatform ? '✓' : '✗'}</span></div>
                <div class="detail-row"><span class="detail-label">Notrufsystem:</span> <span class="detail-value">${props.emergencyCallSystem ? '✓' : '✗'}</span></div>
                <div class="detail-row"><span class="detail-label">Niederflur Wagen:</span> <span class="detail-value">${props.lowFloorTrolley ? '✓' : '✗'}</span></div>
            </div>

            <div class="detail-group">
                <div class="detail-group-title">Piktogramme</div>
                <div class="detail-row"><span class="detail-label">Velo:</span> <span class="detail-value">${props.pictoProperties?.bikePicto ? '✓' : '✗'}</span></div>
                <div class="detail-row"><span class="detail-label">Familie:</span> <span class="detail-value">${props.pictoProperties?.familyZonePicto ? '✓' : '✗'}</span></div>
                <div class="detail-row"><span class="detail-label">Business:</span> <span class="detail-value">${props.pictoProperties?.businessZonePicto ? '✓' : '✗'}</span></div>
                <div class="detail-row"><span class="detail-label">Kinderwagen:</span> <span class="detail-value">${props.pictoProperties?.strollerPicto ? '✓' : '✗'}</span></div>
                <div class="detail-row"><span class="detail-label">Rollstuhl:</span> <span class="detail-value">${props.pictoProperties?.wheelchairPicto ? '✓' : '✗'}</span></div>
            </div>
        </div>
    `;

    document.getElementById('modal-body').innerHTML = html;
    
    // Overlay anzeigen
    const overlay = document.getElementById('modal-overlay');
    overlay.classList.add('active');
}

function formatTime(timeString) {
    try {
        const date = new Date(timeString);
        return date.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' });
    } catch {
        return '-';
    }
}