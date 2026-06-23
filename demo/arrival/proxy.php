<?php
ini_set('display_errors', 0);
error_reporting(E_ALL);

$logFile = __DIR__ . '/debug_proxy.log';

function logDebug($message) {
    global $logFile;
    $timestamp = date('Y-m-d H:i:s');
    file_put_contents($logFile, "[$timestamp] $message\n", FILE_APPEND);
}

logDebug("--- NEUER REQUEST START ---");
logDebug("Methode: " . $_SERVER['REQUEST_METHOD']);
logDebug("URI: " . $_SERVER['REQUEST_URI']);

$xmlInput = file_get_contents('php://input');
logDebug("Eingehender Body (Länge): " . strlen($xmlInput) . " Bytes");
logDebug("Eingehender Body (Vorschau): " . substr($xmlInput, 0, 200));

$url   = 'https://api.opentransportdata.swiss/ojp20';
$token = '';

logDebug("Ziel-URL: $url");

// CURL Verbose-Output ins Log umleiten
$verboseHandle = fopen('php://temp', 'w+');

$ch = curl_init($url);

$headers = [
    'Authorization: Bearer ' . $token,
    'Content-Type: application/xml',
    'Accept: application/xml',
    'Expect:', // Deaktiviert den 100-continue Header
];

curl_setopt($ch, CURLOPT_POST,          true);
curl_setopt($ch, CURLOPT_HTTPHEADER,    $headers);
curl_setopt($ch, CURLOPT_POSTFIELDS,    $xmlInput);
curl_setopt($ch, CURLOPT_RETURNTRANSFER,true);
curl_setopt($ch, CURLOPT_HEADER,        true);
curl_setopt($ch, CURLOPT_VERBOSE,       true);
curl_setopt($ch, CURLOPT_STDERR,        $verboseHandle);
curl_setopt($ch, CURLOPT_TIMEOUT,       15);

logDebug("Sende Request an SBB...");
$response = curl_exec($ch);
$info     = curl_getinfo($ch);
$httpCode = $info['http_code'];

// Verbose-Log auslesen
rewind($verboseHandle);
$verboseLog = stream_get_contents($verboseHandle);
fclose($verboseHandle);
logDebug("CURL-VERBOSE: " . str_replace("\n", " | ", $verboseLog));

logDebug("SBB Antwort-Code: " . $httpCode);
logDebug("Effektive URL: " . $info['effective_url']);
logDebug("CURL-Zeit gesamt: " . $info['total_time'] . "s");
logDebug("Response-Body-Größe: " . strlen($resBody) . " Bytes");
logDebug("Response-Body (FULL): " . $resBody);

if ($response === false) {
    logDebug("CURL-FEHLER: " . curl_error($ch));
    http_response_code(500);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'Upstream-Fehler']);
} else {
    $headerSize = $info['header_size'];
    $resHeader  = substr($response, 0, $headerSize);
    $resBody    = substr($response, $headerSize);

    logDebug("oeVA-Response-Header: " . str_replace("\n", " | ", $resHeader));
    logDebug("oeVA-Response-Body (Vorschau): " . substr($resBody, 0, 300));

    http_response_code($httpCode);
    header('Content-Type: application/xml');
    echo $resBody;
}

logDebug("--- REQUEST ENDE ---");