<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <title>STS: Bildfahrplan Manu-Live</title>
</head>
<style>
 body {
    font-family: Raleway, Helvetica, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif, sans-serif;
    background: #eb0000;
    margin: 0;
    
    /* Fixiert den Viewport starr auf die Bildschirmgröße */
    height: 100vh;
    overflow: hidden;
    box-sizing: border-box;
    padding: 4vh;
    
    /* Zentriert die Liste als kompakten Block auf allen Geräten */
    display: flex;
    align-items: center; /* Vertikal zentriert */
    justify-content: flex-start; /* Linksbündig, aber vertikal zentriert */
    
}

ul {
    color: yellow;
    text-align: left;
    margin: 0;
    padding: 0;
    list-style-position: outside; /* Dots wandern nach links außerhalb des Textes */
    padding-left: 1.2em;          /* Kontrolliert den Abstand zum linken Rand */
    
    /* Line-Height reduziert, damit 5 Zeilen vertikal locker Platz haben */
    line-height: 2; 
    
    /* DIE MATHEMATISCHE BERECHNUNG:
       - 4.2vw sorgt dafür, dass die längste Zeile (ca. 36 Zeichen) exakt in die 
         Breite eines Smartphones passt, ohne umzubrechen.
       - 7.5vh ist der Deckel für große Monitore, damit der Text dort nicht 
         nach oben und unten aus dem Bildschirm quillt.
    */
    font-size: min(4.2vw, 10.5vh);
}

/* Verhindert hartnäckig jeden automatischen Zeilenumbruch */
li {
    white-space: nowrap;
    padding-left: 0.8em;
}

</style>
<body> 
<div>
    <ul>
        <li>Bitte konsultieren Sie den Online-Fahrplan</li>
        <li>Merci de vous référer à l'horaire en ligne</li>
        <li>Si prega di consultare l'orario in internet</li>
        <li>Please refer to online schedule</li>
        <li>Chunnsch STS?</li>
    </ul>
</div>
</body>
</html>