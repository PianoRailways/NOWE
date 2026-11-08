const footerScript = document.currentScript;
const siteRoot = footerScript ? new URL('../', footerScript.src) : new URL('./', window.location.href);

const footer = document.createElement('footer');
footer.className = 'sitefooter';
footer.innerHTML = `
    <a href="${new URL('manual/', siteRoot).href}">Manual</a><br>
    <a href="${new URL('GTFS/', siteRoot).href}">Fahrtensuche</a>
`;

document.body.appendChild(footer);
