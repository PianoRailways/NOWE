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
//   "days": [ { "date": "...", "sjyid": "...", "kind": "soll|stops|times|tracks|variant" }, ... ],
//   "window": { "from": "...", "to": "..." }
// }
// days enthält alle Tage, an denen die Zugnummer fährt, und je Tag die dort gültige Variante.
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

try {
    $pdo = new PDO('sqlite:' . $dbFile, null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);

    $win = $pdo->query('SELECT MIN(date) AS a, MAX(date) AS b FROM service_dates')->fetch();
    $window = ['from' => $win['a'] ? fmt((int)$win['a']) : null, 'to' => $win['b'] ? fmt((int)$win['b']) : null];

    $stmt = $pdo->prepare('SELECT trip_short_name FROM trips WHERE sjyid = ? LIMIT 1');
    $stmt->execute([$sjyid]);
    $number = $stmt->fetchColumn();
    if ($number === false) {
        echo json_encode(['sjyid' => $sjyid, 'dates' => [], 'days' => [], 'window' => $window], JSON_UNESCAPED_SLASHES);
        exit;
    }

    // Ältere Datenbanken haben noch keine Abdrücke
    $cols = array_column($pdo->query('PRAGMA table_info(trips)')->fetchAll(), 'name');
    $sig = in_array('sig_stops', $cols, true)
        ? 't.sig_stops, t.sig_times, t.sig_tracks'
        : 'NULL AS sig_stops, NULL AS sig_times, NULL AS sig_tracks';

    // Alle Varianten dieser Zugnummer mit ihren Tagen
    $stmt = $pdo->prepare("
        SELECT t.sjyid, $sig, d.date
        FROM trips t
        JOIN service_dates d ON d.service_id = t.service_id
        WHERE t.trip_short_name = ?
    ");
    $stmt->execute([$number]);

    $variants = [];   // sjyid => ['sig_*' => ..., 'dates' => [date => true]]
    foreach ($stmt->fetchAll() as $row) {
        $id = $row['sjyid'];
        if (!isset($variants[$id])) {
            $variants[$id] = [
                'sig_stops' => $row['sig_stops'],
                'sig_times' => $row['sig_times'],
                'sig_tracks' => $row['sig_tracks'],
                'dates' => [],
            ];
        }
        $variants[$id]['dates'][(int)$row['date']] = true;
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
        $kind = $pick === $soll ? 'soll' : classify($variants[$soll], $variants[$pick]);
        $days[] = ['date' => fmt($d), 'sjyid' => $pick, 'kind' => $kind];
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
