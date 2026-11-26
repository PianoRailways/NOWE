# GTFS-Hilfen

- `import_gts.php` baut `transit.sqlite` (Fahrten, Verkehrstage, Betreiber) und `operators.json` aus den GTFS-Feeds der Fahrpläne 2026 und 2027. Nur per Konsole (`php GTFS/import_gts.php`). Das Zeitfenster steht oben im Skript (`WINDOW_FROM`, `WINDOW_TO`).
- `verkehrstage.php?sjyid=...` gibt die Verkehrstage einer Fahrt als JSON zurück. Varianten werden nur innerhalb derselben Zugnummer, desselben Betreibers, derselben GTFS-Linie und Richtung verglichen; eine SJYID bleibt auch bei abweichenden Routendaten zwischen Fahrplanfeeds zusammengeführt. Das Soll ist die Variante mit den meisten Tagen; unterschiedliche Fahrplan-Signaturen derselben SJYID werden pro Tag verglichen. Abweichungen: `stops` (andere Halte, rot), `times` (andere Zeiten, orange), `tracks` (anderes Gleis, hellgelb), `variant` (Unterschied unbekannt, wenn keine stop_times importiert wurden) (nur Importfenster, aktuell 01.09.2026 bis 30.04.2027).
- Die Websuche in `index.php` kann neben der datumsgebundenen Fahrtnummernsuche auch nach vollständigen oder partiellen SJYIDs suchen und zeigt die Betriebstage direkt aus `transit.sqlite` an.
- `generate_operator_mapping.py` erzeugt `../shared/operator-names.js` aus `agency.txt` (oder dem ganzen ZIP).
  Die `agency_id` entspricht der Zahl der OJP-Betreiberref (`ojp:801` = `801`).
  Neu ausführen, wenn Betreiber dazukommen: `python3 GTFS/generate_operator_mapping.py agency.txt`

`COMPARE_STOP_TIMES` in `import_gts.php` steuert, ob `stop_times.txt` gelesen wird (verlängert den Import). Der Halteabdruck trennt UIC-Gleise (`UIC:0:Gleis`) und SLOID-Gleissuffixe von der Haltestelle. Komprimierte Detaildaten zu Halten, Zeiten und Gleisen werden in `sig_detail` gespeichert und für die Abweichungsanzeige verwendet. Nach Änderungen an der Abdrucklogik oder Detailaufzeichnung muss die Datenbank neu aufgebaut werden.
