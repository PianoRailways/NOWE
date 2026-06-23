// Setup beim Laden
document.addEventListener("DOMContentLoaded", () => {
    document.getElementById('date').value = new Date().toISOString().split('T')[0];

    const trainInput = document.getElementById('trainNumber');
    const urlParams = new URLSearchParams(window.location.search);
    const trainParam = urlParams.get('train');

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
                    if (data.error && data.error.includes('Rate Limit')) {
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

    // HTML aufbauen
    let html = `
        <div class="stop-selector">
            <label class="stop-label">Haltestelle wählen</label>
            <select id="stopSelect" onchange="updateFormationView(this.value)">
    `;

    stops.forEach((stop, idx) => {
        html += `<option value="${idx}">${stop.name}</option>`;
    });

    html += `
            </select>
            <input type="range" id="stopSlider" min="0" max="${stops.length - 1}" value="0" onchange="updateFormationView(this.value)">
            <div class="stop-counter" id="stopCounter">1/${stops.length}</div>
        </div>

        <div class="stop-name" id="stopName">-</div>

        <div class="stop-info">
            <div class="stop-info-item">
                <div class="stop-info-label">Gleis</div>
                <div class="stop-info-value" id="stopTrack">-</div>
            </div>
            <div class="stop-info-item">
                <div class="stop-info-label">Ankunft</div>
                <div class="stop-info-value" id="stopArrival">-</div>
            </div>
            <div class="stop-info-item">
                <div class="stop-info-label">Abfahrt</div>
                <div class="stop-info-value" id="stopDeparture">-</div>
            </div>
            <div class="stop-info-item">
                <div class="stop-info-label">Wagen</div>
                <div class="stop-info-value" id="vehicleCount">-</div>
            </div>
        </div>

        <div class="formation-title">Formation</div>
        <div class="formation-grid" id="vehiclesContainer"></div>
    `;

    resultDiv.innerHTML = html;

    window.formationData = {
        vehicles: vehicles,
        stops: stops
    };

    updateFormationView(0);
}

function updateFormationView(stopIdx) {
    if (!window.formationData) return;

    stopIdx = parseInt(stopIdx);
    const { vehicles, stops } = window.formationData;
    const stop = stops[stopIdx];

    document.getElementById('stopSlider').value = stopIdx;
    document.getElementById('stopSelect').value = stopIdx;
    document.getElementById('stopCounter').textContent = `${stopIdx + 1}/${stops.length}`;

    const firstVehicleStop = vehicles[0]?.formationVehicleAtScheduledStops[stopIdx];

    document.getElementById('stopName').textContent = stop.name;
    document.getElementById('stopTrack').textContent = firstVehicleStop?.track || '-';

    const arrival = firstVehicleStop?.stopTime?.arrivalTime;
    const departure = firstVehicleStop?.stopTime?.departureTime;

    document.getElementById('stopArrival').textContent = arrival ? formatTime(arrival) : '-';
    document.getElementById('stopDeparture').textContent = departure ? formatTime(departure) : '-';
    document.getElementById('vehicleCount').textContent = `${vehicles.length}`;

    renderVehicles(vehicles, stopIdx);
}

function renderVehicles(vehicles, stopIdx) {
    const container = document.getElementById('vehiclesContainer');
    container.innerHTML = '';

    vehicles.forEach((vehicle, vIdx) => {
        const stopData = vehicle.formationVehicleAtScheduledStops[stopIdx];
        if (!stopData) return;

        const props = vehicle.vehicleProperties || {};
        const accessibility = props.accessibilityProperties || {};
        const typeCode = vehicle.vehicleIdentifier?.typeCodeName || 'Wagen';

        let classColor = '';
        if (props.numberRestaurantSpace > 0) {
            classColor = 'class-restaurant';
        } else if (props.number1class > 0 && props.number2class > 0) {
            classColor = 'class-both';
        } else if (props.number1class > 0) {
            classColor = 'class-1';
        } else if (props.number2class > 0) {
            classColor = 'class-2';
        }

        const card = document.createElement('div');
        card.className = 'wagon-card';
        card.onclick = () => showDetails(vehicle, stopData, vIdx);

        // KORREKTUR & ERWEITERUNG: Wagenübergänge prüfen (Standard ist offen, außer explizit false)
        const transitionPrev = stopData.accessToPreviousVehicle !== false ? '✓' : '✖';
        const transitionNext = stopData.accessToNextVehicle !== false ? '✓' : '✖';
        const prevColor = stopData.accessToPreviousVehicle !== false ? '#4ade80' : '#f87171'; // Grün vs Rot
        const nextColor = stopData.accessToNextVehicle !== false ? '#4ade80' : '#f87171';

        // KORREKTUR: "Wagen 31 (Pos. 12)" Logik im Header eingebaut
        let html = `
            <div class="wagon-header ${classColor}">
                <div>${typeCode}</div>
                <div class="wagon-number" style="text-align: right; line-height: 1.2;">
                    <div>Wagen ${vehicle.number || '-'}</div>
                    <div style="font-size: 0.75em; opacity: 0.8; font-weight: normal;">(Pos. ${vehicle.position || '-'})</div>
                </div>
            </div>
            <div class="wagon-content">
        `;

        if (stopData.sectors) {
            html += `
                <div class="wagon-sector">
                    <div class="wagon-sector-label">Sektor</div>
                    <div class="wagon-sector-value">${stopData.sectors}</div>
                </div>
            `;
        }

        if (props.number1class > 0 || props.number2class > 0) {
            html += `<div class="wagon-classes">`;
            if (props.number1class > 0) {
                html += `<div class="class-badge first">${props.number1class}×1</div>`;
            }
            if (props.number2class > 0) {
                html += `<div class="class-badge second">${props.number2class}×2</div>`;
            }
            html += `</div>`;
        }

        // NEU: Darstellung der Wagenübergänge vor den Features
        html += `
            <div class="wagon-transitions" style="display: flex; justify-content: space-between; font-size: 0.75em; margin-bottom: 8px; padding: 4px 0; border-bottom: 1px solid rgba(255,255,255,0.05); color: var(--text-dim);">
                <span>Übergang Vorn: <b style="color: ${prevColor}">${transitionPrev}</b></span>
                <span>Hinten: <b style="color: ${nextColor}">${transitionNext}</b></span>
            </div>
        `;

        html += `<div class="wagon-features">`;
        html += `<div class="feature-icon ${props.bikePlatform ? 'active' : 'disabled'}">🚲 V</div>`;
        html += `<div class="feature-icon ${accessibility.wheelchairToilet ? 'active' : 'disabled'}">🚻 WC</div>`;
        html += `<div class="feature-icon ${accessibility.wheelchairSymbolProperties?.foldingRamp ? 'active' : 'disabled'}">↓ R</div>`;
        html += `<div class="feature-icon ${accessibility.wheelchairSymbolProperties?.gapBridging ? 'active' : 'disabled'}">━ B</div>`;
        html += `<div class="feature-icon ${props.climated ? 'active' : 'disabled'}">❄ K</div>`;
        const wcSpaces = accessibility.numberWheelchairSpaces || 0;
        html += `<div class="feature-icon ${wcSpaces > 0 ? 'active' : 'disabled'}">♿ ${wcSpaces}</div>`;
        html += `</div>`;
        html += `</div>`;

        card.innerHTML = html;
        container.appendChild(card);
    });
}

function showDetails(vehicle, stopData, vIdx) {
    const props = vehicle.vehicleProperties;
    const accessibility = props.accessibilityProperties || {};

    // Die "vehicle.number" entspricht der Anzeigennummer (Perron), 
    // "vehicle.position" ist die physische Reihung (z.B. 1. Wagen ab Lok).
    let html = `
        <div class="modal-title">
            ${vehicle.vehicleIdentifier.typeCodeName} 
            <span style="font-size: 0.8em; opacity: 0.7; margin-left: 10px;">
                Wagen ${vehicle.number || '-'} (Pos. ${vehicle.position || '-'})
            </span>
        </div>

        <div class="modal-grid">
            <div class="detail-group">
                <div class="detail-group-title">Allgemein</div>
                <div class="detail-row"><span class="detail-label">Wagennummer:</span> <span class="detail-value">${vehicle.number || '-'}</span></div>
                <div class="detail-row"><span class="detail-label">Physische Position:</span> <span class="detail-value">${vehicle.position || '-'}</span></div>
                <div class="detail-row"><span class="detail-label">Tech. Wagennr.:</span> <span class="detail-value">${vehicle.vehicleIdentifier.vehicleNumber || '-'}</span></div>
                <div class="detail-row"><span class="detail-label">EVN:</span> <span class="detail-value" style="font-size: 0.8em;">${vehicle.vehicleIdentifier.evn || '-'}</span></div>
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
    overlay.style.display = 'flex';
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