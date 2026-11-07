/*
 * ANALITIKA BEÁLLÍTÁSA – csak ezt a fájlt kell szerkeszteni.
 *
 * Az analitika csak akkor AKTÍV, ha mindkét mező ki van töltve:
 *   - ga4MeasurementId: érvényes "G-..." mérési azonosító,
 *   - privacyUrl: a VÉGLEGES, publikált adatkezelési tájékoztató relatív címe
 *     (például 'privacy.html').
 *
 * Amíg bármelyik üres vagy érvénytelen, nincs hozzájárulási ablak, nincs tárolás,
 * és a Google felé semmilyen kérés nem megy ki. Így a mérés véletlenül sem
 * indulhat el úgy, hogy a látogató nem kapott tájékoztatást.
 *
 * Aktív állapotban a látogató először a hozzájárulási ablakot látja. A GA4 csak
 * akkor töltődik be, ha a látogató az „Elfogadom” gombra kattintott.
 *
 * Bekapcsolás sorrendje: 1) a privacy.html helyőrzőinek kitöltése és jogi ellenőrzése,
 * 2) a privacy.html törlése a _config.yml „exclude” listájából (különben nem publikálódik),
 * 3) itt: privacyUrl: 'privacy.html'.
 */
window.VALTOPONT_ANALYTICS_CONFIG = {
  ga4MeasurementId: 'G-0G7W9BEY5S',   // „Kattintasmero” GA4-tulajdon
  privacyUrl: ''                      // ÜRES: a végleges tájékoztató még nem készült el
};
