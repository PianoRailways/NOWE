<?php
// Verkehrstage einer Fahrt aus der lokalen GTFS-Datenbank (calendar.txt + calendar_dates.txt)
// Aufruf: verkehrstage.php?sjyid=ojp:91044:B:H:j26:45
// Antwort: { "sjyid": "...", "dates": ["2026-11-26", ...], "window": { "from": "...", "to": "..." } }
// dates enthält nur Tage im Importfenster (siehe DAYS_BACK / DAYS_AHEAD in import_gts.php).

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

try {
    $pdo = new PDO('sqlite:' . $dbFile, null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);

    $stmt = $pdo->prepare('
        SELECT DISTINCT d.date
        FROM trips t
        JOIN service_dates d ON d.service_id = t.service_id
        WHERE t.sjyid = ?
        ORDER BY d.date
    ');
    $stmt->execute([$sjyid]);
    $dates = array_map(fn($r) => fmt((int)$r['date']), $stmt->fetchAll());

    $win = $pdo->query('SELECT MIN(date) AS a, MAX(date) AS b FROM service_dates')->fetch();

    echo json_encode([
        'sjyid' => $sjyid,
        'dates' => $dates,
        'window' => ['from' => $win['a'] ? fmt((int)$win['a']) : null, 'to' => $win['b'] ? fmt((int)$win['b']) : null],
    ], JSON_UNESCAPED_SLASHES);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['error' => 'Datenbankfehler']);
}
