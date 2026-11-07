/*
 * Váltópont – GA4-mérés hozzájárulás-kezeléssel (Google Consent Mode, Basic).
 *
 * Működés röviden:
 * - Ha nincs érvényes Measurement ID VAGY nincs megadva a tájékoztató címe
 *   (analytics-config.js), semmi nem történik: nincs hozzájárulási ablak, nincs tárolás,
 *   nincs kérés a Google felé.
 * - Ha aktív, és a látogató még nem döntött: a képernyő közepén megjelenik a hozzájárulási
 *   ablak (párbeszédablak). Mögötte az oldal elhomályosodik, nem görgethető és nem érhető el,
 *   amíg a látogató nem választ; első megjelenéskor csak a két gombbal zárható.
 *   Mindkét választás után az oldal azonnal használható (az elutasítás nem zár el a tartalomtól).
 *   Döntés előtt a gtag.js NEM töltődik be (Basic Consent Mode).
 * - Elfogadom → consent default (minden denied) → update (analytics_storage: granted)
 *   → gtag.js betöltése. A GA4 konfiguráció egyetlen page_view-t küld, és a Skool
 *   affiliate linkekre kattintás "affiliate_click" eseményt küld.
 *   Az ad_storage, ad_user_data és ad_personalization mindig denied marad.
 * - Elutasítás → a GA4 nem töltődik be. Ha korábban betöltött: letiltjuk,
 *   megkíséreljük törölni a GA-sütiket, és újratöltjük az oldalt, hogy a gtag.js
 *   ne maradjon a memóriában. A Google-hoz korábban már elküldött adatokat ez nem törli.
 * - A döntés a lábléc „Süti-beállítások” gombjával bármikor módosítható: ugyanez az ablak nyílik meg,
 *   és innen Esc-re is bezárható, a döntés változása nélkül.
 * - ?valtopont_test=1 SOHA nem ad hozzájárulást; csak a GA4 DebugView-jelölést
 *   kapcsolja be, ha a látogató már maga elfogadta a mérést.
 * - A mérés soha nem akadályozza a kattintást (nincs preventDefault, minden hiba elnyelve).
 */
(function () {
  var config = window.VALTOPONT_ANALYTICS_CONFIG || {};
  var id = String(config.ga4MeasurementId || '').trim();
  var validId = /^G-[A-Z0-9]{4,}$/.test(id);
  var privacyUrl = String(config.privacyUrl || '').trim();
  var validPrivacyUrl = /^[A-Za-z0-9_\-./]+\.html$/.test(privacyUrl);

  var CONSENT_KEY = 'valtopont_analytics_consent';
  var CONSENT_VERSION = 1;                 // ha a tájékoztató lényegesen változik, növeld → újra kérdez
  var CONSENT_MAX_AGE_DAYS = 365;          // ennyi idő után újra rákérdezünk
  var UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'];
  var AFFILIATE_HOST = 'www.skool.com';
  var AFFILIATE_PATH = '/szabaduszo-affiliate/';

  var params = new URLSearchParams(window.location.search);
  var debugMode = params.get('valtopont_test') === '1';
  var loaded = false;
  var disabled = false;
  var memoryChoice = null;                 // ha a localStorage nem elérhető, csak erre az oldalbetöltésre emlékszünk
  var banner = null;                       // a hozzájárulási ablak (átfedő réteg + párbeszédablak)
  var dialogBox = null;
  var dialogMode = null;                   // 'elso': csak gombbal zárható; 'beallitas': Esc-re is
  var prevFocus = null;
  var inertEls = [];
  var lastClick = null;

  /* ---------- hozzájárulás tárolása ---------- */

  function readChoice() {
    var raw = null;
    try { raw = window.localStorage.getItem(CONSENT_KEY); } catch (e) { return memoryChoice; }
    if (!raw) return memoryChoice;
    try {
      var data = JSON.parse(raw);
      var ageDays = (Date.now() - data.ts) / 86400000;
      if (data.v !== CONSENT_VERSION || !(ageDays >= 0 && ageDays < CONSENT_MAX_AGE_DAYS)) return null;
      return data.choice === 'granted' || data.choice === 'denied' ? data.choice : null;
    } catch (e) {
      return null;                         // régi vagy sérült formátum → újra kérdezünk
    }
  }

  function saveChoice(choice) {
    memoryChoice = choice;
    try {
      window.localStorage.setItem(CONSENT_KEY, JSON.stringify({ v: CONSENT_VERSION, choice: choice, ts: Date.now() }));
    } catch (e) { /* tárolás tiltva: a döntés csak erre az oldalbetöltésre érvényes */ }
  }

  /* ---------- UTM (csak memóriában, nincs tárolás) ---------- */

  function clean(value) {
    if (!value) return '';
    value = String(value).slice(0, 100);
    return /^[A-Za-z0-9_\-.]+$/.test(value) ? value : '';
  }

  var utm = {};
  UTM_KEYS.forEach(function (k) {
    var v = clean(params.get(k));
    if (v) utm[k] = v;
  });

  // "A", "a_ujrakezdes", "B-keszseg" → "A" / "B"; minden más → az utm_content maga.
  function adVariant() {
    var c = utm.utm_content || '';
    var m = c.match(/^([A-Za-z])(?:[_-]|$)/);
    return m ? m[1].toUpperCase() : c;
  }

  // Az oldal URL-je csak a négy engedélyezett utm_* paraméterrel (fbclid, gclid, valtopont_test,
  // utm_term, hash stb. nélkül). A UTM a kampány-hozzárendeléshez kell, minden más elhagyható.
  function cleanPageLocation() {
    var q = UTM_KEYS.filter(function (k) { return utm[k]; })
      .map(function (k) { return k + '=' + encodeURIComponent(utm[k]); }).join('&');
    return window.location.origin + window.location.pathname + (q ? '?' + q : '');
  }

  // Hivatkozó oldal: külső oldalnál csak a domain (pl. https://l.facebook.com/),
  // saját oldalnál a domain + útvonal; lekérdezési paraméter és hash soha.
  function cleanReferrer() {
    var ref = document.referrer;
    if (!ref) return '';
    try {
      var u = new URL(ref);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
      return u.origin === window.location.origin ? u.origin + u.pathname : u.origin + '/';
    } catch (e) {
      return '';
    }
  }

  // A böngésző címsorából is eltávolítjuk a nem engedélyezett paramétereket, mielőtt a gtag.js
  // betöltődik, így az se tudja kiolvasni őket a document.location-ből.
  function cleanAddressBar() {
    try {
      var cleanUrl = cleanPageLocation() + window.location.hash;
      if (cleanUrl !== window.location.href) window.history.replaceState(window.history.state, '', cleanUrl);
    } catch (e) { /* nem kritikus */ }
  }

  /* ---------- GA4 betöltése / letiltása ---------- */

  function loadGa() {
    if (loaded || readChoice() !== 'granted') return;
    loaded = true;
    disabled = false;
    window['ga-disable-' + id] = false;

    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    // Google Consent Mode: előbb az alapállapot (minden denied), majd a látogató döntése.
    window.gtag('consent', 'default', {
      analytics_storage: 'denied',
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied'
    });
    window.gtag('consent', 'update', { analytics_storage: 'granted' });
    cleanAddressBar();
    var pageData = { page_location: cleanPageLocation(), page_referrer: cleanReferrer() };
    window.gtag('set', pageData);          // minden további eseményre (kattintás is) érvényes
    window.gtag('js', new Date());
    var gaConfig = {
      page_location: pageData.page_location,
      page_referrer: pageData.page_referrer,
      allow_google_signals: false,
      allow_ad_personalization_signals: false
    };
    if (debugMode) gaConfig.debug_mode = true;
    window.gtag('config', id, gaConfig);   // ez küldi az egyetlen page_view eseményt

    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(id);
    document.head.appendChild(s);
  }

  // A GA4 saját első féltől származó sütijei. A törlés "legjobb igyekezet": a böngésző csak
  // azokat törli, amelyeknek a neve, domainje és útvonala egyezik.
  function deleteGaCookies() {
    var host = window.location.hostname;
    var domains = ['', host, '.' + host];
    document.cookie.split(';').forEach(function (c) {
      var name = c.split('=')[0].trim();
      if (name === '_ga' || name.indexOf('_ga_') === 0 || name === '_gid' || name.indexOf('_gat') === 0) {
        domains.forEach(function (d) {
          document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/' + (d ? '; domain=' + d : '');
        });
      }
    });
  }

  function disableGa() {
    window['ga-disable-' + id] = true;     // a gtag.js hivatalos kikapcsoló jelzője
    if (loaded && typeof window.gtag === 'function') {
      window.gtag('consent', 'update', { analytics_storage: 'denied' });
    }
    disabled = true;
    deleteGaCookies();
  }

  function setChoice(choice) {
    saveChoice(choice);
    if (choice === 'granted') {
      if (loaded) {
        disabled = false;
        window['ga-disable-' + id] = false;
        window.gtag('consent', 'update', { analytics_storage: 'granted' });
      } else {
        loadGa();
      }
    } else {
      var wasLoaded = loaded;
      disableGa();
      // Ha a gtag.js már betöltődött, újratöltjük az oldalt, így a Google-szkript
      // kikerül a memóriából, és nem küld további adatot.
      if (wasLoaded) {
        window.location.reload();
        return;
      }
    }
    hideBanner();
  }

  /* ---------- hozzájárulási ablak (párbeszédablak) ---------- */

  // Középre úszó doboz. Az „Elfogadom” kiemelt (narancs), az „Elutasítom” kiemelés nélküli,
  // aláhúzott szöveggomb; mindkettő valódi gomb, legalább 44 px magas, egy kattintással működik.
  // Beállítások gomb és bezáró X nincs.
  function buildBanner() {
    var el = document.createElement('div');
    el.className = 'consent';
    el.id = 'consent-banner';
    el.hidden = true;
    el.innerHTML =
      '<div class="consent-doboz" role="dialog" aria-modal="true" aria-label="Sütik és látogatásmérés" ' +
          'aria-describedby="consent-text" tabindex="-1">' +
        '<p class="consent-text" id="consent-text">Sütiket használunk a weboldalunkon, hogy a Google Analytics ' +
        'segítségével mérni tudjuk a látogatottságot és a kattintásokat. Az Elfogadom gombra kattintva hozzájárulsz a sütik ' +
        'használatához. A döntésedet bármikor módosíthatod az oldal alján. ' +
        '<a class="consent-link" href="' + privacyUrl + '" target="_blank" rel="noopener">Adatkezelési tájékoztató</a></p>' +
        '<div class="consent-actions">' +
          '<button type="button" class="consent-btn consent-elfogad" data-consent="granted">Elfogadom</button>' +
          '<button type="button" class="consent-btn consent-elutasit" data-consent="denied">Elutasítom</button>' +
        '</div>' +
      '</div>';
    el.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-consent]');
      if (btn) setChoice(btn.getAttribute('data-consent'));
    });
    document.body.appendChild(el);
    dialogBox = el.querySelector('.consent-doboz');
    return el;
  }

  function focusables() {
    return Array.prototype.slice.call(dialogBox.querySelectorAll('a[href], button:not([disabled])'));
  }

  // Fókuszcsapda: Tab és Shift+Tab a dobozon belül körbejár; Esc csak a beállításokból nyitott ablakot zárja.
  function onDialogKeydown(e) {
    if (!banner || banner.hidden) return;
    if (e.key === 'Escape' || e.key === 'Esc') {
      e.preventDefault();
      if (dialogMode === 'beallitas') hideBanner();
      return;
    }
    if (e.key !== 'Tab') return;
    var f = focusables();
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1], active = document.activeElement;
    if (e.shiftKey) {
      if (active === first || active === dialogBox || !dialogBox.contains(active)) { e.preventDefault(); last.focus(); }
    } else if (active === last || !dialogBox.contains(active)) {
      e.preventDefault(); first.focus();
    }
  }

  // Tartalék az `inert`-et nem ismerő böngészőkhöz: ha a fókusz kikerülne, visszakerül a dobozba.
  function onFocusIn(e) {
    if (banner && !banner.hidden && !dialogBox.contains(e.target)) dialogBox.focus();
  }

  function setBackgroundInert(on) {
    if (on) {
      inertEls = [];
      Array.prototype.forEach.call(document.body.children, function (child) {
        if (child === banner || child.tagName === 'SCRIPT' || child.inert || child.hasAttribute('aria-hidden')) return;
        child.inert = true;                      // nem fókuszálható, nem kattintható, a felolvasó sem éri el
        child.setAttribute('aria-hidden', 'true');
        inertEls.push(child);
      });
    } else {
      inertEls.forEach(function (child) { child.inert = false; child.removeAttribute('aria-hidden'); });
      inertEls = [];
    }
  }

  function showBanner(mode) {
    if (!banner) banner = buildBanner();
    if (!banner.hidden) return;
    dialogMode = mode === 'beallitas' ? 'beallitas' : 'elso';
    prevFocus = document.activeElement;
    banner.hidden = false;
    document.documentElement.classList.add('consent-nyitva');   // görgetészár (style.css)
    document.body.classList.add('has-consent-banner');          // a mobilos sticky CTA rejtve marad
    setBackgroundInert(true);
    document.addEventListener('keydown', onDialogKeydown, true);
    document.addEventListener('focusin', onFocusIn, true);
    try { dialogBox.focus({ preventScroll: true }); } catch (e) { dialogBox.focus(); }
  }

  function hideBanner() {
    if (!banner || banner.hidden) return;
    banner.hidden = true;
    document.documentElement.classList.remove('consent-nyitva');
    document.body.classList.remove('has-consent-banner');
    setBackgroundInert(false);
    document.removeEventListener('keydown', onDialogKeydown, true);
    document.removeEventListener('focusin', onFocusIn, true);
    if (prevFocus && prevFocus !== document.body && document.contains(prevFocus) && prevFocus.focus) {
      try { prevFocus.focus({ preventScroll: true }); } catch (e) { prevFocus.focus(); }
    }
    prevFocus = null;
  }

  // „Süti-beállítások” gomb a [data-consent-settings-slot] helyekre (pl. lábléc): ugyanezt az ablakot nyitja meg.
  function addSettingsButtons() {
    var slots = document.querySelectorAll('[data-consent-settings-slot]');
    Array.prototype.forEach.call(slots, function (slot) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'consent-settings';
      b.textContent = 'Süti-beállítások';
      b.addEventListener('click', function () { showBanner('beallitas'); });
      slot.appendChild(b);
    });
  }

  /* ---------- affiliate kattintás ---------- */

  // Az öt CTA saját data-cta azonosítót kap (fejlec, hero, dontes, zaro, sticky); a link címe,
  // a target és a rel ettől nem változik. Azonosító nélküli Skool-linknél a szakasz id-je a tartalék.
  var CTA_IDS = ['fejlec', 'hero', 'dontes', 'zaro', 'sticky'];
  function ctaLocation(link) {
    var own = link.getAttribute('data-cta');
    if (own && CTA_IDS.indexOf(own) !== -1) return own;
    if (link.closest('.fejlec')) return 'fejlec';
    if (link.closest('#sticky-cta')) return 'sticky';
    var section = link.closest('section[id]');
    return section ? section.id : 'egyeb';
  }

  function isAffiliateLink(link) {
    return link.hostname === AFFILIATE_HOST && link.pathname.indexOf(AFFILIATE_PATH) === 0;
  }

  function onClick(event) {
    try {
      // bal gomb / Enter (click, button 0) vagy középső gomb (auxclick, button 1); jobb gomb nem számít
      if (event.type === 'click' && event.button !== 0) return;
      if (event.type === 'auxclick' && event.button !== 1) return;
      var link = event.target.closest && event.target.closest('a[href]');
      if (!link || !isAffiliateLink(link)) return;

      lastClick = {
        cta_location: ctaLocation(link),
        cta_text: link.textContent.trim().slice(0, 60),
        ad_variant: adVariant() || '(nincs)',
        utm_source: utm.utm_source || '(nincs)',
        utm_medium: utm.utm_medium || '(nincs)',
        utm_campaign: utm.utm_campaign || '(nincs)',
        utm_content: utm.utm_content || '(nincs)'
      };

      if (loaded && !disabled && readChoice() === 'granted' && typeof window.gtag === 'function') {
        var payload = {};
        for (var k in lastClick) payload[k] = lastClick[k];
        payload.transport_type = 'beacon';
        window.gtag('event', 'affiliate_click', payload);
      }
    } catch (e) { /* a mérés hibája soha nem akadályozhatja a link működését */ }
  }

  /* ---------- indulás ---------- */

  if (!validId || !validPrivacyUrl) {
    console.info('[Váltópont analitika] Nem aktív: ' +
      (!validId ? 'nincs érvényes GA4 Measurement ID. ' : '') +
      (!validPrivacyUrl ? 'nincs megadva a végleges adatkezelési tájékoztató (privacyUrl).' : ''));
    return;
  }

  document.addEventListener('click', onClick, true);
  document.addEventListener('auxclick', onClick, true);

  // állapot hibakereséshez, böngészőkonzolból
  window.valtopontAnalytics = {
    status: function () {
      return {
        choice: readChoice(),
        active: loaded && !disabled,
        debugMode: debugMode,
        utm: utm,
        adVariant: adVariant()
      };
    },
    lastClick: function () { return lastClick; },
    openSettings: function () { showBanner('beallitas'); }
  };

  addSettingsButtons();
  var choice = readChoice();
  if (choice === 'granted') loadGa();
  else if (choice === 'denied') deleteGaCookies();
  else showBanner('elso');
})();
