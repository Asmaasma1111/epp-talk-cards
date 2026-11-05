// privacy.html: moved out of the page on 5 Nov 2026 so a Content-Security-Policy with script-src 'self' can apply.
  (function () {
    var en = document.getElementById('en'), ar = document.getElementById('ar'), bEn = document.getElementById('btnEn'), bAr = document.getElementById('btnAr');
    function set(lang) {
      var isAr = lang === 'ar';
      en.hidden = isAr; ar.hidden = !isAr;
      bEn.setAttribute('aria-pressed', String(!isAr)); bAr.setAttribute('aria-pressed', String(isAr));
      document.documentElement.lang = isAr ? 'ar' : 'en';
      try { localStorage.setItem('epp:privacyLang', lang); } catch (e) {}
    }
    bEn.onclick = function () { set('en'); }; bAr.onclick = function () { set('ar'); };
    var saved = null; try { saved = localStorage.getItem('epp:privacyLang'); } catch (e) {}
    set(saved || (/^ar/i.test(navigator.language || '') ? 'ar' : 'en'));
  })();
