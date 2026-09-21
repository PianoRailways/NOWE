<?php
// ─────────────────────────────────────────────────────────────────────────
// HIM REST-API – Lädt Ereignisse aus SQLite-DB (gecacht von sync_siri.php)
// ─────────────────────────────────────────────────────────────────────────

ini_set('display_errors', 0);
error_reporting(E_ALL);

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET');
header('Cache-Control: no-cache, must-revalidate');

// ─────────────────────────────────────────────────────────────────────────
// Konfiguration
// ─────────────────────────────────────────────────────────────────────────

define('DB_FILE', __DIR__ . '/siri_data/siri_index.sqlite');
define('FILE_UNPLANNED', __DIR__ . '/siri_data/siri_unplanned.xml');
define('FILE_PLANNED', __DIR__ . '/siri_data/siri_planned.xml');

// ─────────────────────────────────────────────────────────────────────────
// Fehlerbehandlung
// ─────────────────────────────────────────────────────────────────────────

function sendError($message, $statusCode = 500) {
    http_response_code($statusCode);
    echo json_encode(['error' => $message], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    exit;
}

function sendSuccess($data) {
    http_response_code(200);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    exit;
}

// ─────────────────────────────────────────────────────────────────────────
// Datenbank-Verbindung
// ─────────────────────────────────────────────────────────────────────────

$pdo = null;
if (!file_exists(DB_FILE)) {
    // DB existiert noch nicht, aber wir geben leeres Array zurück statt Fehler
} else {
    try {
        $pdo = new PDO('sqlite:' . DB_FILE);
        $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        
        // Stelle sicher, dass die Tabelle existiert
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
                source_scope TEXT
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
    } catch (PDOException $e) {
        sendError('Datenbankverbindung fehlgeschlagen: ' . $e->getMessage(), 500);
    }
}

// ─────────────────────────────────────────────────────────────────────────
// Query-Parameter
// ─────────────────────────────────────────────────────────────────────────

$action = $_GET['action'] ?? 'list';
$scope = $_GET['scope'] ?? 'all'; // 'all', 'planned', 'unplanned'
$search = $_GET['search'] ?? '';
$limit = max(1, min(500, (int)($_GET['limit'] ?? 100)));
$offset = max(0, (int)($_GET['offset'] ?? 0));

// ─────────────────────────────────────────────────────────────────────────
// API-Endpunkte
// ─────────────────────────────────────────────────────────────────────────

switch ($action) {
    
    // ─────────────────────────────────────────────────────────────────
    // GET /api.php?action=list
    // Lädt Ereignisse aus DB mit optionalem Filter
    // ─────────────────────────────────────────────────────────────────
    case 'list':
        // Wenn DB nicht existiert, gib leeres Array zurück (noch nicht synchronisiert)
        if (!$pdo) {
            sendSuccess([
                'status' => 'ok',
                'data' => [],
                'meta' => [
                    'total' => 0,
                    'limit' => $limit,
                    'offset' => $offset,
                    'has_more' => false,
                    'message' => 'Datenbank noch nicht initialisiert. Bitte sync_siri.php aufrufen.'
                ]
            ]);
            break;
        }
        
        $sql = 'SELECT * FROM siri_events WHERE 1=1';
        $params = [];
        
        // Scope-Filter
        if ($scope === 'planned') {
            $sql .= ' AND source_scope = :scope';
            $params[':scope'] = 'planned';
        } elseif ($scope === 'unplanned') {
            $sql .= ' AND source_scope = :scope';
            $params[':scope'] = 'unplanned';
        }
        
        // Suchfilter
        if (!empty($search)) {
            $sql .= ' AND (title LIKE :search OR description LIKE :search OR transport_mode LIKE :search)';
            $params[':search'] = '%' . $search . '%';
        }
        
        // Sortierung und Limit
        $sql .= " ORDER BY valid_from DESC LIMIT {$limit} OFFSET {$offset}";
        
        try {
            $stmt = $pdo->prepare($sql);
            foreach ($params as $key => $val) {
                $stmt->bindValue($key, $val);
            }
            $stmt->execute();
            
            $events = $stmt->fetchAll(PDO::FETCH_ASSOC);
            
            // Zähle Gesamtergebnisse (ohne LIMIT)
            $countSql = preg_replace('/ ORDER BY valid_from DESC LIMIT \d+ OFFSET \d+$/', '', $sql);
            $countSql = preg_replace('/SELECT \*/', 'SELECT COUNT(*) as total', $countSql);
            
            $countStmt = $pdo->prepare($countSql);
            foreach ($params as $key => $val) {
                $countStmt->bindValue($key, $val);
            }
            $countStmt->execute();
            $countResult = $countStmt->fetch(PDO::FETCH_ASSOC);
            $total = isset($countResult['total']) ? (int)$countResult['total'] : 0;
            
            sendSuccess([
                'status' => 'ok',
                'data' => $events,
                'meta' => [
                    'total' => $total,
                    'limit' => $limit,
                    'offset' => $offset,
                    'has_more' => ($offset + $limit) < $total
                ]
            ]);
        } catch (PDOException $e) {
            sendError('Datenbankabfrage fehlgeschlagen: ' . $e->getMessage(), 500);
        }
        break;
    
    // ─────────────────────────────────────────────────────────────────
    // GET /api.php?action=status
    // Gibt Datei-Status und Sync-Infos zurück
    // ─────────────────────────────────────────────────────────────────
    case 'status':
        $count = 0;
        if (!$pdo) {
            sendSuccess([
                'status' => 'not_initialized',
                'events_total' => 0,
                'last_sync' => '',
                'db_file' => basename(DB_FILE),
                'db_exists' => false,
                'message' => 'Datenbank nicht initialisiert. Erst sync_siri.php aufrufen.'
            ]);
            break;
        }
        
        try {
            $stmt = $pdo->query('SELECT COUNT(*) as total FROM siri_events');
            $result = $stmt->fetch(PDO::FETCH_ASSOC);
            $count = isset($result['total']) ? (int)$result['total'] : 0;
            
            $lastSync = '';
            if (file_exists(FILE_UNPLANNED)) {
                $lastSync = date('Y-m-d H:i:s', filemtime(FILE_UNPLANNED));
            }
            
            sendSuccess([
                'status' => 'ok',
                'events_total' => $count,
                'last_sync' => $lastSync,
                'db_file' => basename(DB_FILE),
                'db_size_mb' => round(filesize(DB_FILE) / 1024 / 1024, 2),
                'cache_unplanned' => file_exists(FILE_UNPLANNED),
                'cache_planned' => file_exists(FILE_PLANNED)
            ]);
        } catch (PDOException $e) {
            sendError('Fehler beim Auslesen des Status: ' . $e->getMessage(), 500);
        }
        break;
    
    // ─────────────────────────────────────────────────────────────────
    // GET /api.php?action=stats
    // Statistiken: Events nach Modus und Transport
    // ─────────────────────────────────────────────────────────────────
    case 'stats':
        if (!$pdo) {
            sendSuccess([
                'status' => 'not_initialized',
                'by_mode' => [],
                'by_type' => ['planned' => 0, 'unplanned' => 0]
            ]);
            break;
        }
        
        try {
            $now = date('Y-m-d H:i:s');
            
            // Nach Transport-Modus gruppieren
            $stmt = $pdo->query("
                SELECT 
                    CASE WHEN transport_mode IS NULL OR transport_mode = '' THEN 'Sonstige' ELSE transport_mode END as mode,
                    COUNT(*) as count
                FROM siri_events
                GROUP BY mode
                ORDER BY count DESC
            ");
            $byMode = $stmt->fetchAll(PDO::FETCH_ASSOC);
            
            // Geplante vs. Ungeplante
            $stmt = $pdo->prepare("
                SELECT 
                    COUNT(CASE WHEN valid_from > :now THEN 1 END) as planned,
                    COUNT(CASE WHEN valid_until >= :now THEN 1 END) as unplanned
                FROM siri_events
            ");
            $stmt->execute([':now' => $now]);
            $byType = $stmt->fetch(PDO::FETCH_ASSOC) ?? ['planned' => 0, 'unplanned' => 0];
            
            sendSuccess([
                'status' => 'ok',
                'by_mode' => $byMode,
                'by_type' => $byType
            ]);
        } catch (PDOException $e) {
            sendError('Fehler beim Auslesen der Statistiken: ' . $e->getMessage(), 500);
        }
        break;
    
    // ─────────────────────────────────────────────────────────────────
    // GET /api.php?action=force-sync
    // Triggert die sync_siri.php zum Laden neuer Daten
    // (Nur wenn sync_siri.php im selben Verzeichnis liegt)
    // ─────────────────────────────────────────────────────────────────
    case 'force-sync':
        $syncScript = __DIR__ . '/sync_siri.php';
        if (!file_exists($syncScript)) {
            sendError('sync_siri.php nicht gefunden', 404);
        }
        
        // Starte sync_siri.php im Hintergrund (Unix)
        if (PHP_OS_FAMILY === 'Linux' || PHP_OS_FAMILY === 'Darwin') {
            shell_exec("php {$syncScript} > /dev/null 2>&1 &");
            sendSuccess(['status' => 'sync_started']);
        } else {
            // Windows: Nutze popen statt shell_exec
            popen("start /B php {$syncScript}", 'r');
            sendSuccess(['status' => 'sync_started']);
        }
        break;
    
    // ─────────────────────────────────────────────────────────────────
    // Unbekannter Action
    // ─────────────────────────────────────────────────────────────────
    default:
        sendError('Unbekannter Action: ' . htmlspecialchars($action), 400);
}