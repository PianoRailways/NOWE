// Ermittelt den data-type eines .line-badge (Farbe siehe line-badge.css).
// Gleiche Logik wie in der Abfahrtstabelle (script/app.js), damit der Trip gleich eingefärbt wird.

// VBZ-Betreiber (operatorName ist die Betreiber-Ref, wenn kein Klartextname geliefert wird)
const VBZ_OPERATORS = new Set(['ojp:3849', 'ojp:849', 'ojp:46', 'ojp:41']);
// Buslinien mit eigener Farbe in line-badge.css
const VBZ_COLORED_BUSES = new Set(['31', '32', '33', '46', '61', '62', '72', '80', '89', '301', '302', '303', '304', '305', '306', '307', '308', '309', '314', '317', '325']);

export function getLineType({ category = '', line = '', operatorName = '' } = {}) {
    const cat = String(category || '');
    const lineStr = String(line || '');
    const cleanCat = cat.replace(/[0-9\s]/g, '').trim().toUpperCase();

    if (VBZ_OPERATORS.has(operatorName)) {
        if (cleanCat === 'T') return `VBZ-${lineStr}`;
        if (cleanCat === 'B' && VBZ_COLORED_BUSES.has(lineStr)) return `VBZ-${lineStr}`;
        return 'VBZ';
    }
    if (operatorName === 'ojp:801' && cat === 'RUB') return 'RUB-PAG';
    if (operatorName === 'ojp:801') return 'PAG';
    if (operatorName === 'ojp:865') return 'RhB';
    return cleanCat;
}
