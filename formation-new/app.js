// Setup beim Laden
document.addEventListener("DOMContentLoaded", () => {
    document.getElementById('date').value = new Date().toISOString().split('T')[0];

    const trainInput = document.getElementById('trainNumber');
    const evuSelect = document.getElementById('evu');
    const urlParams = new URLSearchParams(window.location.search);
    
    const trainParam = urlParams.get('train');
    const evuParam = urlParams.get('evu');

    if (evuParam && evuSelect) {
        evuSelect.value = evuParam;
    }

    if (trainParam && trainInput) {
        trainInput.value = trainParam;
        fetchFormation();
    }

    if (trainInput) {
        trainInput.addEventListener("keypress", function(event) {
            if (event.key === "Enter") {
                event.preventDefault();
                fetchFormation();
            }
        });
    }
});

async function fetchFormation() {
    const resultDiv = document.getElementById('result');
    const train = document.getElementById('trainNumber').value;
    const date = document.getElementById('date').value;
    const evu = document.getElementById('evu').value;

    if (!train || !date) {
        resultDiv.innerHTML = `<div class="error-message">⚠ Bitte Zugnummer und Datum eingeben.</div>`;
        return;
    }

    resultDiv.innerHTML = `<div class="info-message">⏳ Lade Formation...</div>`;

    const operators = evu ? [evu] : ['SBBP', 'SOB', 'BLSP', 'TPF', 'RhB', 'THURBO', 'TRN', 'ZB', 'MBC', 'OeBB', 'VDBB'];
    let foundData = null;
    let successfulEvu = '';
    let rateLimitHit = false;

    for (const operator of operators) {
        resultDiv.innerHTML = `<div class="info-message">⏳ Suche bei ${operator}...</div>`;

        try {
            const response = await fetch(`./proxy.php?trainNumber=${encodeURIComponent(train)}&operationDate=${encodeURIComponent(date)}&evu=${encodeURIComponent(operator)}`);
            const responseText = await response.text();

            try {
                const jsonStartIndex = responseText.indexOf('{');
                if (jsonStartIndex !== -1) {
                    const cleanJson = responseText.substring(jsonStartIndex);
                    const data = JSON.parse(cleanJson);

                    // Rate Limit erkannt
                    const errorMessage = typeof data.error === 'string'
                        ? data.error
                        : data.error?.message;
                    if (errorMessage?.includes('Rate Limit')) {
                        rateLimitHit = true;
                        continue;
                    }

                    // Andere Fehler ignorieren (z.B. "There were no formation data.")
                    if (data.error) continue;

                    if (data.formations && data.formations.length > 0) {
                        foundData = data;
                        successfulEvu = operator;
                        break;
                    }
                }
            } catch (jsonError) {
                console.warn(`Kein JSON bei ${operator}`);
            }
        } catch (error) {
            console.warn(`Fehler bei ${operator}`);
        }
    }

    if (!foundData) {
        if (rateLimitHit) {
            resultDiv.innerHTML = `<div class="error-message">⚠ API Rate Limit erreicht. Bitte versuchen Sie es in einer Minute erneut.</div>`;
        } else {
            resultDiv.innerHTML = `<div class="error-message">❌ Keine Formationsdaten gefunden.</div>`;
        }
        return;
    }

    const formation = foundData.formations[0];
    const vehicles = formation.formationVehicles;

    // Alle eindeutigen Haltestellen sammeln
    const stops = [];
    const stopMap = {};

    vehicles.forEach((vehicle) => {
        vehicle.formationVehicleAtScheduledStops.forEach((stop) => {
            if (!stopMap[stop.stopPoint.name]) {
                stopMap[stop.stopPoint.name] = {
                    name: stop.stopPoint.name,
                    uic: stop.stopPoint.uic,
                    index: stops.length
                };
                stops.push(stopMap[stop.stopPoint.name]);
            }
        });
    });

    const html = `
        <div class="stop-chain" id="stopChain"></div>
        <div class="related-journeys" aria-label="Verbundene Fahrten">
            <div class="related-journey">
                <span class="related-journey-label">Vorherige Fahrt</span>
                <a class="related-journey-value" id="previousTrainNumber">-</a>
            </div>
            <div class="related-journey">
                <span class="related-journey-label">Nachfolgende Fahrt</span>
                <a class="related-journey-value" id="nextTrainNumber">-</a>
            </div>
        </div>
    `;

    resultDiv.innerHTML = html;

    window.formationData = {
        vehicles: vehicles,
        stops: stops,
        relationships: foundData.relationships || []
    };

    updateRelatedJourneys(foundData.relationships || []);

    renderStopChain();
}

function updateRelatedJourneys(relationships) {
    // Mapping der TOCodes auf die entsprechenden EVU-Kürzel
    const toCodeMap = {
        '33': 'BLSP',
        '11': 'SBBP',
        '82': 'SOB',
        '86': 'zb',
        '53': 'TPF',
        '72': 'RhB',
        '65': 'THURBO',
        '43': 'CJ',
        '73': 'TRN',
    };

    const previousJourney = relationships.find((relationship) =>
        relationship.vehicleRelationshipDetails?.direction === 'V'
    );
    const nextJourney = relationships.find((relationship) =>
        relationship.vehicleRelationshipDetails?.direction === 'N'
    );

    // Vorherige Fahrt verarbeiten
    const prevMeta = previousJourney?.advancedJourneyInformation1?.trainMetaInformation;
    const prevNumber = prevMeta?.trainNumber;
    const prevToCode = prevMeta?.toCode;
    const prevElement = document.getElementById('previousTrainNumber');
    
    if (prevNumber) {
        prevElement.textContent = prevNumber;
        let prevUrl = `./?train=${encodeURIComponent(prevNumber)}`;
        if (prevToCode && toCodeMap[prevToCode]) {
            prevUrl += `&evu=${encodeURIComponent(toCodeMap[prevToCode])}`;
        }
        prevElement.href = prevUrl;
    } else {
        prevElement.textContent = '-';
        prevElement.removeAttribute('href');
    }

    // Nachfolgende Fahrt verarbeiten
    const nextMeta = nextJourney?.advancedJourneyInformation1?.trainMetaInformation;
    const nextNumber = nextMeta?.trainNumber;
    const nextToCode = nextMeta?.toCode;
    const nextElement = document.getElementById('nextTrainNumber');

    if (nextNumber) {
        nextElement.textContent = nextNumber;
        let nextUrl = `./?train=${encodeURIComponent(nextNumber)}`;
        if (nextToCode && toCodeMap[nextToCode]) {
            nextUrl += `&evu=${encodeURIComponent(toCodeMap[nextToCode])}`;
        }
        nextElement.href = nextUrl;
    } else {
        nextElement.textContent = '-';
        nextElement.removeAttribute('href');
    }
}

const FLIP_DIRECTION = false;

function renderStopChain() {
    const { vehicles, stops } = window.formationData;
    const chain = document.getElementById('stopChain');
    chain.innerHTML = stops.map((stop, idx) => {
        const stopData = vehicles[0]?.formationVehicleAtScheduledStops[idx];
        const isFirst = idx === 0;
        const isLast = idx === stops.length - 1;
        const arrival = stopData?.stopTime?.arrivalTime;
        const departure = stopData?.stopTime?.departureTime;
        const times = isFirst
            ? `<span class="chain-time">${departure ? formatTime(departure) : '--:--'}</span>`
            : isLast
                ? `<span class="chain-time">${arrival ? formatTime(arrival) : '--:--'}</span>`
                : `<span class="chain-time">${arrival ? formatTime(arrival) : '--:--'}</span><span class="chain-time">${departure ? formatTime(departure) : '--:--'}</span>`;
        return `
            <section class="formation-stop" data-stop-index="${idx}">
                <button class="formation-stop-row" type="button" onclick="toggleStop(${idx})">
                    <span class="chain-times">${times}</span>
                    <span class="chain-marker"><span class="chain-dot"></span></span>
                    <span class="chain-stop-text"><strong>${stop.name}</strong><small>Gl. ${stopData?.track || '-'}</small></span>
                    <span class="stop-arrow" aria-hidden="true">›</span>
                </button>
                <div class="formation-panel" id="formation-panel-${idx}"></div>
            </section>`;
    }).join('');

    const now = Date.now();
    let openIndex = stops.findIndex((stop, idx) => {
        const data = vehicles[0]?.formationVehicleAtScheduledStops[idx];
        const time = idx === stops.length - 1 ? data?.stopTime?.arrivalTime : data?.stopTime?.departureTime;
        return time && new Date(time).getTime() >= now;
    });
    toggleStop(openIndex >= 0 ? openIndex : 0);
}

function toggleStop(stopIdx) {
    const { vehicles } = window.formationData;
    document.querySelectorAll('.formation-stop').forEach((stop, idx) => {
        const open = idx === stopIdx;
        stop.classList.toggle('is-open', open);
        const panel = stop.querySelector('.formation-panel');
        if (open) {
            panel.innerHTML = renderFormationStrip(vehicles, idx);
        } else {
            panel.innerHTML = '';
        }
    });
}

function renderFormationStrip(vehicles, stopIdx) {
    const available = vehicles.map((vehicle, index) => ({
        vehicle,
        stopData: vehicle.formationVehicleAtScheduledStops[stopIdx],
        index
    })).filter(item => item.stopData);
    const ordered = FLIP_DIRECTION ? [...available].reverse() : available;
    const sectors = [];
    ordered.forEach((item, index) => {
        const sector = item.stopData.sectors || '';
        const previous = sectors[sectors.length - 1];
        if (previous && previous.sector === sector) previous.count++;
        else sectors.push({ sector, count: 1 });
    });
    const sectorHtml = sectors.map(group => `<span class="sector-group" style="--span:${group.count}">${group.sector ? `<b><span>Sektor ${group.sector}</span></b>` : ''}</span>`).join('');
    const direction = window.formationData.stops.at(-1)?.name || '-';
    const wagonHtml = ordered.map((item, index) => renderWagon(item.vehicle, item.stopData, item.index, index, ordered, stopIdx)).join('');
    return `<div class="formation-strip" style="--wagon-count:${ordered.length}">
        <div class="sector-bar">${sectorHtml}</div>
        <div class="formation-direction">← Richtung ${direction}</div>
        <div class="wagon-row">${wagonHtml}</div>
    </div>`;
}

function iconSvg(type) {
    const paths = {
        wheelchair: '<circle cx="7" cy="3" r="2"/><path d="M7 7h3l2 3m-5-3-1 5 4 3m-4-3H4m3-5 4 5h3"/>',
        bike: '<circle cx="4" cy="14" r="2"/><circle cx="14" cy="14" r="2"/><path d="m4 14 3-7h4l3 7M7 7l-2-2h3m2 2 2-3"/>',
        stroller: '<circle cx="5" cy="15" r="1.5"/><circle cx="14" cy="15" r="1.5"/><path d="M4 13h8l2-7H6m0 0L5 3H3"/>'
    };
    return `<svg viewBox="0 0 18 18" aria-hidden="true">${paths[type]}</svg>`;
}

function renderWagon(vehicle, stopData, vIdx, index, ordered, stopIdx) {
    const props = vehicle.vehicleProperties || {};
    const accessibility = props.accessibilityProperties || {};
    const hasSeats = props.number1class > 0 || props.number2class > 0 || props.numberRestaurantSpace > 0;
    const transitionOpen = stopData.accessToNextVehicle !== false && ordered[index + 1]?.stopData.accessToPreviousVehicle !== false;
    const badges = props.numberRestaurantSpace > 0 ? '<span class="restaurant-badge">R</span>' :
        `${props.number1class > 0 ? '<span class="class-badge first">1</span>' : ''}${props.number2class > 0 ? '<span class="class-badge second">2</span>' : ''}`;
    const icons = [
        (accessibility.numberWheelchairSpaces > 0 || accessibility.wheelchairToilet) ? iconSvg('wheelchair') : '',
        props.bikePlatform ? iconSvg('bike') : '',
        props.pictoProperties?.strollerPicto ? iconSvg('stroller') : '',
        props.lowFloorTrolley ? '<strong>NF</strong>' : ''
    ].filter(Boolean).join('');
    return `<div class="wagon-unit">
        <button class="wagon-card ${!hasSeats ? 'wagon-empty' : ''} ${props.numberRestaurantSpace > 0 ? 'wagon-restaurant' : ''}" type="button" onclick="event.stopPropagation(); showDetails(window.formationData.vehicles[${vIdx}], window.formationData.vehicles[${vIdx}].formationVehicleAtScheduledStops[${stopIdx}], ${vIdx})">
            <span class="wagon-class-bar"></span><span class="wagon-badges">${badges}</span><span class="wagon-number">${vehicle.number || '-'}</span>
        </button>
        <span class="wagon-icons">${icons}</span>
        ${index < ordered.length - 1 ? `<span class="wagon-connection ${transitionOpen ? '' : 'is-closed'}">${transitionOpen ? '' : '✕'}</span>` : ''}
    </div>`;
}

function showDetails(vehicle, stopData, vIdx) {
    const props = vehicle.vehicleProperties;
    const accessibility = props.accessibilityProperties || {};

    // Die "vehicle.number" entspricht der Anzeigennummer (Perron), 
    // "vehicle.position" ist die physische Reihung (z.B. 1. Wagen ab Lok).
    let html = `
        <div class="modal-title">
            <div class="modal-title-main">${vehicle.vehicleIdentifier.typeCodeName}</div>
            <div class="modal-title-meta">
                <span class="modal-badges">${props.number1class > 0 ? '<span class="class-badge first">1</span>' : ''}${props.number2class > 0 ? '<span class="class-badge second">2</span>' : ''}${props.numberRestaurantSpace > 0 ? '<span class="restaurant-badge">R</span>' : ''}${accessibility.numberWheelchairSpaces > 0 || accessibility.wheelchairToilet ? iconSvg('wheelchair') : ''}${props.bikePlatform ? iconSvg('bike') : ''}${props.pictoProperties?.strollerPicto ? iconSvg('stroller') : ''}${props.lowFloorTrolley ? '<strong>NF</strong>' : ''}</span>
                Wagen ${vehicle.number || '-'} (Pos. ${vehicle.position || '-'})
            </div>
        </div>

        <div class="modal-grid">
            <div class="detail-group">
                <div class="detail-group-title">Allgemein</div>
                <div class="detail-row"><span class="detail-label">Wagennummer:</span> <span class="detail-value">${vehicle.number || '-'}</span></div>
                <div class="detail-row"><span class="detail-label">Physische Position:</span> <span class="detail-value">${vehicle.position || '-'}</span></div>
                <div class="detail-row"><span class="detail-label">Tech. Wagennr.:</span> <span class="detail-value">${vehicle.vehicleIdentifier.vehicleNumber || '-'}</span></div>
                <div class="detail-row"><span class="detail-label">EVN:</span> <span class="detail-value detail-value--small">${vehicle.vehicleIdentifier.evn || '-'}</span></div>
                <div class="detail-row"><span class="detail-label">Länge:</span> <span class="detail-value">${props.length || '-'} m</span></div>
                <div class="detail-row"><span class="detail-label">Sektoren:</span> <span class="detail-value">${stopData.sectors || '-'}</span></div>
            </div>

            <div class="detail-group">
                <div class="detail-group-title">Plätze</div>
                <div class="detail-row"><span class="detail-label">1. Klasse:</span> <span class="detail-value">${props.number1class || 0}</span></div>
                <div class="detail-row"><span class="detail-label">2. Klasse:</span> <span class="detail-value">${props.number2class || 0}</span></div>
                <div class="detail-row"><span class="detail-label">Restaurant:</span> <span class="detail-value">${props.numberRestaurantSpace || 0}</span></div>
                <div class="detail-row"><span class="detail-label">Betten:</span> <span class="detail-value">${props.numberBeds || 0}</span></div>
            </div>

            <div class="detail-group">
                <div class="detail-group-title">Barrierefreiheit</div>
                <div class="detail-row"><span class="detail-label">Rollstuhlplätze:</span> <span class="detail-value">${accessibility.numberWheelchairSpaces || 0}</span></div>
                <div class="detail-row"><span class="detail-label">1. Kl. Rollstuhl:</span> <span class="detail-value">${accessibility.numberWheelchairSpaces1class || 0}</span></div>
                <div class="detail-row"><span class="detail-label">2. Kl. Rollstuhl:</span> <span class="detail-value">${accessibility.numberWheelchairSpaces2class || 0}</span></div>
                <div class="detail-row"><span class="detail-label">Behindertenkompartiment:</span> <span class="detail-value">${accessibility.disabledCompartment ? '✓' : '✗'}</span></div>
            </div>

            <div class="detail-group">
                <div class="detail-group-title">Einstieg & WC</div>
                <div class="detail-row"><span class="detail-label">Klapprampe:</span> <span class="detail-value">${accessibility.wheelchairSymbolProperties?.foldingRamp ? '✓' : '✗'}</span></div>
                <div class="detail-row"><span class="detail-label">Brückenlösung:</span> <span class="detail-value">${accessibility.wheelchairSymbolProperties?.gapBridging ? '✓' : '✗'}</span></div>
                <div class="detail-row"><span class="detail-label">Einstiegshöhe:</span> <span class="detail-value">${accessibility.wheelchairSymbolProperties?.heightBoardingPlatform || 0} cm</span></div>
                <div class="detail-row"><span class="detail-label">Rollstuhl-WC:</span> <span class="detail-value">${accessibility.wheelchairToilet ? '✓' : '✗'}</span></div>
            </div>

            <div class="detail-group">
                <div class="detail-group-title">Ausstattung</div>
                <div class="detail-row"><span class="detail-label">Klima:</span> <span class="detail-value">${props.climated ? '✓' : '✗'}</span></div>
                <div class="detail-row"><span class="detail-label">Velo-Plattform:</span> <span class="detail-value">${props.bikePlatform ? '✓' : '✗'}</span></div>
                <div class="detail-row"><span class="detail-label">Notrufsystem:</span> <span class="detail-value">${props.emergencyCallSystem ? '✓' : '✗'}</span></div>
                <div class="detail-row"><span class="detail-label">Niederflur Wagen:</span> <span class="detail-value">${props.lowFloorTrolley ? '✓' : '✗'}</span></div>
            </div>

            <div class="detail-group">
                <div class="detail-group-title">Piktogramme</div>
                <div class="detail-row"><span class="detail-label">Velo:</span> <span class="detail-value">${props.pictoProperties?.bikePicto ? '✓' : '✗'}</span></div>
                <div class="detail-row"><span class="detail-label">Familie:</span> <span class="detail-value">${props.pictoProperties?.familyZonePicto ? '✓' : '✗'}</span></div>
                <div class="detail-row"><span class="detail-label">Business:</span> <span class="detail-value">${props.pictoProperties?.businessZonePicto ? '✓' : '✗'}</span></div>
                <div class="detail-row"><span class="detail-label">Kinderwagen:</span> <span class="detail-value">${props.pictoProperties?.strollerPicto ? '✓' : '✗'}</span></div>
                <div class="detail-row"><span class="detail-label">Rollstuhl:</span> <span class="detail-value">${props.pictoProperties?.wheelchairPicto ? '✓' : '✗'}</span></div>
            </div>
        </div>
    `;

    document.getElementById('modal-body').innerHTML = html;
    
    // Overlay anzeigen
    const overlay = document.getElementById('modal-overlay');
    overlay.classList.add('active');
}

function formatTime(timeString) {
    try {
        const date = new Date(timeString);
        return date.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' });
    } catch {
        return '-';
    }
}