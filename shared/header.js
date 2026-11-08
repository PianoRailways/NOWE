let headerObserver = null;
let zoomBlocked = false;

export function initHeaderHeight() {
    const header = document.getElementById('app-header');
    if (!header) return;

    const update = () => {
        document.documentElement.style.setProperty('--header-h', `${header.offsetHeight}px`);
    };
    update();

    if (headerObserver) return;
    if ('ResizeObserver' in window) {
        headerObserver = new ResizeObserver(update);
        headerObserver.observe(header);
    } else {
        window.addEventListener('resize', update);
        window.addEventListener('orientationchange', update);
    }
}

export function blockZoom() {
    if (zoomBlocked) return;
    zoomBlocked = true;

    document.addEventListener('gesturestart', (event) => event.preventDefault());
    document.addEventListener('gesturechange', (event) => event.preventDefault());
    document.addEventListener('wheel', (event) => {
        if (event.ctrlKey) event.preventDefault();
    }, { passive: false });
    document.addEventListener('keydown', (event) => {
        if ((event.ctrlKey || event.metaKey) && ['+', '-', '=', '0'].includes(event.key)) {
            event.preventDefault();
        }
    });
}
