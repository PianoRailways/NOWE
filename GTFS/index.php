<?php
$number = trim($_GET['number'] ?? '');
$dateInput = trim($_GET['date'] ?? '');
$date = date('Ymd');
$error = '';

if ($number !== '' && !ctype_digit($number)) {
    $error = 'Bitte eine gültige Fahrtnummer eingeben.';
}

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
        $error = $error ?: 'Bitte ein gültiges Datum im Format TT.MM.JJJJ eingeben.';
    }
} else {
    $error = $error ?: 'Bitte ein gültiges Datum im Format TT.MM.JJJJ eingeben.';
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
            SELECT DISTINCT t.destination, t.sjyid, t.hints
            FROM trips t
            JOIN service_dates d ON d.service_id = t.service_id
            WHERE t.trip_short_name = :number AND d.date = :date
        ");
        $stmt->execute([':number' => $number, ':date' => (int) $date]);
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
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=0, viewport-fit=cover">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <meta name="theme-color" content="#061030">
    <link rel="stylesheet" href="../css/style.css">
    <link rel="stylesheet" href="../shared/footer.css">
    <link rel="stylesheet" href="gtfs.css">
    <link rel="icon" type="image/png" href="../nowe.png">
    <link rel="apple-touch-icon" href="../nowe.png">
    <title>öV NOWE • Fahrtensuche</title>
    <style>
        #app-header { position: sticky; top: 0; z-index: 100; padding-top: env(safe-area-inset-top); }
        input, select, textarea { font-size: 16px; }
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
                <input type="text" id="number" name="number" value="<?= htmlspecialchars($number) ?>" placeholder="z.B. 450" inputmode="numeric" pattern="[0-9]*" autocomplete="off" required>
            </div>
            <div class="gtfs-field">
                <label for="date">Datum (TT.MM.JJJJ):</label>
                <div class="gtfs-date-fields">
                    <input type="text" id="date" name="date" value="<?= htmlspecialchars($dateInput) ?>" placeholder="z.B. 02.11.2026" inputmode="numeric" pattern="[0-9.]*" maxlength="10" autocomplete="off" required>
                    <input type="date" id="date-picker" value="<?= htmlspecialchars(substr($date, 0, 4) . '-' . substr($date, 4, 2) . '-' . substr($date, 6, 2)) ?>" aria-label="Kalender öffnen" title="Kalender öffnen">
                </div>
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
                <a href="<?= htmlspecialchars($noweUrl) ?>" class="gtfs-trip-row">
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
        const numberInput = document.getElementById('number');
        const dateInput = document.getElementById('date');
        const datePicker = document.getElementById('date-picker');
        const searchButton = document.querySelector('.gtfs-form button[type="submit"]');

        numberInput.addEventListener('input', () => {
            numberInput.value = numberInput.value.replace(/\D/g, '');
        });

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

        datePicker.addEventListener('change', () => {
            const parts = datePicker.value.split('-');
            if (parts.length === 3) {
                dateInput.value = `${parts[2]}.${parts[1]}.${parts[0]}`;
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
    <script src="../shared/footer.js"></script>
</body>
</html>