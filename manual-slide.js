let slideIndex = 0;

    // Hilfsfunktion: Prüft die URL und springt zum richtigen Bild
    function checkHashAndJump() {
      const hash = window.location.hash;
      if (hash) {
        const targetSlide = document.querySelector(hash);
        if (targetSlide && targetSlide.classList.contains('slide')) {
          const slides = Array.from(document.getElementsByClassName("slide"));
          slideIndex = slides.indexOf(targetSlide);
        }
      }
      showSlides(slideIndex);
    }

    // 1. Wenn die Seite frisch geladen wird
    window.addEventListener("DOMContentLoaded", checkHashAndJump);

    // 2. Wenn du die URL händisch in der Adresszeile änderst oder die Browser-Navi nutzt
    window.addEventListener("hashchange", checkHashAndJump);

    // Funktion für die Vor-/Zurück-Buttons der Slideshow
    function changeSlide(n) {
      showSlides(slideIndex += n);
      window.addEventListener('resize', rescaledMap);
      window.addEventListener('load', rescaledMap);
    }

    // Funktion für die Direktlinks im Text
    function jumpToSlide(n) {
      showSlides(slideIndex = n);
    }

    // Die Kern-Funktion zur Steuerung der Anzeige
    function showSlides(n) {
      let slides = document.getElementsByClassName("slide");
      
      // Ring-Navigation (wenn am Ende, fange vorne an und umgekehrt)
      if (n >= slides.length) { slideIndex = 0; }
      if (n < 0) { slideIndex = slides.length - 1; }
      
      // Alle Slides unsichtbar machen
      for (let i = 0; i < slides.length; i++) {
        slides[i].style.display = "none";
      }
      
      // Nur die aktuelle anzeigen
      if (slides[slideIndex]) {
        slides[slideIndex].style.display = "block";
      }
      
      // Am Ende der Umschalt-Logik in manual-slide.js einfügen:
      if (typeof rescaledMap === 'function') {
          // Kurzer Timeout, damit der Browser das Element gerendert hat
          setTimeout(rescaledMap, 50); 
      }
    }