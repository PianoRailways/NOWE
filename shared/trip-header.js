import { withCountdownParam } from './countdown.js';

const FORMATION_OPERATOR_CODES = new Map([
    ['bls', 'BLSP'],
    ['blsp', 'BLSP'],
    ['sbb', 'SBBP'],
    ['sbbp', 'SBBP'],
    ['sob', 'SOB'],
    ['tpf', 'TPF'],
    ['rhb', 'RhB'],
    ['ojp:11', 'SBBP'],
    ['ojp:33', 'BLSP'],
    ['ojp:53', 'TPF'],
    ['ojp:72', 'RhB'],
    ['ojp:82', 'SOB'],
]);

export function renderTripHeader(trip, { links = 'trip' } = {}) {
    const lineType = (trip.category || '').replace(/[0-9\s]/g, '').trim();
    const operatorRef = String(trip.operatorRef || '').trim().toLowerCase();
    const evuCode = FORMATION_OPERATOR_CODES.get(operatorRef);
    const agencyName = trip.operatorName || trip.operatorRef || '';
    const lineBadge = `<span class="line-badge" data-type="${lineType}" operator="${agencyName}" agency-name="${agencyName}" data-line="${trip.line || ''}">${trip.line || ''}</span>`;
    const operatingDay = trip.operatingDay || trip.journeyMeta?.operationDate || '';
    const href = links === 'formation'
        ? (trip.swissJourneyId
            ? withCountdownParam(`../trip/?sjyid=${encodeURIComponent(trip.swissJourneyId)}${operatingDay ? `&date=${encodeURIComponent(operatingDay)}` : ''}`)
            : '')
        : (evuCode && trip.trainNumber
            ? withCountdownParam(`/formation-new/?train=${encodeURIComponent(trip.trainNumber)}&evu=${encodeURIComponent(evuCode)}${operatingDay ? `&date=${encodeURIComponent(operatingDay)}` : ''}`)
            : '');
    const number = href
        ? `<a href="${href}" class="trip-header__num">${trip.trainNumber || ''}</a>`
        : `<span class="trip-header__num">${trip.trainNumber || ''}</span>`;
    return `<div class="trip-header">
        <div class="line-container">
            ${lineBadge}
            ${number}
        </div>
        <span class="trip-header__dest">→ ${trip.destination || ''}</span>
    </div>`;
}
