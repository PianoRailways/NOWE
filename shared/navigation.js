(function () {
    function setMenuOpen(isOpen) {
        const sidebar = document.getElementById('menu-sidebar');
        const overlay = document.getElementById('menu-overlay');
        const toggle = document.getElementById('btn-menu-toggle');
        if (!sidebar || !overlay || !toggle) return;

        sidebar.classList.toggle('active', isOpen);
        overlay.classList.toggle('active', isOpen);
        toggle.setAttribute('aria-expanded', String(isOpen));
        document.documentElement.style.overflow = isOpen ? 'hidden' : '';
    }

    document.addEventListener('DOMContentLoaded', () => {
        const toggle = document.getElementById('btn-menu-toggle');
        const close = document.getElementById('btn-menu-close');
        const overlay = document.getElementById('menu-overlay');
        const links = document.querySelectorAll('.menu-link');
        if (!toggle) return;

        toggle.addEventListener('click', () => {
            const sidebar = document.getElementById('menu-sidebar');
            setMenuOpen(!sidebar?.classList.contains('active'));
        });
        close?.addEventListener('click', () => setMenuOpen(false));
        overlay?.addEventListener('click', () => setMenuOpen(false));
        links.forEach((link) => link.addEventListener('click', () => setMenuOpen(false)));
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') setMenuOpen(false);
        });
    });
})();
