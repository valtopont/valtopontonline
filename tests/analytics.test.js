/*
 * Váltópont – automatikus böngészős tesztek a hozzájárulás-kezeléshez, a GA4-méréshez
 * és az affiliate CTA-khoz (v1.6: az öt CTA a data-cta azonosítóval külön mérhető).
 *
 * Futtatás (nincs package.json, a már telepített Playwrightot használja):
 *   NODE_PATH=$(npm root -g) node --test tests/*.test.js
 *
 * FONTOS: a tesztek a Google-kéréseket HELYETTESÍTIK. A gtag.js helyett egy kis szkript fut,
 * amely a dataLayer parancsait a valódi gtag.js-hez hasonlóan értelmezi, és "collect"
 * kéréseket küld, amelyeket a teszt elfog. Ez a saját kódunk viselkedését igazolja,
 * a valódi Google-adatgyűjtést NEM. Azt a GA4 DebugView-ban kell kézzel ellenőrizni.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const BASE = 'https://valtopontonline.hu/';
const AFF = 'https://www.skool.com/szabaduszo-affiliate/about?ref=9f8501e9ce73465b9c9ea3abf13c00f2';
const KICSI = { width: 360, height: 640 };
const MOBILE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 900 };
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'application/javascript',
  '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };

// A valódi gtag.js helyettesítője: tiszteletben tartja a consent állapotot és a ga-disable jelzőt.
const GTAG_STUB = `(function () {
  var dl = window.dataLayer = window.dataLayer || [];
  var consent = {}, page = {}, id = null;
  function off() { return consent.analytics_storage !== 'granted' || (id && window['ga-disable-' + id] === true); }
  function send(en, params) {
    if (off()) return;
    var q = new URLSearchParams({ v: '2', tid: id, en: en });
    Object.keys(params || {}).forEach(function (k) {
      if (k !== 'transport_type' && params[k] !== undefined) q.set(k, String(params[k]));
    });
    fetch('https://region1.google-analytics.com/g/collect?' + q.toString(), { method: 'POST', keepalive: true, mode: 'no-cors' });
  }
  function handle(a) {
    a = Array.prototype.slice.call(a);
    if (a[0] === 'consent') Object.assign(consent, a[2] || {});
    else if (a[0] === 'set') Object.assign(page, a[1] || {});
    else if (a[0] === 'config') {
      id = a[1];
      if (!off()) {
        document.cookie = '_ga=GA1.1.111.222; path=/; max-age=63072000';
        document.cookie = '_ga_' + id.slice(2) + '=GS1.1.333; path=/; max-age=63072000';
      }
      var cfg = a[2] || {};
      if (cfg.send_page_view !== false) send('page_view', Object.assign({}, page, cfg));
    } else if (a[0] === 'event') send(a[1], Object.assign({}, page, a[2] || {}));
  }
  dl.forEach(handle);
  var push = dl.push;
  dl.push = function () { for (var i = 0; i < arguments.length; i++) handle(arguments[i]); return push.apply(dl, arguments); };
})();`;

let browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser.close(); });

/*
 * active=true: a teszt az analytics-config.js-ben kitölti a privacyUrl-t (csak a tesztben!),
 * hogy az analitika aktív legyen. active=false: a repository változatlan konfigurációja.
 */
async function setup({ active = true, viewport = MOBILE } = {}) {
  const ctx = await browser.newContext({ viewport });
  const s = { ctx, external: [], collects: [], errors: [] };
  await ctx.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === 'valtopontonline.hu') {
      const rel = url.pathname.slice(1) || 'index.html';
      const file = path.resolve(ROOT, rel);
      if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        return route.fulfill({ status: 404, body: '' });
      }
      const type = TYPES[path.extname(file)] || 'text/plain';
      if (!/^text\/|javascript/.test(type)) return route.fulfill({ contentType: type, body: fs.readFileSync(file) });
      let body = fs.readFileSync(file, 'utf8');
      if (rel === 'analytics-config.js' && active) {
        assert.ok(body.includes("privacyUrl: ''"), 'a repository konfigurációjában a privacyUrl üres');
        body = body.replace("privacyUrl: ''", "privacyUrl: 'privacy.html'");
      }
      return route.fulfill({ contentType: type, body });
    }
    s.external.push(url.href);
    if (url.hostname === 'www.googletagmanager.com' && url.pathname === '/gtag/js') {
      return route.fulfill({ contentType: 'application/javascript', body: GTAG_STUB });
    }
    if (url.hostname.endsWith('google-analytics.com')) {
      s.collects.push({ raw: url.search, ...Object.fromEntries(url.searchParams) });
      return route.fulfill({ status: 204, body: '' });
    }
    if (url.hostname === 'www.skool.com') {
      return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Skool</title>' });
    }
    return route.abort();
  });
  ctx.on('page', (p) => {
    p.on('pageerror', (e) => s.errors.push(e.message));
    p.on('console', (m) => { if (m.type() === 'error') s.errors.push(m.text()); });
  });
  s.page = await ctx.newPage();
  s.events = (name) => s.collects.filter((c) => c.en === name);
  s.cookies = async () => (await ctx.cookies()).map((c) => c.name);
  s.googleRequests = () => s.external.filter((u) => /google(tagmanager|-analytics)\.com/.test(u));
  s.close = async () => {
    assert.deepEqual(s.errors, [], 'nincs JavaScript-hiba');
    await ctx.close();
  };
  return s;
}

async function choose(s, label) {
  await s.page.getByRole('button', { name: label, exact: true }).click();
  await s.page.waitForTimeout(400);
}

// Affiliate link kattintása; az új lapot (Skool) megvárja és bezárja.
async function clickCta(s, locator) {
  const [popup] = await Promise.all([s.ctx.waitForEvent('page'), locator.click()]);
  await popup.waitForLoadState().catch(() => {});
  const url = popup.url();
  await popup.close();
  await s.page.waitForTimeout(300);
  return url;
}

// Az öt CTA saját data-cta azonosítója = a GA4 cta_location értéke.
const CTAS = [
  { name: 'fejléc', selector: '[data-cta="fejlec"]', location: 'fejlec' },
  { name: 'hero', selector: '[data-cta="hero"]', location: 'hero' },
  { name: 'ár és feltételek', selector: '[data-cta="dontes"]', location: 'dontes' },
  { name: 'záró', selector: '[data-cta="zaro"]', location: 'zaro' },
  { name: 'mobilos sticky CTA', selector: '[data-cta="sticky"]', location: 'sticky' },
];

test('0. biztonsági zár: üres privacyUrl mellett az analitika nem aktív', async () => {
  const s = await setup({ active: false });
  await s.page.goto(BASE);
  await s.page.waitForTimeout(800);
  assert.equal(await s.page.locator('#consent-banner').count(), 0, 'nincs hozzájárulási ablak');
  assert.equal(await s.page.locator('.consent-settings').count(), 0, 'nincs Süti-beállítások gomb');
  assert.equal(await s.page.locator('a[href="privacy.html"]').count(), 0, 'nincs link a nem létező tájékoztatóra');
  assert.deepEqual(s.googleRequests(), []);
  assert.deepEqual(await s.cookies(), []);
  await s.close();
});

test('1. hozzájárulási ablak 360×640-en, 390×844-en és asztali nézetben; döntés előtt nincs Google-kérés, elutasítás után az oldal használható', async () => {
  for (const viewport of [KICSI, MOBILE, DESKTOP]) {
    const n = `${viewport.width}×${viewport.height}`;
    const s = await setup({ viewport });
    await s.page.goto(BASE);
    await s.page.evaluate(() => document.fonts.ready);
    await s.page.waitForTimeout(600);
    const dlg = s.page.locator('#consent-banner [role="dialog"]');
    assert.ok(await dlg.isVisible(), `${n}: az ablak látszik`);
    assert.equal(await dlg.getAttribute('aria-modal'), 'true', `${n}: párbeszédablak (aria-modal)`);

    // a doboz teljesen a képernyőn belül van, legfeljebb 420 px széles
    const geo = await s.page.evaluate(() => {
      const r = document.querySelector('.consent-doboz').getBoundingClientRect();
      return { bal: r.left, fent: r.top, jobb: r.right, lent: r.bottom, szel: r.width, w: innerWidth, h: innerHeight };
    });
    assert.ok(geo.bal >= 0 && geo.fent >= 0 && geo.jobb <= geo.w && geo.lent <= geo.h, `${n}: a doboz a képernyőn belül (${JSON.stringify(geo)})`);
    assert.ok(geo.szel <= 420, `${n}: a doboz legfeljebb 420 px széles (${geo.szel})`);

    // mindkét gomb látszik, a képernyőn belül van és legalább 44 px magas
    for (const nev of ['Elfogadom', 'Elutasítom']) {
      const b = s.page.getByRole('button', { name: nev, exact: true });
      assert.ok(await b.isVisible(), `${n}: ${nev} látszik`);
      const bb = await b.boundingBox();
      assert.ok(bb.height >= 44, `${n}: ${nev} legalább 44 px magas (${bb.height})`);
      assert.ok(bb.y >= 0 && bb.y + bb.height <= viewport.height, `${n}: ${nev} a képernyőn belül`);
    }

    // a mögötte lévő oldal nem érhető el
    assert.equal(await s.page.evaluate(() => document.querySelector('main').inert), true, `${n}: a háttér nem érhető el (inert)`);

    // Tab-bal mindkét gomb elérhető, és a fókusz a dobozban marad (előre és visszafelé is)
    const lattuk = new Set();
    for (let i = 0; i < 8; i++) {
      await s.page.keyboard.press('Tab');
      const f = await s.page.evaluate(() => ({ benn: !!document.activeElement.closest('.consent-doboz'), szoveg: document.activeElement.textContent }));
      assert.ok(f.benn, `${n}: ${i + 1}. Tab után a fókusz a dobozban`);
      lattuk.add(f.szoveg);
    }
    for (let i = 0; i < 5; i++) {
      await s.page.keyboard.press('Shift+Tab');
      assert.ok(await s.page.evaluate(() => !!document.activeElement.closest('.consent-doboz')), `${n}: ${i + 1}. Shift+Tab után is a dobozban`);
    }
    assert.ok(lattuk.has('Elfogadom') && lattuk.has('Elutasítom'), `${n}: mindkét gomb elérhető Tab-bal`);

    // első megjelenéskor Esc nem zárja be; az oldal nem görgethető
    await s.page.keyboard.press('Escape');
    assert.ok(await dlg.isVisible(), `${n}: első megjelenéskor Esc nem zárja be`);
    await s.page.mouse.move(4, 4);
    await s.page.mouse.wheel(0, 900);
    await s.page.waitForTimeout(300);
    assert.equal(await s.page.evaluate(() => window.scrollY), 0, `${n}: döntés előtt az oldal nem görgethető`);

    // döntés előtt: nincs Google-kérés, süti vagy tárolás
    assert.deepEqual(s.googleRequests(), [], `${n}: döntés előtt nincs Google-kérés`);
    assert.deepEqual(await s.cookies(), [], `${n}: döntés előtt nincs süti`);
    assert.equal(await s.page.evaluate(() => localStorage.length), 0, `${n}: döntés előtt nincs tárolás`);
    assert.equal(await s.page.locator('script[src*="googletagmanager"]').count(), 0);

    // elutasítás után az ablak eltűnik, az oldal azonnal használható és görgethető, nincs Google-kérés
    await choose(s, 'Elutasítom');
    assert.ok(!(await dlg.isVisible()), `${n}: elutasítás után az ablak bezárult`);
    assert.equal(await s.page.evaluate(() => document.querySelector('main').inert), false, `${n}: elutasítás után a tartalom elérhető`);
    await s.page.mouse.wheel(0, 900);
    await s.page.waitForTimeout(400);
    assert.ok(await s.page.evaluate(() => window.scrollY) > 0, `${n}: elutasítás után az oldal görgethető`);
    assert.deepEqual(s.googleRequests(), [], `${n}: elutasítás után sincs Google-kérés`);
    await s.close();
  }
});

test('2. elutasítás után és újratöltés után sincs GA4-mérés', async () => {
  const s = await setup();
  await s.page.goto(BASE);
  await choose(s, 'Elutasítom');
  await s.page.reload();
  await s.page.waitForTimeout(800);
  assert.ok(!(await s.page.locator('#consent-banner').isVisible().catch(() => false)), 'az ablak nem jelenik meg újra');
  await clickCta(s, s.page.locator('#hero-cta'));
  assert.deepEqual(s.googleRequests(), [], 'nincs Google-kérés');
  assert.deepEqual(await s.cookies(), [], 'nincs süti');
  const stored = JSON.parse(await s.page.evaluate(() => localStorage.getItem('valtopont_analytics_consent')));
  assert.equal(stored.choice, 'denied');
  await s.close();
});

test('3. elfogadás után oldalbetöltésenként legfeljebb egy page_view, helyes Consent Mode sorrend', async () => {
  const s = await setup();
  await s.page.goto(BASE);
  await choose(s, 'Elfogadom');
  assert.equal(s.events('page_view').length, 1, 'pontosan egy page_view');
  const consent = await s.page.evaluate(() => window.dataLayer
    .map((a) => Array.prototype.slice.call(a))
    .filter((a) => a[0] === 'consent' || a[0] === 'config')
    .map((a) => [a[0], a[1], a[2] && a[0] === 'consent' ? a[2] : null]));
  assert.deepEqual(consent[0], ['consent', 'default',
    { analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' }]);
  assert.deepEqual(consent[1], ['consent', 'update', { analytics_storage: 'granted' }]);
  assert.equal(consent[2][0], 'config', 'a config a consent parancsok után jön');
  for (const c of consent) {
    if (c[2]) for (const k of ['ad_storage', 'ad_user_data', 'ad_personalization']) assert.notEqual(c[2][k], 'granted');
  }
  s.collects.length = 0;
  await s.page.reload();
  await s.page.waitForTimeout(800);
  assert.equal(s.events('page_view').length, 1, 'újratöltés után is pontosan egy page_view');
  await s.close();
});

test('4. visszavonáskor a további GA4-események leállnak', async () => {
  const s = await setup();
  await s.page.goto(BASE);
  await choose(s, 'Elfogadom');
  assert.ok((await s.cookies()).includes('_ga'), 'elfogadás után keletkezett GA-süti (helyettesítő)');
  // a Süti-beállítások gomb ugyanazt az ablakot nyitja meg; innen Esc-re bezárható, a döntés változása nélkül
  await s.page.getByRole('button', { name: 'Süti-beállítások' }).click();
  assert.ok(await s.page.locator('#consent-banner [role="dialog"]').isVisible(), 'az ablak megnyílt');
  assert.ok(await s.page.evaluate(() => !!document.activeElement.closest('.consent-doboz')), 'a fókusz a dobozban');
  await s.page.keyboard.press('Escape');
  await s.page.waitForTimeout(200);
  assert.ok(!(await s.page.locator('#consent-banner').isVisible()), 'Esc bezárja');
  const megmaradt = JSON.parse(await s.page.evaluate(() => localStorage.getItem('valtopont_analytics_consent')));
  assert.equal(megmaradt.choice, 'granted', 'Esc után a döntés nem változott');
  assert.equal(await s.page.evaluate(() => document.activeElement.textContent), 'Süti-beállítások', 'a fókusz visszakerül a gombra');
  await s.page.getByRole('button', { name: 'Süti-beállítások' }).click();
  await Promise.all([s.page.waitForNavigation(), s.page.getByRole('button', { name: 'Elutasítom', exact: true }).click()]);
  await s.page.waitForTimeout(800);
  s.collects.length = 0;
  s.external.length = 0;
  assert.equal(await s.page.locator('script[src*="googletagmanager"]').count(), 0, 'újratöltés után nincs gtag.js');
  assert.deepEqual((await s.cookies()).filter((n) => n.startsWith('_ga')), [], 'a GA-sütik törlődtek');
  await clickCta(s, s.page.locator('#hero-cta'));
  assert.deepEqual(s.collects, [], 'visszavonás után nincs több esemény');
  assert.deepEqual(s.googleRequests(), []);
  await s.close();
});

test('5–7. mind az öt CTA: helyes cél, ref megmarad, kattintásonként egy affiliate_click, helyes cta_location', async () => {
  const s = await setup();
  await s.page.goto(BASE);
  await choose(s, 'Elfogadom');
  const hrefs = await s.page.$$eval('a[href*="skool.com"]', (as) => as.map((a) => a.getAttribute('href')));
  assert.equal(hrefs.length, 5, 'öt Skool-link');
  for (const h of hrefs) assert.equal(h, AFF, 'pontosan az eredeti affiliate URL');
  const attrs = await s.page.$$eval('a[href*="skool.com"]', (as) => as.map((a) => [a.dataset.cta, a.target, a.rel]));
  assert.deepEqual(attrs.map((a) => a[0]).sort(), ['dontes', 'fejlec', 'hero', 'sticky', 'zaro'], 'öt különböző data-cta');
  for (const a of attrs) assert.deepEqual(a.slice(1), ['_blank', 'noopener sponsored'], 'target és rel változatlan');

  for (const cta of CTAS) {
    if (cta.location === 'sticky') {
      await s.page.locator('#tanulas').scrollIntoViewIfNeeded();
      await s.page.waitForSelector('#sticky-cta.is-visible');
      await s.page.waitForTimeout(400);
    } else if (cta.location === 'fejlec') {
      await s.page.evaluate(() => window.scrollTo(0, 0));
    } else {
      await s.page.locator(cta.selector).scrollIntoViewIfNeeded();
    }
    const before = s.events('affiliate_click').length;
    const opened = await clickCta(s, s.page.locator(cta.selector));
    assert.equal(opened, AFF, `${cta.name}: a megnyílt cél pontosan az affiliate URL`);
    const after = s.events('affiliate_click');
    assert.equal(after.length - before, 1, `${cta.name}: pontosan egy affiliate_click`);
    assert.equal(after[after.length - 1].cta_location, cta.location, `${cta.name}: cta_location`);
  }
  // jobb gombos kattintás nem számít kattintásnak
  const before = s.events('affiliate_click').length;
  await s.page.locator('#hero-cta').scrollIntoViewIfNeeded();
  await s.page.locator('#hero-cta').click({ button: 'right' });
  await s.page.waitForTimeout(300);
  assert.equal(s.events('affiliate_click').length, before, 'jobb gomb: nincs esemény');
  await s.close();
});

test('8. UTM: csak a négy engedélyezett paraméter kerül a mérésbe', async () => {
  const s = await setup();
  const q = '?utm_source=facebook&utm_medium=paid_social&utm_campaign=valtopont_teszt1&utm_content=A' +
    '&utm_term=x&fbclid=SECRETFB&gclid=SECRETG&email=teszt%40pelda.hu';
  await s.page.goto(BASE + q);
  await choose(s, 'Elfogadom');
  const clean = BASE + '?utm_source=facebook&utm_medium=paid_social&utm_campaign=valtopont_teszt1&utm_content=A';
  assert.equal(s.events('page_view')[0].page_location, clean, 'page_location csak UTM-mel');
  assert.equal(s.page.url(), clean, 'a címsorból is eltűntek a felesleges paraméterek');
  await clickCta(s, s.page.locator('#hero-cta'));
  const ev = s.events('affiliate_click')[0];
  assert.equal(ev.utm_source, 'facebook');
  assert.equal(ev.utm_medium, 'paid_social');
  assert.equal(ev.utm_campaign, 'valtopont_teszt1');
  assert.equal(ev.utm_content, 'A');
  assert.equal(ev.ad_variant, 'A');
  assert.equal(ev.cta_text, 'Megnézem a közösséget');
  const allowed = new Set(['v', 'tid', 'en', 'raw', 'page_location', 'page_referrer', 'allow_google_signals',
    'allow_ad_personalization_signals', 'cta_location', 'cta_text', 'ad_variant',
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_content']);
  for (const c of s.collects) {
    assert.ok(!/SECRET|teszt%40|pelda|utm_term|fbclid|gclid/.test(c.raw), 'nincs fbclid, gclid, e-mail, utm_term');
    for (const k of Object.keys(c)) assert.ok(allowed.has(k), `csak előre meghatározott paraméter: ${k}`);
  }
  await s.close();

  // érvénytelen (pl. e-mail-címet tartalmazó) UTM-érték nem kerül továbbításra
  const s2 = await setup();
  await s2.page.goto(BASE + '?utm_source=teszt%40pelda.hu&utm_content=B');
  await choose(s2, 'Elfogadom');
  await clickCta(s2, s2.page.locator('#hero-cta'));
  const ev2 = s2.events('affiliate_click')[0];
  assert.equal(ev2.utm_source, '(nincs)');
  assert.equal(ev2.ad_variant, 'B');
  await s2.close();
});

test('9. nincs Meta Pixel és GA4-en kívüli követőkód vagy külső kérés', async () => {
  for (const f of ['index.html', 'analytics.js', 'analytics-config.js', 'script.js']) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.ok(!/fbq\(|fbevents|connect\.facebook|facebook\.com\/tr|pixel/i.test(src), `${f}: nincs Meta Pixel`);
  }
  const s = await setup();
  await s.page.goto(BASE);
  await choose(s, 'Elfogadom');
  await clickCta(s, s.page.locator('#hero-cta'));
  const hosts = [...new Set(s.external.map((u) => new URL(u).hostname))].sort();
  assert.deepEqual(hosts, ['region1.google-analytics.com', 'www.googletagmanager.com', 'www.skool.com']);
  assert.equal(await s.page.evaluate(() => typeof window.fbq), 'undefined');
  const scripts = await s.page.$$eval('script[src]', (ss) => ss.map((x) => new URL(x.src).hostname));
  assert.deepEqual([...new Set(scripts)].sort(), ['valtopontonline.hu', 'www.googletagmanager.com']);
  await s.close();
});

test('10. a mobilos sticky CTA továbbra is működik', async () => {
  const s = await setup();
  await s.page.goto(BASE);
  assert.equal(await s.page.locator('#sticky-cta').evaluate((e) => getComputedStyle(e).display), 'none',
    'amíg a hozzájárulási ablak látszik, a sticky CTA rejtve van');
  await choose(s, 'Elutasítom');
  const state = () => s.page.locator('#sticky-cta').evaluate((e) => [e.classList.contains('is-visible'), e.getAttribute('aria-hidden')]);
  // a script.js szabálya: a sáv rejtve, amíg a hero, a középső vagy a záró CTA látszik.
  await s.page.locator('#hero-cta').scrollIntoViewIfNeeded();
  await s.page.waitForTimeout(400);
  assert.deepEqual(await state(), [false, 'true'], 'amíg a hero CTA látszik, rejtve');
  await s.page.locator('#tanulas').scrollIntoViewIfNeeded();
  await s.page.waitForTimeout(400);
  assert.deepEqual(await state(), [true, 'false'], 'görgetés után megjelenik');
  await s.page.locator('#final-cta').scrollIntoViewIfNeeded();
  await s.page.waitForTimeout(400);
  assert.deepEqual(await state(), [false, 'true'], 'a záró CTA-nál ismét rejtve');
  await s.close();
});

test('11. nincs vízszintes túlcsordulás 390 px-en és asztali nézetben', async () => {
  for (const viewport of [MOBILE, DESKTOP]) {
    const s = await setup({ viewport });
    await s.page.goto(BASE);
    await s.page.waitForTimeout(300);
    const check = () => s.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
    assert.ok(await check(), `${viewport.width}px, hozzájárulási ablakkal`);
    await choose(s, 'Elutasítom');
    assert.ok(await check(), `${viewport.width}px, döntés után`);
    await s.close();
  }
});

test('12. az egyetlen reklám- és ajánlói közlés (.reklam-doboz) olvasható, megfelelő kontrasztú, a hero CTA előtt áll', async () => {
  const s = await setup();
  await s.page.goto(BASE);
  await choose(s, 'Elutasítom');
  const info = await s.page.evaluate(() => {
    function rgb(c) { return c.match(/[\d.]+/g).slice(0, 3).map(Number); }
    function lum(c) {
      return rgb(c).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); })
        .reduce((acc, v, i) => acc + v * [0.2126, 0.7152, 0.0722][i], 0);
    }
    // a legközelebbi nem átlátszó háttér színei; színátmenetnél az összes színpont (a legrosszabbat mérjük)
    function bgs(el) {
      for (; el; el = el.parentElement) {
        const cs = getComputedStyle(el);
        const grad = cs.backgroundImage && cs.backgroundImage.includes('gradient')
          ? (cs.backgroundImage.match(/rgba?\([^)]*\)/g) || []) : [];
        if (grad.length) return grad;
        const c = cs.backgroundColor;
        if (c && !/rgba\(.*,\s*0\)$/.test(c) && c !== 'transparent') return [c];
      }
      return ['rgb(255, 255, 255)'];
    }
    const el = document.querySelector('.reklam-doboz'); const cs = getComputedStyle(el);
    const a = lum(cs.color);
    const ratio = Math.min(...bgs(el).map((c) => { const b = lum(c); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); }));
    return { text: el.textContent, size: parseFloat(cs.fontSize), ratio, visible: el.getBoundingClientRect().height > 0 };
  });
  assert.ok(info.visible, '.reklam-doboz látható');
  assert.ok(info.size >= 12, `.reklam-doboz legalább 12 px (${info.size})`);
  assert.ok(info.ratio >= 4.5, `.reklam-doboz kontraszt legalább 4,5:1 (${info.ratio.toFixed(2)})`);
  assert.equal(info.text, 'Reklám – ajánlói link Ha az oldal gombjain keresztül csatlakozol, a Váltópont üzemeltetője jutalékot kaphat. Neked ez nem kerül többe. A közösséget nem a Váltópont üzemelteti.');
  // a reklámdoboz közvetlenül a hero CTA előtt áll
  assert.equal(await s.page.evaluate(() => document.getElementById('hero-cta').previousElementSibling.className), 'reklam-doboz');
  // a látható szövegben a „jutalékot kaphat” pontosan egyszer szerepel (a közlés egy helyen van)
  const lathato = await s.page.evaluate(() => document.body.innerText);
  assert.equal((lathato.match(/jutalékot kaphat/g) || []).length, 1, 'a „jutalékot kaphat” pontosan egyszer szerepel');
  await s.close();
});

// 13. JavaScript-hiba: minden teszt végén a setup().close() ellenőrzi, hogy nem volt
// pageerror vagy console.error. Itt külön is betöltjük asztali nézetben, döntés nélkül.
test('13. nincs JavaScript-hiba (asztali nézet, aktív és inaktív konfiguráció)', async () => {
  for (const active of [true, false]) {
    const s = await setup({ active, viewport: DESKTOP });
    await s.page.goto(BASE);
    await s.page.mouse.wheel(0, 20000);
    await s.page.waitForTimeout(500);
    await s.close();
  }
});

// 14. Tartalmi zárak és megosztási előnézet (v1.6): a megszűnt próba, belső jelölések és a Meta Pixel
// nem kerülhet vissza; az og:-címkék és a favicon megvannak, a hivatkozott fájlok léteznek.
test('14. tartalmi zárak, Open Graph-címkék és favicon', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  for (const tiltott of [/próba/i, /ingyen/i, /7\s*nap/i, /JÓVÁHAGYANDÓ/, /HELYŐRZŐ/, /\bKELL\b/, /fbq\(/, /garant[aá]lt (bevétel|kereset)[^.]*(lesz|kapsz)/i]) {
    assert.ok(!tiltott.test(html), `nincs ilyen szöveg az oldalon: ${tiltott}`);
  }
  const s = await setup({ active: false });
  await s.page.goto(BASE);
  const meta = await s.page.evaluate(() => Object.fromEntries(
    [...document.querySelectorAll('meta[property^="og:"]')].map((m) => [m.getAttribute('property'), m.content])));
  for (const k of ['og:title', 'og:description', 'og:url', 'og:type', 'og:image']) assert.ok(meta[k], `${k} megvan`);
  assert.equal(meta['og:url'], 'https://valtopontonline.hu/');
  assert.ok(meta['og:image'].startsWith('https://valtopontonline.hu/'), 'abszolút og:image URL');
  assert.ok(fs.existsSync(path.join(ROOT, new URL(meta['og:image']).pathname.slice(1))), 'az og:image fájl létezik');
  const icons = await s.page.$$eval('link[rel~="icon"], link[rel="apple-touch-icon"]', (ls) => ls.map((l) => l.getAttribute('href')));
  assert.ok(icons.length >= 2, 'favicon-linkek');
  for (const i of icons) assert.ok(fs.existsSync(path.join(ROOT, i)), `${i} létezik`);
  // a látható szövegben a „Skoolon ellenőrizd” jellegű mondat csak egyszer szerepel
  const lathato = await s.page.evaluate(() => document.body.innerText);
  assert.equal((lathato.match(/nézd át a Skoolon/g) || []).length, 1, 'az ellenőrzési mondat egyszer szerepel');
  await s.close();
});
