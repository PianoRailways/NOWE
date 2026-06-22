import { fetchTripInfo } from './trip-api-client.js';

// ─── DOM-Refs ─────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

// ─── Uhr ──────────────────────────────────────────────────────────────────────
function updateClock() {
    const el = $('live-clock');
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
    if (type === 'ALT_TRANSPORT') return '<span class="access-icon access-icon--alt"   title="Ersatztransport">🚌</span>';
    if (type === 'NOTIFY')        return '<span class="access-icon access-icon--notify"   title="Hilfe auf Anfrage">📞</span>';
    if (type === 'NO_BEHIG')      return '<span class="access-icon access-icon--no"   title="Nicht rollstuhlgänglich">🔺</span>';
    
    return '';
}

// ─── Trip laden ───────────────────────────────────────────────────────────────
async function loadTrip() {
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
        showStatus(`${trip.category} ${trip.line}  ·  Fahrtnummer ${trip.trainNumber}  ·  ${trip.stops.length} Halte`, 'success');
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
function renderPerlschnur(trip) {
    let html = '<div class="chain">';
    
    trip.stops.forEach((stop, idx) => {
        const isFirst = idx === 0;
        const isLast  = idx === trip.stops.length - 1;
        const isThisStop = stop.isThisCall;

        // Zeiten (nur HH:MM, ohne Sekunden)
        const arrTime = fmtTime(stop.arrival.timetabled);
        const depTime = fmtTime(stop.departure.timetabled);

        // Verspätungs-/Verfrühungs-Badges
        const arrDelay = delayLabel(stop.arrival.delaySec);
        const depDelay = delayLabel(stop.departure.delaySec);

        // HTML für Zeitspalte
        let timesHtml = '';
        if (isFirst) {
            timesHtml = `<div class="chain-times">
                <div class="time-row">
                    <span class="ps-time ps-time--dep">${depTime ?? '--:--'}</span>
                    ${depDelay}
                </div>
            </div>`;
        } else if (isLast) {
            timesHtml = `<div class="chain-times">
                <div class="time-row">
                    <span class="ps-time ps-time--arr">${arrTime ?? '--:--'}</span>
                    ${arrDelay}
                </div>
            </div>`;
        } else {
            timesHtml = `<div class="chain-times">
                <div class="time-row">
                    <span class="ps-time ps-time--arr">${arrTime ?? '--:--'}</span>
                    ${arrDelay}
                </div>
                <div class="time-row">
                    <span class="ps-time ps-time--dep">${depTime ?? '--:--'}</span>
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
        
        // Nutzt die jetzt im Objekt vorhandene ID (z.B. "ch:1:sloid:8100:2:3")
        const stopParam = stop.stopPointRef || stop.name;
        
        const stsUrl = `https://nowe.stellwerksim.ch/?stop=${encodeURIComponent(stopParam)}`;

        // Wechselt die URL direkt im selben Fenster
        const chainInfo = `<div class="chain-info">
            <span class="chain-name">
                <a href="${stsUrl}">${stop.name}</a>$ {accessIcon(stop.accessibility)}
            </span>
            ${quayLine}
        </div>`;

        const rowClass = isThisStop ? 'chain-stop this-call' : 'chain-stop';
        html += `
            <div class="${rowClass}">
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
        window.location.href = '../';
    });
});