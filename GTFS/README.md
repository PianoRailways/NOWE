# GTFS-Hilfen

- `import_gts.php` baut `transit.sqlite` (Fahrten, Verkehrstage, Betreiber) und `operators.json` aus dem GTFS-Feed.
- `verkehrstage.php?sjyid=...` gibt die Verkehrstage einer Fahrt als JSON zurück (nur Importfenster).
- `generate_operator_mapping.py` erzeugt `../shared/operator-names.js` aus `agency.txt` (oder dem ganzen ZIP).
  Die `agency_id` entspricht der Zahl der OJP-Betreiberref (`ojp:801` = `801`).
  Neu ausführen, wenn Betreiber dazukommen: `python3 GTFS/generate_operator_mapping.py agency.txt`
