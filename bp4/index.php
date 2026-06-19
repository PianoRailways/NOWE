<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Betriebsstellen / Stationen</title>
    <style>
        :root {
            --bg-color: #0d1117;
            --panel-bg: #161b22;
            --border-color: #30363d;
            --text-main: #c9d1d9;
            --text-muted: #8b949e;
            --accent-blue: #58a6ff;
            --accent-green: #3fb950;
            --accent-orange: #f0883e;
            --error-red: #f85149;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
            background-color: var(--bg-color);
            color: var(--text-main);
            margin: 0;
            padding: 2rem;
            display: flex;
            justify-content: center;
        }

        .container {
            width: 100%;
            max-width: 1200px;
        }

        h1 {
            font-size: 1.5rem;
            font-weight: 500;
            margin-bottom: 1.5rem;
            color: var(--text-main);
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }

        h1::before {
            content: "";
            display: inline-block;
            width: 4px;
            height: 1.5rem;
            background-color: var(--accent-blue);
            border-radius: 2px;
        }

        .search-box {
            width: 100%;
            padding: 0.8rem 1rem;
            background-color: var(--panel-bg);
            border: 1px solid var(--border-color);
            border-radius: 6px;
            color: var(--text-main);
            font-size: 1rem;
            box-sizing: border-box;
            margin-bottom: 1.5rem;
            outline: none;
            transition: border-color 0.2s;
        }

        .search-box:focus {
            border-color: var(--accent-blue);
        }

        .station-table {
            width: 100%;
            border-collapse: collapse;
            background-color: var(--panel-bg);
            border: 1px solid var(--border-color);
            border-radius: 6px;
            overflow: hidden;
        }

        .station-table th, .station-table td {
            padding: 10px 15px;
            text-align: left;
            border-bottom: 1px solid var(--border-color);
        }

        .station-table th {
            background-color: rgba(255, 255, 255, 0.02);
            color: var(--text-muted);
            font-size: 0.85rem;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            font-weight: 600;
        }

        .station-table tr:last-child td {
            border-bottom: none;
        }

        .station-table tr:hover td {
            background-color: rgba(255, 255, 255, 0.01);
        }

        .id-cell {
            font-family: ui-monospace, SFMono-Regular, SF Pro Text, Menlo, Monaco, Consolas, monospace;
            color: var(--accent-orange);
            font-weight: 500;
            white-space: nowrap;
            width: 10%;
        }

        .name-cell {
            font-weight: 600;
            color: #ffffff;
            width: 25%;
        }

        .code-cell {
            width: 10%;
        }

        .code-badge {
            display: inline-block;
            font-family: ui-monospace, SFMono-Regular, monospace;
            background-color: rgba(88, 166, 255, 0.15);
            color: var(--accent-blue);
            padding: 2px 6px;
            border-radius: 4px;
            font-size: 0.85rem;
            font-weight: bold;
            border: 1px solid rgba(88, 166, 255, 0.2);
        }

        .lang-cell {
            width: 55%;
        }

        .tags-container {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
        }

        .lang-tag {
            background-color: rgba(255, 255, 255, 0.05);
            border: 1px solid var(--border-color);
            padding: 2px 8px;
            border-radius: 4px;
            font-size: 0.85rem;
            color: var(--text-muted);
            transition: all 0.2s;
        }

        .lang-tag:hover {
            color: var(--text-main);
            border-color: rgba(255, 255, 255, 0.2);
        }

        .status-message {
            text-align: center;
            padding: 2rem !important;
            color: var(--text-muted);
            font-style: italic;
        }

        .error-message {
            color: var(--error-red) !important;
            font-weight: 500;
        }
    </style>
</head>
<body>

<div class="container">
    <h1>Stationen & Betriebsstellen</h1>
    
    <input type="text" id="searchInput" class="search-box" placeholder="Nach ID, Name, Kürzel oder Übersetzung suchen..." disabled>

    <table class="station-table">
        <thead>
            <tr>
                <th>ID</th>
                <th>Hauptbezeichnung</th>
                <th>Kürzel</th>
                <th>Synonyme / International</th>
            </tr>
        </thead>
        <tbody id="stationBody">
            <tr>
                <td colspan="4" class="status-message" id="statusCell">Lade Stationsdaten vom Server...</td>
            </tr>
        </tbody>
    </table>
</div>

<script>
    let stations = [];
    const tbody = document.getElementById('stationBody');
    const statusCell = document.getElementById('statusCell');
    const searchInput = document.getElementById('searchInput');

    // Parser für das spezifische Dateiformat mit $<zahl>$
    function parseData(text) {
        return text.split('\n').map(line => {
            const trimmedLine = line.trim();
            if (!trimmedLine) return null;

            const idMatch = trimmedLine.match(/^(\d+)\s+/);
            if (!idMatch) return null;
            const id = idMatch[1];

            const rest = trimmedLine.substring(id.length).trim();
            const parts = rest.split(/\$<\d+>\$/).map(p => p.trim()).filter(p => p.length > 0);

            const name = parts[0] || '';
            const code = parts[1] || '';
            const translations = parts.slice(2);

            return { id, name, code, translations };
        }).filter(item => item !== null);
    }

    // Funktion zum Rendern der Tabelle
    function renderTable(data) {
        tbody.innerHTML = '';
        
        if (data.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" class="status-message">Keine Stationen gefunden</td></tr>`;
            return;
        }

        data.forEach(station => {
            const tr = document.createElement('tr');

            const tdId = document.createElement('td');
            tdId.className = 'id-cell';
            tdId.textContent = station.id;
            tr.appendChild(tdId);

            const tdName = document.createElement('td');
            tdName.className = 'name-cell';
            tdName.textContent = station.name;
            tr.appendChild(tdName);

            const tdCode = document.createElement('td');
            tdCode.className = 'code-cell';
            if (station.code) {
                const span = document.createElement('span');
                span.className = 'code-badge';
                span.textContent = station.code;
                tdCode.appendChild(span);
            }
            tr.appendChild(tdCode);

            const tdLang = document.createElement('td');
            tdLang.className = 'lang-cell';
            const tagsContainer = document.createElement('div');
            tagsContainer.className = 'tags-container';
            
            station.translations.forEach(trans => {
                const span = document.createElement('span');
                span.className = 'lang-tag';
                span.textContent = trans;
                tagsContainer.appendChild(span);
            });
            
            tdLang.appendChild(tagsContainer);
            tr.appendChild(tdLang);

            tbody.appendChild(tr);
        });
    }

    // Daten asynchron vom Server laden
    async function loadStations() {
        try {
            // Geht davon aus, dass BAHNHOF-4.txt im selben Verzeichnis liegt
            const response = await fetch('BAHNHOF-4.txt');
            
            if (!response.ok) {
                throw new Error(`HTTP-Fehler! Status: ${response.status}`);
            }
            
            const textData = await response.text();
            stations = parseData(textData);
            
            if (stations.length === 0) {
                statusCell.textContent = "Die Datei enthielt keine gültigen Stationsdaten.";
                return;
            }

            // Suche aktivieren und erste Daten anzeigen
            searchInput.disabled = false;
            renderTable(stations);
            
        } catch (error) {
            console.error('Fehler beim Laden der Datei:', error);
            statusCell.textContent = `Fehler beim Laden der BAHNHOF-4.txt: ${error.message}`;
            statusCell.classList.add('error-message');
        }
    }

    // Live-Suche über alle Felder
    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().trim();
        
        const filtered = stations.filter(station => {
            return station.id.toLowerCase().includes(query) ||
                   station.name.toLowerCase().includes(query) ||
                   station.code.toLowerCase().includes(query) ||
                   station.translations.some(t => t.toLowerCase().includes(query));
        });
        
        renderTable(filtered);
    });

    // Start des Ladevorgangs beim Aufruf der Seite
    loadStations();
</script>

</body>
</html>