const API_CONFIG = {
    PROXY_URL: './proxy.php',
    REQUESTOR_REF: 'NOWE26',
    LOCATION_URL: 'https://api.opentransportdata.swiss/ojp20'
};

// ─── OJP Stop-Event Request ─────────────────────────────────────────────────

function createOJPRequest(stopId, queryTime = null) {
    const now = new Date().toISOString();
    
    // Falls queryTime ein naiver String ist (z.B. aus buildISO), 
    // müssen wir sicherstellen, dass er für die Schweiz gilt.
    // Wir hängen '+02:00' (Sommerzeit) oder '+01:00' (Winterzeit) an, 
    // oder wir lassen queryTime als lokalen String, wenn die API das akzeptiert.
    // Sicherster Weg für OJP: Ein echtes ISO-Format mit Zeitzone.
    
    let depArrTime = queryTime;
    if (queryTime && !queryTime.includes('+') && !queryTime.includes('Z')) {
        // Hier könntest du prüfen, ob wir Sommer- oder Winterzeit haben.
        // Einfacher Workaround: Da du lokal suchst, 
        // konvertiere queryTime kurz in ein Date-Objekt.
        depArrTime = new Date(queryTime).toISOString(); 
    } else if (!queryTime) {
        depArrTime = now;
    }
	
	return `<?xml version="1.0" encoding="UTF-8"?>
<OJP xmlns="http://www.vdv.de/ojp"
     xmlns:siri="http://www.siri.org.uk/siri"
     version="2.0">
  <OJPRequest>
    <siri:ServiceRequest>
      <siri:RequestTimestamp>${now}</siri:RequestTimestamp>
      <siri:RequestorRef>${API_CONFIG.REQUESTOR_REF}</siri:RequestorRef>
      <OJPStopEventRequest>
        <siri:RequestTimestamp>${now}</siri:RequestTimestamp>
        <Location>
          <PlaceRef>
            <StopPlaceRef>${stopId}</StopPlaceRef>
          </PlaceRef>
          <DepArrTime>${depArrTime}</DepArrTime>
        </Location>
        <Params>
          <NumberOfResults>25</NumberOfResults>
          <StopEventType>departure</StopEventType>
          <IncludePreviousCalls>true</IncludePreviousCalls>
          <IncludeOnwardCalls>true</IncludeOnwardCalls>
          <IncludeOperatingDays>true</IncludeOperatingDays>
        </Params>
      </OJPStopEventRequest>
    </siri:ServiceRequest>
  </OJPRequest>
</OJP>`;
}

export async function fetchDepartures(stopId, queryTime = null) {
    try {
        let actualStopId = stopId;
        
        // ✅ Legacy-Fallback: Falls stopId eine alte DiDok-ID ist, resolve zu SLOID
        if (window.didokMapping && window.didokMapping[stopId]) {
            const stationName = window.didokMapping[stopId];
            console.log(`🔄 DIDOK-Fallback: "${stopId}" → "${stationName}"`);
            
            const results = await searchStops(stationName);
            if (results && results.length > 0) {
                actualStopId = String(results[0].ref);
                console.log(`✓ Aufgelöst zu SLOID: "${actualStopId}"`);
            } else {
                console.warn(`⚠️ DIDOK-Code konnte nicht aufgelöst werden: ${stopId}`);
                // Fallback: Nutze stopId direkt (wird wahrscheinlich fehlschlag)
                actualStopId = String(stopId);
            }
        }
        
        // ✅ Validierung: actualStopId muss entweder SLOID oder externe ID sein
        // SLOID: ch:1:sloid:XXXXX
        // Extern: beliebiges Format (z.B. 8014440_gen:missingSLOID_pf:1, 8718462)
        if (!/(^ch:1:sloid:\d+$|^\d{3,})/.test(actualStopId)) {
            console.warn(`⚠️ WARNUNG: Stop-ID ist nicht im erwarteten Format: "${actualStopId}". Versuche trotzdem.`);
            // Nicht werfen, aber loggen — externe IDs können ungewöhnliche Formate haben
        }

        const xmlBody = createOJPRequest(actualStopId, queryTime);
        const response = await fetch(API_CONFIG.PROXY_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/xml' },
            body: xmlBody
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Proxy-Status: ${response.status} - ${errorText}`);
        }
        const xmlData = await response.text();
        return parseOJPResponse(xmlData);
    } catch (error) {
        console.error('OJP API Error:', error);
        throw error;
    }
}

// ─── Timezone Conversion Helper ─────────────────────────────────────────────
/**
 * Konvertiert einen UTC-ISO-String der API sicher in die lokale Schweizer Zeit.
 * Gibt einen naiven ISO-String zurück (YYYY-MM-DDTHH:mm:ss).
 */
function utcToLocalISO(utcString) {
    if (!utcString) return null;
    try {
        const d = new Date(utcString);
        // "sv-SE" Format ist YYYY-MM-DD HH:mm:ss, sehr nah an ISO
        // Wir erzwingen die Europe/Zurich Zeitzone
        const localFormatter = new Intl.DateTimeFormat('sv-SE', {
            timeZone: 'Europe/Zurich',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
        
        const parts = localFormatter.formatToParts(d);
        const f = (type) => parts.find(p => p.type === type).value;
        
        return `${f('year')}-${f('month')}-${f('day')}T${f('hour')}:${f('minute')}:${f('second')}`;
    } catch (e) {
        return null;
    }
}

// ─── XML Escape Helper ──────────────────────────────────────────────────────

function escapeXml(unsafe) {
    // ✅ Konvertiere zu String, falls nicht schon einer
    const str = String(unsafe || '');
    
    return str.replace(/[<>&'"]/g, function (c) {
        switch (c) {
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '&': return '&amp;';
            case '\'': return '&apos;';
            case '"': return '&quot;';
        }
    });
}

// ─── OJP Location Information Request (Stopssuche) ──────────────────────────

function createLocationRequest(queryString) {
    const now = new Date().toISOString();
    const escapedQuery = escapeXml(queryString);
    const msgId = 'LIR-' + Math.random().toString(36).substr(2, 9);
    return `<?xml version="1.0" encoding="UTF-8"?>
<OJP xmlns="http://www.vdv.de/ojp" xmlns:siri="http://www.siri.org.uk/siri" version="2.0">
  <OJPRequest>
    <siri:ServiceRequest>
      <siri:RequestTimestamp>${now}</siri:RequestTimestamp>
      <siri:RequestorRef>${API_CONFIG.REQUESTOR_REF}</siri:RequestorRef>
      <OJPLocationInformationRequest>
        <siri:RequestTimestamp>${now}</siri:RequestTimestamp>
        <siri:MessageIdentifier>${msgId}</siri:MessageIdentifier>
        <InitialInput>
          <Name>${escapedQuery}</Name>
        </InitialInput>
        <Restrictions>
          <NumberOfResults>10</NumberOfResults>
        </Restrictions>
      </OJPLocationInformationRequest>
    </siri:ServiceRequest>
  </OJPRequest>
</OJP>`;
}

export async function searchStops(queryString) {
    try {
        const xmlBody = createLocationRequest(queryString);
        //console.log('🔍 Suche nach:', queryString);
        //console.log('📤 XML-Body:', xmlBody.substring(0, 300));
        
        const response = await fetch(API_CONFIG.PROXY_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/xml' },
            body: xmlBody
        });
        
        const xmlData = await response.text();
        //console.log('📥 Response Status:', response.status);
        //console.log('📥 Response Body:', xmlData.substring(0, 500));
        
        if (!response.ok) {
            console.warn('⚠️ Response nicht OK:', response.status);
            return [];
        }
        
        const results = parseLocationResponse(xmlData);
        //console.log('✅ Gefundene Halte:', results);
        return results;
    } catch (error) {
        console.error('❌ Location search error:', error);
        return [];
    }
}

function parseLocationResponse(xmlString) {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlString, 'text/xml');
    const results = [];
    
    if (xmlDoc.getElementsByTagName('parsererror').length > 0) {
        console.error('❌ XML Parse-Fehler:', xmlDoc.getElementsByTagName('parsererror')[0].textContent);
        return [];
    }
    
    console.log('🔍 Parsing XML, Root-Element:', xmlDoc.documentElement.tagName);
    
    let placeResults = xmlDoc.getElementsByTagName('PlaceResult');
    console.log('📍 Gefundene PlaceResult-Elemente:', placeResults.length);
    
    for (let i = 0; i < placeResults.length; i++) {
        const result = placeResults[i];
        console.log(`\n--- PlaceResult #${i} ---`);
        
        const place = result.getElementsByTagName('Place')[0];
        if (!place) {
            console.log('  ❌ Kein Place-Element gefunden');
            continue;
        }
        
        const stopPlace = place.getElementsByTagName('StopPlace')[0];
        if (!stopPlace) {
            console.log('  ❌ Kein StopPlace-Element gefunden');
            continue;
        }

        const ref = stopPlace.getElementsByTagName('StopPlaceRef')[0]?.textContent?.trim() ?? '';
        console.log(`  📌 StopPlaceRef: "${ref}"`);
        
        // Logging: Alle Namen-Quellen anschauen
        const placeName = place.getElementsByTagName('Name')[0]
            ?.getElementsByTagName('Text')[0]?.textContent?.trim() ?? '';
        const stopPlaceName = stopPlace.getElementsByTagName('StopPlaceName')[0]
            ?.getElementsByTagName('Text')[0]?.textContent?.trim() ?? '';
        
        console.log(`  📝 Place/Name/Text: "${placeName}"`);
        console.log(`  📝 StopPlace/StopPlaceName/Text: "${stopPlaceName}"`);
        
        // Verwende StopPlaceName (sauber und kurz)
        const name = stopPlaceName || placeName;
        console.log(`  ✅ Verwendet: "${name}"`);

        if (ref && name) {
            results.push({ ref, name });
            console.log(`  ➕ Zur Liste hinzugefügt`);
        } else {
            console.log(`  ⚠️ Übersprungen (ref="${ref}", name="${name}")`);
        }
    }
    
    console.log(`\n📊 Finale Ergebnisse vor Deduplication: ${results.length} Einträge`);
    const deduped = results.filter((v, i, a) => a.findIndex(t => t.ref === v.ref) === i);
    console.log(`📊 Nach Deduplication: ${deduped.length} Einträge`);
    deduped.forEach((r, idx) => console.log(`  [${idx}] ${r.name} (${r.ref})`));
    
    return deduped;
}

/**
 * Dedupliziert Abfahrten nach: Zugnummer + Zielstation
 * Priorität: Eintrag mit "Fahrplanänderung" gewinnt
 */
function deduplicateDepartures(departures) {
    const seen = new Map();
    const result = [];

    for (let i = 0; i < departures.length; i++) {
        const dep = departures[i];
        
        const onwardFingerprint = dep.calls.onward
            .map(c => c.stopRef)
            .join('|');
        
        const key = `${dep.journeyRef}|${onwardFingerprint}`;
        
        if (seen.has(key)) {
            const prevIdx = seen.get(key);
            const prev = result[prevIdx];
            
            const currHasFABA = dep.situations?.some(s => s.summary?.includes('Fahrplanänderung'));
            const prevHasFABA = prev.situations?.some(s => s.summary?.includes('Fahrplanänderung'));
            
            if (currHasFABA && !prevHasFABA) {
                result[prevIdx] = dep;
                console.warn(`🔄 ${key} → Neue Version mit Fahrplanänderung`);
            } else if (!currHasFABA && !prevHasFABA) {
                result[prevIdx] = dep;
                console.warn(`🔄 ${key} → Neuerer Eintrag`);
            }
        } else {
            seen.set(key, result.length);
            result.push(dep);
        }
    }
    return result;
}

// ─── Parse Stop-Event Response ───────────────────────────────────────────────

function parseOJPResponse(xmlString) {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlString, 'text/xml');

    // 1. Hinweistexte (Situations) extrahieren
    const situationsMap = {};
    const ptSituations = xmlDoc.getElementsByTagName('PtSituation');
    console.log(`📍 Gefundene PtSituation-Elemente: ${ptSituations.length}`);
    for (const sit of ptSituations) {
        const idNode = sit.getElementsByTagName('siri:SituationNumber')[0] || sit.getElementsByTagName('SituationNumber')[0];
        const id = idNode?.textContent;
        const sumNode = sit.getElementsByTagName('siri:SummaryText')[0] || sit.getElementsByTagName('SummaryText')[0];
        const reasonNode = sit.getElementsByTagName('siri:ReasonText')[0] || sit.getElementsByTagName('ReasonText')[0];
        const descNode = sit.getElementsByTagName('siri:DescriptionText')[0] || sit.getElementsByTagName('DescriptionText')[0];
        const consNode = sit.getElementsByTagName('siri:ConsequenceText')[0] || sit.getElementsByTagName('ConsequenceText')[0];
        const recNode = sit.getElementsByTagName('siri:RecommendationText')[0] || sit.getElementsByTagName('RecommendationText')[0];
        const durNode = sit.getElementsByTagName('siri:DurationText')[0] || sit.getElementsByTagName('DurationText')[0];
        
        if (id) {
            situationsMap[id] = {
                summary: sumNode?.textContent || '',
                reason: reasonNode?.textContent || '',
                desc: descNode?.textContent || '',
                consequence: consNode?.textContent || '',
                rec: recNode?.textContent || '',
                duration: durNode?.textContent || ''
            };
            console.log(`  ✓ Situation ${id}: "${situationsMap[id].summary.substring(0, 50)}..."`);
        }
    }
    console.log(`📊 Gesamt Situations in situationsMap: ${Object.keys(situationsMap).length}`);

    // --- Interne Helfer ---

    function getStopName(callNode) {
        const nameEl = callNode.getElementsByTagName('StopPointName')[0];
        return nameEl?.getElementsByTagName('Text')[0]?.textContent?.trim() ?? null;
    }

    function getStopRef(callNode) {
        const spRef = callNode.getElementsByTagName('siri:StopPointRef')[0]?.textContent?.trim();
        
        if (!spRef) return null;
        
        // ✅ Swiss SLOID: Extrahiere Parent-SLOID ohne Perron/Quay
        // Format: ch:1:sloid:79897:0:1 → ch:1:sloid:79897
        //         ch:1:sloid:90015 → ch:1:sloid:90015
        const swissMatch = spRef.match(/^(ch:1:sloid:\d+)(?::|$)/);
        if (swissMatch) {
            return swissMatch[1];
        }
        
        // ✅ External IDs: Behalte sie als-is
        // Deutschland: 8014440_gen:missingSLOID_pf:1
        // Frankreich: 8718462
        return spRef;
    }

	function getTimeInfo(callNode, tagName) {
		const el = callNode.getElementsByTagName(tagName)[0];
		if (!el) return { timetabled: null, estimated: null, delayed: false, delayDisplay: null, delayMinutes: 0 };
		
		let ttRaw = el.getElementsByTagName('TimetabledTime')[0]?.textContent?.trim() ?? null;
		let estRaw = el.getElementsByTagName('EstimatedTime')[0]?.textContent?.trim() ?? null;
		
		const timetabled = utcToLocalISO(ttRaw);
		const estimated = utcToLocalISO(estRaw);
		
		const delayed = !!estimated && estimated !== timetabled;
		let delayMinutes = 0;
		let delayDisplay = null;

		if (delayed && estRaw && ttRaw) {
			const diffMs = new Date(estRaw) - new Date(ttRaw);
			delayMinutes = Math.round(diffMs / 60000);
			
			// ✅ Sowohl positive als auch negative Delays anzeigen
			if (delayMinutes > 0) {
				delayDisplay = `+${delayMinutes}'`;
			} else if (delayMinutes < 0) {
				delayDisplay = `${delayMinutes}'`;  // Negativ, z.B. "-2'"
			}
		}

		return { timetabled, estimated, delayed, delayDisplay, delayMinutes };
	}

    function getQuay(callNode) {
        const planned = callNode.getElementsByTagName('PlannedQuay')[0]
            ?.getElementsByTagName('Text')[0]?.textContent?.trim() ?? null;
        const estimated = callNode.getElementsByTagName('EstimatedQuay')[0]
            ?.getElementsByTagName('Text')[0]?.textContent?.trim() ?? null;

        // Aussteigeseite spezifisch für diesen EINEN Halt suchen
        let side = '';
        const attributes = callNode.getElementsByTagName('Attribute');
        for (const attr of attributes) {
            const textNode = attr.getElementsByTagName('Text')[0];
            if (textNode) {
                const val = textNode.textContent;
                if (val.includes('Aussteigeseite: Links')) { side = 'G'; break; }
                if (val.includes('Aussteigeseite: Rechts')) { side = 'D'; break; }
            }
        }

        return {
            planned,
            estimated,
            text: estimated ?? planned ?? '',
            isChanged: estimated !== null && planned !== null && estimated !== planned,
            side: side
        };
    }

    function parseCalls(event, currentName, thisCallNode) {
        const previous = [];
        const onward   = [];

        // ─── PreviousCall ───────────────────────────────────────────────────────
        const prevCalls = event.getElementsByTagName('PreviousCall');
        for (let i = 0; i < prevCalls.length; i++) {
            const call = prevCalls[i];
            const name = getStopName(call);
            if (!name) continue;
            const q   = getQuay(call);
            const arr = getTimeInfo(call, 'ServiceArrival');
            const dep = getTimeInfo(call, 'ServiceDeparture');
            const isCancelled = call.getElementsByTagName('NotServicedStop')[0]?.textContent === 'true';
            const noBoardingAtStop = call.getElementsByTagName('NoBoardingAtStop')[0]?.textContent === 'true';
            const noAlightingAtStop = call.getElementsByTagName('NoAlightingAtStop')[0]?.textContent === 'true';
            const isRequestStop = call.getElementsByTagName('RequestStop')[0]?.textContent === 'true';
            
            previous.push({
                name,
                arrivalTime:          arr.timetabled,
                arrivalEstimated:     arr.estimated,
                arrivalDelayed:       arr.delayed,
                arrivalDelayDisplay:  arr.delayDisplay,
                arrivalDelayMinutes:  arr.delayMinutes,
                departureTime:        dep.timetabled,
                departureEstimated:   dep.estimated,
                departureDelayed:     dep.delayed,
                departureDelayDisplay:dep.delayDisplay,
                departureDelayMinutes:dep.delayMinutes,
                platform:             q.text,
                plannedPlatform:      q.planned,
                estimatedPlatform:    q.estimated,
                platformChanged:      q.isChanged,
                cancelled:            isCancelled,
                noBoardingAtStop,
                noAlightingAtStop,
                requestStop:          isRequestStop,
                stopRef:              getStopRef(call)
            });
        }

        // ─── CurrentCall ────────────────────────────────────────────────────────
        const current = thisCallNode ? (() => {
            const q   = getQuay(thisCallNode);
            const arr = getTimeInfo(thisCallNode, 'ServiceArrival');
            const dep = getTimeInfo(thisCallNode, 'ServiceDeparture');
            const isCancelled = thisCallNode.getElementsByTagName('NotServicedStop')[0]?.textContent === 'true';
            const isRequestStop = thisCallNode.getElementsByTagName('RequestStop')[0]?.textContent === 'true';
            return {
                name:                 getStopName(thisCallNode) ?? currentName,
                arrivalTime:          arr.timetabled,
                arrivalEstimated:     arr.estimated,
                arrivalDelayed:       arr.delayed,
                arrivalDelayDisplay:  arr.delayDisplay,
                arrivalDelayMinutes:  arr.delayMinutes,
                departureTime:        dep.timetabled,
                departureEstimated:   dep.estimated,
                departureDelayed:     dep.delayed,
                departureDelayDisplay:dep.delayDisplay,
                departureDelayMinutes:dep.delayMinutes,
                platform:             q.text,
                plannedPlatform:      q.planned,
                estimatedPlatform:    q.estimated,
                platformChanged:      q.isChanged,
                cancelled:            isCancelled,
                requestStop:          isRequestStop,
                stopRef:              null
            };
        })() : null;

        // ─── OnwardCall ─────────────────────────────────────────────────────────
        const onwCalls = event.getElementsByTagName('OnwardCall');
        for (let i = 0; i < onwCalls.length; i++) {
            const call = onwCalls[i];
            const name = getStopName(call);
            if (!name) continue;
            const q   = getQuay(call);
            const arr = getTimeInfo(call, 'ServiceArrival');
            const dep = getTimeInfo(call, 'ServiceDeparture');
            const isCancelled = call.getElementsByTagName('NotServicedStop')[0]?.textContent === 'true';
            const noBoardingAtStop = call.getElementsByTagName('NoBoardingAtStop')[0]?.textContent === 'true';
            const noAlightingAtStop = call.getElementsByTagName('NoAlightingAtStop')[0]?.textContent === 'true';
            const isRequestStop = call.getElementsByTagName('RequestStop')[0]?.textContent === 'true';
            
            onward.push({
                name,
                arrivalTime:          arr.timetabled,
                arrivalEstimated:     arr.estimated,
                arrivalDelayed:       arr.delayed,
                arrivalDelayDisplay:  arr.delayDisplay,
                arrivalDelayMinutes:  arr.delayMinutes,
                departureTime:        dep.timetabled,
                departureEstimated:   dep.estimated,
                departureDelayed:     dep.delayed,
                departureDelayDisplay:dep.delayDisplay,
                departureDelayMinutes:dep.delayMinutes,
                platform:             q.text,
                plannedPlatform:      q.planned,
                estimatedPlatform:    q.estimated,
                platformChanged:      q.isChanged,
                cancelled:            isCancelled,
                noBoardingAtStop,
                noAlightingAtStop,
                requestStop:          isRequestStop,
                stopRef:              getStopRef(call)
            });
        }

        return { previous, current, onward };
    }

    function getText(node, tagName) {
        const el = node?.getElementsByTagName(tagName)[0];
        if (!el) return null;
        const textNode = el.getElementsByTagName('Text')[0];
        return textNode ? textNode.textContent.trim() : el.textContent.trim();
    }

    // --- Hauptverarbeitung ---

    const results = xmlDoc.getElementsByTagName('StopEventResult');
    const departures = [];

    for (const result of results) {
        const event = result.getElementsByTagName('StopEvent')[0];
        const service = event?.getElementsByTagName('Service')[0];
        const thisCall = event?.getElementsByTagName('ThisCall')[0];
		const stopName = getStopName(thisCall) ?? 'Unbekannter Halt';
        if (!service || !thisCall) continue;

        const journeyNumber = getText(service, 'TrainNumber') ?? '';
        let timetabled    = thisCall.getElementsByTagName('TimetabledTime')[0]?.textContent?.trim();
        let estimated     = thisCall.getElementsByTagName('EstimatedTime')[0]?.textContent?.trim();
        
        // Konvertiere in lokale Zeit
        if (timetabled) timetabled = utcToLocalISO(timetabled);
        if (estimated) estimated = utcToLocalISO(estimated);
        
        const delayed       = !!estimated && estimated !== timetabled;

        const timeFormatted = timetabled
            ? (() => {
                const match = timetabled.match(/T(\d{2}):(\d{2})/);
                return match ? `${match[1]}:${match[2]}` : '--:--';
            })()
            : '--:--';

        let delayMinutes = 0;
        if (delayed) {
            delayMinutes = Math.round((new Date(estimated) - new Date(timetabled)) / 60000);
        }

        let delayDisplay = "+0:00";
        if (delayed && estimated && timetabled) {
            const diffMs = new Date(estimated) - new Date(timetabled);
            const totalSeconds = Math.max(0, Math.floor(diffMs / 1000));
            const mins = Math.floor(totalSeconds / 60);
            const secs = totalSeconds % 60;
            delayDisplay = `+${mins}:${secs.toString().padStart(2, '0')}`;
        }
        const timeData = getTimeInfo(thisCall, 'ServiceDeparture'); // Nutzt die Hilfsfunktion für den Haupt-Stop

        const destination = service.getElementsByTagName('DestinationText')[0]
            ?.getElementsByTagName('Text')[0]?.textContent?.trim() ?? 'Unbekannt';

        const calls = parseCalls(event, destination, thisCall);
        const vias = calls.onward
            .slice(0, 10)
            .map(c => c.name)
            .filter(n => n !== destination);

        // Gleis und Seite für den aktuellen Halt holen
        const currentQuay = getQuay(thisCall);
        const alightingSide = currentQuay.side; // Nimmt die Seite vom aktuellen Halt (getQuay prüft die Attribute)

        // 2. Ersatzzug (Unplanned)
        const unplanned = service.getElementsByTagName('Unplanned')[0]?.textContent === 'true';

        // 4. Hinweistexte verknüpfen
        const sitRefs = service.getElementsByTagName('SituationFullRef');
        const activeSituations = [];
        for (const ref of sitRefs) {
            const idNode = ref.getElementsByTagName('siri:SituationNumber')[0] || ref.getElementsByTagName('SituationNumber')[0];
            const id = idNode?.textContent;
            if (id && situationsMap[id]) {
                if (!activeSituations.find(s => s === situationsMap[id])) {
                    activeSituations.push(situationsMap[id]);
                }
            }
        }

        const journeyRef = service.getElementsByTagName('JourneyRef')[0]?.textContent?.trim()
            ?? service.getElementsByTagName('siri:FramedVehicleJourneyRef')[0]
               ?.getElementsByTagName('siri:DatedVehicleJourneyRef')[0]?.textContent?.trim()
            ?? event.getElementsByTagName('JourneyRef')[0]?.textContent?.trim()
            ?? '';

        const operatorRef = service.getElementsByTagName('OperatorRef')[0]?.textContent?.trim()
            ?? service.getElementsByTagName('siri:OperatorRef')[0]?.textContent?.trim()
            ?? '';
        const operatorName = getText(service, 'OperatorName') ?? operatorRef;

        // ─── OperatingDays Parsing ──────────────────────────────────────────────
        const operatingDaysEl = event?.getElementsByTagName('OperatingDays')[0];
        let operatingDays = null;
        if (operatingDaysEl) {
            const fromEl = operatingDaysEl.getElementsByTagName('From')[0];
            const toEl = operatingDaysEl.getElementsByTagName('To')[0];
            const patternEl = operatingDaysEl.getElementsByTagName('Pattern')[0];
            
            if (fromEl && toEl && patternEl) {
                operatingDays = {
                    from: fromEl.textContent?.trim() ?? '',
                    to: toEl.textContent?.trim() ?? '',
                    pattern: patternEl.textContent?.trim() ?? ''
                };
                console.log(`✓ OperatingDays: ${operatingDays.from} – ${operatingDays.to} (${operatingDays.pattern.length} Zeichen)`);
            }
        }

        departures.push({
			stopName,
            cat: getText(service, 'ShortName') ?? '??',
            line: getText(service, 'PublishedServiceName') ?? '??',
            journeyNumber,
            unplanned,
            situations: activeSituations,
            alightingSide,
            destination,
            vias,
            platform: currentQuay.text,
            platformChanged: currentQuay.isChanged,
            time: timeFormatted,
            timetabledIso: timetabled ?? null,
            estimatedIso: estimated ?? null,
            delayed,
            delayDisplay,
            delayMinutes,
            calls,
            journeyRef,
            operatorRef,
            operatorName,
            operatingDays
        });
    }

	return deduplicateDepartures(departures);
}