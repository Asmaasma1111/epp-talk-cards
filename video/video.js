// index.html: moved out of the page on 5 Nov 2026 so a Content-Security-Policy with script-src 'self' can apply.
  (function () {
    var v = document.getElementById('v'), s = document.getElementById('src'), bW = document.getElementById('bWide'), bT = document.getElementById('bTall');
    function pick(wide) {
      var t = v.currentTime, playing = !v.paused;
      s.src = wide ? 'speak-cards-wide.mp4' : 'speak-cards.mp4'; v.poster = wide ? 'poster-wide.jpg' : 'poster.jpg';
      bW.setAttribute('aria-pressed', String(wide)); bT.setAttribute('aria-pressed', String(!wide));
      v.load(); if (t) v.currentTime = t; if (playing) v.play().catch(function () {});
    }
    bW.onclick = function () { pick(true); }; bT.onclick = function () { pick(false); };
    if (window.matchMedia && matchMedia('(orientation: portrait)').matches && innerWidth < 700) pick(false);
  })();
