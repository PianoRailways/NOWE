<?php
$number = trim($_GET['number'] ?? '');
$date = trim($_GET['date'] ?? date('Ymd'));

$results = [];
$error = '';
$dbFile = __DIR__ . '/transit.sqlite';

if ($number !== '' && file_exists($dbFile)) {
    try {
        $pdo = new PDO('sqlite:' . $dbFile, null, null, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC
        ]);

        $stmt = $pdo->prepare("
            SELECT trip_id, destination, sjyid, hints, date 
            FROM trips 
            WHERE trip_short_name = :number AND date = :date
        ");
        $stmt->execute([':number' => $number, ':date' => $date]);
        $results = $stmt->fetchAll();

    } catch (Exception $e) {
        $error = 'Datenbankfehler bei der Abfrage.';
    }
}

// Datum für den NOWE-Link formatieren (YYYYMMDD zu YYYY-MM-DD)
$formattedDate = strlen($date) === 8 ? substr($date, 0, 4) . '-' . substr($date, 4, 2) . '-' . substr($date, 6, 2) : date('Y-m-d');
?>
<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="stylesheet" href="../style.css">
    <link rel="icon" type="image/png" href="../nowe.png">
    <link rel="apple-touch-icon" href="../nowe.png">
    <title>öV NOWE - GTFS Trip Finder</title>
    <style>
        .gtfs-main { width: 100%; max-width: 1100px; margin: 0 auto; }
        .gtfs-heading { padding: 18px 14px 12px; background: var(--board-head); border-bottom: 1px solid var(--border); }
        .gtfs-heading h1 { font-size: 1.2em; letter-spacing: 0.02em; }
        .gtfs-heading p { margin-top: 4px; color: var(--text-via); font-size: 0.85em; }
        .gtfs-form { display: flex; align-items: flex-end; gap: 8px; padding: 12px 14px; background: var(--board-bg); border-bottom: 1px solid var(--border); }
        .gtfs-field { flex: 1; min-width: 0; }
        .gtfs-field--number { flex: 2; }
        .gtfs-form label { display: block; margin-bottom: 5px; color: var(--text-via); font-size: 0.8em; font-weight: 700; }
        .gtfs-form input { width: 100%; padding: 8px 10px; border: 1px solid rgba(255,255,255,0.18); border-radius: 3px; background: rgba(255,255,255,0.06); color: var(--text-main); font: inherit; }
        .gtfs-form input:focus { outline: none; border-color: var(--sbb-orange); background: rgba(255,255,255,0.1); }
        .gtfs-form input::placeholder { color: var(--text-dim); }
        .gtfs-form button { padding: 8px 18px; border: 0; border-radius: 3px; background: var(--sbb-red); color: #fff; font-weight: 700; cursor: pointer; }
        .gtfs-form button:hover { background: #c90000; }
        .gtfs-notice { margin: 12px 14px; padding: 10px 12px; border-left: 3px solid var(--live-red); background: rgba(255,59,48,0.15); color: #ffb0aa; }
        .gtfs-empty { padding: 18px 14px; color: var(--text-via); }
        .gtfs-results-title { padding: 16px 14px 8px; font-size: 1em; color: var(--text-main); }
        .gtfs-table-wrap { overflow-x: auto; }
        .gtfs-table { width: 100%; border-collapse: collapse; }
        .gtfs-table th, .gtfs-table td { padding: 10px 14px; border-bottom: 1px solid var(--border); text-align: left; font-size: 0.86em; vertical-align: middle; }
        .gtfs-table th { background: var(--board-head); color: var(--text-via); font-size: 0.75em; letter-spacing: 0.03em; text-transform: uppercase; }
        .gtfs-table tbody tr:nth-child(even) { background: var(--board-row); }
        .gtfs-table tbody tr:nth-child(odd) { background: var(--board-alt); }
        .gtfs-table code { padding: 2px 5px; color: var(--text-via); background: rgba(0,0,0,0.2); font-family: monospace; font-size: 0.9em; }
        .btn-nowe { display: inline-block; padding: 5px 9px; border: 1px solid var(--sbb-orange); border-radius: 2px; color: var(--sbb-orange); text-decoration: none; font-size: 0.8em; font-weight: 700; white-space: nowrap; }
        .btn-nowe:hover { background: var(--sbb-orange); color: #000; }
        #live-clock { cursor: pointer; }
        @media (max-width: 640px) {
            .gtfs-form { align-items: stretch; flex-direction: column; }
            .gtfs-field--number { flex: 1; }
            .gtfs-form button { width: 100%; }
            .gtfs-table th, .gtfs-table td { padding: 9px 10px; }
        }
    </style>
</head>
<body>

<header id="app-header">
    <div id="header-left">
        <button id="btn-home" title="Startseite" onclick="window.location='../'">⌂ Home</button>
    </div>
    <div id="header-center">
        <span id="live-clock" title="Suche zurücksetzen" onclick="window.location.href = window.location.pathname"></span>
    </div>
    <div id="header-right">
        <span id="app-title">öV NOWE</span>
    </div>
</header>

<main class="gtfs-main">
    <section class="gtfs-heading">
        <h1>GTFS Trip Finder</h1>
        <p>Fahrten über Zugnummer und Datum finden und direkt in NOWE öffnen.</p>
    </section>

    <form class="gtfs-form" method="GET" action="">
            <div class="gtfs-field gtfs-field--number">
                <label for="number">Zugnummer:</label>
                <input type="text" id="number" name="number" value="<?= htmlspecialchars($number) ?>" placeholder="z.B. 450" required>
            </div>
            <div class="gtfs-field">
                <label for="date">Datum (YYYYMMDD):</label>
                <input type="text" id="date" name="date" value="<?= htmlspecialchars($date) ?>" placeholder="z.B. 20261102" required>
            </div>
        <button type="submit">Suchen</button>
    </form>

    <?php if ($error): ?>
        <div class="gtfs-notice"><?= htmlspecialchars($error) ?></div>
    <?php endif; ?>

    <?php if ($number !== '' && empty($results) && !$error): ?>
        <p class="gtfs-empty">Keine Fahrten für Zug <?= htmlspecialchars($number) ?> am <?= htmlspecialchars($date) ?> gefunden.</p>
    <?php endif; ?>

    <?php if (!empty($results)): ?>
        <h2 class="gtfs-results-title">Gefundene Fahrten (<?= count($results) ?>)</h2>
        <div class="gtfs-table-wrap">
        <table class="gtfs-table">
            <thead>
                <tr>
                    <th>Fahrtziel</th>
                    <th>Swiss Journey ID (sjyid)</th>
                    <th>Hints</th>
                    <th>Aktion</th>
                </tr>
            </thead>
            <tbody>
                <?php foreach ($results as $row): ?>
                    <?php 
                        $sjyidEncoded = urlencode($row['sjyid']);
                        $noweUrl = "https://nowe.stellwerksim.ch/trip/?sjyid=" . $sjyidEncoded . "&date=" . $formattedDate;
                    ?>
                    <tr>
                        <td><strong><?= htmlspecialchars($row['destination'] ?: '-') ?></strong></td>
                        <td><code><?= htmlspecialchars($row['sjyid']) ?></code></td>
                        <td><?= htmlspecialchars($row['hints'] ?: '-') ?></td>
                        <td>
                            <a href="<?= htmlspecialchars($noweUrl) ?>" target="_blank" class="btn-nowe">NOWE Abfragen</a>
                        </td>
                    </tr>
                <?php endforeach; ?>
            </tbody>
        </table>
        </div>
    <?php endif; ?>
    </main>

    <script>
        function updateClock() {
            const clock = document.getElementById('live-clock');
            if (!clock) return;
            const now = new Date();
            clock.textContent = [now.getHours(), now.getMinutes(), now.getSeconds()]
                .map(value => String(value).padStart(2, '0'))
                .join(':');
        }

        updateClock();
        setInterval(updateClock, 1000);
    </script>
</body>
</html>