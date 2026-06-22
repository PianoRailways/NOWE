// ─── Konfiguration ────────────────────────────────────────────────────────────

const TRIP_API_CONFIG = {
    PROXY_URL:     './trip-proxy.php',
    REQUESTOR_REF: 'NOWE26'
};

// ─── OJP TripInfo XML Request ────────────────────────────────────────────────

function createTripInfoRequest(swissJourneyId, operatingDay) {
    const now = new Date().toISOString();
    return `<?xml version="1.0" encoding="UTF-8"?>
<OJP xmlns="http://www.vdv.de/ojp"
     xmlns:siri="http://www.siri.org.uk/siri"
     version="1.0">
  <OJPRequest>
    <siri:ServiceRequest>
      <siri:ServiceRequestContext>
        <siri:Language>de</siri:Language>
      </siri:ServiceRequestContext>
      <siri:RequestTimestamp>${now}</siri:RequestTimestamp>
      <siri:RequestorRef>${TRIP_API_CONFIG.REQUESTOR_REF}</siri:RequestorRef>
      <OJPTripInfoRequest>
        <siri:RequestTimestamp>${now}</siri:RequestTimestamp>
        <JourneyRef>${swissJourneyId}</JourneyRef>
        <OperatingDayRef>${operatingDay}</OperatingDayRef>
        <Params>
          <IncludeCalls>true</IncludeCalls>
          <IncludeService>true</IncludeService>
          <IncludeTrackProjection>false</IncludeTrackProjection>
          <IncludePlacesContext>false</IncludePlacesContext>
          <IncludeSituationsContext>true</IncludeSituationsContext>
        </Params>
      </OJPTripInfoRequest>
    </siri:ServiceRequest>
  </OJPRequest>
</OJP>`;
}

// ─── Timezone Helper: UTC ISO → Europe/Zurich ISO (ohne Z) ──────────────────

function utcToLocalISO(utcString) {
    if (!utcString) return null;
    try {
        const d = new Date(utcString);
        const fmt = new Intl.DateTimeFormat('sv-SE', {
            timeZone: 'Europe/Zurich',
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit'
        });
        const p = fmt.formatToParts(d);
        const f = (t) => p.find(x => x.type === t).value;
        return `${f('year')}-${f('month')}-${f('day')}T${f('hour')}:${f('minute')}:${f('second')}`;
    } catch (e) {
        return null;
    }
}

// ─── Delay in Sekunden (kann negativ sein) ───────────────────────────────────

function calcDelaySeconds(timetabled, estimated) {
    if (!timetabled || !estimated) return null;
    const diff = new Date(estimated) - new Date(timetabled);
    if (isNaN(diff)) return null;
    return Math.round(diff / 1000);
}

// ─── Rollstuhl-Status aus NameSuffix ─────────────────────────────────────────

function parseAccessibility(nameSuffix) {
    if (!nameSuffix) return null;
    const v = nameSuffix.trim().toUpperCase();
    if (v === 'ALTERNATIVE_TRANSPORT') return 'ALT_TRANSPORT';
    if (v === 'PLATFORM_ACCESS_WITHOUT_ASSISTANCE') return 'ACCESSIBLE';
    if (v === 'PLATFORM_ACCESS_WITH_ASSISTANCE') return 'ASSISTANCE';
    if (v === 'PLATFORM_ACCESS_WITH_ASSISTANCE_WHEN_NOTIFIED') return 'NOTIFY';
    if (v === 'PLATFORM_NOT_WHEELCHAIR_ACCESSIBLE') return 'NO_BEHIG';
    return null;
}

// ─── Situation-Parser (Ausfälle, Fahrplanänderungen) ──────────────────────────

function parseSituations(xmlDoc) {
    const situations = {};
    const sitElements = xmlDoc.getElementsByTagName('PtSituation');

    for (let i = 0; i < sitElements.length; i++) {
        const sit = sitElements[i];
        const sitId = sit.getAttribute('siri:id') || sit.getAttribute('id') || `sit-${i}`;

        // Summary und Description extrahieren
        const summaryText = sit.getElementsByTagName('Summary')[0]
                              ?.getElementsByTagName('Text')[0]?.textContent?.trim() || '';
        const descText = sit.getElementsByTagName('Description')[0]
                           ?.getElementsByTagName('Text')[0]?.textContent?.trim() || '';

        // Severity: 'Normale', 'Warnung', 'Störung'
        const severity = sit.getElementsByTagName('Severity')[0]?.textContent?.trim() || 'Normale';

        // Affected StopPoints
        const affectedStops = [];
        const stopRefs = sit.getElementsByTagName('siri:StopPointRef');
        for (let j = 0; j < stopRefs.length; j++) {
            const stopRef = stopRefs[j].textContent?.trim();
            if (stopRef) affectedStops.push(stopRef);
        }

        // Fallback: auch non-namespaced StopPointRef versuchen
        if (affectedStops.length === 0) {
            const stopRefsNoNS = sit.getElementsByTagName('StopPointRef');
            for (let j = 0; j < stopRefsNoNS.length; j++) {
                const stopRef = stopRefsNoNS[j].textContent?.trim();
                if (stopRef) affectedStops.push(stopRef);
            }
        }

        if (summaryText) {
            situations[sitId] = {
                summary: summaryText,
                description: descText,
                severity,
                affectedStops
            };
        }
    }

    return situations;
}

// ─── Parser ───────────────────────────────────────────────────────────────────

function parseTripInfoResponse(xmlString) {
    const parser  = new DOMParser();
    const xmlDoc  = parser.parseFromString(xmlString, 'text/xml');

    // ── Situations zuerst extrahieren ────────────────────────────────────────
    const situations = parseSituations(xmlDoc);

    const results = xmlDoc.getElementsByTagName('TripInfoResult');
    if (results.length === 0) {
        console.warn('⚠️ Kein TripInfoResult gefunden');
        return null;
    }
    const result = results[0];

    // ── Service ──────────────────────────────────────────────────────────────
    const svc = result.getElementsByTagName('Service')[0];
    if (!svc) {
        console.warn('⚠️ Kein Service-Element');
        return null;
    }

    const g = (el, tag, idx = 0) => {
        const nodes = el.getElementsByTagName(tag);
        return nodes[idx]?.textContent?.trim() || '';
    };

    const trainNumber  = g(svc, 'TrainNumber');
    const publicCode   = g(svc, 'PublicCode');
    const destination  = svc.getElementsByTagName('DestinationText')[0]
                            ?.getElementsByTagName('Text')[0]?.textContent?.trim() || '';
    const operatorRef  = svc.getElementsByTagName('siri:OperatorRef')[0]?.textContent?.trim()
                      || svc.getElementsByTagName('OperatorRef')[0]?.textContent?.trim()
                      || '';

    // Kategorie: ProductCategory/ShortName/Text, Fallback Mode/ShortName/Text
    const prodCat = svc.getElementsByTagName('ProductCategory')[0];
    const category = prodCat
        ? prodCat.getElementsByTagName('ShortName')[0]
              ?.getElementsByTagName('Text')[0]?.textContent?.trim() || publicCode
        : (svc.getElementsByTagName('Mode')[0]
              ?.getElementsByTagName('ShortName')[0]
              ?.getElementsByTagName('Text')[0]?.textContent?.trim() || publicCode);

    // ── PreviousCalls (schon abgefahrene Stops) ─────────────────────────────
    const previousCalls = result.getElementsByTagName('PreviousCall');
    
    // ── ThisCall (aktueller Stop) ───────────────────────────────────────────
    const thisCall = result.getElementsByTagName('ThisCall')[0];
    
    // ── OnwardCalls (alle zukünftigen Stops) ────────────────────────────────
    const onwardCalls = result.getElementsByTagName('OnwardCall');

    const stops = [];
    let allCalls = [];

    // PreviousCalls hinzufügen (in Reihenfolge)
    for (let i = 0; i < previousCalls.length; i++) {
        allCalls.push({ element: previousCalls[i], isPreviousCall: true });
    }

    // ThisCall hinzufügen (falls vorhanden)
    if (thisCall) {
        allCalls.push({ element: thisCall, isThisCall: true });
    }

    // OnwardCalls hinzufügen
    for (let i = 0; i < onwardCalls.length; i++) {
        allCalls.push({ element: onwardCalls[i], isOnwardCall: true });
    }

    if (allCalls.length === 0) {
        console.warn('⚠️ Keine Calls gefunden (weder PreviousCalls noch ThisCall noch OnwardCalls)');
        return null;
    }

    console.log(`📍 Trip: ${previousCalls.length} vorherige + ${thisCall ? 1 : 0} aktuelle + ${onwardCalls.length} zukünftige = ${allCalls.length} Stops`);

    // Alle Calls durchlaufen
    allCalls.forEach((callData) => {
        const c = callData.element;

        const name = c.getElementsByTagName('StopPointName')[0]
                      ?.getElementsByTagName('Text')[0]?.textContent?.trim() || 'Unbekannt';

        // Quay-Extraktion: Versuche mehrere Orte
        // 1. PlannedQuay direkt im Call
        let quay = c.getElementsByTagName('PlannedQuay')[0]?.textContent?.trim() || '';
        
        // 2. Falls leer, versuche im StopPoint/PlannedQuayRef
        if (!quay) {
            const stopPoint = c.getElementsByTagName('StopPoint')[0];
            quay = stopPoint?.getElementsByTagName('PlannedQuayRef')[0]?.textContent?.trim() || '';
        }
        
        // 3. Falls noch leer, versuche EstimatedQuay
        if (!quay) {
            quay = c.getElementsByTagName('EstimatedQuay')[0]?.textContent?.trim() || '';
        }

        const nameSuffix = c.getElementsByTagName('NameSuffix')[0]
                            ?.getElementsByTagName('Text')[0]?.textContent?.trim() || '';
        const accessibility = parseAccessibility(nameSuffix);

        // Ankunft
        const arrEl  = c.getElementsByTagName('ServiceArrival')[0];
        const arrTT  = arrEl?.getElementsByTagName('TimetabledTime')[0]?.textContent || null;
        const arrEst = arrEl?.getElementsByTagName('EstimatedTime')[0]?.textContent  || null;

        // Abfahrt
        const depEl  = c.getElementsByTagName('ServiceDeparture')[0];
        const depTT  = depEl?.getElementsByTagName('TimetabledTime')[0]?.textContent || null;
        const depEst = depEl?.getElementsByTagName('EstimatedTime')[0]?.textContent  || null;

        const arrDelaySec = calcDelaySeconds(arrTT, arrEst);
        const depDelaySec = calcDelaySeconds(depTT, depEst);

		// Sucht das ID-Tag im aktuellen Call (unter Berücksichtigung des Namespaces)
		const stopPointRef = c.getElementsByTagName('siri:StopPointRef')[0]?.textContent?.trim()
                  || c.getElementsByTagName('StopPointRef')[0]?.textContent?.trim()
                  || '';

        // Request Stop (Halt auf Verlangen)
        const isRequestStop = c.getElementsByTagName('RequestStop')[0]?.textContent === 'true';

        stops.push({
            name,
			stopPointRef,
            quay,
            accessibility,  // 'ACCESSIBLE' | 'ALT_TRANSPORT' | null
            requestStop:    isRequestStop,  // Halt auf Verlangen
            isThisCall: callData.isThisCall,  // Markiert den aktuellen Stop
            arrival: {
                timetabled: arrTT  ? utcToLocalISO(arrTT)  : null,
                estimated:  arrEst ? utcToLocalISO(arrEst) : null,
                delaySec:   arrDelaySec
            },
            departure: {
                timetabled: depTT  ? utcToLocalISO(depTT)  : null,
                estimated:  depEst ? utcToLocalISO(depEst) : null,
                delaySec:   depDelaySec
            }
        });
    });

    const trip = { 
        trainNumber, 
        line: publicCode, 
        category, 
        destination, 
        operatorRef, 
        stops,
        situations    // ← Situations hinzufügen
    };
    
    console.log(`✅ Trip: ${category} ${publicCode} Nr. ${trainNumber} → ${destination}`);
    console.log(`📊 Stop-Details: ${stops.length} Halte`);
    if (stops.length > 0) {
        console.log(`   - First: ${stops[0]?.name} (Abf: ${stops[0]?.departure.timetabled}) Gl. ${stops[0]?.quay || 'N/A'}`);
        console.log(`   - Last:  ${stops[stops.length-1]?.name} (Ank: ${stops[stops.length-1]?.arrival.timetabled}) Gl. ${stops[stops.length-1]?.quay || 'N/A'}`);
        console.log(`   - Alle Stops:`, stops.map((s, i) => `[${i}] ${s.name} (${s.quay || '-'})`).join(' → '));
    }
    if (Object.keys(situations).length > 0) {
        console.log(`⚠️  Situationen gefunden:`, situations);
    }
    
    return trip;
}

// ─── Öffentliche Funktion ─────────────────────────────────────────────────────

export async function fetchTripInfo(swissJourneyId, operatingDay = null) {
    if (!swissJourneyId?.trim()) throw new Error('Keine gültige SwissJourneyID');

    if (!operatingDay) {
        operatingDay = new Date().toISOString().split('T')[0];
    }

    const xmlBody = createTripInfoRequest(swissJourneyId.trim(), operatingDay);
    console.log(`📤 TripInfo: ${swissJourneyId} / ${operatingDay}`);

    const response = await fetch(TRIP_API_CONFIG.PROXY_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/xml' },
        body:    xmlBody
    });

    if (!response.ok) {
        const err = await response.text();
        throw new Error(`Proxy ${response.status}: ${err}`);
    }

    const xml = await response.text();
    return parseTripInfoResponse(xml);
}