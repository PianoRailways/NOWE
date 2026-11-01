<?php
$number = trim($_GET['number'] ?? '');
$dateInput = trim($_GET['date'] ?? '');
$date = date('Ymd');
$error = '';

if ($dateInput === '') {
    $dateInput = date('d.m.Y');
} elseif (preg_match('/^(\d{2})\.(\d{2})\.(\d{4})$/', $dateInput, $dateParts) && checkdate((int) $dateParts[2], (int) $dateParts[1], (int) $dateParts[3])) {
    $date = $dateParts[3] . $dateParts[2] . $dateParts[1];
} elseif (preg_match('/^\d{8}$/', $dateInput)) {
    $yearMonthDayValid = checkdate((int) substr($dateInput, 4, 2), (int) substr($dateInput, 6, 2), (int) substr($dateInput, 0, 4));
    $dayMonthYearValid = checkdate((int) substr($dateInput, 2, 2), (int) substr($dateInput, 0, 2), (int) substr($dateInput, 4, 4));

    if ($yearMonthDayValid) {
        $date = $dateInput;
        $dateInput = substr($dateInput, 6, 2) . '.' . substr($dateInput, 4, 2) . '.' . substr($dateInput, 0, 4);
    } elseif ($dayMonthYearValid) {
        $date = substr($dateInput, 4, 4) . substr($dateInput, 2, 2) . substr($dateInput, 0, 2);
        $dateInput = substr($dateInput, 0, 2) . '.' . substr($dateInput, 2, 2) . '.' . substr($dateInput, 4, 4);
    } else {
        $error = 'Bitte ein gültiges Datum im Format TT.MM.JJJJ eingeben.';
    }
} else {
    $error = 'Bitte ein gültiges Datum im Format TT.MM.JJJJ eingeben.';
}

$results = [];
$dbFile = __DIR__ . '/transit.sqlite';

if ($number !== '' && $error === '' && file_exists($dbFile)) {
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
    <title>öV NOWE • Fahrtensuche</title>
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
        .gtfs-trips { display: flex; flex-direction: column; }
        .gtfs-trip-row { display: block; padding: 10px 14px; border-bottom: 1px solid var(--border); color: var(--text-main); text-decoration: none; }
        .gtfs-trip-row:nth-child(even) { background: var(--board-row); }
        .gtfs-trip-row:nth-child(odd) { background: var(--board-alt); }
        .gtfs-trip-top, .gtfs-trip-bottom { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
        .gtfs-trip-top { font-size: 0.9em; }
        .gtfs-trip-sjyid { color: var(--text-via); font-family: monospace; font-size: 0.86em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .gtfs-trip-bottom { margin-top: 5px; font-size: 0.95em; }
        .gtfs-trip-arrow { font-weight: 700; font-size: 1.2em;}
        .gtfs-trip-destination { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 700;}
        .gtfs-trip-hints { margin-left: auto; color: var(--text-via); font-size: 0.8em; text-align: right; white-space: nowrap; }
        #live-clock { cursor: pointer; }
        @media (max-width: 640px) {
            .gtfs-form { align-items: stretch; flex-direction: column; }
            .gtfs-field--number { flex: 1; }
            .gtfs-form button { width: 100%; }
            .gtfs-trip-row { padding: 10px; }
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
        <h1>Fahrtensuche</h1>
    </section>

    <form class="gtfs-form" method="GET" action="">
            <div class="gtfs-field gtfs-field--number">
                <label for="number">Fahrtnummer:</label>
                <input type="text" id="number" name="number" value="<?= htmlspecialchars($number) ?>" placeholder="z.B. 450" required>
            </div>
            <div class="gtfs-field">
                <label for="date">Datum (TT.MM.JJJJ):</label>
                <input type="text" id="date" name="date" value="<?= htmlspecialchars($dateInput) ?>" placeholder="z.B. 02.11.2026" inputmode="numeric" maxlength="10" autocomplete="off" required>
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
        <div class="gtfs-trips">
            <?php foreach ($results as $row): ?>
                <?php 
                    $sjyidEncoded = urlencode($row['sjyid']);
                    $noweUrl = "https://nowe.stellwerksim.ch/trip/?sjyid=" . $sjyidEncoded . "&date=" . $formattedDate;
                ?>
                <a href="<?= htmlspecialchars($noweUrl) ?>" target="_blank" class="gtfs-trip-row">
                    <span class="gtfs-trip-top">
                        <?= htmlspecialchars($number) ?>
                        <span class="gtfs-trip-sjyid">(<?= htmlspecialchars($row['sjyid']) ?>)</span>
                    </span>
                    <span class="gtfs-trip-bottom">
                        <span class="gtfs-trip-arrow">→</span>
                        <span class="gtfs-trip-destination"><?= htmlspecialchars($row['destination'] ?: '-') ?></span>
                        <span class="gtfs-trip-hints"><?= htmlspecialchars($row['hints'] ?: '-') ?></span>
                    </span>
                </a>
            <?php endforeach; ?>
        </div>
    <?php endif; ?>
    </main>

    <script>
        const dateInput = document.getElementById('date');
        const searchButton = document.querySelector('.gtfs-form button[type="submit"]');

        dateInput.addEventListener('input', () => {
            const digits = dateInput.value.replace(/\D/g, '').slice(0, 8);
            const parts = [];

            if (digits.length > 0) parts.push(digits.slice(0, 2));
            if (digits.length > 2) parts.push(digits.slice(2, 4));
            if (digits.length > 4) parts.push(digits.slice(4, 8));

            dateInput.value = parts.join('.');

            if (digits.length === 8) {
                searchButton.focus();
            }
        });

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