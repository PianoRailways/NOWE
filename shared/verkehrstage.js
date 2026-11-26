// Verkehrstage einer Fahrt aus dem GTFS-Import (GTFS/verkehrstage.php) als Monatskalender.
// Die Trip-API von opentransportdata liefert die Verkehrstage nicht zuverlässig, GTFS schon.

const ENDPOINT = new URL('../GTFS/verkehrstage.php', import.meta.url).href;
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

// Fahrt per SJYID abfragen. Mehrere Kandidaten möglich, der erste mit Treffern gewinnt.
export async function fetchVerkehrstage(sjyids, { url = ENDPOINT } = {}) {
    const candidates = [...new Set((Array.isArray(sjyids) ? sjyids : [sjyids]).map((s) => String(s || '').trim()).filter(Boolean))];
    let last = null;
    for (const id of candidates) {
        const response = await fetch(`${url}?sjyid=${encodeURIComponent(id)}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (data.error) throw new Error(data.error);
        last = data;
        if (data.dates?.length) return data;
    }
    return last;
}

const KIND_LABELS = {
    stops: 'Andere Halte',
    times: 'Andere Zeiten',
    tracks: 'Anderes Gleis (nur Info)',
    variant: 'Andere Variante (Unterschied nicht bekannt)',
};

// Link zur abweichenden Variante. Tripansicht und Formationssuche liegen beide eine Ebene unter dem Wurzelverzeichnis.
function variantHref(sjyid, date) {
    return `../trip/?sjyid=${encodeURIComponent(sjyid)}&date=${encodeURIComponent(date)}`;
}

function monthGrid(year, month, info, from, to, marked, today) {
    const first = new Date(Date.UTC(year, month - 1, 1));
    const offset = (first.getUTCDay() + 6) % 7; // Montag = 0
    const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const cells = WEEKDAYS.map((d) => `<span class="vt-head">${d}</span>`);
    for (let i = 0; i < offset; i++) cells.push('<span class="vt-empty"></span>');
    for (let d = 1; d <= days; d++) {
        const date = iso(year, month, d);
        const day = info.get(date);
        const cls = ['vt-day'];
        let title = `${d}.${month}.${year}`;
        if (day) {
            cls.push('vt-on');
            if (day.kind !== 'soll') {
                cls.push(`vt-dev-${day.kind}`);
                title += `: ${KIND_LABELS[day.kind] || 'Abweichung'}`;
            }
            if (day.own) cls.push('vt-own');
        } else if (date < from || date > to) cls.push('vt-out');
        if (date === marked) cls.push('vt-marked');
        if (date === today) cls.push('vt-today');
        // Abweichende Tage anderer Varianten führen zur jeweiligen Fahrt
        if (day && day.kind !== 'soll' && !day.own && day.sjyid) {
            cells.push(`<a class="${cls.join(' ')}" href="${variantHref(day.sjyid, date)}" title="${title}">${d}</a>`);
        } else {
            cells.push(`<span class="${cls.join(' ')}" title="${title}">${d}</span>`);
        }
    }
    return `<div class="vt-month"><div class="vt-month-title">${MONTHS[month - 1]} ${year}</div><div class="vt-grid">${cells.join('')}</div></div>`;
}

// Tage aus der Antwort: bevorzugt days (alle Varianten der Zugnummer), sonst nur dates (ältere Antwort)
function collectDays(data) {
    const own = new Set(data.dates || []);
    const info = new Map();
    if (Array.isArray(data.days) && data.days.length) {
        for (const d of data.days) info.set(d.date, { kind: d.kind || 'soll', sjyid: d.sjyid, own: own.has(d.date) });
    } else {
        for (const date of own) info.set(date, { kind: 'soll', sjyid: data.sjyid, own: true });
    }
    return info;
}

export function renderVerkehrstage(data, { markedDate = '', today = '' } = {}) {
    const info = collectDays(data);
    if (!info.size) {
        return '<div class="vt-note">Keine Verkehrstage im GTFS-Fahrplan gefunden. Die Fahrt fährt im Importfenster nicht oder ist dort nicht enthalten.</div>';
    }
    const dates = [...info.keys()].sort();
    const from = data.window?.from || dates[0];
    const to = data.window?.to || dates[dates.length - 1];
    let [y, m] = from.split('-').map(Number);
    const [ty, tm] = to.split('-').map(Number);
    const months = [];
    while (y < ty || (y === ty && m <= tm)) {
        months.push(monthGrid(y, m, info, from, to, markedDate, today));
        m++;
        if (m > 12) { m = 1; y++; }
    }

    const counts = {};
    for (const d of info.values()) if (d.kind !== 'soll') counts[d.kind] = (counts[d.kind] || 0) + 1;
    const deviating = Object.values(counts).reduce((a, b) => a + b, 0);
    const legend = ['stops', 'times', 'tracks', 'variant']
        .filter((k) => counts[k])
        .map((k) => `<span class="vt-legend-item"><span class="vt-swatch vt-dev-${k}"></span>${KIND_LABELS[k]} (${counts[k]})</span>`)
        .join('');
    const hasVariants = deviating > 0;
    const summary = `${info.size} Verkehrstage laut GTFS-Fahrplan, ${from.split('-').reverse().join('.')} bis ${to.split('-').reverse().join('.')}.`
        + (hasVariants ? ` ${deviating} davon weichen vom Soll ab.` : ' Alle Tage identisch.');
    const ownHint = hasVariants ? '<span class="vt-legend-item"><span class="vt-swatch vt-on vt-own"></span>Tage dieser Fahrt</span>' : '';
    return `<div class="vt-months">${months.join('')}</div>
        ${legend || ownHint ? `<div class="vt-legend">${legend}${ownHint}</div>` : ''}
        <div class="vt-note">${summary}</div>`;
}

// Befüllt einen Container. Fehler zeigen nur einen Hinweis, die Tripansicht bleibt davon unberührt.
export async function showVerkehrstage(container, sjyids, { markedDate = '' } = {}) {
    if (!container) return;
    container.innerHTML = '<h2 class="vt-title">Verkehrstage</h2><div class="vt-note">Lade Verkehrstage…</div>';
    try {
        const data = await fetchVerkehrstage(sjyids);
        const now = new Date();
        const today = iso(now.getFullYear(), now.getMonth() + 1, now.getDate());
        container.innerHTML = `<h2 class="vt-title">Verkehrstage</h2>${renderVerkehrstage(data, { markedDate, today })}`;
    } catch (error) {
        container.innerHTML = '<h2 class="vt-title">Verkehrstage</h2><div class="vt-note">Verkehrstage sind gerade nicht verfügbar.</div>';
        console.warn('Verkehrstage:', error);
    }
}
