import { fetchTripInfo } from '../trip/trip-api-client.js';
import { formatCountdown, isCountdownDefault, withCountdownParam, bindTimeToggle, startCountdownTicker } from './countdown.js';
export { initHeaderHeight } from './header.js?v=1';

export function updateClock() {
    const element = document.getElementById('live-clock');
    if (element) element.textContent = new Date().toLocaleTimeString('de-CH');
}

export function fmtTime(value) {
    if (!value) return null;
    const match = String(value).match(/T(\d{2}):(\d{2})/);
    return match ? `${match[1]}:${match[2]}` : null;
}

export function formatTime(value) {
    return fmtTime(value) || '';
}

export function delayLabel(seconds) {
    if (!seconds) return '';
    const sign = seconds > 0 ? '+' : '−';
    const absolute = Math.abs(seconds);
    const className = seconds < 0 ? ' delay-badge--early' : '';
    return `<span class="delay-badge${className}">${sign}${Math.floor(absolute / 60)}:${String(absolute % 60).padStart(2, '0')}</span>`;
}

export function accessIcon(type) {
    return type ? `<span class="access-icon" title="${type}">♿</span>` : '';
}

export function timeRow(value, estimated, delay, kind) {
    const target = estimated || value || '';
    const countdownDefault = isCountdownDefault() && target;
    const time = countdownDefault ? formatCountdown(target) : (fmtTime(value) || '--:--');
    const badge = delayLabel(delay);
    const badgeHtml = countdownDefault
        ? badge.replace('class="delay-badge"', 'class="delay-badge" style="display:none"')
        : badge;
    return `<div class="time-row" data-tt="${value || ''}" data-est="${estimated || ''}" data-delay="${delay || 0}">
        <span class="ps-time ps-time--${kind}" data-clock="${fmtTime(value) || '--:--'}"${countdownDefault ? ` data-cd-target="${target}"` : ''}>${time}</span><span class="delay-slot">${badgeHtml}</span>
    </div>`;
}

function stopName(row) {
    return row.name || row.stopName || 'Unbekannter Halt';
}

export function renderStopChain(state, { expandable = false, stopLabel = stopName, onToggle, renderPanel } = {}) {
    const chain = document.getElementById('stopChain');
    if (!chain) return;
    const rows = state.rows || state.trip?.stops || [];
    let previousDay = null;
    chain.innerHTML = rows.map((row, index) => {
        const isFirst = index === 0;
        const isLast = index === rows.length - 1;
        const arrival = row.arrival?.timetabled;
        const departure = row.departure?.timetabled;
        const dateValue = arrival || departure;
        const day = dateValue?.slice(0, 10);
        const daySeparator = day && day !== previousDay && previousDay !== null
            ? `<div class="day-separator">${new Date(`${day}T12:00:00`).toLocaleDateString('de-CH', { weekday: 'short', day: '2-digit', month: '2-digit' })}</div>`
            : '';
        if (day) previousDay = day;
        const times = isFirst
            ? timeRow(departure, row.departure?.estimated, row.departure?.delaySec, 'dep')
            : isLast
                ? timeRow(arrival, row.arrival?.estimated, row.arrival?.delaySec, 'arr')
                : `${timeRow(arrival, row.arrival?.estimated, row.arrival?.delaySec, 'arr')}${timeRow(departure, row.departure?.estimated, row.departure?.delaySec, 'dep')}`;
        const name = stopLabel(row);
        const stopReference = row.stopPointRef || row.name;
        const operatingDay = state.trip?.operatingDay || state.journeyMeta?.operationDate || '';
        const stopLink = withCountdownParam(`https://nowe.stellwerksim.ch/?stop=${encodeURIComponent(stopReference || '')}&date=${encodeURIComponent(operatingDay)}${dateValue ? `&time=${encodeURIComponent(formatTime(dateValue))}` : ''}`);
        const quay = row.platformChanged
            ? `<del class="planned-quay">Gl. ${row.plannedQuay}</del><strong class="estimated-quay">Gl. ${row.estimatedQuay}</strong>`
            : (row.quay ? `Gl. ${row.quay}` : '');
        const service = row.serviceStop === true;
        const noFormation = row.noFormation === true;
        const classes = [row.unplannedStop ? 'stop-unplanned' : '', row.cancelled ? 'stop-cancelled' : '', service ? 'service-name' : ''].filter(Boolean).join(' ');
        const formationHint = noFormation ? '<small class="no-formation-hint">Keine Formation (Halt entfällt?)</small>' : '';
        const canExpand = expandable && !noFormation && row.fIdx !== undefined;
        return `${daySeparator}<section class="formation-stop ${isFirst ? 'formation-stop--first' : ''} ${isLast ? 'formation-stop--last' : ''} ${service ? 'is-service' : ''}" data-stop-index="${row.fIdx ?? ''}" data-trip-index="${row.tripIndex ?? index}" data-row-index="${index}">
            <${canExpand ? 'button' : 'div'} class="formation-stop-row ${row.cancelled ? 'stop-cancelled' : ''}" type="${canExpand ? 'button' : ''}" data-formation-index="${row.fIdx ?? ''}" ${canExpand ? '' : 'disabled'}>
                <span class="chain-times">${times}</span>
                <span class="chain-marker"><span class="chain-dot"></span></span>
                <span class="chain-stop-text"><a class="${classes}" href="${stopLink}">${name}</a>${row.cancelled ? '<small class="stop-cancelled">Halt entfällt</small>' : ''}${formationHint}${accessIcon(row.accessibility)}${row.requestStop ? '<b class="hav-badge">HaV</b>' : ''}${quay ? `<small>${quay}</small>` : ''}</span>
                ${canExpand ? '<span class="stop-arrow" aria-hidden="true">›</span>' : ''}
            </${canExpand ? 'button' : 'div'}>
            ${canExpand ? `<div class="formation-panel" id="formation-panel-${row.fIdx}"></div>` : ''}
        </section>`;
    }).join('');
    if (expandable && onToggle) {
        chain.querySelectorAll('.formation-stop-row:not([disabled])').forEach((row) => {
            row.addEventListener('click', (event) => {
                if (!event.target.closest('a')) onToggle(Number(row.dataset.formationIndex));
            });
        });
    }
    setupTimeRows(chain);
    updateVehicleMarker(state);
}

export function setupTimeRows(root = document) {
    root.querySelectorAll('.time-row').forEach((row) => {
        bindTimeToggle(row, row.querySelector('.ps-time'), row.querySelector('.delay-badge'));
    });
    startCountdownTicker();
}

export function updateTripRows(state, trip) {
    if (!trip?.stops) return;
    state.trip = trip;
    trip.stops.forEach((stop, index) => {
        const row = document.querySelector(`.formation-stop[data-trip-index="${index}"]`);
        if (!row) return;
        row.querySelectorAll('.time-row').forEach((time) => {
            const kind = time.querySelector('.ps-time--arr') ? 'arrival' : 'departure';
            const value = stop[kind];
            if (!value) return;
            if (!value.timetabled) return;
            time.dataset.tt = value.timetabled;
            time.dataset.est = value.estimated || '';
            time.dataset.delay = value.delaySec || 0;
            time.querySelector('.ps-time').dataset.cdTarget = value.estimated || value.timetabled;
            time.querySelector('.ps-time').dataset.clock = fmtTime(value.timetabled) || '--:--';
            if (time.querySelector('.ps-time').dataset.cdTemp !== '1' && !isCountdownDefault()) {
                time.querySelector('.ps-time').textContent = fmtTime(value.timetabled) || '--:--';
            }
            const delaySlot = time.querySelector('.delay-slot');
            delaySlot.innerHTML = delayLabel(value.delaySec);
            const delayBadge = delaySlot.querySelector('.delay-badge');
            if (delayBadge) delayBadge.style.display = time.querySelector('.ps-time').dataset.cdTemp === '1' || isCountdownDefault() ? 'none' : '';
        });
        const quay = row.querySelector('.chain-stop-text small:not(.stop-cancelled):not(.no-formation-hint)');
        const quayHtml = stop.platformChanged
            ? `<del class="planned-quay">Gl. ${stop.plannedQuay}</del><strong class="estimated-quay">Gl. ${stop.estimatedQuay}</strong>`
            : (stop.quay ? `Gl. ${stop.quay}` : '');
        if (quay) quay.innerHTML = quayHtml;
        row.classList.toggle('stop-cancelled', stop.cancelled === true);
        row.querySelector('.formation-stop-row')?.classList.toggle('stop-cancelled', stop.cancelled === true);
        row.querySelector('.chain-stop-text a')?.classList.toggle('stop-cancelled', stop.cancelled === true);
        row.querySelector('.chain-stop-text small.stop-cancelled')?.classList.toggle('stop-cancelled', stop.cancelled === true);
    });
    updateVehicleMarker(state);
}

export function updateVehicleMarker(state) {
    const chain = document.getElementById('stopChain');
    const trip = state.trip;
    if (!chain || !trip?.stops?.length || typeof window.calculateVehiclePosition !== 'function') return;
    const position = window.calculateVehiclePosition(trip.stops, new Date(), trip);
    let marker = chain.querySelector('.vehicle-position-marker');
    if (!position) {
        marker?.setAttribute('hidden', '');
        return;
    }
    if (!marker) {
        marker = document.createElement('span');
        marker.className = 'vehicle-position-marker';
        chain.appendChild(marker);
    }
    const rows = [...chain.querySelectorAll('.formation-stop')];
    const current = rows.find((row) => Number(row.dataset.tripIndex) === position.stopIndex);
    if (!current) return;
    const next = position.nextStopIndex === undefined ? current : rows.find((row) => Number(row.dataset.tripIndex) === position.nextStopIndex) || current;
    const chainRect = chain.getBoundingClientRect();
    const currentRect = current.querySelector('.chain-dot').getBoundingClientRect();
    const nextRect = next.querySelector('.chain-dot').getBoundingClientRect();
    const progress = position.progress || 0;
    marker.style.top = `${currentRect.top + currentRect.height / 2 - chainRect.top + (nextRect.top - currentRect.top) * progress}px`;
    marker.style.left = `${currentRect.left + currentRect.width / 2 - chainRect.left}px`;
    marker.removeAttribute('hidden');
}

export function stopTripRefresh(state) {
    if (state.refreshTimer) window.clearInterval(state.refreshTimer);
    if (state.markerTimer) window.clearInterval(state.markerTimer);
    state.refreshTimer = null;
    state.markerTimer = null;
}

export async function refreshTrip(state) {
    if (state.refreshRunning || document.hidden || !state.trip) return;
    const journeyId = state.trip.swissJourneyId || state.trip.sjyid || state.trip.journeyId;
    if (!journeyId) return;
    state.refreshRunning = true;
    try {
        const date = state.trip.operatingDay || document.getElementById('date')?.value || document.getElementById('trip-date')?.value;
        const updated = await fetchTripInfo(journeyId, date);
        updateTripRows(state, updated);
        if (updated?.isFinal) stopTripRefresh(state);
    } finally {
        state.refreshRunning = false;
    }
}

export function startTripRefresh(state) {
    stopTripRefresh(state);
    if (!state.trip) return;
    state.refreshTimer = window.setInterval(() => refreshTrip(state), 15000);
    state.markerTimer = window.setInterval(() => updateVehicleMarker(state), 10000);
}
