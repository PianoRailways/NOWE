// Verkehrstage einer Fahrt aus dem GTFS-Import (GTFS/verkehrstage.php) als Monatskalender.
// Die Trip-API von opentransportdata liefert die Verkehrstage nicht zuverlässig, GTFS schon.

const ENDPOINT = new URL('../GTFS/verkehrstage.php', import.meta.url).href;
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
})[char]);

function stopReferenceMarkup(stop) {
    const ref = String(stop ?? '');
    const escapedRef = escapeHtml(ref);
    return `<span class="vt-stop-reference" data-stop-ref="${escapedRef}">${escapedRef}</span>`;
}

function stopNameKey(ref) {
    return String(ref || '').match(/^(ch:1:sloid:\d+)(?::|_gen|$)/)?.[1] || String(ref || '');
}

function resolveStopNames(container, tripStops) {
    const names = new Map();
    for (const stop of Array.isArray(tripStops) ? tripStops : []) {
        const ref = String(stop?.stopPointRef || '').trim();
        const name = String(stop?.name || stop?.stopName || '').trim();
        if (ref && name) names.set(stopNameKey(ref), name);
    }
    for (const element of container.querySelectorAll('.vt-stop-reference')) {
        const ref = element.dataset.stopRef;
        const name = names.get(stopNameKey(ref));
        if (name) {
            element.textContent = name;
            element.title = ref;
        }
    }
}

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
    stops: 'Andere Halte als Soll',
    times: 'Andere Zeiten als Soll',
    tracks: 'Anderes Gleis als Soll (nur Info)',
    variant: 'Andere Variante als Soll (Unterschied nicht bekannt)',
};

// Tripansicht und Formationssuche liegen beide eine Ebene unter dem Wurzelverzeichnis.
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
        if (day && day.sjyid) {
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
        for (const d of data.days) info.set(d.date, { kind: d.kind || 'soll', sjyid: d.sjyid, own: own.has(d.date), details: d.details || null });
    } else {
        for (const date of own) info.set(date, { kind: 'soll', sjyid: data.sjyid, own: true, details: null });
    }
    return info;
}

function displayTime(value) {
    const time = String(value ?? '');
    const match = time.match(/^(\d+:\d{2})(?::\d{2})?$/);
    return match ? match[1] : time || '–';
}

function detailLines(details) {
    if (!details) return ['Detaildaten fehlen – bitte den GTFS-Import mit Detaildaten ausführen.'];
    const lines = [];
    for (const stop of details.stops?.removed || []) {
        lines.push(`Halt entfällt: ${stopReferenceMarkup(stop)}`);
    }
    for (const stop of details.stops?.added || []) {
        lines.push(`Zusätzlicher Halt: ${stopReferenceMarkup(stop)}`);
    }
    for (const change of details.stops?.flags || []) {
        lines.push(`Einstiegs-/Ausstiegsregel ${stopReferenceMarkup(change.stop)}: ${escapeHtml(change.from || '–')} → ${escapeHtml(change.to || '–')}`);
    }
    for (const change of details.times || []) {
        const times = [];
        const fromArrival = displayTime(change.from_arrival);
        const toArrival = displayTime(change.to_arrival);
        const fromDeparture = displayTime(change.from_departure);
        const toDeparture = displayTime(change.to_departure);
        if (fromArrival !== toArrival) {
            times.push(`Ankunft ${escapeHtml(fromArrival)} → ${escapeHtml(toArrival)}`);
        }
        if (fromDeparture !== toDeparture) {
            times.push(`Abfahrt ${escapeHtml(fromDeparture)} → ${escapeHtml(toDeparture)}`);
        }
        if (times.length) lines.push(`Zeiten ${stopReferenceMarkup(change.stop)}: ${times.join(', ')}`);
    }
    for (const change of details.tracks || []) {
        const from = change.from || '';
        const to = change.to || '';
        const fromPlatform = from.split(':', 1)[0];
        const toPlatform = to.split(':', 1)[0];
        const valueClass = from.includes(':') && to.includes(':') && fromPlatform && toPlatform
            ? (fromPlatform === toPlatform ? 'vt-track-same-platform' : 'vt-track-platform-changed')
            : '';
        const toValue = valueClass
            ? `<span class="${valueClass}">${escapeHtml(to || '–')}</span>`
            : escapeHtml(to || '–');
        lines.push(`Gleis ${stopReferenceMarkup(change.stop)}: ${escapeHtml(from || '–')} → ${toValue}`);
    }
    return lines.length ? lines : ['Keine Einzeldifferenzen verfügbar.'];
}

function renderDifference(day, date, soll) {
    if (!day || day.kind === 'soll') return '';
    const lines = detailLines(day.details);
    return `<section class="vt-difference">
        <h3>Abweichungen am ${escapeHtml(date.split('-').reverse().join('.'))} (${escapeHtml(day.sjyid)})</h3>
        <p>Verglichen mit der Soll-Signatur von ${escapeHtml(soll || 'unbekannter SJYID')}:</p>
        <ul>${lines.map((line) => `<li>${line}</li>`).join('')}</ul>
    </section>`;
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
    const difference = renderDifference(info.get(markedDate), markedDate, data.soll);
    return `<div class="vt-months">${months.join('')}</div>
        ${legend || ownHint ? `<div class="vt-legend">${legend}${ownHint}</div>` : ''}
        <div class="vt-note">${summary}</div>
        <div class="vt-note">Betriebstage anklicken, um die Fahrt an diesem Datum zu öffnen.</div>
        ${difference}`;
}

function renderDisclosure(content) {
    return `<details class="vt-disclosure">
        <summary class="vt-title">Verkehrstage</summary>
        <div class="vt-disclosure-content">${content}</div>
    </details>`;
}

function setDisclosureContent(container, content) {
    const wasOpen = container.querySelector('.vt-disclosure')?.open || false;
    container.innerHTML = renderDisclosure(content);
    if (wasOpen) container.querySelector('.vt-disclosure').open = true;
}

// Befüllt einen Container. Fehler zeigen nur einen Hinweis, die Tripansicht bleibt davon unberührt.
export async function showVerkehrstage(container, sjyids, { markedDate = '', tripStops = [] } = {}) {
    if (!container) return;
    setDisclosureContent(container, '<div class="vt-note">Lade Verkehrstage…</div>');
    try {
        const data = await fetchVerkehrstage(sjyids);
        const now = new Date();
        const today = iso(now.getFullYear(), now.getMonth() + 1, now.getDate());
        setDisclosureContent(container, renderVerkehrstage(data, { markedDate, today }));
        resolveStopNames(container, tripStops);
    } catch (error) {
        setDisclosureContent(container, '<div class="vt-note">Verkehrstage sind gerade nicht verfügbar.</div>');
        console.warn('Verkehrstage:', error);
    }
}
