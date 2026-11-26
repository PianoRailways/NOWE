// Betreibernamen aus den GTFS-Daten (agency.txt), Schlüssel ist die Zahl der OJP-Betreiberref.
import { OPERATOR_NAMES } from './operator-names.js';

// 'ojp:801' -> '801'
export function operatorIdFromRef(ref) {
    return String(ref ?? '').trim().replace(/^ojp:/i, '');
}

// Klartextname zur Betreiberref, oder '' wenn unbekannt
export function getOperatorName(ref) {
    const id = operatorIdFromRef(ref);
    return id ? (OPERATOR_NAMES[id] ?? '') : '';
}

// Name für Anzeige und Logik: Name aus OJP, sonst GTFS-Name, sonst die Ref selbst
export function resolveOperatorName(ref, apiName = '') {
    const api = String(apiName ?? '').trim();
    if (api && api !== String(ref ?? '').trim()) return api;
    return getOperatorName(ref) || api || String(ref ?? '').trim();
}
