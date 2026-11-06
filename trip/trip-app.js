import { fetchTripInfo } from './trip-api-client.js';
import {
    renderStopChain,
    startTripRefresh,
    stopTripRefresh,
    updateVehicleMarker,
    updateClock,
    initHeaderHeight
} from '../shared/stop-chain.js';
import { renderTripHeader } from '../shared/trip-header.js';

const state = {
    trip: null,
    rows: [],
    refreshTimer: null,
    markerTimer: null,
    refreshRunning: false
};

const $ = (id) => document.getElementById(id);

function showMessage(message, type = 'info') {
    const result = $('result');
    if (!result) return;
    result.innerHTML = `<div class="${type === 'error' ? 'error-message' : 'info-message'}">${message}</div>`;
}

function renderTrip(trip) {
    state.trip = trip;
    state.rows = trip.stops.map((stop, tripIndex) => ({ ...stop, tripIndex }));
    $('result').innerHTML = `${renderTripHeader(trip, { links: 'trip' })}<div class="stop-chain" id="stopChain"></div>`;
    renderStopChain(state, { expandable: false, stopLabel: (row) => row.name || row.stopName || 'Unbekannter Halt' });
    updateVehicleMarker(state);
}

async function loadTrip(journeyId, date) {
    stopTripRefresh(state);
    state.trip = null;
    showMessage('Lade Fahrtdetails…');
    try {
        const trip = await fetchTripInfo(journeyId, date || null);
        if (!trip?.stops?.length) {
            showMessage('Keine Fahrtdaten gefunden.', 'error');
            return;
        }
        trip.operatingDay = date || trip.stops[0].departure?.timetabled?.slice(0, 10) || null;
        renderTrip(trip);
        const url = new URL(window.location.href);
        url.searchParams.set('sjyid', journeyId);
        if (date) url.searchParams.set('date', date);
        else url.searchParams.delete('date');
        window.history.replaceState({}, '', url);
        startTripRefresh(state);
    } catch (error) {
        showMessage(`Fehler: ${error.message}`, 'error');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    initHeaderHeight();
    const dateInput = $('trip-date');
    const params = new URLSearchParams(window.location.search);
    const journeyId = params.get('sjyid') || '';
    const date = params.get('date') || '';
    $('trip-input').value = journeyId;
    dateInput.value = date;
    $('btn-home')?.addEventListener('click', () => { window.location.href = '../'; });
    $('live-clock')?.addEventListener('click', () => { window.location.href = './'; });
    $('btn-trip-fetch')?.addEventListener('click', () => loadTrip($('trip-input').value.trim(), dateInput.value));
    $('trip-input')?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') loadTrip($('trip-input').value.trim(), dateInput.value);
    });
    updateClock();
    window.setInterval(updateClock, 1000);
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) updateVehicleMarker(state);
    });
    window.addEventListener('resize', () => updateVehicleMarker(state));
    if (journeyId) loadTrip(journeyId, date);
});
