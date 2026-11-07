/*
 * Váltópont – WAOO landing v1.4.1 (sticky-javítás: v1.5.1): három kis funkció, külső könyvtár nélkül.
 * 1. Beúszó elemek görgetéskor (a v2 bevált logikája): az elem akkor indul, amikor kb. 80%-a
 *    a ténylegesen látható sávban van; mobilon a látszó sticky sáv alatti rész nem számít
 *    láthatónak. Magas elemeknél méretérzékeny küszöb, egyszerre indulóknál rövid lépcsőzés,
 *    felfelé görgetéskor felülről érkezés. Minden elem csak egyszer animál.
 *    JS nélkül, szkripthibánál és csökkentett mozgásnál minden azonnal látható.
 * 2. Mobilos sticky CTA (v1.4.1): akkor jelenik meg, ha a tartalom egyik CTA-ja (hero, középső, záró)
 *    sem használható; egy csak csíkban látszó gomb nem számít használhatónak. Görgetés közben rövid
 *    késleltetéssel jön elő, hogy két CTA váltásakor ne villanjon fel. A sáv mért magassága
 *    a --sticky-mag CSS-változóba kerül (fókusz-görgetési tartalék, lábléc alsó térköze).
 * 3. Asztali fejléc: a hero teteje után üveges hátteret kap (JS nélkül áttetsző sávval is olvasható).
 */
(function () {
  'use strict';

  var root = document.documentElement;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var hasIO = 'IntersectionObserver' in window;
  var sticky = document.getElementById('sticky-cta');

  /* 1. Beúszó elemek */
  var KUSZOB = 0.8;    // az elem ennyi része legyen a látható sávban
  var MAX_SAV = 0.35;  // magas elemnél legfeljebb a látható sáv ennyi részét kell kitöltenie
  var LEPCSO = 70;     // ms az egyszerre induló elemek között
  var ELTOLAS = 18;    // px: a rejtett elem ennyivel lejjebb áll (style.css: --reveal-y)
  var items = Array.prototype.slice.call(document.querySelectorAll('.reveal'));

  // bármilyen szkripthiba esetén minden tartalom animáció nélkül látható
  function mindentMutat() {
    root.classList.remove('reveal-ready');
  }

  // a látszó mobilos sticky sáv magassága; ha rejtve van (vagy asztali nézetben), 0
  function alsoTakaras() {
    return sticky && sticky.classList.contains('is-visible') && getComputedStyle(sticky).display !== 'none'
      ? sticky.offsetHeight : 0;
  }

  // a sticky sáv állapotváltozásakor hívódik (lásd lent); a beúszás itt frissíti a sávhatárt
  var savValtozott = function () {};

  if (hasIO && !reduce && items.length) {
    window.addEventListener('error', mindentMutat);

    var takaras = alsoTakaras();
    var lathatoAlja = (window.innerHeight || root.clientHeight) - takaras;

    // ami betöltéskor akár részben is látszik, azonnal (animáció nélkül) látható
    items.forEach(function (el) {
      var r = el.getBoundingClientRect();
      if (r.top < lathatoAlja && r.bottom > 0) el.classList.add('is-visible');
    });

    var lepcsok = [];
    for (var i = 0; i <= 20; i++) lepcsok.push(i / 20);

    var megfigyelo;

    var indit = function (entries) {
      try {
        var indulo = entries.filter(function (entry) {
          if (!entry.isIntersecting) return false;
          var rb = entry.rootBounds || { top: 0, bottom: lathatoAlja, height: lathatoAlja };
          var b = entry.boundingClientRect;
          // a végleges (eltolás nélküli) helyből számolunk, nem a lejjebb tolt rejtett dobozból
          var el = ELTOLAS;
          var lathato = Math.min(b.bottom - el, rb.bottom) - Math.max(b.top - el, rb.top);
          var kell = Math.min(b.height * KUSZOB, rb.height * MAX_SAV);
          return lathato + 0.5 >= kell;
        });

        indulo.sort(function (a, b) {
          return (a.boundingClientRect.top - b.boundingClientRect.top) ||
            (a.boundingClientRect.left - b.boundingClientRect.left);
        });

        indulo.forEach(function (entry, n) {
          var el = entry.target;
          megfigyelo.unobserve(el);
          if (entry.rootBounds && entry.boundingClientRect.top < entry.rootBounds.top) {
            // felfelé görgetéskor felülről, enyhén lefelé ereszkedve érkezik
            el.style.transition = 'none';
            el.style.setProperty('--reveal-y', '-14px');
            el.getBoundingClientRect();
            el.style.transition = '';
          }
          el.style.setProperty('--reveal-delay', Math.min(n, 3) * LEPCSO + 'ms');
          el.classList.add('is-visible');
        });
      } catch (e) {
        mindentMutat();
      }
    };

    var megfigyel = function () {
      if (megfigyelo) megfigyelo.disconnect();
      megfigyelo = new IntersectionObserver(indit, {
        rootMargin: '0px 0px -' + takaras + 'px 0px',
        threshold: lepcsok
      });
      items.forEach(function (el) {
        if (!el.classList.contains('is-visible')) megfigyelo.observe(el);
      });
    };

    megfigyel();

    // a sticky sáv megjelenésekor/eltűnésekor, illetve méret- vagy tájolásváltáskor új sávhatár
    savValtozott = function () {
      var uj = alsoTakaras();
      if (uj !== takaras) {
        takaras = uj;
        lathatoAlja = (window.innerHeight || root.clientHeight) - takaras;
        megfigyel();
      }
    };

    var idozito;
    window.addEventListener('resize', function () {
      clearTimeout(idozito);
      idozito = setTimeout(savValtozott, 200);
    });

    root.classList.add('reveal-ready');
  }

  /* 2. Mobilos sticky CTA (v1.4.1)
   *    Egy tartalmi CTA akkor „használható”, ha a gomb legalább 75%-a látszik; amíg a sáv látszik, ezt a sáv
   *    fölötti szabad területen mérjük (a sáv mögötti gomb nem használható). Hiszterézis a villogás ellen:
   *    a sáv akkor jön elő, ha minden CTA láthatósága 50% alá esik, és akkor tűnik el, ha valamelyik CTA
   *    legalább 75%-ban a sáv fölött látszik; a két küszöb között az állapot nem változik. Görgetés közben a sáv
   *    csak akkor jön elő, ha a CTA nélküli állapot legalább 250 ms-ig fennáll, és a görgetés irányában a következő
   *    CTA nincs már 160 px-en belül: két közeli CTA váltásakor (az egyik épp kifut, a másik épp beér) így nem villan
   *    fel. Ha a látogató megáll, a sáv a CTA nélküli helyen mindig előjön; az eltűnés azonnali. Betöltéskor és
   *    szélességváltáskor (forgatás, nagyítás) nincs előzmény: ott a 75%-os küszöb dönt, így egy csak
   *    csíkban látszó gomb mellett is megjelenik a sáv. A záró CTA elérése után (a lábléc felé) a sáv rejtve
   *    marad: a záró CTA közvetlenül fölötte van, és a sáv ne takarja a lábléc közléseit. Ahol a CSS elrejti
   *    (asztal, nagyon alacsony nézet), ott a sáv inaktív. */
  var ctak = ['hero-cta', 'kozepso-cta', 'final-cta'].map(function (id) {
    return document.getElementById(id);
  }).filter(Boolean);
  var MUTAT_HA_ALATTA = 0.5;
  var HASZNALHATO = 0.75 - 0.001; // a lebegőpontos kerekítés miatt
  var KESLELTETES = 250;          // ms: ennyi ideig kell fennállnia a CTA nélküli állapotnak a megjelenés előtt
  var KOZEL = 160;                // px: görgetés közben az ennyin belül érkező következő CTA mellett a sáv nem jön elő
  var BETU_VAR = 600;             // v1.5.1 – ms: az első döntés legfeljebb ennyit vár a még töltődő webes betűkre

  if (sticky && hasIO && ctak.length) {
    var link = sticky.querySelector('a');
    var teljes = new Map();   // CTA → látható arány a teljes nézetben
    var szabad = new Map();   // CTA → látható arány a sáv fölötti szabad területen
    var zaro = document.getElementById('final-cta');
    var zaroUtan = false;     // a záró CTA teteje már a nézet felső széle fölött van (lábléc-zóna)
    var mutatva = false;
    var elso = true;
    var szukitett = null;
    var szelesseg = window.innerWidth;
    var varakozas = null;     // a halasztott megjelenítés időzítője
    var utolsoY = window.pageYOffset;
    var irany = 0;            // a legutóbbi görgetés iránya: 1 le, -1 fel
    var utolsoMozgas = 0;     // a legutóbbi görgetés ideje (ms)

    var aktiv = function () {
      return getComputedStyle(sticky).display !== 'none';
    };
    var legjobb = function (m) {
      var x = 0;
      m.forEach(function (v) { if (v > x) x = v; });
      return x;
    };

    var allit = function (mutat) {
      if (mutat === mutatva) return;
      mutatva = mutat;
      sticky.classList.toggle('is-visible', mutat);
      sticky.setAttribute('aria-hidden', mutat ? 'false' : 'true');
      link.tabIndex = mutat ? 0 : -1;
      savValtozott();
    };

    var nincsHasznalhato = function () {
      return !zaroUtan && legjobb(teljes) < MUTAT_HA_ALATTA;
    };
    // görgetés közben a görgetés irányában a következő CTA már közel van: hamarosan használható lesz
    var kozeledik = function () {
      if (Date.now() - utolsoMozgas > 150) return false;
      var h = window.innerHeight;
      return ctak.some(function (el) {
        var r = el.getBoundingClientRect();
        return irany > 0 ? r.bottom > h && r.top - h < KOZEL : irany < 0 && r.top < 0 && -r.bottom < KOZEL;
      });
    };
    // a megjelenés halasztása: ha közben egy CTA eléri az 50%-ot, a sáv elő sem jön
    var halaszt = function () {
      if (varakozas) return;
      varakozas = setTimeout(function () {
        varakozas = null;
        if (mutatva || elso || !aktiv() || !nincsHasznalhato()) return;
        if (kozeledik()) halaszt();
        else allit(true);
      }, KESLELTETES);
    };
    var megszakit = function () {
      if (varakozas) { clearTimeout(varakozas); varakozas = null; }
    };

    // v1.5.1: amíg a webes betűk töltődnek (legfeljebb BETU_VAR ms-ig), az első döntés vár: a tartalék betűs,
    // átmeneti elrendezés alapján a sáv különben egy pillanatra megjelenne, majd a betöltés után eltűnne
    var kezdet = Date.now();
    var betureVar = function () {
      return !!(document.fonts && document.fonts.status === 'loading') && Date.now() - kezdet < BETU_VAR;
    };
    var dont = function () {
      if (!aktiv()) { megszakit(); allit(false); return; }
      if (elso) {
        if (teljes.size < ctak.length || betureVar()) return;
        elso = false;
        megszakit();
        allit(!zaroUtan && legjobb(teljes) < HASZNALHATO);
      } else if (!mutatva) {
        if (nincsHasznalhato()) halaszt(); else megszakit();
      } else if (zaroUtan || legjobb(szabad) >= HASZNALHATO) {
        allit(false);
      }
    };

    var lepcsok = [0, 0.25, 0.5, 0.75, 1];
    var rogzit = function (m, teljesNezet) {
      return function (entries) {
        entries.forEach(function (e) {
          m.set(e.target, e.isIntersecting ? e.intersectionRatio : 0);
          if (teljesNezet && e.target === zaro) zaroUtan = e.boundingClientRect.top < (e.rootBounds ? e.rootBounds.top : 0);
        });
        dont();
      };
    };

    // a sáv mért magassága: a szabad terület alsó határa, a fókusz-tartalék és a lábléc térköze;
    // csak változáskor írjuk (a gyökérelem változója az egész dokumentum stílusát érvényteleníti)
    var utolsoMag = -1;
    var meretez = function () {
      var magassag = aktiv() ? sticky.offsetHeight : 0;
      if (magassag === utolsoMag) return;
      utolsoMag = magassag;
      if (magassag) root.style.setProperty('--sticky-mag', magassag + 'px');
      else root.style.removeProperty('--sticky-mag');
      if (szukitett) szukitett.disconnect();
      szabad.clear();
      szukitett = new IntersectionObserver(rogzit(szabad), {
        threshold: lepcsok,
        rootMargin: '0px 0px -' + magassag + 'px 0px'
      });
      ctak.forEach(function (el) { szukitett.observe(el); });
    };

    var teljesFigyelo = new IntersectionObserver(rogzit(teljes, true), { threshold: lepcsok });
    ctak.forEach(function (el) { teljesFigyelo.observe(el); });
    // v1.5.1: a CTA-k dokumentumbeli helye (a webes betűk betöltése utáni összevetéshez)
    var helyek = '';
    var hely = function () {
      return ctak.map(function (el) { return Math.round(el.getBoundingClientRect().top + window.pageYOffset); }).join(',');
    };
    // a mérés az első megjelenítés után fut: így nem kényszerít korai, ismételt elrendezést a betöltés alatt
    requestAnimationFrame(function () { helyek = hely(); setTimeout(meretez, 0); });

    window.addEventListener('scroll', function () {
      var y = window.pageYOffset;
      if (y === utolsoY) return;
      irany = y > utolsoY ? 1 : -1;
      utolsoY = y;
      utolsoMozgas = Date.now();
    }, { passive: true });

    var meretIdozito;
    window.addEventListener('resize', function () {
      clearTimeout(meretIdozito);
      meretIdozito = setTimeout(function () {
        // csak szélességváltáskor (forgatás, nagyítás) döntünk újra előzmény nélkül; a mobilos címsor
        // ki-be csúszása (csak magasságváltás) nem okozhat váltást
        if (window.innerWidth !== szelesseg) { szelesseg = window.innerWidth; elso = true; }
        meretez();
        dont();
      }, 200);
    });
    /* v1.5.1: a webes betűk betöltése után a CTA-k helye megváltozhat (tartalék betűvel a hero-kártya magasabb).
     *    Az első döntés addigra a tartalék betűs elrendezés alapján megszületett; előzménnyel a sáv csak akkor
     *    tűnne el, ha a gomb 75%-a a sáv fölött látszana, amit a sáv mögé került, egyébként teljesen látható gomb
     *    nem teljesít – így a sáv tartósan a gomb fölött maradt. Ezért a betöltés után a helyet egyszer újramérjük:
     *    ha egy CTA elmozdult, a láthatóságot közvetlenül számoljuk, és előzmény nélkül döntünk (mint szélesség-
     *    váltáskor). Ha semmi nem mozdult, csak a sáv magasságát frissítjük. Egy képkockán belül több jelzés
     *    egyetlen mérést indít; nincs ismétlődő mérés és várakozás. */
    var arany = function (el, also) {
      var r = el.getBoundingClientRect();
      if (!r.height) return 0;
      return Math.max(0, Math.min(1, (Math.min(r.bottom, also) - Math.max(r.top, 0)) / r.height));
    };
    var ujramerVar = false;
    var betuUtan = function () {
      if (ujramerVar) return;
      ujramerVar = true;
      requestAnimationFrame(function () {
        ujramerVar = false;
        meretez();
        var most = hely();
        if (most === helyek) { if (elso) dont(); return; }
        helyek = most;
        var h = window.innerHeight;
        ctak.forEach(function (el) {
          teljes.set(el, arany(el, h));
          szabad.set(el, arany(el, h - Math.max(utolsoMag, 0)));
        });
        if (zaro) zaroUtan = zaro.getBoundingClientRect().top < 0;
        elso = true;
        dont();
      });
    };
    // a várakozás felső határa: ha a betűk ennyi idő alatt sem érkeznek meg, a meglévő mérés alapján döntünk
    setTimeout(function () { if (elso) dont(); }, BETU_VAR + 20);
    if (document.fonts) {
      if (document.fonts.ready) document.fonts.ready.then(betuUtan);
      if (document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', betuUtan);
    }
  }

  /* 3. Asztali fejléc: üvegsáv, amint a hero teteje kigördült */
  var fejlec = document.getElementById('fejlec');
  var hero = document.getElementById('hero');

  if (fejlec && hero && hasIO) {
    var jelzo = document.createElement('div');
    jelzo.setAttribute('aria-hidden', 'true');
    jelzo.style.cssText = 'position:absolute;top:0;left:0;width:1px;height:72px;pointer-events:none;visibility:hidden';
    hero.insertBefore(jelzo, hero.firstChild);
    new IntersectionObserver(function (entries) {
      fejlec.classList.toggle('fejlec--lebeg', !entries[0].isIntersecting);
    }).observe(jelzo);
  }
})();
