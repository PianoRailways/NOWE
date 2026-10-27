import { fetchTripInfo } from './trip-api-client.js';

// ─── DOM-Refs ─────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
let activeTrip = null;
let positionTimer = null;
let positionRequestRunning = false;
let positionErrorShown = false;
let positionRequestKey = 0;

// ─── Uhr ──────────────────────────────────────────────────────────────────────
function updateClock() {
    const el = $('live-clock'); // Diese Zeile muss existieren
    if (!el) return;
    const now = new Date();
    el.textContent =
        String(now.getHours()).padStart(2,'0') + ':' +
        String(now.getMinutes()).padStart(2,'0') + ':' +
        String(now.getSeconds()).padStart(2,'0');
}

// ─── Status ───────────────────────────────────────────────────────────────────
function showStatus(msg, type = 'info') {
    const el = $('trip-status');
    if (!el) return;
    el.textContent = msg;
    el.className = `trip-status trip-status--${type}`;
}

// ─── Zeit-Formatierung ────────────────────────────────────────────────────────

// ISO-String (lokal, kein Z) → "HH:MM"
function fmtTime(iso) {
    if (!iso) return null;
    const m = iso.match(/T(\d{2}):(\d{2})/);
    return m ? `${m[1]}:${m[2]}` : null;
}

// Delay-Label für inline-Anzeige (z.B. "+1:23" oder "−0:45")
function delayLabel(sec) {
    if (sec === null || sec === undefined || sec === 0) return '';
    
    const sign   = sec > 0 ? '+' : '−';
    const absSec = Math.abs(sec);
    const min    = Math.floor(absSec / 60);
    const s      = absSec % 60;
    
    // Einheitliches Format M:SS (z.B. +0:06 oder −1:15)
    const label = `${sign}${min}:${String(s).padStart(2, '0')}`;
    
    // Dynamische Klasse je nach Abweichung
    const cls = sec > 0 ? 'delay-badge delay-badge--late' : 'delay-badge delay-badge--early';
    
    return `<span class="${cls}">${label}</span>`;
}

// ─── Rollstuhl-Icon ───────────────────────────────────────────────────────────
function accessIcon(type) {
    if (type === 'ACCESSIBLE')    return '<span class="access-icon access-icon--ok"    title="Einstieg ohne Hilfe">♿</span>';
    if (type === 'ASSISTANCE')    return '<span class="access-icon access-icon--assist"    title="Einstieg mit Hilfe">♿️🧑🏼</span>';
    if (type === 'ALT_TRANSPORT') return '<span class="access-icon access-icon--alt"   title="Ersatztransport">🚌</span>';
    if (type === 'NOTIFY')        return '<span class="access-icon access-icon--notify"   title="Hilfe auf Anfrage">📞</span>';
    if (type === 'NO_BEHIG')      return '<span class="access-icon access-icon--no"   title="Nicht rollstuhlgänglich">🔺</span>';
    
    return '';
}

// ─── Trip laden ───────────────────────────────────────────────────────────────
async function loadTrip() {
    stopPositionUpdates();
    activeTrip = null;
    positionRequestKey += 1;

    const journeyId   = $('trip-input')?.value.trim();
    const operatingDay = $('trip-date')?.value || null;

    if (!journeyId) {
        showStatus('Bitte SwissJourneyID eingeben.', 'error');
        return;
    }

    showStatus('Lade Fahrtdetails…', 'info');
    $('trip-board').innerHTML = '';

    try {
        const trip = await fetchTripInfo(journeyId, operatingDay);
        if (!trip || !trip.stops?.length) {
            showStatus('Keine Fahrtdaten gefunden.', 'error');
            return;
        }
        
        renderTrip(trip);
        activeTrip = trip;
        positionErrorShown = false;
        const initialPosition = updateVehiclePosition(trip);
        if (!initialPosition?.isFinal) startPositionUpdates();
        showStatus(`${trip.category} ${trip.line}  ·  Fahrtnummer ${trip.trainNumber}  ·  ${trip.stops.length} Halte`, 'success');

        // URL in der Adresszeile aktualisieren, ohne die Seite neu zu laden
        const url = new URL(window.location.href);
        url.searchParams.set('sjyid', journeyId);
        if (operatingDay) {
            url.searchParams.set('date', operatingDay);
        } else {
            url.searchParams.delete('date');
        }
        window.history.replaceState({}, '', url.toString());

    } catch (err) {
        showStatus(`Fehler: ${err.message}`, 'error');
        console.error(err);
    }
}

// ─── Fahrt-Header mit Line-Badge ──────────────────────────────────────────────
function renderHeader(trip) {
    const lineType = trip.category.replace(/[0-9\s]/g, '').trim();
    return `
        <div class="trip-header">
            <div class="line-container">
                <span class="line-badge" data-type="${lineType}">${trip.line}</span>
                <span class="trip-header__num">${trip.trainNumber}</span>
            </div>
            <span class="trip-header__dest">→ ${trip.destination}</span>
        </div>
    `;
}

// ─── Chain-ähnliche Perlschnur (wie Abfahrtstabelle) mit Ausfällen ──────────
// ─── Chain-ähnliche Perlschnur (wie Abfahrtstabelle) mit Ausfällen ──────────
function renderPerlschnur(trip) {
    let html = '<div class="chain">';
    
    trip.stops.forEach((stop, idx) => {
        const isFirst = idx === 0;
        const isLast  = idx === trip.stops.length - 1;
        const isThisStop = stop.isThisCall;

        // Zeiten (nur HH:MM, ohne Sekunden)
        const arrTT  = fmtTime(stop.arrival?.timetabled);
        const arrEst = fmtTime(stop.arrival?.estimated);
        const depTT  = fmtTime(stop.departure?.timetabled);
        const depEst = fmtTime(stop.departure?.estimated);

        // Datum und Uhrzeit für die URL extrahieren
        const arrivalIso = stop.arrival?.timetabled;
        const arrivalDate = arrivalIso ? arrivalIso.split('T')[0] : null;
        const arrivalTimeForUrl = arrTT;

        // Verspätungs-/Verfrühungs-Badges
        const arrDelay = delayLabel(stop.arrival?.delaySec);
        const depDelay = delayLabel(stop.departure?.delaySec);

        // HTML für Zeitspalte (mit SOLL-Zeiten im Span & Data-Attributen für Prognose-Klick)
        let timesHtml = '';
        if (isFirst) {
            timesHtml = `<div class="chain-times">
                <div class="time-row" data-tt="${depTT ?? ''}" data-est="${depEst ?? ''}" data-delay="${stop.departure?.delaySec ?? 0}" style="cursor: pointer;" title="Klicken für Prognosezeit">
                    <span class="ps-time ps-time--dep">${depTT ?? '--:--'}</span>
                    ${depDelay}
                </div>
            </div>`;
        } else if (isLast) {
            timesHtml = `<div class="chain-times">
                <div class="time-row" data-tt="${arrTT ?? ''}" data-est="${arrEst ?? ''}" data-delay="${stop.arrival?.delaySec ?? 0}" style="cursor: pointer;" title="Klicken für Prognosezeit">
                    <span class="ps-time ps-time--arr">${arrTT ?? '--:--'}</span>
                    ${arrDelay}
                </div>
            </div>`;
        } else {
            timesHtml = `<div class="chain-times">
                <div class="time-row" data-tt="${arrTT ?? ''}" data-est="${arrEst ?? ''}" data-delay="${stop.arrival?.delaySec ?? 0}" style="cursor: pointer;" title="Klicken für Prognosezeit">
                    <span class="ps-time ps-time--arr">${arrTT ?? '--:--'}</span>
                    ${arrDelay}
                </div>
                <div class="time-row" data-tt="${depTT ?? ''}" data-est="${depEst ?? ''}" data-delay="${stop.departure?.delaySec ?? 0}" style="cursor: pointer;" title="Klicken für Prognosezeit">
                    <span class="ps-time ps-time--dep">${depTT ?? '--:--'}</span>
                    ${depDelay}
                </div>
            </div>`;
        }

        // Dot-Spalte
        const dotClass = isFirst ? 'ps-dot ps-dot--first'
                       : isLast  ? 'ps-dot ps-dot--last'
                       : 'ps-dot';

        const dotHtml = `<div class="chain-dot-col">
            <div class="ps-line-wrap">
                ${!isFirst ? '<div class="ps-line ps-line--top"></div>' : ''}
                <div class="${dotClass}"></div>
                ${!isLast  ? '<div class="ps-line ps-line--bot"></div>' : ''}
            </div>
        </div>`;

        // Name + Quay unter dem Namen
        const quayLine = stop.quay ? `<div class="ps-quay-line">Gl. ${stop.quay}</div>` : '';
        
        // Nutzt die ID (z.B. "ch:1:sloid:8100:2:3")
        const stopParam = stop.stopPointRef || stop.name;
        
        // Datum + Zeit mit übergeben
        const stsUrl = arrivalDate && arrivalTimeForUrl
            ? `https://nowe.stellwerksim.ch/?stop=${encodeURIComponent(stopParam)}&date=${encodeURIComponent(arrivalDate)}&time=${encodeURIComponent(arrivalTimeForUrl)}`
            : `https://nowe.stellwerksim.ch/?stop=${encodeURIComponent(stopParam)}`;

        // Request Stop Badge (Halt auf Verlangen)
        const requestStopBadge = stop.requestStop
            ? '<span style="border:1.5px solid var(--sbb-red); color:var(--sbb-red); font-size:0.72em; margin-left:6px; font-weight:bold; padding:1px 6px; border-radius:3px; letter-spacing:0.03em;">HaV</span>'
            : '';

        // Wechselt die URL direkt im selben Fenster
        const chainInfo = `<div class="chain-info">
            <span class="chain-name">
                <a href="${stsUrl}">${stop.name}</a> ${accessIcon(stop.accessibility)}${requestStopBadge}
            </span>
            ${quayLine}
        </div>`;

        const rowClass = isThisStop ? 'chain-stop this-call' : 'chain-stop';
        html += `
            <div class="${rowClass}" data-stop-index="${idx}">
                ${timesHtml}
                ${dotHtml}
                ${chainInfo}
            </div>
        `;

        // ── Ausfälle für diesen Stop ──────────────────────────────────────
        if (trip.situations) {
            for (const [sitId, sit] of Object.entries(trip.situations)) {
                // Prüfe, ob dieser Stop betroffen ist
                const isAffected = sit.affectedStops.includes(stop.stopPointRef) 
                                || sit.affectedStops.includes(stop.name);
                
                if (isAffected && sit.summary) {
                    const severityClass = sit.severity.toLowerCase() === 'störung' 
                                        ? 'situation-alert--disruption'
                                        : 'situation-alert--warning';
                    
                    html += `
                        <div class="situation-alert ${severityClass}">
                            <span class="situation-icon">⚠</span>
                            <span class="situation-text">${sit.summary}</span>
                        </div>
                    `;
                }
            }
        }
    });

    html += '</div>';
    return html;
}

// ─── Haupt-Render ─────────────────────────────────────────────────────────────
function renderTrip(trip) {
    const board = $('trip-board');
    if (!board) return;
    board.innerHTML = renderHeader(trip) + renderPerlschnur(trip);
}

// Klick-Handler für den 5-Sekunden-Wechsel auf Prognosezeit
document.addEventListener('click', (e) => {
    const timeRow = e.target.closest('.time-row');
    if (!timeRow) return;

    const timeSpan = timeRow.querySelector('.ps-time');
    const badgeSpan = timeRow.querySelector('.delay-badge');

    const ttTime = timeRow.dataset.tt;
    const estTime = timeRow.dataset.est;

    if (!estTime || estTime === ttTime) return;

    // Falls bereits im Prognose-Modus, Timer zurücksetzen
    if (timeRow.dataset.mode === 'estimated') {
        clearTimeout(timeRow._timeoutId);
    } else {
        // Auf Prognose umschalten, Verspätungs-Badge verstecken
        timeRow.dataset.mode = 'estimated';
        if (timeSpan) timeSpan.textContent = estTime;
        if (badgeSpan) badgeSpan.style.display = 'none';
    }

    // Nach 5 Sekunden automatisch zurücksetzen
    timeRow._timeoutId = setTimeout(() => {
        timeRow.dataset.mode = 'timetabled';
        if (timeSpan) timeSpan.textContent = ttTime || '--:--';
        if (badgeSpan) badgeSpan.style.display = '';
        delete timeRow._timeoutId;
    }, 5000);
});

function updateStopTimes(row, stop) {
    const arrTT = fmtTime(stop.arrival?.timetabled);
    const arrEst = fmtTime(stop.arrival?.estimated);
    const depTT = fmtTime(stop.departure?.timetabled);
    const depEst = fmtTime(stop.departure?.estimated);

    const timeRows = row.querySelectorAll('.time-row');
    timeRows.forEach((timeRow) => {
        const isDep = timeRow.querySelector('.ps-time--dep');
        const tt = isDep ? depTT : arrTT;
        const est = isDep ? depEst : arrEst;
        const delay = isDep ? stop.departure?.delaySec : stop.arrival?.delaySec;

        timeRow.dataset.tt = tt || '';
        timeRow.dataset.est = est || '';
        timeRow.dataset.delay = delay ?? 0;

        // Nur aktualisieren, wenn der Benutzer gerade nicht in der 5-Sekunden-Ansicht ist
        if (timeRow.dataset.mode !== 'estimated') {
            const timeSpan = timeRow.querySelector('.ps-time');
            if (timeSpan) timeSpan.textContent = tt ?? '--:--';

            timeRow.querySelector('.delay-badge')?.remove();
            const badge = delayLabel(delay);
            if (badge) timeRow.insertAdjacentHTML('beforeend', badge);
        }
    });
}

function updatePerlschnurTimes(trip) {
    document.querySelectorAll('.chain-stop[data-stop-index]').forEach(row => {
        const index = Number(row.dataset.stopIndex);
        const stop = trip.stops[index];
        if (stop) updateStopTimes(row, stop);
    });
}

function removeVehicleMarker() {
    document.querySelector('.vehicle-position-marker')?.remove();
}

function updateVehicleMarker(trip) {
    const chain = document.querySelector('.chain');
    const position = globalThis.calculateVehiclePosition?.(trip.stops, new Date(), trip);
    if (!chain || !position) {
        removeVehicleMarker();
        return;
    }

    const stopRows = [...chain.querySelectorAll('.chain-stop[data-stop-index]')];
    const rowForIndex = index => stopRows.find(row => Number(row.dataset.stopIndex) === index);
    const currentDot = rowForIndex(position.stopIndex)?.querySelector('.ps-dot');
    if (!currentDot) {
        removeVehicleMarker();
        return;
    }

    const chainRect = chain.getBoundingClientRect();
    const currentRect = currentDot.getBoundingClientRect();
    let x = currentRect.left + currentRect.width / 2 - chainRect.left;
    let y = currentRect.top + currentRect.height / 2 - chainRect.top;
    const nextDot = position.nextStopIndex === undefined
        ? null
        : rowForIndex(position.nextStopIndex)?.querySelector('.ps-dot');
    if (nextDot && Number.isFinite(position.progress)) {
        const nextRect = nextDot.getBoundingClientRect();
        const nextX = nextRect.left + nextRect.width / 2 - chainRect.left;
        const nextY = nextRect.top + nextRect.height / 2 - chainRect.top;
        x += (nextX - x) * position.progress;
        y += (nextY - y) * position.progress;
    }

    let marker = chain.querySelector('.vehicle-position-marker');
    if (!marker) {
        marker = document.createElement('div');
        marker.className = 'vehicle-position-marker';
        chain.appendChild(marker);
    }
    marker.style.left = `${x}px`;
    marker.style.top = `${y}px`;
    const currentName = trip.stops[position.stopIndex]?.name || 'Halt';
    const nextName = position.nextStopIndex === undefined ? '' : trip.stops[position.nextStopIndex]?.name || 'Halt';
    marker.title = position.state === 'inStation'
        ? `In ${currentName}`
        : `Zwischen ${currentName} und ${nextName}`;
    return position;
}

function updateVehiclePosition(trip) {
    updatePerlschnurTimes(trip);
    return updateVehicleMarker(trip);
}

async function refreshVehiclePosition() {
    if (!activeTrip || document.hidden || positionRequestRunning) return;
    positionRequestRunning = true;
    const requestKey = positionRequestKey;
    const journeyId = $('trip-input')?.value.trim();
    const operatingDay = $('trip-date')?.value || null;
    try {
        const freshTrip = await fetchTripInfo(journeyId, operatingDay);
        if (activeTrip && requestKey === positionRequestKey && freshTrip?.stops?.length) {
            activeTrip = freshTrip;
            const position = updateVehiclePosition(freshTrip);
            if (position?.isFinal) stopPositionTimer();
            positionErrorShown = false;
        }
    } catch (error) {
        if (!positionErrorShown) {
            positionErrorShown = true;
            console.warn('Live-Position konnte nicht aktualisiert werden:', error);
        }
    } finally {
        positionRequestRunning = false;
    }
}

function startPositionUpdates() {
    if (positionTimer !== null) {
        window.clearInterval(positionTimer);
    }
    positionTimer = window.setInterval(refreshVehiclePosition, 15000);
}

function stopPositionTimer() {
    if (positionTimer !== null) {
        window.clearInterval(positionTimer);
        positionTimer = null;
    }
}

function stopPositionUpdates() {
    stopPositionTimer();
    removeVehicleMarker();
}

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    updateClock();
    setInterval(updateClock, 1000);

    // Standardmäßig das aktuelle Datum setzen
    const dateInput = $('trip-date');
    if (dateInput) {
        const t = new Date();
        dateInput.value = `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`;
    }

    // URL-Parameter auswerten
    const urlParams = new URLSearchParams(window.location.search);
    const sjyidParam = urlParams.get('sjyid');

    if (sjyidParam) {
        const tripInput = $('trip-input');
        if (tripInput) {
            tripInput.value = sjyidParam;
        }

        // Prüfen, ob ein separates Datum als Key ohne Wert angehängt wurde (z.B. &2026-06-05)
        // Alternativ wird auch ein sauberes &date=2026-06-05 unterstützt
        let customDate = urlParams.get('date');
        
        if (!customDate) {
            // Durchsuche alle Parameter-Keys nach einem ISO-Datum (YYYY-MM-DD)
            for (const key of urlParams.keys()) {
                if (/^\d{4}-\d{2}-\d{2}$/.test(key)) {
                    customDate = key;
                    break;
                }
            }
        }

        if (customDate && dateInput) {
            dateInput.value = customDate;
        }

        // Direktes Laden triggern, da ID vorhanden ist
        loadTrip();
    }

    $('btn-trip-fetch')?.addEventListener('click', loadTrip);

    $('trip-input')?.addEventListener('keydown', e => {
        if (e.key === 'Enter') loadTrip();
    });

    $('btn-home')?.addEventListener('click', () => {
        stopPositionUpdates();
        activeTrip = null;
        window.location.href = '../';
    });
    // Aktualisiert die URL live, wenn das Datum im Webinterface geändert wird
    $('trip-date')?.addEventListener('change', (e) => {
        const journeyId = $('trip-input')?.value.trim();
        const url = new URL(window.location.href);
        
        if (e.target.value) {
            url.searchParams.set('date', e.target.value);
        } else {
            url.searchParams.delete('date');
        }
        
        // Falls schon eine ID eingetragen ist, diese ebenfalls synchron halten
        if (journeyId) {
            url.searchParams.set('sjyid', journeyId);
        }

        window.history.replaceState({}, '', url.toString());
    });

    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) refreshVehiclePosition();
    });
    window.addEventListener('pagehide', stopPositionUpdates);
});
