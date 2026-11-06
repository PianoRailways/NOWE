<?php
// GTFS-Import für NOWE (schlanke Variante)
// Aufruf: php import.php             lädt den Feed, falls er sich geändert hat
//         php import.php datei.zip   importiert ein lokales ZIP (z.B. zum Testen)

ini_set('memory_limit', '512M');
set_time_limit(0);
date_default_timezone_set('Europe/Zurich');

// Zeitfenster der Betriebstage, die in der DB landen
const DAYS_BACK  = 1;
const DAYS_AHEAD = 60;

$feedUrl   = 'https://data.opentransportdata.swiss/dataset/timetable-2026-gtfs2020/permalink';
$zipFile   = __DIR__ . '/gtfs_feed.zip';
$dbTemp    = __DIR__ . '/transit_new.sqlite';
$dbFinal   = __DIR__ . '/transit.sqlite';
$lockFile  = __DIR__ . '/import.lock';
$logFile   = __DIR__ . '/import.log';
$metaFile  = __DIR__ . '/feed_meta.json';
$localZip  = $argv[1] ?? null;

function writeLog($msg) {
    global $logFile;
    file_put_contents($logFile, date('[Y-m-d H:i:s] ') . $msg . PHP_EOL, FILE_APPEND);
}

function fail($msg) {
    writeLog('FEHLER: ' . $msg);
    exit(1);
}

$fpLock = fopen($lockFile, 'c+');
if (!flock($fpLock, LOCK_EX | LOCK_NB)) {
    writeLog('Import läuft bereits. Abbruch.');
    exit(1);
}

writeLog('Start.');
$newMeta = null;

if ($localZip === null) {
    // Prüfen, ob sich der Feed geändert hat
    $ch = curl_init($feedUrl);
    curl_setopt_array($ch, [
        CURLOPT_NOBODY => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_HEADER => true,
    ]);
    $headers = (string)curl_exec($ch);
    curl_close($ch);

    // Bei Redirects gibt es mehrere Header-Blöcke, der letzte zählt
    preg_match_all('/^ETag:\s*(.+)$/mi', $headers, $e);
    preg_match_all('/^Last-Modified:\s*(.+)$/mi', $headers, $m);
    $newMeta = [
        'etag' => isset($e[1]) && $e[1] ? trim(end($e[1])) : null,
        'last_modified' => isset($m[1]) && $m[1] ? trim(end($m[1])) : null,
    ];

    $oldMeta = file_exists($metaFile) ? json_decode(file_get_contents($metaFile), true) : null;
    $hasRemoteInfo = $newMeta['etag'] !== null || $newMeta['last_modified'] !== null;
    if ($hasRemoteInfo && $oldMeta && $oldMeta === $newMeta && file_exists($dbFinal)) {
        writeLog('Feed unverändert. Kein Import nötig.');
        exit(0);
    }

    writeLog('Lade Feed herunter...');
    $fpZip = fopen($zipFile, 'w+');
    $ch = curl_init($feedUrl);
    curl_setopt_array($ch, [
        CURLOPT_FILE => $fpZip,
        CURLOPT_FOLLOWLOCATION => true,
    ]);
    $ok = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    fclose($fpZip);
    if (!$ok || $code !== 200) fail("Download fehlgeschlagen (HTTP $code)");
    $source = $zipFile;
} else {
    $source = $localZip;
}

// Zeitfenster
$today = new DateTimeImmutable('today');
$window = [];
for ($i = -DAYS_BACK; $i <= DAYS_AHEAD; $i++) {
    $d = $today->modify(sprintf('%+d day', $i));
    $window[] = [(int)$d->format('Ymd'), (int)$d->format('N') - 1];
}
$winStart = $window[0][0];
$winEnd = $window[count($window) - 1][0];
writeLog("Zeitfenster: $winStart bis $winEnd");

// Datenbank
if (file_exists($dbTemp)) unlink($dbTemp);
$pdo = new PDO('sqlite:' . $dbTemp);
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$pdo->exec('PRAGMA synchronous = OFF');
$pdo->exec('PRAGMA journal_mode = OFF');
$pdo->exec('PRAGMA cache_size = -200000');

$pdo->exec('CREATE TABLE trips (
    trip_short_name TEXT NOT NULL,
    service_id INTEGER NOT NULL,
    destination TEXT,
    sjyid TEXT,
    hints TEXT
)');
$pdo->exec('CREATE TABLE service_dates (
    service_id INTEGER NOT NULL,
    date INTEGER NOT NULL,
    PRIMARY KEY (service_id, date)
) WITHOUT ROWID');

$zip = new ZipArchive();
if ($zip->open($source) !== true) fail('ZIP lässt sich nicht öffnen.');

function openCsv(ZipArchive $zip, string $name, array $required): array {
    $fp = $zip->getStream($name);
    if (!$fp) fail("$name fehlt im ZIP.");
    $header = fgetcsv($fp, 0, ',', '"', '');
    if (!$header) fail("$name hat keinen Header.");
    $header[0] = preg_replace('/^\xEF\xBB\xBF/', '', $header[0]);
    $idx = array_flip($header);
    foreach ($required as $col) {
        if (!isset($idx[$col])) fail("Spalte '$col' fehlt in $name. Header: " . implode(',', $header));
    }
    return [$fp, $idx, count($header)];
}

// Service-IDs als Integer, spart Platz
$serviceIds = [];
function serviceId(string $name): int {
    global $serviceIds;
    return $serviceIds[$name] ??= count($serviceIds) + 1;
}

// 1. Regelmässige Verkehrstage aus calendar.txt (nur im Fenster)
writeLog('Verarbeite calendar.txt...');
[$fp, $c, $n] = openCsv($zip, 'calendar.txt', [
    'service_id', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
    'start_date', 'end_date',
]);
$dayCols = [$c['monday'], $c['tuesday'], $c['wednesday'], $c['thursday'], $c['friday'], $c['saturday'], $c['sunday']];
$ins = $pdo->prepare('INSERT OR IGNORE INTO service_dates VALUES (?, ?)');
$pdo->beginTransaction();
while (($r = fgetcsv($fp, 0, ',', '"', '')) !== false) {
    if (count($r) < $n) continue;
    $id = serviceId($r[$c['service_id']]);
    $start = (int)$r[$c['start_date']];
    $end = (int)$r[$c['end_date']];
    foreach ($window as [$date, $wd]) {
        if ($date < $start || $date > $end) continue;
        if ($r[$dayCols[$wd]] === '1') $ins->execute([$id, $date]);
    }
}
fclose($fp);
$pdo->commit();

// 2. Ausnahmen streamen, nur Fenster, nichts im RAM halten
writeLog('Verarbeite calendar_dates.txt...');
[$fp, $c, $n] = openCsv($zip, 'calendar_dates.txt', ['service_id', 'date', 'exception_type']);
$del = $pdo->prepare('DELETE FROM service_dates WHERE service_id = ? AND date = ?');
$pdo->beginTransaction();
while (($r = fgetcsv($fp, 0, ',', '"', '')) !== false) {
    if (count($r) < $n) continue;
    $date = (int)$r[$c['date']];
    if ($date < $winStart || $date > $winEnd) continue;
    $id = serviceId($r[$c['service_id']]);
    $type = (int)$r[$c['exception_type']];
    if ($type === 1) $ins->execute([$id, $date]);
    elseif ($type === 2) $del->execute([$id, $date]);
}
fclose($fp);
$pdo->commit();

$active = [];
foreach ($pdo->query('SELECT DISTINCT service_id FROM service_dates') as $row) {
    $active[(int)$row[0]] = true;
}
writeLog('Services mit Betrieb im Fenster: ' . count($active) . ' von ' . count($serviceIds));

// 3. Trips: eine Zeile pro Fahrt, nur wenn sie im Fenster fährt
writeLog('Verarbeite trips.txt...');
[$fp, $c, $n] = openCsv($zip, 'trips.txt', [
    'service_id', 'trip_headsign', 'trip_short_name', 'original_trip_id',
]);
$iHints = $c['hints'] ?? null;
$insTrip = $pdo->prepare('INSERT INTO trips VALUES (?, ?, ?, ?, ?)');
$pdo->beginTransaction();
$count = 0;
$skipped = 0;
while (($r = fgetcsv($fp, 0, ',', '"', '')) !== false) {
    if (count($r) < $n) continue;
    $short = trim($r[$c['trip_short_name']]);
    $id = $serviceIds[$r[$c['service_id']]] ?? null;
    if ($short === '' || $id === null || !isset($active[$id])) {
        $skipped++;
        continue;
    }
    $insTrip->execute([
        $short,
        $id,
        $r[$c['trip_headsign']],
        $r[$c['original_trip_id']],
        $iHints !== null ? $r[$iHints] : '',
    ]);
    $count++;
}
fclose($fp);
$pdo->commit();
$zip->close();
writeLog("Trips gespeichert: $count, übersprungen: $skipped");

writeLog('Erstelle Index...');
$pdo->exec('CREATE INDEX idx_trips_name ON trips(trip_short_name)');
$pdo = null;

rename($dbTemp, $dbFinal);
if ($newMeta !== null) {
    file_put_contents($metaFile, json_encode($newMeta));
    @unlink($zipFile);
}
writeLog('Import erfolgreich abgeschlossen. DB: ' . round(filesize($dbFinal) / 1048576) . ' MB');