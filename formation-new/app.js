import { fetchTripInfo } from '../trip/trip-api-client.js';

let tripRefreshTimer = null;
let tripRefreshRunning = false;

function updateClock() {
    const el = document.getElementById('live-clock');
    if (!el) return;
    const now = new Date();
    el.textContent = now.toLocaleTimeString('de-CH');
}

function closeModal() {
    document.getElementById('modal-overlay')?.classList.remove('active');
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
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') closeModal();
    });

    const trainInput = document.getElementById('trainNumber');
    const evuSelect = document.getElementById('evu');
    const urlParams = new URLSearchParams(window.location.search);
    
    const trainParam = urlParams.get('train');
    const evuParam = urlParams.get('evu');
    const sjyidParam = urlParams.get('sjyid');

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
    }
});

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

                    // Rate Limit erkannt
                    const errorMessage = typeof data.error === 'string'
                        ? data.error
                        : data.error?.message;
                    if (errorMessage?.includes('Rate Limit')) {
                        rateLimitHit = true;
                        continue;
                    }

                    // Andere Fehler ignorieren (z.B. "There were no formation data.")
                    if (data.error) continue;

                    if (data.formations && data.formations.length > 0) {
                        foundData = data;
                        successfulEvu = operator;
                        break;
                    }
                }
            } catch (jsonError) {
                console.warn(`Kein JSON bei ${operator}`);
            }
        } catch (error) {
            console.warn(`Fehler bei ${operator}`);
        }
    }

    if (!foundData) {
        if (rateLimitHit) {
            resultDiv.innerHTML = `<div class="error-message">⚠ API Rate Limit erreicht. Bitte versuchen Sie es in einer Minute erneut.</div>`;
        } else {
            resultDiv.innerHTML = `<div class="error-message">❌ Keine Formationsdaten gefunden.</div>`;
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
            name: point.name || '-',
            uic: point.uic,
            index,
            arrivalTime: entry.stopTime?.arrivalTime,
            departureTime: entry.stopTime?.departureTime,
            track: entry.track,
            formationShort: entry.formationShort || {},
            vehicleGoals: entry.formationShort?.vehicleGoals || []
        };
    });

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
        rows: createMasterRows(trip, stops),
        metaInformation: foundData.metaInformation || {},
        hints: foundData.hints,
        relationships: foundData.relationships || []
    };

    updateRelatedJourneys(foundData.relationships || []);

    renderStopChain();
    startTripRefresh();
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
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) refreshTrip();
    });
    window.addEventListener('resize', () => {
        if (!document.hidden) updateTripRows(window.formationData.trip);
    });
    window.addEventListener('pagehide', stopTripRefresh);
}

function createMasterRows(trip, stops) {
    if (!trip?.stops?.length) {
        return stops.map((stop, fIdx) => ({
            name: stop.name,
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
            return (ref && Number(ref) === Number(stop.uic) % 100000)
                || row.name?.trim().toLowerCase() === stop.name?.trim().toLowerCase();
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

    const previousJourney = relationships.find((relationship) =>
        relationship.vehicleRelationshipDetails?.direction === 'V'
    );
    const nextJourney = relationships.find((relationship) =>
        relationship.vehicleRelationshipDetails?.direction === 'N'
    );

    // Vorherige Fahrt verarbeiten
    const prevMeta = previousJourney?.advancedJourneyInformation1?.trainMetaInformation;
    const prevNumber = prevMeta?.trainNumber;
    const prevToCode = prevMeta?.toCode;
    const prevElement = document.getElementById('previousTrainNumber');
    
    if (prevNumber) {
        prevElement.textContent = prevNumber;
        let prevUrl = `./?train=${encodeURIComponent(prevNumber)}`;
        if (prevToCode && toCodeMap[prevToCode]) {
            prevUrl += `&evu=${encodeURIComponent(toCodeMap[prevToCode])}`;
        }
        prevElement.href = prevUrl;
    } else {
        prevElement.textContent = '-';
        prevElement.removeAttribute('href');
    }

    // Nachfolgende Fahrt verarbeiten
    const nextMeta = nextJourney?.advancedJourneyInformation1?.trainMetaInformation;
    const nextNumber = nextMeta?.trainNumber;
    const nextToCode = nextMeta?.toCode;
    const nextElement = document.getElementById('nextTrainNumber');

    if (nextNumber) {
        nextElement.textContent = nextNumber;
        let nextUrl = `./?train=${encodeURIComponent(nextNumber)}`;
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
const FORMATION_ATTRIBUTES = new Set(['NF', 'VH', 'KW', 'BHP']);

function parseFormationShort(value) {
    if (!value) return [];
    const normalized = String(value).replace(/@([A-Z]+)/g, ',$1,').replace(/,{2,}/g, ',');
    const result = [];
    const stack = [[]];
    let sector = '';
    const addToken = (token, inherited = []) => {
        const clean = token.trim();
        if (!clean || clean === 'F' || clean === '(' || clean === '[') return;
        if (clean.startsWith('@')) {
            sector = clean.slice(1);
            return;
        }
        if (clean === ')' || clean === ']') return;
        const [classPart, attrPart] = clean.split('#');
        const classes = classPart.replace(/[^12]/g, '');
        if (!classes && !attrPart) return;
        const attrs = new Set(inherited);
        (attrPart || '').split(';').filter(Boolean).forEach((attr) => {
            if (!FORMATION_ATTRIBUTES.has(attr)) {
                if (!UNKNOWN_ATTRIBUTES.has(attr)) {
                    UNKNOWN_ATTRIBUTES.add(attr);
                    console.warn(`Unbekanntes Formationsattribut: ${attr}`);
                }
            }
            attrs.add(attr);
        });
        result.push({ classes: classes === '21' ? '12' : classes, attrs, sector });
    };
    const tokens = normalized.split(/([()[\],])/).filter(Boolean);
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i].trim();
        if (token === '(' || token === '[') {
            stack.push([]);
        } else if (token === ')' || token === ']') {
            const inherited = stack.pop() || [];
            const following = tokens[i + 1]?.trim() || '';
            const attrs = following.startsWith('#') ? following.slice(1).split(';') : [];
            if (attrs.length) i++;
            result.forEach((wagon) => {
                if (wagon.attrs === inherited) attrs.forEach((attr) => wagon.attrs.add(attr));
            });
        } else if (token !== ',') {
            addToken(token, stack.at(-1));
        }
    }
    return result;
}

function stopEntryFor(vehicle, stop) {
    return (vehicle.formationVehicleAtScheduledStops || []).find((entry) =>
        entry.stopPoint?.uic === stop.uic
    );
}

function formationCoversStop(vehicle, stop, stopIndex) {
    const props = vehicle.vehicleProperties || {};
    const from = props.fromStop?.uic;
    const to = props.toStop?.uic;
    const fromIndex = stopsIndexByUic(from);
    const toIndex = stopsIndexByUic(to);
    return fromIndex <= stopIndex && stopIndex <= toIndex;
}

function stopsIndexByUic(uic) {
    return window.formationData.stops.findIndex((stop) => stop.uic === uic);
}

function formationForStop(stopIdx) {
    const stop = window.formationData.stops[stopIdx];
    for (let fIdx = window.formationData.formations.length - 1; fIdx >= 0; fIdx--) {
        const formation = window.formationData.formations[fIdx];
        const vehicles = (formation.formationVehicles || []).filter((vehicle) =>
            formationCoversStop(vehicle, stop, stopIdx) && stopEntryFor(vehicle, stop)
        );
        if (vehicles.length) return { formation, vehicles };
    }
    return { formation: null, vehicles: [] };
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
    return `<span class="delay-badge">${sign}${Math.floor(absolute / 60)}:${String(absolute % 60).padStart(2, '0')}</span>`;
}

function accessIcon(type) {
    return type ? `<span class="access-icon" title="${type}">♿</span>` : '';
}

function timeRow(value, estimated, delay, kind) {
    return `<div class="time-row" data-tt="${value || ''}" data-est="${estimated || ''}" data-delay="${delay || 0}">
        <span class="ps-time ps-time--${kind}">${fmtTime(value) || '--:--'}</span>${delayLabel(delay)}
    </div>`;
}

function renderStopChain() {
    const { stops, rows } = window.formationData;
    const chain = document.getElementById('stopChain');
    chain.innerHTML = rows.map((row, idx) => {
        const fIdx = row.fIdx;
        const stop = fIdx === undefined ? row : stops[fIdx];
        const isFirst = idx === 0;
        const isLast = idx === rows.length - 1;
        const arrival = row.arrival?.timetabled || stop.arrivalTime;
        const departure = row.departure?.timetabled || stop.departureTime;
        const times = isFirst
            ? timeRow(departure, row.departure?.estimated, row.departure?.delaySec, 'dep')
            : isLast
                ? timeRow(arrival, row.arrival?.estimated, row.arrival?.delaySec, 'arr')
                : `${timeRow(arrival, row.arrival?.estimated, row.arrival?.delaySec, 'arr')}${timeRow(departure, row.departure?.estimated, row.departure?.delaySec, 'dep')}`;
        const quay = fIdx !== undefined ? stops[fIdx].track : row.quay;
        const link = `https://nowe.stellwerksim.ch/?stop=${encodeURIComponent(row.stopPointRef || row.name)}&date=${encodeURIComponent(document.getElementById('date').value)}${arrival ? `&time=${encodeURIComponent(formatTime(arrival))}` : ''}`;
        const rowBody = `<span class="chain-stop-text"><a href="${link}" onclick="event.preventDefault(); event.stopPropagation(); window.location.href=this.href">${row.name}</a>${accessIcon(row.accessibility)}${row.requestStop ? '<b class="hav-badge">HaV</b>' : ''}<small>Gl. ${quay || '-'}</small></span>`;
        return `
            <section class="formation-stop" data-stop-index="${fIdx ?? ''}" data-row-index="${idx}">
                <button class="formation-stop-row" type="button" ${fIdx === undefined ? 'disabled' : `onclick="toggleStop(${fIdx})"`}>
                    <span class="chain-times">${times}</span>
                    <span class="chain-marker"><span class="chain-dot"></span></span>
                    ${rowBody}
                    ${fIdx === undefined ? '' : '<span class="stop-arrow" aria-hidden="true">›</span>'}
                </button>
                ${fIdx === undefined ? '' : `<div class="formation-panel" id="formation-panel-${fIdx}"></div>`}
            </section>`;
    }).join('');

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

function stopFormationData(stopIdx) {
    const stop = window.formationData.stops[stopIdx];
    const firstVehicleStop = stop ? stopEntryFor(formationForStop(stopIdx).vehicles[0], stop) : null;
    return firstVehicleStop || {
        track: stop?.track,
        stopTime: { arrivalTime: stop?.arrivalTime, departureTime: stop?.departureTime }
    };
}

function renderFormationStrip(stopIdx) {
    const { vehicles, formation } = formationForStop(stopIdx);
    const stop = window.formationData.stops[stopIdx];
    const parserData = parseFormationShort(stop.formationShort?.formationShortString);
    const parsed = parserData.length === vehicles.length ? parserData : [];
    if (parserData.length && !parsed.length) {
        console.warn('FormationShort und Wagenanzahl stimmen nicht überein.');
    }
    const available = vehicles.map((vehicle, index) => ({
        vehicle,
        stopData: stopEntryFor(vehicle, stop),
        index
    })).filter(item => item.stopData);
    const ordered = orderedFormation(available.map((item) => item.vehicle), parsed)
        .map((item) => ({ ...available[item.sourceIndex], parsed: item.parsed }));
    const sectors = [];
    ordered.forEach((item, index) => {
        const sector = item.parsed?.sector || (item.stopData.sectors || '').charAt(0);
        const previous = sectors[sectors.length - 1];
        if (previous && previous.sector === sector) previous.count++;
        else sectors.push({ sector, count: 1 });
    });
    const sectorHtml = sectors.map(group => `<span class="sector-group" style="--span:${group.count}">${group.sector ? `<b><span>Sektor ${group.sector}</span></b>` : ''}</span>`).join('');
    const goals = stop.vehicleGoals || [];
    const direction = goals.length === 1 ? `← Richtung ${goals[0].toStop?.name || goals[0].name || goals[0]}` : '';
    const wagonHtml = ordered.map((item, index) => renderWagon(item.vehicle, item.stopData, item.index, index, ordered, stopIdx)).join('');
    const meta = window.formationData.metaInformation || {};
    const lastUpdate = meta.lastUpdate ? formatTime(meta.lastUpdate) : '';
    const hints = window.formationData.hints;
    return `<div class="formation-strip" style="--wagon-count:${ordered.length}">
        <div class="sector-bar">${sectorHtml}</div>
        ${direction ? `<div class="formation-direction">${direction}</div>` : ''}
        <div class="wagon-row">${wagonHtml}</div>
        <div class="formation-meta">
            ${meta.length ? `Länge ${meta.length} m` : ''}${meta.numberSeats ? ` · ${meta.numberSeats} Sitzplätze` : ''}${lastUpdate ? ` · Stand ${lastUpdate}` : ''}
        </div>
        ${hints ? `<div class="formation-hints">${Array.isArray(hints) ? hints.map(hint => `<span>${typeof hint === 'string' ? hint : JSON.stringify(hint)}</span>`).join('') : JSON.stringify(hints)}</div>` : ''}
    </div>`;
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
    const props = vehicle.vehicleProperties || {};
    const accessibility = props.accessibilityProperties || {};
    const parsed = ordered[index].parsed;
    const classes = parsed?.classes || `${props.number1class > 0 ? '1' : ''}${props.number2class > 0 ? '2' : ''}`;
    const hasSeats = props.number1class > 0 || props.number2class > 0 || props.numberRestaurantSpace > 0;
    const transitionOpen = index === 0 || ordered[index].stopData.accessToPreviousVehicle !== false;
    const badges = props.numberRestaurantSpace > 0 ? '<span class="restaurant-badge">R</span>' :
        `${classes.includes('1') ? '<span class="class-badge first">1</span>' : ''}${classes.includes('2') ? '<span class="class-badge second">2</span>' : ''}`;
    const icons = [
        (parsed?.attrs.has('BHP') || accessibility.numberWheelchairSpaces > 0 || accessibility.wheelchairToilet || props.pictoProperties?.wheelchairPicto) ? iconSvg('wheelchair') : '',
        (parsed?.attrs.has('VH') || props.bikePlatform || props.pictoProperties?.bikePicto) ? '🚲' : '',
        (parsed?.attrs.has('KW') || props.pictoProperties?.strollerPicto) ? iconSvg('stroller') : '',
        (parsed?.attrs.has('NF') || props.lowFloorTrolley) ? '<strong>NF</strong>' : ''
    ].filter(Boolean).join('');
    const number = Number(vehicle.number) > 0 ? vehicle.number : '';
    const status = props.closed === true ? 'gesperrt' : props.vehicleWillBePutAway === true ? 'wird abgehängt' : '';
    return `<div class="wagon-unit">
        <button class="wagon-card ${!hasSeats ? 'wagon-empty' : ''} ${props.numberRestaurantSpace > 0 ? 'wagon-restaurant' : ''} ${props.closed === true ? 'wagon-closed' : ''}" type="button" onclick="event.stopPropagation(); showDetails(window.formationData.formations[${window.formationData.formations.findIndex(f => f.formationVehicles?.includes(vehicle))}].formationVehicles[${vIdx}], window.formationData.stops[${stopIdx}], ${vIdx})">
            <span class="wagon-class-bar"></span><span class="wagon-badges">${badges}</span><span class="wagon-number">${number}</span>${status ? `<small class="wagon-status">${status}</small>` : ''}
        </button>
        <span class="wagon-icons">${icons}</span>
        ${index < ordered.length - 1 ? `<span class="wagon-connection ${transitionOpen ? '' : 'is-closed'}">${transitionOpen ? '' : '✕'}</span>` : ''}
    </div>`;
}

function showDetails(vehicle, stopData, vIdx) {
    const props = vehicle.vehicleProperties || {};
    const accessibility = props.accessibilityProperties || {};

    // Die "vehicle.number" entspricht der Anzeigennummer (Perron), 
    // "vehicle.position" ist die physische Reihung (z.B. 1. Wagen ab Lok).
    let html = `
        <div class="modal-title">
            <div class="modal-title-main">${vehicle.vehicleIdentifier.typeCodeName}</div>
            <div class="modal-title-meta">
                <span class="modal-badges">${props.number1class > 0 ? '<span class="class-badge first">1</span>' : ''}${props.number2class > 0 ? '<span class="class-badge second">2</span>' : ''}${props.numberRestaurantSpace > 0 ? '<span class="restaurant-badge">R</span>' : ''}${accessibility.numberWheelchairSpaces > 0 || accessibility.wheelchairToilet ? iconSvg('wheelchair') : ''}${props.bikePlatform ? '🚲' : ''}${props.pictoProperties?.strollerPicto ? iconSvg('stroller') : ''}${props.lowFloorTrolley ? '<strong>NF</strong>' : ''}</span>
                ${Number(vehicle.number) > 0 ? `Wagen ${vehicle.number}` : ''} (Pos. ${vehicle.position || '-'})
                ${props.closed === true ? '<span class="wagon-status">gesperrt</span>' : ''}${props.vehicleWillBePutAway === true ? '<span class="wagon-status">wird abgehängt</span>' : ''}
            </div>
        </div>

        <div class="modal-grid">
            <div class="detail-group">
                <div class="detail-group-title">Allgemein</div>
                <div class="detail-row"><span class="detail-label">Wagennummer:</span> <span class="detail-value">${vehicle.number || '-'}</span></div>
                <div class="detail-row"><span class="detail-label">Physische Position:</span> <span class="detail-value">${vehicle.position || '-'}</span></div>
                <div class="detail-row"><span class="detail-label">Tech. Wagennr.:</span> <span class="detail-value">${vehicle.vehicleIdentifier?.vehicleNumber || '-'}</span></div>
                <div class="detail-row"><span class="detail-label">EVN:</span> <span class="detail-value detail-value--small">${vehicle.vehicleIdentifier?.evn || '-'}</span></div>
                ${vehicle.vehicleIdentifier?.parentEvn ? `<div class="detail-row"><span class="detail-label">Parent-EVN:</span> <span class="detail-value detail-value--small">${vehicle.vehicleIdentifier.parentEvn}</span></div>` : ''}
                <div class="detail-row"><span class="detail-label">Velohaken:</span> <span class="detail-value">${props.numberBikeHooks || 0}</span></div>
                <div class="detail-row"><span class="detail-label">Verkehrt ab/bis:</span> <span class="detail-value">${props.fromStop?.name || '-'} / ${props.toStop?.name || '-'}</span></div>
                ${props.trolleyStatus && props.trolleyStatus !== 'Normal' ? `<div class="detail-row"><span class="detail-label">Zustand:</span> <span class="detail-value">${props.trolleyStatus}</span></div>` : ''}
                <div class="detail-row"><span class="detail-label">Länge:</span> <span class="detail-value">${props.length || '-'} m</span></div>
                <div class="detail-row"><span class="detail-label">Sektoren:</span> <span class="detail-value">${stopData.sectors || '-'}</span></div>
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