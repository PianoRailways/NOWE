// Ermittelt den data-type eines .line-badge (Farbe siehe line-badge.css).
// Eine Quelle für Abfahrten, Ankünfte und Trip. Der Betreiber wird über den Namen
// aus der GTFS-agency.txt erkannt (shared/operators.js), nicht über einzelne ojp-IDs.
import { getOperatorName } from './operators.js';

// Buslinien mit eigener Farbe in line-badge.css
const VBZ_COLORED_BUSES = new Set(['31', '32', '33', '46', '61', '62', '72', '80', '89', '301', '302', '303', '304', '305', '306', '307', '308', '309', '314', '317', '325']);

// "Verkehrsbetriebe Zürich", aber nicht "Verkehrsbetriebe Zürichsee und Oberland" (VZO)
const VBZ_NAME = /^Verkehrsbetriebe Zürich(?![\p{L}\d])/u;

export function getLineType({ category = '', line = '', operatorRef = '', operatorName = '' } = {}) {
    const cat = String(category || '');
    const lineStr = String(line || '');
    const cleanCat = cat.replace(/[0-9\s]/g, '').trim().toUpperCase();
    // Name aus der GTFS-Zuordnung hat Vorrang, sonst der von der API gelieferte Name
    const name = getOperatorName(operatorRef) || String(operatorName || '');

    // VBZ, Forchbahn (Tram 18) und Aargau Verkehr (Tram 20) sind im Zürcher Liniennetz gefärbt
    const isVbz = VBZ_NAME.test(name) || name.startsWith('Forchbahn');
    const isAvaTram = name.startsWith('Aargau Verkehr') && cleanCat === 'T';
    if (isVbz || isAvaTram) {
        if (cleanCat === 'T') return `VBZ-${lineStr}`;
        if (cleanCat === 'B' && VBZ_COLORED_BUSES.has(lineStr)) return `VBZ-${lineStr}`;
        return 'VBZ';
    }
    if (name.startsWith('PostAuto') && cat === 'RUB') return 'RUB-PAG';
    if (name.startsWith('PostAuto')) return 'PAG';
    if (name === 'Autoverkehr RhB') return 'RhB';
    return cleanCat;
}
