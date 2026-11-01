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
    <title>TRAGIC Trip Search</title>
    <style>
        body { font-family: sans-serif; background: #fff; color: #18181b; max-width: 900px; margin: 40px auto; padding: 20px; border-radius: 8px; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1); }
        h1 { font-size: 1.5rem; margin-bottom: 20px; }
        label { display: block; margin-bottom: 6px; font-weight: 600; font-size: 0.9rem; }
        input[type="text"] { width: 100%; padding: 8px 12px; margin-bottom: 16px; border: 1px solid #d4d4d8; border-radius: 4px; box-sizing: border-box; }
        button { background: #2563eb; color: white; border: none; padding: 10px 16px; border-radius: 4px; cursor: pointer; font-weight: 600; }
        button:hover { background: #1d4ed8; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        th, td { text-align: left; padding: 10px; border-bottom: 1px solid #e4e4e7; font-size: 0.9rem; }
        th { background: #f8fafc; }
        .notice { background: #fef2f2; color: #991b1b; padding: 10px; border-radius: 4px; margin-bottom: 16px; }
        code { background: #f4f4f5; padding: 2px 4px; border-radius: 3px; font-size: 0.85rem; }
        a.btn-nowe { background: #16a34a; color: white; padding: 4px 10px; border-radius: 4px; text-decoration: none; font-size: 0.8rem; font-weight: 600; display: inline-block; }
        a.btn-nowe:hover { background: #15803d; }
    </style>
</head>
<body>

    <h1>TRAGIC Trip Finder</h1>

    <form method="GET" action="">
        <div style="display: flex; gap: 16px;">
            <div style="flex: 2;">
                <label for="number">Zugnummer:</label>
                <input type="text" id="number" name="number" value="<?= htmlspecialchars($number) ?>" placeholder="z.B. 450" required>
            </div>
            <div style="flex: 1;">
                <label for="date">Datum (YYYYMMDD):</label>
                <input type="text" id="date" name="date" value="<?= htmlspecialchars($date) ?>" placeholder="z.B. 20261102" required>
            </div>
        </div>
        <button type="submit">Suchen</button>
    </form>

    <?php if ($error): ?>
        <div class="notice"><?= htmlspecialchars($error) ?></div>
    <?php endif; ?>

    <?php if ($number !== '' && empty($results) && !$error): ?>
        <p style="margin-top: 20px; color: #71717a;">Keine Fahrten für Zug <?= htmlspecialchars($number) ?> am <?= htmlspecialchars($date) ?> gefunden.</p>
    <?php endif; ?>

    <?php if (!empty($results)): ?>
        <h2>Gefundene Fahrten (<?= count($results) ?>)</h2>
        <table>
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
    <?php endif; ?>

</body>
</html>