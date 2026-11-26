# GTFS-Hilfen

- `import_gts.php` baut `transit.sqlite` (Fahrten, Verkehrstage, Betreiber) und `operators.json` aus den GTFS-Feeds der Fahrpläne 2026 und 2027. Nur per Konsole (`php GTFS/import_gts.php`). Das Zeitfenster steht oben im Skript (`WINDOW_FROM`, `WINDOW_TO`).
- `verkehrstage.php?sjyid=...` gibt die Verkehrstage einer Fahrt als JSON zurück (nur Importfenster, aktuell 01.09.2026 bis 30.04.2027).
- `generate_operator_mapping.py` erzeugt `../shared/operator-names.js` aus `agency.txt` (oder dem ganzen ZIP).
  Die `agency_id` entspricht der Zahl der OJP-Betreiberref (`ojp:801` = `801`).
  Neu ausführen, wenn Betreiber dazukommen: `python3 GTFS/generate_operator_mapping.py agency.txt`
