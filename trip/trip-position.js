// Pure vehicle-position calculation for the trip chain.
(function (global) {
    function parseTime(value) {
        if (!value) return null;
        if (value instanceof Date) {
            return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
        }

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
        const offset = displayedAsUtc - utcGuess;
        return new Date(utcGuess - offset);
    }

    function actualTime(stopTime) {
        return parseTime(stopTime?.estimated || stopTime?.timetabled);
    }

    function calculateVehiclePosition(stops, currentTime = new Date(), trip = null) {
        if (!Array.isArray(stops) || stops.length === 0) return null;
        if (trip?.cancelled || trip?.isCancelled || trip?.status === 'cancelled') return null;
        if (stops.some(stop => stop?.cancelled || stop?.isCancelled)) return null;

        const now = parseTime(currentTime);
        if (!now) return null;

        const timedStops = stops.map((stop, originalIndex) => ({
            stop,
            originalIndex,
            arrival: actualTime(stop?.arrival),
            departure: actualTime(stop?.departure)
        })).filter(item => item.arrival || item.departure);

        if (timedStops.length === 0) return null;

        let previousTime = null;
        for (const item of timedStops) {
            if (item.arrival && item.departure && item.arrival > item.departure) return null;
            for (const time of [item.arrival, item.departure]) {
                if (time && previousTime && time < previousTime) return null;
                if (time) previousTime = time;
            }
        }

        const first = timedStops[0];
        const last = timedStops[timedStops.length - 1];
        if (first.departure && now < first.departure) {
            return { stopIndex: first.originalIndex, state: 'inStation' };
        }
        if (last.arrival && now >= last.arrival) {
            return { stopIndex: last.originalIndex, state: 'inStation', isFinal: true };
        }

        for (let index = 0; index < timedStops.length; index += 1) {
            const current = timedStops[index];
            if (current.arrival && current.departure && now >= current.arrival && now <= current.departure) {
                return { stopIndex: current.originalIndex, state: 'inStation' };
            }

            const next = timedStops[index + 1];
            if (!next?.arrival || !current.departure || current.departure > next.arrival) continue;
            if (now < current.departure || now > next.arrival) continue;

            const total = next.arrival.getTime() - current.departure.getTime();
            const elapsed = now.getTime() - current.departure.getTime();
            const progress = total > 0 ? Math.max(0, Math.min(1, elapsed / total)) : 0;
            const state = progress < 1 / 3
                ? 'justDeparted'
                : progress <= 2 / 3 ? 'middle' : 'almostThere';
            return {
                stopIndex: current.originalIndex,
                nextStopIndex: next.originalIndex,
                state,
                progress
            };
        }

        return null;
    }

    global.calculateVehiclePosition = calculateVehiclePosition;
})(typeof window !== 'undefined' ? window : globalThis);
