<?php
$feedUrl = 'https://data.opentransportdata.swiss/dataset/timetable-2026-gtfs2020/permalink';
$zipFile = __DIR__ . '/gtfs_feed.zip';
$dbTemp = __DIR__ . '/transit_new.sqlite';
$dbFinal = __DIR__ . '/transit.sqlite';
$lockFile = __DIR__ . '/import.lock';
$logFile = __DIR__ . '/import.log';

function writeLog($msg) {
    global $logFile;
    file_put_contents($logFile, date('[Y-m-d H:i:s] ') . $msg . PHP_EOL, FILE_APPEND);
}

$fpLock = fopen($lockFile, 'c+');
if (!flock($fpLock, LOCK_EX | LOCK_NB)) {
    writeLog('Import läuft bereits. Abbruch.');
    exit(1);
}

writeLog('Starte GTFS-Prüfung...');

$ch = curl_init($feedUrl);
curl_setopt($ch, CURLOPT_NOBODY, true);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
curl_setopt($ch, CURLOPT_HEADER, true);
$headers = curl_exec($ch);

preg_match('/ETag: "(.+?)"/i', $headers, $etagMatches);
preg_match('/Last-Modified: (.+)/i', $headers, $modMatches);

$remoteETag = $etagMatches[1] ?? null;
$remoteMod = $modMatches[1] ?? null;

$metaFile = __DIR__ . '/feed_meta.json';
$localMeta = file_exists($metaFile) ? json_decode(file_get_contents($metaFile), true) : [];

if ($localMeta && $localMeta['etag'] === $remoteETag && $localMeta['last_modified'] === $remoteMod) {
    writeLog('Feed unverändert. Kein Import nötig.');
    flock($fpLock, LOCK_UN);
    fclose($fpLock);
    exit(0);
}

writeLog('Feed hat sich geändert. Starte Download...');

$fpZip = fopen($zipFile, 'w+');
$ch = curl_init($feedUrl);
curl_setopt($ch, CURLOPT_FILE, $fpZip);
curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
$success = curl_exec($ch);
fclose($fpZip);

if (!$success) {
    writeLog('Fehler beim Download des Feeds.');
    flock($fpLock, LOCK_UN);
    fclose($fpLock);
    exit(1);
}

file_put_contents($metaFile, json_encode(['etag' => $remoteETag, 'last_modified' => $remoteMod]));

if (file_exists($dbTemp)) unlink($dbTemp);
$pdo = new PDO('sqlite:' . $dbTemp);
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

$pdo->exec("PRAGMA synchronous = OFF;");
$pdo->exec("PRAGMA journal_mode = MEMORY;");

// Schema genau auf deine Daten ausgelegt
$pdo->exec("CREATE TABLE trips (
    trip_short_name TEXT NOT NULL,
    trip_id TEXT NOT NULL,
    destination TEXT,
    sjyid TEXT,
    hints TEXT,
    date TEXT NOT NULL
);");

$zip = new ZipArchive();
if ($zip->open($zipFile) !== TRUE) {
    writeLog('Konnte ZIP-Datei nicht öffnen.');
    flock($fpLock, LOCK_UN);
    fclose($fpLock);
    exit(1);
}

function getCsvStream($zip, $filename) {
    $fp = $zip->getStream($filename);
    if (!$fp) return [null, null];
    $headerLine = fgets($fp);
    $headers = str_getcsv(trim($headerLine));
    return [$fp, $headers];
}

writeLog('Verarbeite Kalender...');
$calendar = [];
list($fp, $headers) = getCsvStream($zip, 'calendar.txt');
if ($fp) {
    $iId = array_search('service_id', $headers);
    $iMon = array_search('monday', $headers);
    $iTue = array_search('tuesday', $headers);
    $iWed = array_search('wednesday', $headers);
    $iThu = array_search('thursday', $headers);
    $iFri = array_search('friday', $headers);
    $iSat = array_search('saturday', $headers);
    $iSun = array_search('sunday', $headers);
    $iStart = array_search('start_date', $headers);
    $iEnd = array_search('end_date', $headers);

    while (($row = fgets($fp)) !== false) {
        $data = str_getcsv(trim($row));
        if (count($data) <= max($iStart, $iEnd)) continue;
        $calendar[$data[$iId]] = [
            'days' => [$data[$iMon], $data[$iTue], $data[$iWed], $data[$iThu], $data[$iFri], $data[$iSat], $data[$iSun]],
            'start' => $data[$iStart],
            'end' => $data[$iEnd]
        ];
    }
    fclose($fp);
}

$exceptions = [];
list($fp, $headers) = getCsvStream($zip, 'calendar_dates.txt');
if ($fp) {
    $iId = array_search('service_id', $headers);
    $iDate = array_search('date', $headers);
    $iType = array_search('exception_type', $headers);

    while (($row = fgets($fp)) !== false) {
        $data = str_getcsv(trim($row));
        if (count($data) <= max($iId, $iDate, $iType)) continue;
        $exceptions[$data[$iId]][$data[$iDate]] = (int)$data[$iType];
    }
    fclose($fp);
}

function getServiceDates($serviceId, $calData, $exceptions) {
    $dates = [];
    if (!isset($calData[$serviceId])) return $dates;
    
    $start = new DateTime($calData[$serviceId]['start']);
    $end = new DateTime($calData[$serviceId]['end']);
    $end->modify('+1 day');
    
    $period = new DatePeriod($start, new DateInterval('P1D'), $end);
    $weeklyDays = $calData[$serviceId]['days'];

    foreach ($period as $dt) {
        $dateStr = $dt->format('Ymd');
        $wday = (int)$dt->format('N') - 1;
        $runs = $weeklyDays[$wday] == '1';

        if (isset($exceptions[$serviceId][$dateStr])) {
            $type = $exceptions[$serviceId][$dateStr];
            if ($type === 1) $runs = true;
            if ($type === 2) $runs = false;
        }

        if ($runs) $dates[] = $dateStr;
    }
    return $dates;
}

writeLog('Schreibe Trips in SQLite...');
list($fp, $headers) = getCsvStream($zip, 'trips.txt');
if ($fp) {
    // Dynamische Spaltenerkennung basierend auf dem Standard-Feed
    $iService = array_search('service_id', $headers);
    $iTripId = array_search('trip_id', $headers);
    $iHeadsign = array_search('trip_headsign', $headers);
    $iTripShort = array_search('trip_short_name', $headers);
    $iSjyid = array_search('sjyid', $headers); // Falls im Header so benannt
    $iHints = array_search('wheelchair_accessible', $headers); // oder entsprechende Hint-Spalte

    // Fallback falls Spaltenpositionen fix erwartet werden oder Header abweicht
    // Basierend auf deiner Beispielzeile: 
    // 0: route_id/service_id, 2: trip_id, 3: destination, 4: train_number, 7: sjyid, 8: hints
    $iService = $iService !== false ? $iService : 0;
    $iTripId = $iTripId !== false ? $iTripId : 2;
    $iHeadsign = $iHeadsign !== false ? $iHeadsign : 3;
    $iTripShort = $iTripShort !== false ? $iTripShort : 4;
    $iSjyid = $iSjyid !== false ? $iSjyid : 7;
    $iHints = $iHints !== false ? $iHints : 8;

    $pdo->beginTransaction();
    $stmt = $pdo->prepare("INSERT INTO trips VALUES (:num, :id, :dest, :sjyid, :hints, :date)");

    $serviceDatesCache = [];

    while (($row = fgets($fp)) !== false) {
        $data = str_getcsv(trim($row));
        if (count($data) <= max($iTripShort, $iTripId)) continue;

        $tripShort = trim($data[$iTripShort]);
        if ($tripShort === '') continue;

        $tripId = $data[$iTripId] ?? '';
        $destination = $data[$iHeadsign] ?? '';
        $sjyid = $data[$iSjyid] ?? '';
        $hints = $data[$iHints] ?? '';
        $serviceId = $data[$iService] ?? '';

        if (!isset($serviceDatesCache[$serviceId])) {
            $serviceDatesCache[$serviceId] = getServiceDates($serviceId, $calendar, $exceptions);
        }
        $activeDates = $serviceDatesCache[$serviceId];

        foreach ($activeDates as $dateStr) {
            $stmt->execute([
                ':num' => $tripShort,
                ':id' => $tripId,
                ':dest' => $destination,
                ':sjyid' => $sjyid,
                ':hints' => $hints,
                ':date' => $dateStr
            ]);
        }
    }
    fclose($fp);
    $pdo->commit();
}

$zip->close();

writeLog('Erstelle Index...');
$pdo->exec("CREATE INDEX idx_search ON trips(trip_short_name, date);");
$pdo = null;

if (file_exists($dbTemp)) {
    rename($dbTemp, $dbFinal);
    writeLog('Import erfolgreich abgeschlossen.');
} else {
    writeLog('Fehler: Temporäre Datenbank nicht gefunden.');
}

flock($fpLock, LOCK_UN);
fclose($fpLock);