<?php
// -----------------------------------------------------------------------------
// 1. Fehler-Reporting aktivieren
// -----------------------------------------------------------------------------
ini_set('display_errors', 1);
ini_set('display_startup_errors', 1);
error_reporting(E_ALL);

// -----------------------------------------------------------------------------
// 2. Konfiguration
// -----------------------------------------------------------------------------
// Füge hier deinen API-Token ein
define('API_TOKEN', '');

// Cache-Verzeichnis relativ zum aktuellen Skript-Standort
define('CACHE_DIR', __DIR__ . '/siri_data/');

define('FILE_PLANNED', CACHE_DIR . 'siri_planned.xml');
define('FILE_UNPLANNED', CACHE_DIR . 'siri_unplanned.xml');
define('DB_FILE', CACHE_DIR . 'siri_index.sqlite');

define('TTL_PLANNED', 86400); // 24 Stunden
define('TTL_UNPLANNED', 300);  // 5 Minuten

// -----------------------------------------------------------------------------
// 3. SQLite-Datenbank und Import-Funktionen
// -----------------------------------------------------------------------------
function getDbConnection(): PDO {
    $dir = dirname(DB_FILE);
    if (!is_dir($dir)) {
        @mkdir($dir, 0775, true);
    }
    
    $pdo = new PDO('sqlite:' . DB_FILE);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS siri_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            item_identifier TEXT,
            title TEXT,
            description TEXT,
            valid_from TEXT,
            valid_until TEXT,
            transport_mode TEXT,
            creation_time TEXT,
            source_scope TEXT,
            reason TEXT,
            consequence TEXT,
            recommendation TEXT,
            duration TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_valid ON siri_events(valid_from, valid_until);
    ");

    $columns = $pdo->query("PRAGMA table_info(siri_events)")->fetchAll(PDO::FETCH_ASSOC);
    $columnNames = array_column($columns, 'name');
    if (!in_array('creation_time', $columnNames, true)) {
        $pdo->exec('ALTER TABLE siri_events ADD COLUMN creation_time TEXT');
    }
    if (!in_array('source_scope', $columnNames, true)) {
        $pdo->exec('ALTER TABLE siri_events ADD COLUMN source_scope TEXT');
    }
    foreach (['reason', 'consequence', 'recommendation', 'duration'] as $column) {
        if (!in_array($column, $columnNames, true)) {
            $pdo->exec("ALTER TABLE siri_events ADD COLUMN {$column} TEXT");
        }
    }
    
    return $pdo;
}

function importSiriXmlToSqlite(string $xmlFilePath, PDO $pdo, string $sourceScope): void {
    if (!file_exists($xmlFilePath) || filesize($xmlFilePath) === 0) {
        return;
    }

    $reader = new XMLReader();
    if (!$reader->open($xmlFilePath)) {
        return;
    }
    
    $stmt = $pdo->prepare("
        INSERT INTO siri_events (item_identifier, title, description, valid_from, valid_until, transport_mode, creation_time, source_scope, reason, consequence, recommendation, duration) 
        VALUES (:id, :title, :desc, :from, :until, :mode, :created, :scope, :reason, :consequence, :recommendation, :duration)
    ");
    
    while ($reader->read()) {
        if ($reader->nodeType == XMLReader::ELEMENT && $reader->name === 'PtSituationElement') {
            $nodeXml = new SimpleXMLElement($reader->readOuterXML());

            $value = static function (array $names, bool $german = false) use ($nodeXml): string {
                foreach ($names as $name) {
                    $matches = $nodeXml->xpath('//*[local-name()="' . $name . '"]') ?: [];
                    $fallback = '';
                    foreach ($matches as $match) {
                        $text = trim((string)$match);
                        if ($fallback === '') {
                            $fallback = $text;
                        }
                        if ($german) {
                            $attributes = $match->attributes('http://www.w3.org/XML/1998/namespace');
                            if ((string)($attributes['lang'] ?? '') === 'DE') {
                                return $text;
                            }
                        } else {
                            return $text;
                        }
                    }
                    if ($fallback !== '') {
                        return $fallback;
                    }
                }
                return '';
            };
            
            $stmt->execute([
                ':id' => $value(['SituationNumber']),
                ':title' => $value(['Summary', 'SummaryText'], true),
                ':desc' => $value(['Description', 'DescriptionText'], true),
                ':from' => $value(['StartTime']),
                ':until' => $value(['EndTime']),
                ':mode' => $value(['VehicleMode']),
                ':created' => $value(['CreationTime']),
                ':scope' => $sourceScope,
                ':reason' => $value(['Reason', 'ReasonText'], true),
                ':consequence' => $value(['Consequence', 'ConsequenceText'], true),
                ':recommendation' => $value(['Recommendation', 'RecommendationText'], true),
                ':duration' => $value(['Duration', 'DurationText'], true)
            ]);
        }
    }
    
    $reader->close();
}

function rebuildSqliteIndex(): void {
    $pdo = getDbConnection();
    $pdo->beginTransaction();

    try {
        $pdo->exec("DELETE FROM siri_events");
        importSiriXmlToSqlite(FILE_UNPLANNED, $pdo, 'unplanned');
        importSiriXmlToSqlite(FILE_PLANNED, $pdo, 'planned');
        $pdo->commit();
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $error;
    }
}

// -----------------------------------------------------------------------------
// 4. Synchronisations-Funktion
// -----------------------------------------------------------------------------
function syncSiriData(string $filePath, int $ttlSeconds, string $apiUrl): void {
    $now = time();
    $fileNeedsUpdate = false;

    if (!file_exists($filePath)) {
        $fileNeedsUpdate = true;
    } else {
        $fileAge = $now - filemtime($filePath);
        if ($fileAge >= $ttlSeconds) {
            $fileNeedsUpdate = true;
        }
    }

    if ($fileNeedsUpdate) {
        $dir = dirname($filePath);
        
        if (!is_dir($dir) && !@mkdir($dir, 0775, true)) {
            echo "<p style='color:red;'><strong>Fehler:</strong> Ordner <code>{$dir}</code> konnte nicht erstellt werden.</p>";
            return;
        }

        if (!is_writable($dir)) {
            echo "<p style='color:red;'><strong>Fehler:</strong> Das Verzeichnis <code>{$dir}</code> ist nicht beschreibbar.</p>";
            return;
        }

        $ch = curl_init();
        curl_setopt_array($ch, [
            CURLOPT_URL => $apiUrl,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 60,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_ENCODING => '', // Akzeptiert alle Komprimierungen (gzip, deflate) automatisch
            CURLOPT_HTTPHEADER => [
                'Authorization: ' . trim(API_TOKEN),
                'User-Agent: TransportApp/1.0',
                'Accept: application/xml, text/xml, application/zip, */*'
            ]
        ]);

        $rawData = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlError = curl_error($ch);

        if ($rawData !== false && $httpCode === 200 && !empty($rawData)) {
            $xmlContent = null;
            $payload = $rawData;

            // Prüfen auf ZIP Magic Bytes ("PK")
            if (str_starts_with($payload, "PK")) {
                $tmpZipPath = tempnam(sys_get_temp_dir(), 'siri_zip_');
                file_put_contents($tmpZipPath, $payload);

                $zip = new ZipArchive();
                $res = $zip->open($tmpZipPath);

                if ($res === true) {
                    if ($zip->numFiles > 0) {
                        $extracted = $zip->getFromIndex(0);
                        // Falls die Datei im ZIP gzipped ist
                        if (str_starts_with($extracted, "\x1f\x8b")) {
                            $xmlContent = gzdecode($extracted);
                        } else {
                            $xmlContent = $extracted;
                        }
                    }
                    $zip->close();
                } else {
                    echo "<p style='color:red;'><strong>ZIP-Fehler:</strong> Archiv konnte nicht geöffnet werden (Code: {$res}).</p>";
                }
                @unlink($tmpZipPath);
            } else {
                // Falls direkt GZIP
                if (str_starts_with($payload, "\x1f\x8b")) {
                    $xmlContent = gzdecode($payload);
                } else {
                    $xmlContent = $payload;
                }
            }

            // Nur speichern, wenn der Inhalt tatsächlich wie XML aussieht
            if (!empty($xmlContent) && str_contains($xmlContent, '<')) {
                $tmpFile = $filePath . '.tmp';
                if (file_put_contents($tmpFile, $xmlContent) !== false) {
                    rename($tmpFile, $filePath);
                } else {
                    echo "<p style='color:red;'><strong>Fehler:</strong> Schreibzugriff auf Temp-Datei fehlgeschlagen.</p>";
                }
            } else {
                echo "<p style='color:red;'><strong>Fehler:</strong> Extrahierte Daten enthalten kein gültiges XML.</p>";
            }

        } else {
            echo "<div style='background:#fee; border:1px solid red; padding:10px; margin-bottom:10px;'>";
            echo "<h4 style='color:red; margin:0 0 5px 0;'>API-Fehler bei {$apiUrl}</h4>";
            echo "<strong>HTTP Status:</strong> {$httpCode}<br>";
            if (!empty($curlError)) {
                echo "<strong>cURL Netz-Fehler:</strong> {$curlError}<br>";
            }
            if (!empty($rawData)) {
                echo "<strong>Antwort vom API-Server:</strong><pre style='background:#fff; padding:5px; border:1px solid #ccc; max-height:150px; overflow:auto;'>" . htmlspecialchars(substr($rawData, 0, 500)) . "</pre>";
            } else {
                echo "<em>(Keine Antwort-Daten vom Server erhalten)</em>";
            }
            echo "</div>";
            
            if (file_exists($filePath)) {
                touch($filePath);
            }
        }
    }
}

// -----------------------------------------------------------------------------
// 5. Daten-Synchronisation ausführen
// -----------------------------------------------------------------------------
$urlPlanned = 'https://api.opentransportdata.swiss/la/siri-sx'; 
$urlUnplanned = 'https://api.opentransportdata.swiss/la/siri-sx-unplanned';

syncSiriData(FILE_UNPLANNED, TTL_UNPLANNED, $urlUnplanned);
syncSiriData(FILE_PLANNED, TTL_PLANNED, $urlPlanned);
rebuildSqliteIndex();

// -----------------------------------------------------------------------------
// 6. Status-Ausgabe
// -----------------------------------------------------------------------------
?>
<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <title>SIRI Cache & DB Status</title>
    <style>
        body { font-family: system-ui, sans-serif; margin: 2rem; background: #f4f4f9; color: #333; }
        .card { background: #fff; padding: 1.5rem; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.1); max-width: 650px; }
        .ok { color: #2e7d32; font-weight: bold; }
        .missing { color: #c62828; font-weight: bold; }
        code { background: #eee; padding: 3px 6px; border-radius: 4px; font-size: 0.9em; }
    </style>
</head>
<body>

<div class="card">
    <h2>SIRI Cache & DB Status</h2>
    
    <h3>Ungeplante Ereignisse (Intervall: 5 Min.)</h3>
    <?php if (file_exists(FILE_UNPLANNED)): ?>
        <p class="ok">✓ Vorhanden (XML & DB aktualisiert)</p>
        <ul>
            <li>Pfad: <code><?= FILE_UNPLANNED ?></code></li>
            <li>Größe: <?= round(filesize(FILE_UNPLANNED) / 1024, 2) ?> KB</li>
            <li>Alter: Vor <?= (time() - filemtime(FILE_UNPLANNED)) ?> Sekunden aktualisiert</li>
        </ul>
    <?php else: ?>
        <p class="missing">✗ Datei existiert noch nicht</p>
    <?php endif; ?>

    <hr>

    <h3>Geplante Ereignisse (Intervall: 24 Std.)</h3>
    <?php if (file_exists(FILE_PLANNED)): ?>
        <p class="ok">✓ Vorhanden (XML & DB aktualisiert)</p>
        <ul>
            <li>Pfad: <code><?= FILE_PLANNED ?></code></li>
            <li>Größe: <?= round(filesize(FILE_PLANNED) / 1024, 2) ?> KB</li>
            <li>Alter: Vor <?= (time() - filemtime(FILE_PLANNED)) ?> Sekunden aktualisiert</li>
        </ul>
    <?php else: ?>
        <p class="missing">✗ Datei existiert noch nicht</p>
    <?php endif; ?>

    <hr>

    <h3>SQLite-Datenbank</h3>
    <?php if (file_exists(DB_FILE)): ?>
        <p class="ok">✓ Aktiv</p>
        <ul>
            <li>Pfad: <code><?= DB_FILE ?></code></li>
            <li>Größe: <?= round(filesize(DB_FILE) / 1024, 2) ?> KB</li>
        </ul>
    <?php else: ?>
        <p class="missing">✗ Noch keine Datenbank erstellt</p>
    <?php endif; ?>
</div>

</body>
</html>