<?php
declare(strict_types=1);

$allowedUrl = 'https://tragic.stellwerksim.ch/didok/custom.json';
$url = $_GET['url'] ?? '';

if ($url !== $allowedUrl) {
    http_response_code(400);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => 'Nicht erlaubte DiDok-Quelle']);
    exit;
}

$ch = curl_init($allowedUrl);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => false,
    CURLOPT_TIMEOUT => 5,
    CURLOPT_HTTPHEADER => ['Accept: application/json'],
]);
$response = curl_exec($ch);
$httpCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curlError = curl_error($ch);
curl_close($ch);

if ($response === false || $httpCode < 200 || $httpCode >= 300) {
    http_response_code(502);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => $curlError ?: 'DiDok-Quelle nicht erreichbar']);
    exit;
}

$data = json_decode($response, true);
if (!is_array($data) || array_is_list($data)) {
    http_response_code(502);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => 'Ungültiges DiDok-Format']);
    exit;
}

header('Content-Type: application/json; charset=utf-8');
echo json_encode($data);
