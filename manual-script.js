function updateClock() {
    const el = document.getElementById('live-clock');
    if (!el) return;
    const now = new Date();
    el.textContent = now.getHours().toString().padStart(2, '0') + ':'
                   + now.getMinutes().toString().padStart(2, '0') + ':'
                   + now.getSeconds().toString().padStart(2, '0');
}
updateClock();
setInterval(updateClock, 1000);

const tooltip = document.getElementById('map-tooltip');

document.querySelectorAll('area[data-tooltip]').forEach(area => {
    let touchMoved = false;

    // ── Mouse (Desktop) ──────────────────────────────────────────
    area.addEventListener('mouseenter', () => {
        tooltip.innerHTML = area.dataset.tooltip; // innerHTML erlaubt <br>
        tooltip.classList.add('visible');
    });

    area.addEventListener('mousemove', e => {
        tooltip.style.left = (e.clientX + 14) + 'px';
        tooltip.style.top  = (e.clientY - 28) + 'px';
    });

    area.addEventListener('mouseleave', () => {
        tooltip.classList.remove('visible');
    });

    // ── Touch (Mobil) ──────────────────────────────────────────
    area.addEventListener('touchstart', e => {
        touchMoved = false;
        tooltip.innerHTML = area.dataset.tooltip;
        tooltip.classList.add('visible');

        const touch = e.touches[0];
        // Positioniert den Tooltip mittig über dem Finger, um ihn nicht zu verdecken
        const leftPos = touch.clientX - (tooltip.offsetWidth / 2);
        const topPos = touch.clientY - tooltip.offsetHeight - 20;

        // Verhindert das Rausrutschen aus dem Bildschirmrand
        tooltip.style.left = Math.max(10, Math.min(window.innerWidth - tooltip.offsetWidth - 10, leftPos)) + 'px';
        tooltip.style.top  = Math.max(10, topPos) + 'px';
    });

    area.addEventListener('touchmove', () => {
        touchMoved = true;
        tooltip.classList.remove('visible');
    });

    area.addEventListener('touchend', e => {
        if (!touchMoved) {
            e.preventDefault(); // Verhindert ungewollte Klicks beim Tippen
        }
        setTimeout(() => tooltip.classList.remove('visible'), 2000);
    });
});

function rescaledMap() {
    const images = document.querySelectorAll('img[usemap]');
    images.forEach(img => {
        // Falls das Bild noch nicht geladen ist, warten
        if (!img.complete || img.naturalWidth === 0) {
            img.addEventListener('load', rescaledMap, { once: true });
            return;
        }

        // NEU: Wenn das Bild unsichtbar ist (Breite = 0), überspringen wir die Berechnung,
        // bis es durch die Slideshow eingeblendet wird.
        if (img.clientWidth === 0) {
            return;
        }

        const mapName = img.getAttribute('usemap').replace('#', '');
        const map = document.querySelector(`map[name="${mapName}"]`);
        if (!map) return;

        const w = img.clientWidth / img.naturalWidth;
        const h = img.clientHeight / img.naturalHeight;

        map.querySelectorAll('area').forEach(area => {
            if (!area.dataset.coords) area.dataset.coords = area.coords;
            const newCoords = area.dataset.coords.split(',').map((c, i) => 
                Math.round(c * (i % 2 === 0 ? w : h))
            );
            area.coords = newCoords.join(',');
        });
    });
}

window.addEventListener('resize', rescaledMap);
window.addEventListener('load', rescaledMap);