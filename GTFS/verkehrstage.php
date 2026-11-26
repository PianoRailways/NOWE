<?php
// Verkehrstage einer Fahrt aus der lokalen GTFS-Datenbank (calendar.txt + calendar_dates.txt)
// Aufruf: verkehrstage.php?sjyid=ojp:91044:B:H:j26:45
//
// Antwort:
// {
//   "sjyid": "...",
//   "number": "450",                 Zugnummer (trip_short_name)
//   "dates": ["2026-11-26", ...],    Tage dieser Fahrt (SJYID)
//   "soll": "...",                   Variante mit den meisten Verkehrstagen = Soll
//   "days": [ { "date": "...", "sjyid": "...", "kind": "...", "details": { ... } }, ... ],
//   "window": { "from": "...", "to": "..." }
// }
// days enthält alle Tage, an denen die Fahrtfamilie fährt, und je Tag die dort gültige Variante.
// Bei mehreren Fahrplan-Signaturen einer SJYID dient deren häufigste Signatur als Soll.
// details listet bei Abweichungen hinzugefügte/entfallene Halte sowie geänderte Zeiten und Gleise.
// kind: soll = wie die Standardvariante, stops = andere Halte, times = andere Zeiten (gleiche Halte),
//       tracks = nur anderes Gleis, variant = andere Variante, Unterschied nicht bekannt (keine stop_times importiert).
// Nur Tage im Importfenster (siehe WINDOW_FROM / WINDOW_TO in import_gts.php).

header('Content-Type: application/json; charset=utf-8');

$sjyid = trim($_GET['sjyid'] ?? '');
$dbFile = __DIR__ . '/transit.sqlite';

if ($sjyid === '' || strlen($sjyid) > 200) {
    http_response_code(400);
    echo json_encode(['error' => 'sjyid fehlt oder ist ungültig']);
    exit;
}
if (!file_exists($dbFile)) {
    http_response_code(503);
    echo json_encode(['error' => 'GTFS-Datenbank nicht vorhanden']);
    exit;
}

function fmt(int $d): string {
    $s = (string)$d;
    return substr($s, 0, 4) . '-' . substr($s, 4, 2) . '-' . substr($s, 6, 2);
}

// Wie unterscheidet sich Variante $v vom Soll $s? Wichtigster Unterschied gewinnt.
function classify(array $s, array $v): string {
    if ($s['sig_stops'] === null || $v['sig_stops'] === null) return 'variant';
    if ($s['sig_stops'] !== $v['sig_stops']) return 'stops';
    if ($s['sig_times'] !== $v['sig_times']) return 'times';
    if ($s['sig_tracks'] !== $v['sig_tracks']) return 'tracks';
    return 'soll';
}

function decodeDetails(?string $json): ?array {
    if ($json === null || $json === '') return null;
    $compressed = base64_decode($json, true);
    if ($compressed === false) throw new RuntimeException('Ungültige Haltestellendetails');
    $decoded = gzuncompress($compressed);
    if ($decoded === false) throw new RuntimeException('Haltestellendetails lassen sich nicht entpacken');
    $details = json_decode($decoded, true, 512, JSON_THROW_ON_ERROR);
    if (!is_array($details)) throw new RuntimeException('Ungültige Haltestellendetails');
    return $details;
}

function indexDetails(?array $details): ?array {
    if ($details === null) return null;
    $indexed = [];
    $occurrences = [];
    foreach ($details as $stop) {
        if (!is_array($stop) || !isset($stop['id'])) throw new RuntimeException('Ungültiger Haltestelleneintrag');
        $id = (string)$stop['id'];
        $occurrence = $occurrences[$id] ?? 0;
        $occurrences[$id] = $occurrence + 1;
        $indexed[$id . "\0" . $occurrence] = $stop;
    }
    return $indexed;
}

function compareDetails(?array $reference, ?array $actual): ?array {
    $referenceStops = indexDetails($reference);
    $actualStops = indexDetails($actual);
    if ($referenceStops === null || $actualStops === null) return null;

    $added = [];
    $removed = [];
    $flags = [];
    $times = [];
    $tracks = [];
    foreach ($actualStops as $key => $stop) {
        if (!isset($referenceStops[$key])) {
            $added[] = $stop['id'];
            continue;
        }
        $before = $referenceStops[$key];
        if (($before['flags'] ?? '') !== ($stop['flags'] ?? '')) {
            $flags[] = ['stop' => $stop['id'], 'from' => $before['flags'] ?? '', 'to' => $stop['flags'] ?? ''];
        }
        if (($before['arrival'] ?? '') !== ($stop['arrival'] ?? '') || ($before['departure'] ?? '') !== ($stop['departure'] ?? '')) {
            $times[] = [
                'stop' => $stop['id'],
                'from_arrival' => $before['arrival'] ?? '',
                'to_arrival' => $stop['arrival'] ?? '',
                'from_departure' => $before['departure'] ?? '',
                'to_departure' => $stop['departure'] ?? '',
            ];
        }
        if (($before['track'] ?? '') !== ($stop['track'] ?? '')) {
            $tracks[] = ['stop' => $stop['id'], 'from' => $before['track'] ?? '', 'to' => $stop['track'] ?? ''];
        }
    }
    foreach ($referenceStops as $key => $stop) {
        if (!isset($actualStops[$key])) $removed[] = $stop['id'];
    }

    return [
        'stops' => ['added' => $added, 'removed' => $removed, 'flags' => $flags],
        'times' => $times,
        'tracks' => $tracks,
    ];
}

try {
    $pdo = new PDO('sqlite:' . $dbFile, null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);

    $win = $pdo->query('SELECT MIN(date) AS a, MAX(date) AS b FROM service_dates')->fetch();
    $window = ['from' => $win['a'] ? fmt((int)$win['a']) : null, 'to' => $win['b'] ? fmt((int)$win['b']) : null];

    $cols = array_column($pdo->query('PRAGMA table_info(trips)')->fetchAll(), 'name');
    $hasFamily = count(array_diff(['agency_id', 'route_id', 'direction_id'], $cols)) === 0;
    $lookupFields = $hasFamily ? 'trip_short_name, agency_id, route_id, direction_id' : 'trip_short_name';
    $stmt = $pdo->prepare("SELECT $lookupFields FROM trips WHERE sjyid = ?");
    $stmt->execute([$sjyid]);
    $tripRows = $stmt->fetchAll();
    if (!$tripRows) {
        echo json_encode(['sjyid' => $sjyid, 'dates' => [], 'days' => [], 'window' => $window], JSON_UNESCAPED_SLASHES);
        exit;
    }
    $trip = $tripRows[0];
    $number = $trip['trip_short_name'];
    $variantWhere = 't.sjyid = ?';
    $variantParams = [$sjyid];
    if ($hasFamily) {
        $families = [];
        foreach ($tripRows as $tripRow) {
            if ($tripRow['agency_id'] === '' || $tripRow['route_id'] === '' || $tripRow['direction_id'] === '') continue;
            $family = [$tripRow['trip_short_name'], $tripRow['agency_id'], $tripRow['route_id'], $tripRow['direction_id']];
            $families[implode("\0", $family)] = $family;
        }
        if ($families) {
            $familyConditions = [];
            foreach ($families as $family) {
                $familyConditions[] = '(t.trip_short_name = ? AND t.agency_id = ? AND t.route_id = ? AND t.direction_id = ?)';
                array_push($variantParams, ...$family);
            }
            $variantWhere = '(t.sjyid = ? OR ' . implode(' OR ', $familyConditions) . ')';
        }
    }

    // Ältere Datenbanken haben noch keine Abdrücke
    $sig = in_array('sig_stops', $cols, true)
        ? 't.sig_stops, t.sig_times, t.sig_tracks'
        : 'NULL AS sig_stops, NULL AS sig_times, NULL AS sig_tracks';
    $detail = in_array('sig_detail', $cols, true) ? 't.sig_detail' : 'NULL AS sig_detail';

    // Alle Varianten dieser Zugnummer mit ihren Tagen
    $stmt = $pdo->prepare("
        SELECT t.sjyid, $sig, $detail, d.date
        FROM trips t
        JOIN service_dates d ON d.service_id = t.service_id
        WHERE $variantWhere
    ");
    $stmt->execute($variantParams);

    $variants = [];   // sjyid => date/signature combinations
    foreach ($stmt->fetchAll() as $row) {
        $id = $row['sjyid'];
        $date = (int)$row['date'];
        $signature = [
            'sig_stops' => $row['sig_stops'],
            'sig_times' => $row['sig_times'],
            'sig_tracks' => $row['sig_tracks'],
        ];
        $signatureKey = json_encode(array_values($signature), JSON_THROW_ON_ERROR);
        $signatureRecord = [
            'signature' => $signature,
            'details' => decodeDetails($row['sig_detail']),
        ];
        if (!isset($variants[$id])) {
            $variants[$id] = [
                'dates' => [],
                'signatures' => [],
            ];
        }
        $variants[$id]['dates'][$date][$signatureKey] = $signatureRecord;
        if (!isset($variants[$id]['signatures'][$signatureKey])) {
            $variants[$id]['signatures'][$signatureKey] = [
                'signature' => $signatureRecord,
                'dates' => [],
            ];
        }
        $variants[$id]['signatures'][$signatureKey]['dates'][$date] = true;
    }

    if (!$variants) {
        echo json_encode(['sjyid' => $sjyid, 'number' => $number, 'dates' => [], 'days' => [], 'window' => $window], JSON_UNESCAPED_SLASHES);
        exit;
    }

    $own = isset($variants[$sjyid]) ? array_keys($variants[$sjyid]['dates']) : [];
    sort($own);

    // Soll: Variante mit den meisten Tagen, bei Gleichstand die kleinere SJYID
    $soll = null;
    foreach ($variants as $id => $v) {
        if ($soll === null
            || count($v['dates']) > count($variants[$soll]['dates'])
            || (count($v['dates']) === count($variants[$soll]['dates']) && strcmp($id, $soll) < 0)) {
            $soll = $id;
        }
    }

    // Eine SJYID kann je nach Betriebstag mehrere Fahrplan-Signaturen haben.
    // Als Soll-Signatur dient die innerhalb der häufigsten SJYID meistgenutzte.
    $sollSignatureKey = null;
    foreach ($variants[$soll]['signatures'] as $key => $signature) {
        if ($sollSignatureKey === null
            || count($signature['dates']) > count($variants[$soll]['signatures'][$sollSignatureKey]['dates'])
            || (count($signature['dates']) === count($variants[$soll]['signatures'][$sollSignatureKey]['dates']) && strcmp($key, $sollSignatureKey) < 0)) {
            $sollSignatureKey = $key;
        }
    }
    $sollRecord = $variants[$soll]['signatures'][$sollSignatureKey]['signature'];

    // Je Tag die gültige Variante: das Soll, sonst die geöffnete Fahrt, sonst die kleinste SJYID
    $allDates = [];
    foreach ($variants as $v) foreach ($v['dates'] as $d => $_) $allDates[$d] = true;
    ksort($allDates);

    $days = [];
    foreach (array_keys($allDates) as $d) {
        if (isset($variants[$soll]['dates'][$d])) {
            $pick = $soll;
        } elseif (isset($variants[$sjyid]['dates'][$d])) {
            $pick = $sjyid;
        } else {
            $pick = null;
            foreach ($variants as $id => $v) {
                if (isset($v['dates'][$d]) && ($pick === null || strcmp($id, $pick) < 0)) $pick = $id;
            }
        }
        $daySignatures = $variants[$pick]['dates'][$d];
        if (isset($daySignatures[$sollSignatureKey])) {
            $dayRecord = $daySignatures[$sollSignatureKey];
        } else {
            $daySignatureKeys = array_keys($daySignatures);
            sort($daySignatureKeys, SORT_STRING);
            $dayRecord = $daySignatures[$daySignatureKeys[0]];
        }
        $kind = classify($sollRecord['signature'], $dayRecord['signature']);
        $differences = $kind === 'soll' ? null : compareDetails($sollRecord['details'], $dayRecord['details']);
        $days[] = ['date' => fmt($d), 'sjyid' => $pick, 'kind' => $kind, 'details' => $differences];
    }

    echo json_encode([
        'sjyid' => $sjyid,
        'number' => $number,
        'dates' => array_map('fmt', $own),
        'soll' => $soll,
        'days' => $days,
        'window' => $window,
    ], JSON_UNESCAPED_SLASHES);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['error' => 'Datenbankfehler']);
}
