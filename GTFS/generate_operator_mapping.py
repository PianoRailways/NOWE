#!/usr/bin/env python3
"""Erzeugt shared/operator-names.js aus der agency.txt des GTFS-Feeds.

Aufruf:
    python3 GTFS/generate_operator_mapping.py pfad/zu/agency.txt
    python3 GTFS/generate_operator_mapping.py pfad/zu/gtfs_fp2026_xxx.zip

Die agency_id entspricht der Zahl in der OJP-Betreiberref (ojp:801 -> agency_id 801).
Keine Abhängigkeiten, nur Python 3.
"""
import csv
import io
import json
import sys
import zipfile
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / 'shared' / 'operator-names.js'

# Zusatz im Namen, der nur die Informationsvariante kennzeichnet
SUFFIXES_TO_STRIP = (' INFO+',)


def read_agency(path: Path) -> str:
    if path.suffix.lower() == '.zip':
        with zipfile.ZipFile(path) as z:
            return z.read('agency.txt').decode('utf-8-sig')
    return path.read_text(encoding='utf-8-sig')


def clean_name(name: str) -> str:
    name = name.strip()
    for suffix in SUFFIXES_TO_STRIP:
        if name.endswith(suffix):
            name = name[: -len(suffix)].rstrip()
    return name


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 1
    rows = csv.DictReader(io.StringIO(read_agency(Path(sys.argv[1]))))
    names = {}
    for row in rows:
        agency_id = (row.get('agency_id') or '').strip()
        agency_name = clean_name(row.get('agency_name') or '')
        if not agency_id or not agency_name:
            continue
        if agency_id in names and names[agency_id] != agency_name:
            print(f'Warnung: agency_id {agency_id} doppelt ({names[agency_id]!r} / {agency_name!r}), erster Wert bleibt', file=sys.stderr)
            continue
        names[agency_id] = agency_name

    ordered = dict(sorted(names.items(), key=lambda kv: (not kv[0].isdigit(), int(kv[0]) if kv[0].isdigit() else 0, kv[0])))
    lines = [
        '// Automatisch erzeugt mit GTFS/generate_operator_mapping.py aus agency.txt. Nicht von Hand ändern.',
        '// Schlüssel: agency_id (entspricht der Zahl in ojp:<id>), Wert: Betreibername.',
        'export const OPERATOR_NAMES = Object.freeze({',
    ]
    items = list(ordered.items())
    for i, (k, v) in enumerate(items):
        lines.append(f'    {json.dumps(k)}: {json.dumps(v, ensure_ascii=False)}{"," if i < len(items) - 1 else ""}')
    lines.append('});')
    OUT.write_text('\n'.join(lines) + '\n', encoding='utf-8')
    print(f'{len(ordered)} Betreiber nach {OUT} geschrieben')
    return 0


if __name__ == '__main__':
    sys.exit(main())
