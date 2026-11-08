function parseTime(value) {
    if (!value) return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
    if (typeof value !== 'string') return null;

    const trimmed = value.trim();
    if (!trimmed) return null;
    const directDate = new Date(trimmed);
    if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(trimmed)) {
        return Number.isNaN(directDate.getTime()) ? null : directDate;
    }

    const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/);
    if (!match) return Number.isNaN(directDate.getTime()) ? null : directDate;

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const hour = Number(match[4]);
    const minute = Number(match[5]);
    const second = Number(match[6] || 0);
    const millisecond = Number((match[7] || '').padEnd(3, '0') || 0);
    const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Zurich',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hourCycle: 'h23'
    });
    const parts = Object.fromEntries(formatter.formatToParts(new Date(utcGuess))
        .filter(part => part.type !== 'literal')
        .map(part => [part.type, Number(part.value)]));
    const displayedAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day,
        parts.hour, parts.minute, parts.second, millisecond);
    return new Date(utcGuess - (displayedAsUtc - utcGuess));
}

export function isCountdownDefault() {
    const value = new URLSearchParams(window.location.search).get('countdown');
    return value === 'true' || value === '1';
}

export function withCountdownParam(url) {
    if (!isCountdownDefault()) return url;
    const result = new URL(url, window.location.href);
    result.searchParams.set('countdown', 'true');
    return url.startsWith('http') ? result.href : `${result.pathname}${result.search}${result.hash}`;
}

export function formatCountdown(targetIso, now = new Date()) {
    const target = parseTime(targetIso);
    if (!target) return '';

    const totalSeconds = Math.round((target.getTime() - now.getTime()) / 1000);
    const absoluteSeconds = Math.abs(totalSeconds);
    const minutes = Math.floor(absoluteSeconds / 60);
    const seconds = absoluteSeconds % 60;
    const value = absoluteSeconds >= 60 && seconds === 0
        ? `${minutes}'`
        : `${minutes}:${String(seconds).padStart(2, '0')}`;
    return totalSeconds < 0 ? `vor ${value}` : `in ${value}`;
}

let countdownTicker = null;
let countdownVisibilityBound = false;

function updateCountdownElements() {
    if (document.hidden) return;
    document.querySelectorAll('[data-cd-target]').forEach((element) => {
        if (element.dataset.cdTemp === '1') return;
        element.textContent = formatCountdown(element.dataset.cdTarget);
    });
}

export function startCountdownTicker() {
    if (!countdownVisibilityBound) {
        document.addEventListener('visibilitychange', updateCountdownVisibility);
        countdownVisibilityBound = true;
    }
    if (countdownTicker || document.hidden || !document.querySelector('[data-cd-target]')) return;
    updateCountdownElements();
    countdownTicker = window.setInterval(updateCountdownElements, 1000);
}

function updateCountdownVisibility() {
    if (document.hidden) {
        if (countdownTicker) window.clearInterval(countdownTicker);
        countdownTicker = null;
        return;
    }
    startCountdownTicker();
    updateCountdownElements();
}

export function bindTimeToggle(cell, time, badge) {
    if (!cell || !time || cell.dataset.cdBound === '1') return;
    cell.dataset.cdBound = '1';
    cell.addEventListener('click', (event) => {
        event.stopPropagation();
        const target = time.dataset.cdTarget || cell.dataset.est || cell.dataset.tt;
        if (!target) return;
        if (cell._countdownTimeout) window.clearTimeout(cell._countdownTimeout);

        if (isCountdownDefault()) {
            time.dataset.cdTemp = '1';
            time.textContent = time.dataset.clock || time.textContent;
            if (badge) badge.style.display = '';
            cell._countdownTimeout = window.setTimeout(() => {
                delete time.dataset.cdTemp;
                if (badge) badge.style.display = 'none';
                startCountdownTicker();
            }, 10000);
            return;
        }

        time.dataset.cdTemp = '1';
        time.textContent = formatCountdown(target) || time.textContent;
        if (badge) badge.style.display = 'none';
        cell._countdownTimeout = window.setTimeout(() => {
            delete time.dataset.cdTemp;
            time.textContent = time.dataset.clock || time.textContent;
            if (badge) badge.style.display = '';
        }, 10000);
    });
}

export function parseCountdownTime(value) {
    return parseTime(value);
}

export function formatZurichDateTime(value) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Zurich',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(value);
    const values = Object.fromEntries(parts
        .filter(part => part.type !== 'literal')
        .map(part => [part.type, part.value]));
    return {
        date: `${values.year}-${values.month}-${values.day}`,
        time: `${values.hour}:${values.minute}`
    };
}
