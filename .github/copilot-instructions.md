# Arbeitsanweisungen

## Tech-Stack und Einschränkungen

- Arbeite im bestehenden JavaScript-, HTML- und CSS-Stack; verwende vorhandene APIs und Hilfsfunktionen.
- Ändere bei Formation-Aufgaben nur die ausdrücklich genannten Dateien; `proxy.php` bleibt unangetastet.
- Führe PHP oder Node nicht aus und prüfe sie nicht, sofern der Auftrag nichts anderes verlangt.
- Verwende keine neue Abhängigkeit, wenn die vorhandenen Browser-APIs ausreichen.
- Berücksichtige die bestehende Struktur mit `trip/`, `formation-new/` und den API-Clients.

## Code-Konventionen

- Behalte die vorhandene Formatierung, Benennung und Modulstruktur bei.
- Verwende sprechende Konstanten und Hilfsfunktionen statt duplizierter Logik.
- Nutze `window.formationData` als zentrale Formation-Datenbasis und bewahre bestehende Datenflüsse.
- Escape HTML, bevor externe/API-Werte in `innerHTML` gelangen.
- Behalte bestehende Fallbacks und Fehlermeldungen bei; erweitere sie gezielt statt sie still zu ersetzen.
- Verwende bestehende Betreiber-Codes und Formation-Links konsistent, z. B. `SBBP`, `BLSP`, `SOB`, `TPF`, `RhB`.
- Verwende für Änderungen kleine Diffs; schreibe keine Komplett-Rewrites.

## Arbeitsweise

- Lies vor der Änderung den betroffenen Code und suche nach bestehender vergleichbarer Logik.
- Setze nur die verlangte Änderung um und ändere kein unabhängiges Verhalten.
- Erhalte bestehende UX und Event-Delegation; registriere Listener nicht wiederholt.
- Bei Formation- und Trip-Links übernimm Zugnummer, Betreiber und Datum aus den vorhandenen Daten.
- Verlinke Formationen nur für unterstützte Betreiber; andere Betreiber bleiben unverlinkt.
- Committe nach jedem ausdrücklich verlangten Schritt mit einer kurzen deutschen Nachricht im Format `formation: <was>` beziehungsweise passend zum Bereich.
- Prüfe Diffs und Syntax statisch; führe keine PHP-/Node-Prüfung aus, wenn dies ausgeschlossen wurde.
- Räume keine fremden oder nicht auftragsbezogenen Änderungen auf und verwende keine destruktiven Git-Befehle.

## Kommunikation

- Kommuniziere auf Deutsch, knapp und sachlich.
- Wenn ausdrücklich „keine Erklärungen oder Rückfragen“ verlangt wird, arbeite direkt und antworte nur mit dem verlangten Ergebnis.
- Nenne am Ende nur die verlangten Commit- oder Log-Zeilen.
- Verweise auf Dateien mit Markdown-Links und absoluten Pfaden, wenn du Dateien erwähnst.

## Häufige Fehler, die du vermeiden sollst

- Verwechsle Parser-Indizes mit Indizes der gefilterten oder gedrehten Wagenliste.
- Verwende beim Wagen-Popup das registrierte Fahrzeug aus `wagonRegistry`, nicht einen ungeprüften Formation-Index.
- Bestimme Übergänge anhand der tatsächlichen Nachbarn in der Anzeige; beachte `FLIP_DIRECTION`.
- Ermittle Formation-Fahrzeuge passend zum Streckensegment und gib die Formation des ersten gefundenen Fahrzeugs zurück.
- Behandle Fehlerwerte robust, weil `error` sowohl String als auch Objekt mit `message` sein kann.
- Staple keine `visibilitychange`-, `resize-` oder `pagehide`-Listener bei wiederholten Aktualisierungen auf.
- Setze Formation-Links relativ auf `./formation-new/?train=...&evu=...&date=...` und lasse nicht unterstützte Betreiber ohne Link.
- Setze `overflow` und `overscroll-behavior` nie gleichzeitig auf `html` und `body`; diese Regeln gehören nur auf `html`.
- Behandle alle Apps als iOS-Webclip im Standalone-Modus: binde `shared/HEAD-SNIPPET.html` sinngemäss und `shared/webclip.css` ein, versehe feste Header mit Safe-Area-Inset und Formularfelder mit mindestens 16px Schrift.
- Führe Node.js und PHP lokal nicht aus, chatte nicht unnötig und committe mehrstufige Änderungen nach jedem Schritt einzeln.
