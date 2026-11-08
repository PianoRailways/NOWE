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
