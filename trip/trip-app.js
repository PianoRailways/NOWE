// ─── Chain-ähnliche Perlschnur (wie Abfahrtstabelle) mit Ausfällen ──────────
function renderPerlschnur(trip) {
    let html = '<div class="chain">';
    
    trip.stops.forEach((stop, idx) => {
        const isFirst = idx === 0;
        const isLast  = idx === trip.stops.length - 1;
        const isThisStop = stop.isThisCall;

        // Zeiten (nur HH:MM, ohne Sekunden)
        const arrTime = fmtTime(stop.arrival.timetabled);
        const depTime = fmtTime(stop.departure.timetabled);

        // ✅ Datum und Uhrzeit für die URL extrahieren
        const arrivalIso = stop.arrival.timetabled;
        const arrivalDate = arrivalIso ? arrivalIso.split('T')[0] : null;
        const arrivalTimeForUrl = arrTime; // "HH:MM"

        // Verspätungs-/Verfrühungs-Badges
        const arrDelay = delayLabel(stop.arrival.delaySec);
        const depDelay = delayLabel(stop.departure.delaySec);

        // HTML für Zeitspalte
        let timesHtml = '';
        if (isFirst) {
            timesHtml = `<div class="chain-times">
                <div class="time-row">
                    <span class="ps-time ps-time--dep">${depTime ?? '--:--'}</span>
                    ${depDelay}
                </div>
            </div>`;
        } else if (isLast) {
            timesHtml = `<div class="chain-times">
                <div class="time-row">
                    <span class="ps-time ps-time--arr">${arrTime ?? '--:--'}</span>
                    ${arrDelay}
                </div>
            </div>`;
        } else {
            timesHtml = `<div class="chain-times">
                <div class="time-row">
                    <span class="ps-time ps-time--arr">${arrTime ?? '--:--'}</span>
                    ${arrDelay}
                </div>
                <div class="time-row">
                    <span class="ps-time ps-time--dep">${depTime ?? '--:--'}</span>
                    ${depDelay}
                </div>
            </div>`;
        }

        // Dot-Spalte
        const dotClass = isFirst ? 'ps-dot ps-dot--first'
                       : isLast  ? 'ps-dot ps-dot--last'
                       : 'ps-dot';

        const dotHtml = `<div class="chain-dot-col">
            <div class="ps-line-wrap">
                ${!isFirst ? '<div class="ps-line ps-line--top"></div>' : ''}
                <div class="${dotClass}"></div>
                ${!isLast  ? '<div class="ps-line ps-line--bot"></div>' : ''}
            </div>
        </div>`;

        // Name + Quay unter dem Namen
        const quayLine = stop.quay ? `<div class="ps-quay-line">Gl. ${stop.quay}</div>` : '';
        
        // Nutzt die jetzt im Objekt vorhandene ID (z.B. "ch:1:sloid:8100:2:3")
        const stopParam = stop.stopPointRef || stop.name;
        
        // ✅ GEÄNDERT: Datum + Zeit mit übergeben
        const stsUrl = arrivalDate && arrivalTimeForUrl
            ? `https://nowe.stellwerksim.ch/?stop=${encodeURIComponent(stopParam)}&date=${encodeURIComponent(arrivalDate)}&time=${encodeURIComponent(arrivalTimeForUrl)}`
            : `https://nowe.stellwerksim.ch/?stop=${encodeURIComponent(stopParam)}`;

        const chainInfo = `<div class="chain-info">
            <span class="chain-name">
                <a href="${stsUrl}">${stop.name}</a>${accessIcon(stop.accessibility)}
            </span>
            ${quayLine}
        </div>`;

        const rowClass = isThisStop ? 'chain-stop this-call' : 'chain-stop';
        html += `
            <div class="${rowClass}">
                ${timesHtml}
                ${dotHtml}
                ${chainInfo}
            </div>
        `;

        // ── Ausfälle für diesen Stop ──────────────────────────────────────
        if (trip.situations) {
            for (const [sitId, sit] of Object.entries(trip.situations)) {
                // Prüfe, ob dieser Stop betroffen ist
                const isAffected = sit.affectedStops.includes(stop.stopPointRef) 
                                || sit.affectedStops.includes(stop.name);
                
                if (isAffected && sit.summary) {
                    const severityClass = sit.severity.toLowerCase() === 'störung' 
                                        ? 'situation-alert--disruption'
                                        : 'situation-alert--warning';
                    
                    html += `
                        <div class="situation-alert ${severityClass}">
                            <span class="situation-icon">⚠</span>
                            <span class="situation-text">${sit.summary}</span>
                        </div>
                    `;
                }
            }
        }
    });

    html += '</div>';
    return html;
}