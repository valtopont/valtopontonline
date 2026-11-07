# valtopontonline.hu

A https://valtopontonline.hu ajánlói oldal forráskódja. Statikus HTML, CSS és egy kis JavaScript; nincs build lépés és nincs backend.

## Fájlok

- `index.html` – az oldal teljes tartalma.
- `style.css` – a stílusok.
- `script.js` – beúszó elemek, mobilos sticky gomb, lebegő fejléc.
- `analytics.js` – hozzájárulási ablak és GA4-mérés; csak akkor indul, ha a beállítás engedi.
- `analytics-config.js` – a mérés beállítása (amíg a `privacyUrl` üres, a mérés nem indul el).
- `favicon.ico` – az oldal ikonja.
- `assets/` – logók, faviconok, megosztási kép és betűtípusok.
- `tests/` – automatikus böngészős tesztek.
- `.htaccess` – http→https és www→domain átirányítás a tárhelyen.
- `.cpanel.yml` – a tárhelyre másolandó fájlok listája.

## Tesztek

A tesztekhez Node.js és Playwright kell:

```bash
node --test tests/analytics.test.js
```

## Közzététel

A tárhely (cPanel) a `main` ágról frissül: a cPanel Git Version Control felületén a telepítés a `.cpanel.yml` szerint a weboldal fájljait másolja a `public_html` mappába.
