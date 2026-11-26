<?php
// GTFS-Import für NOWE (schlanke Variante)
// Aufruf: php import_gts.php                     lädt die Feeds, falls sich einer geändert hat
//         php import_gts.php fp2026.zip fp2027.zip   importiert lokale ZIPs in der Reihenfolge der Feeds (z.B. zum Testen)

// Nur über die Serverkonsole starten, nicht über den Webserver
if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit('Nur über die Kommandozeile aufrufbar.');
}

ini_set('memory_limit', '512M');
set_time_limit(0);
date_default_timezone_set('Europe/Zurich');

// Betriebstage, die in der DB landen (YYYYMMDD, beide Grenzen inklusive)
const WINDOW_FROM = 20260901;
const WINDOW_TO   = 20270430;

// Pro Fahrt einen Abdruck aus Halten, Zeiten und Gleisen speichern (liest stop_times.txt, verlängert den Import).
// Damit erkennt die Tripansicht, ob eine Fahrt von der Standardvariante abweicht.
const COMPARE_STOP_TIMES = true;

// Jeder Feed liefert nur Tage innerhalb seines Fahrplanjahres, damit sich die Feeds nicht überlappen.
// Fahrplanjahr 2026: 14.12.2025 bis 12.12.2026, Fahrplanjahr 2027 beginnt am 13.12.2026.
$feeds = [
    [
        'key' => 'fp2026',
        'url' => 'https://data.opentransportdata.swiss/dataset/timetable-2026-gtfs2020/permalink',
        'valid_from' => 20251214,
        'valid_to' => 20261212,
    ],
    [
        'key' => 'fp2027',
        'url' => 'https://data.opentransportdata.swiss/dataset/timetable-2027-gtfs2020/permalink',
        'valid_from' => 20261213,
        'valid_to' => 20271211,
    ],
];

$dbTemp    = __DIR__ . '/transit_new.sqlite';
$dbFinal   = __DIR__ . '/transit.sqlite';
$lockFile  = __DIR__ . '/import.lock';
$logFile   = __DIR__ . '/import.log';
$metaFile  = __DIR__ . '/feed_meta.json';
$localZips = array_slice($argv, 1);

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

// ETag und Last-Modified eines Feeds (Bei Redirects gibt es mehrere Header-Blöcke, der letzte zählt)
function fetchRemoteMeta(string $url): array {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_NOBODY => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_HEADER => true,
    ]);
    $headers = (string)curl_exec($ch);
    curl_close($ch);
    preg_match_all('/^ETag:\s*(.+)$/mi', $headers, $e);
    preg_match_all('/^Last-Modified:\s*(.+)$/mi', $headers, $m);
    return [
        'etag' => isset($e[1]) && $e[1] ? trim(end($e[1])) : null,
        'last_modified' => isset($m[1]) && $m[1] ? trim(end($m[1])) : null,
    ];
}

$sources = [];   // key => ZIP-Pfad
$newMeta = [];   // key => Meta, nur bei Download

if (!$localZips) {
    // Prüfen, ob sich ein Feed geändert hat
    $oldMeta = file_exists($metaFile) ? json_decode(file_get_contents($metaFile), true) : null;
    $allKnown = is_array($oldMeta) && file_exists($dbFinal);
    foreach ($feeds as $feed) {
        $newMeta[$feed['key']] = fetchRemoteMeta($feed['url']);
        $meta = $newMeta[$feed['key']];
        $hasRemoteInfo = $meta['etag'] !== null || $meta['last_modified'] !== null;
        if (!$hasRemoteInfo || ($oldMeta[$feed['key']] ?? null) !== $meta) $allKnown = false;
    }
    if ($allKnown) {
        writeLog('Feeds unverändert. Kein Import nötig.');
        exit(0);
    }

    foreach ($feeds as $feed) {
        $zipFile = __DIR__ . '/gtfs_feed_' . $feed['key'] . '.zip';
        writeLog('Lade Feed ' . $feed['key'] . ' herunter...');
        $fpZip = fopen($zipFile, 'w+');
        $ch = curl_init($feed['url']);
        curl_setopt_array($ch, [
            CURLOPT_FILE => $fpZip,
            CURLOPT_FOLLOWLOCATION => true,
        ]);
        $ok = curl_exec($ch);
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        fclose($fpZip);
        if (!$ok || $code !== 200) fail('Download von ' . $feed['key'] . " fehlgeschlagen (HTTP $code). Bestehende Datenbank bleibt unverändert.");
        $sources[$feed['key']] = $zipFile;
    }
} else {
    foreach ($feeds as $i => $feed) {
        if (!isset($localZips[$i])) break;
        $sources[$feed['key']] = $localZips[$i];
    }
}

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
    hints TEXT,
    trip_id TEXT,
    feed TEXT,
    sig_stops TEXT,
    sig_times TEXT,
    sig_tracks TEXT,
    sig_detail TEXT,
    agency_id TEXT NOT NULL DEFAULT \'\',
    route_id TEXT NOT NULL DEFAULT \'\',
    direction_id TEXT NOT NULL DEFAULT \'\'
)');
$pdo->exec('CREATE TABLE agencies (
    agency_id TEXT PRIMARY KEY,
    agency_name TEXT NOT NULL
) WITHOUT ROWID');
$pdo->exec('CREATE TABLE service_dates (
    service_id INTEGER NOT NULL,
    date INTEGER NOT NULL,
    PRIMARY KEY (service_id, date)
) WITHOUT ROWID');

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

// Service-IDs als Integer, spart Platz. Der Präfix hält die Feeds auseinander,
// weil dieselbe service_id in zwei Feeds etwas anderes bedeuten kann.
$serviceIds = [];
function serviceId(string $prefix, string $name): int {
    global $serviceIds;
    return $serviceIds[$prefix . '|' . $name] ??= count($serviceIds) + 1;
}

// Fahrten ohne SJYID: OJP-ID aus trip_id und direction_id ableiten
// .ojp-91-44-B.1.TA.45.j26 + direction 0  ->  ojp:91044:B:H:j26:45
function deriveOjpId(string $tripId, string $direction): string {
    if (!preg_match('/^\.ojp-(\d+)-(\d+)-([A-Za-z]+)\.\d+\.[A-Za-z]+\.(\d+)\.(j\d+)$/', $tripId, $m)) return '';
    $dir = $direction === '1' ? 'R' : 'H';
    return sprintf('ojp:%s%03d:%s:%s:%s:%s', $m[1], (int)$m[2], $m[3], $dir, $m[5], $m[4]);
}

// Ergebnis: 1 gespeichert, 0 Fahrt nicht in der DB, -1 Fahrt kam schon vor (stop_times nicht gruppiert)
function storeSignature(PDOStatement $check, PDOStatement $upd, string $key, string $tripId, string $stops, string $times, string $tracks, string $detail): int {
    $check->execute([$key, $tripId]);
    $row = $check->fetch(PDO::FETCH_NUM);
    if (!$row) return 0;
    if ($row[0] !== null) return -1;
    $upd->execute([substr(md5($stops), 0, 12), substr(md5($times), 0, 12), substr(md5($tracks), 0, 12), $detail, $key, $tripId]);
    return 1;
}

// Abdruck je Fahrt aus stop_times.txt: Halte (Stopp-ID ohne Gleis plus Ein-/Ausstieg), Zeiten, Gleise.
// Gleise stehen entweder als UIC:0:Gleis oder als Suffix einer SLOID-Stopp-ID.
function importStopSignatures(PDO $pdo, ZipArchive $zip, string $key): void {
    if (!COMPARE_STOP_TIMES) return;
    if ($zip->locateName('stop_times.txt') === false) {
        writeLog("[$key] stop_times.txt fehlt, Varianten werden nicht verglichen.");
        return;
    }
    writeLog("[$key] Verarbeite stop_times.txt (Abdruck je Fahrt)...");
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_trips_tripid ON trips(feed, trip_id)');
    [$fp, $c, $n] = openCsv($zip, 'stop_times.txt', ['trip_id', 'arrival_time', 'departure_time', 'stop_id']);
    $iPick = $c['pickup_type'] ?? null;
    $iDrop = $c['drop_off_type'] ?? null;
    $check = $pdo->prepare('SELECT sig_stops FROM trips WHERE feed = ? AND trip_id = ? LIMIT 1');
    $upd = $pdo->prepare('UPDATE trips SET sig_stops = ?, sig_times = ?, sig_tracks = ?, sig_detail = ? WHERE feed = ? AND trip_id = ?');

    $current = null;
    $stops = $times = $tracks = '';
    $stopDetails = [];
    $stored = 0;
    $pending = 0;
    $broken = false;
    $pdo->beginTransaction();
    $flush = function () use (&$current, &$stops, &$times, &$tracks, &$stopDetails, &$stored, &$pending, &$broken, $check, $upd, $key, $pdo) {
        if ($current === null) return;
        $json = json_encode($stopDetails, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        $compressed = gzcompress($json, 6);
        if ($compressed === false) throw new RuntimeException('Haltestellendetails lassen sich nicht komprimieren.');
        $detail = base64_encode($compressed);
        $res = storeSignature($check, $upd, $key, $current, $stops, $times, $tracks, $detail);
        if ($res === 1) $stored++;
        elseif ($res === -1) $broken = true;
        if (++$pending >= 20000) {
            $pdo->commit();
            $pdo->beginTransaction();
            $pending = 0;
        }
    };
    while (($r = fgetcsv($fp, 0, ',', '"', '')) !== false) {
        if (count($r) < $n) continue;
        $tid = $r[$c['trip_id']];
        if ($tid !== $current) {
            $flush();
            $current = $tid;
            $stops = $times = $tracks = '';
            $stopDetails = [];
        }
        $stopId = $r[$c['stop_id']];
        if (preg_match('/^(?:Parent)?(ch:1:sloid:[^:]+)(?::(.*))?$/', $stopId, $stopParts)) {
            $base = $stopParts[1];
            $track = isset($stopParts[2]) ? ltrim($stopParts[2], ':') : '';
        } elseif (preg_match('/^(?:Parent)?([^:]+):0:(.+)$/', $stopId, $stopParts)) {
            $base = $stopParts[1];
            $track = $stopParts[2];
        } else {
            $base = preg_replace('/^Parent/', '', $stopId);
            $track = '';
        }
        $flags = ($iPick !== null ? (int)$r[$iPick] : 0) . ($iDrop !== null ? (int)$r[$iDrop] : 0);
        $stops .= $base . '/' . $flags . ';';
        $times .= $r[$c['arrival_time']] . '-' . $r[$c['departure_time']] . ';';
        $tracks .= $track . ';';
        $stopDetails[] = [
            'id' => $base,
            'flags' => $flags,
            'arrival' => $r[$c['arrival_time']],
            'departure' => $r[$c['departure_time']],
            'track' => $track,
        ];
    }
    $flush();
    fclose($fp);
    $pdo->commit();
    if ($broken) {
        $pdo->exec("UPDATE trips SET sig_stops = NULL, sig_times = NULL, sig_tracks = NULL, sig_detail = NULL WHERE feed = " . $pdo->quote($key));
        writeLog("[$key] WARNUNG: stop_times.txt ist nicht nach trip_id gruppiert, Abdrücke verworfen. Varianten werden nur als 'andere Variante' erkannt.");
    } else {
        writeLog("[$key] Abdrücke gespeichert: $stored");
    }
}

$operators = [];

function importFeed(PDO $pdo, string $key, string $source, int $from, int $to): void {
    global $operators;
    $feedAgencyIds = [];
    writeLog("[$key] Zeitfenster: $from bis $to");

    // Tage des Fensters mit Wochentag (0 = Montag)
    $window = [];
    $d = DateTimeImmutable::createFromFormat('Ymd', (string)$from);
    $end = DateTimeImmutable::createFromFormat('Ymd', (string)$to);
    for (; $d <= $end; $d = $d->modify('+1 day')) {
        $window[] = [(int)$d->format('Ymd'), (int)$d->format('N') - 1];
    }

    $zip = new ZipArchive();
    if ($zip->open($source) !== true) fail("ZIP $key lässt sich nicht öffnen.");

    // 0. Betreiber aus agency.txt (agency_id -> Klartextname), landet auch in operators.json
    writeLog("[$key] Verarbeite agency.txt...");
    if ($zip->locateName('agency.txt') !== false) {
        [$fp, $c, $n] = openCsv($zip, 'agency.txt', ['agency_id', 'agency_name']);
        $insAgency = $pdo->prepare('INSERT OR REPLACE INTO agencies VALUES (?, ?)');
        $pdo->beginTransaction();
        while (($r = fgetcsv($fp, 0, ',', '"', '')) !== false) {
            if (count($r) < $n) continue;
            $aid = trim($r[$c['agency_id']]);
            $aname = trim($r[$c['agency_name']]);
            if ($aid === '' || $aname === '') continue;
            $insAgency->execute([$aid, $aname]);
            $operators[$aid] = $aname;
            $feedAgencyIds[$aid] = true;
        }
        fclose($fp);
        $pdo->commit();
    } else {
        writeLog("[$key] agency.txt fehlt im ZIP, Betreiber werden übersprungen.");
    }

    // 1. Regelmässige Verkehrstage aus calendar.txt (nur im Fenster)
    writeLog("[$key] Verarbeite calendar.txt...");
    [$fp, $c, $n] = openCsv($zip, 'calendar.txt', [
        'service_id', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
        'start_date', 'end_date',
    ]);
    $dayCols = [$c['monday'], $c['tuesday'], $c['wednesday'], $c['thursday'], $c['friday'], $c['saturday'], $c['sunday']];
    $ins = $pdo->prepare('INSERT OR IGNORE INTO service_dates VALUES (?, ?)');
    $pdo->beginTransaction();
    while (($r = fgetcsv($fp, 0, ',', '"', '')) !== false) {
        if (count($r) < $n) continue;
        $id = serviceId($key, $r[$c['service_id']]);
        $start = (int)$r[$c['start_date']];
        $stop = (int)$r[$c['end_date']];
        foreach ($window as [$date, $wd]) {
            if ($date < $start || $date > $stop) continue;
            if ($r[$dayCols[$wd]] === '1') $ins->execute([$id, $date]);
        }
    }
    fclose($fp);
    $pdo->commit();

    // 2. Ausnahmen streamen, nur Fenster, nichts im RAM halten
    writeLog("[$key] Verarbeite calendar_dates.txt...");
    [$fp, $c, $n] = openCsv($zip, 'calendar_dates.txt', ['service_id', 'date', 'exception_type']);
    $del = $pdo->prepare('DELETE FROM service_dates WHERE service_id = ? AND date = ?');
    $pdo->beginTransaction();
    while (($r = fgetcsv($fp, 0, ',', '"', '')) !== false) {
        if (count($r) < $n) continue;
        $date = (int)$r[$c['date']];
        if ($date < $from || $date > $to) continue;
        $id = serviceId($key, $r[$c['service_id']]);
        $type = (int)$r[$c['exception_type']];
        if ($type === 1) $ins->execute([$id, $date]);
        elseif ($type === 2) $del->execute([$id, $date]);
    }
    fclose($fp);
    $pdo->commit();

    // Services dieses Feeds mit Betrieb im Fenster (IDs sind feedübergreifend eindeutig)
    global $serviceIds;
    $active = [];
    foreach ($pdo->query('SELECT DISTINCT service_id FROM service_dates') as $row) {
        $active[(int)$row[0]] = true;
    }

    // 3. Trips: eine Zeile pro Fahrt, nur wenn sie im Fenster fährt
    writeLog("[$key] Verarbeite trips.txt...");
    writeLog("[$key] Verarbeite routes.txt für Betreiber und Linien...");
    [$fp, $routeColumns, $routeCount] = openCsv($zip, 'routes.txt', ['route_id']);
    $routeAgencyColumn = $routeColumns['agency_id'] ?? null;
    $defaultAgencyId = count($feedAgencyIds) === 1 ? (string)array_key_first($feedAgencyIds) : '';
    $routeAgencies = [];
    while (($r = fgetcsv($fp, 0, ',', '"', '')) !== false) {
        if (count($r) < $routeCount) continue;
        $routeId = trim($r[$routeColumns['route_id']]);
        $agencyId = $routeAgencyColumn !== null ? trim($r[$routeAgencyColumn]) : '';
        $routeAgencies[$routeId] = $agencyId !== '' ? $agencyId : $defaultAgencyId;
    }
    fclose($fp);

    [$fp, $c, $n] = openCsv($zip, 'trips.txt', [
        'route_id', 'service_id', 'trip_id', 'trip_headsign', 'trip_short_name', 'direction_id', 'original_trip_id',
    ]);
    $iHints = $c['hints'] ?? null;
    $insTrip = $pdo->prepare('INSERT INTO trips (trip_short_name, service_id, destination, sjyid, hints, trip_id, feed, agency_id, route_id, direction_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    $pdo->beginTransaction();
    $count = 0;
    $skipped = 0;
    $derived = 0;
    $unresolved = 0;
    while (($r = fgetcsv($fp, 0, ',', '"', '')) !== false) {
        if (count($r) < $n) continue;
        $short = trim($r[$c['trip_short_name']]);
        $id = $serviceIds[$key . '|' . $r[$c['service_id']]] ?? null;
        if ($short === '' || $id === null || !isset($active[$id])) {
            $skipped++;
            continue;
        }
        $sjyid = $r[$c['original_trip_id']];
        if ($sjyid === '') {
            $sjyid = deriveOjpId($r[$c['trip_id']], $r[$c['direction_id']]);
            if ($sjyid !== '') $derived++; else $unresolved++;
        }
        $insTrip->execute([
            $short,
            $id,
            $r[$c['trip_headsign']],
            $sjyid,
            $iHints !== null ? $r[$iHints] : '',
            $r[$c['trip_id']],
            $key,
            $routeAgencies[trim($r[$c['route_id']])] ?? $defaultAgencyId,
            trim($r[$c['route_id']]),
            trim($r[$c['direction_id']]),
        ]);
        $count++;
    }
    fclose($fp);
    $pdo->commit();
    importStopSignatures($pdo, $zip, $key);
    $zip->close();
    writeLog("[$key] Trips gespeichert: $count, übersprungen: $skipped");
    writeLog("[$key] Ohne SJYID: $derived abgeleitet (ojp:...), $unresolved nicht ableitbar");
}

$imported = 0;
foreach ($feeds as $feed) {
    if (!isset($sources[$feed['key']])) continue;
    $from = max(WINDOW_FROM, $feed['valid_from']);
    $to = min(WINDOW_TO, $feed['valid_to']);
    if ($from > $to) {
        writeLog('[' . $feed['key'] . '] Liegt ausserhalb des Zeitfensters, übersprungen.');
        continue;
    }
    importFeed($pdo, $feed['key'], $sources[$feed['key']], $from, $to);
    $imported++;
}
if ($imported === 0) fail('Kein Feed importiert.');

writeLog('Erstelle Index...');
$pdo->exec('CREATE INDEX idx_trips_name ON trips(trip_short_name)');
$pdo->exec('CREATE INDEX idx_trips_sjyid ON trips(sjyid)');
$pdo->exec('CREATE INDEX idx_trips_family ON trips(trip_short_name, agency_id, route_id, direction_id)');
$pdo = null;

rename($dbTemp, $dbFinal);
if ($operators) {
    ksort($operators, SORT_NATURAL);
    file_put_contents(__DIR__ . '/operators.json', json_encode($operators, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT));
}
if (!$localZips) {
    file_put_contents($metaFile, json_encode($newMeta));
    foreach ($sources as $zipFile) @unlink($zipFile);
}

writeLog(sprintf('Import erfolgreich abgeschlossen. DB: %d MB', round(filesize($dbFinal) / 1048576)));
