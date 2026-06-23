<?php
header("Content-Type: application/json; charset=utf-8");
error_reporting(0);
ini_set('display_errors', 0);

// API KEY HIER EINTRAGEN
$apiKey = '';

$train = isset($_GET['trainNumber']) ? trim($_GET['trainNumber']) : '';
$date = isset($_GET['operationDate']) ? trim($_GET['operationDate']) : '';
$evu = isset($_GET['evu']) ? trim($_GET['evu']) : '';

// Validierung
if (empty($apiKey)) {
    http_response_code(500);
    die(json_encode([
        'error' => [
            'message' => 'API-Schlüssel nicht konfiguriert. Bitte API_KEY in proxy.php eintragen.'
        ]
    ]));
}

if (empty($train) || empty($date)) {
    http_response_code(400);
    die(json_encode([
        'error' => [
            'message' => 'Parameter trainNumber und operationDate sind erforderlich.'
        ]
    ]));
}

// URL zusammenstellen
$url = "https://api.opentransportdata.swiss/formation/v2/formations_full?" . 
       "trainNumber=" . urlencode($train) . 
       "&operationDate=" . urlencode($date);

if (!empty($evu)) {
    $url .= "&evu=" . urlencode($evu);
}

// CURL Request
$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, $url);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_TIMEOUT, 30);
curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    "Authorization: Bearer " . $apiKey,
    "Accept: application/json",
    "User-Agent: Formation-Viewer/1.0"
]);

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curlError = curl_error($ch);
curl_close($ch);

// Error Handling
if ($curlError) {
    http_response_code(500);
    die(json_encode([
        'error' => [
            'message' => 'Netzwerkfehler: ' . $curlError
        ]
    ]));
}

if ($httpCode !== 200) {
    http_response_code($httpCode);
    
    // Versuche die Response zu parsen
    $data = @json_decode($response, true);
    if ($data) {
        die(json_encode($data));
    }
    
    // Fallback
    die(json_encode([
        'error' => [
            'message' => 'API-Fehler (HTTP ' . $httpCode . '): ' . substr($response, 0, 200)
        ]
    ]));
}

// Validiere JSON Response
if (!is_null(json_decode($response))) {
    echo $response;
} else {
    http_response_code(502);
    die(json_encode([
        'error' => [
            'message' => 'Ungültige JSON-Response von API'
        ]
    ]));
}
?>