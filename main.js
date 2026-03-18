// main.js - BYNIGHTS Instagram follow suggested with cookies (Playwright JS)

const { chromium } = require('playwright');

const SUGGERITI_URL = 'https://www.instagram.com/explore/people/';
const ENV_COOKIES = 'INSTAGRAM_COOKIES';
const MAX_FOLLOW = 70;
const MAX_TENTATIVI_FALLITI = 10;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Parte 1: caricare i cookie dall'env e aggiungerli al context
async function caricaCookies(context) {
  const cookiesJson = process.env[ENV_COOKIES];
  if (!cookiesJson || cookiesJson.trim() === '') {
    console.log('Errore: variabile di ambiente INSTAGRAM_COOKIES mancante.');
    return false;
  }

  try {
    const cookiesList = JSON.parse(cookiesJson);

    const cookies = cookiesList.map(c => {
      const cookie = {
        name: c.name,
        value: c.value,
      };

      if (c.url) {
        cookie.url = c.url;
      } else {
        if (c.domain) cookie.domain = c.domain;
        if (c.path) cookie.path = c.path;
      }

      if (typeof c.expirationDate === 'number') {
        cookie.expires = c.expirationDate;
      } else if (typeof c.expires === 'number') {
        cookie.expires = c.expires;
      }

      if (typeof c.httpOnly === 'boolean') cookie.httpOnly = c.httpOnly;
      if (typeof c.secure === 'boolean') cookie.secure = c.secure;

      // sameSite: mappa solo valori validi per Playwright JS
      if (typeof c.sameSite === 'string') {
        const s = c.sameSite.toLowerCase();
        if (s === 'lax') cookie.sameSite = 'Lax';
        else if (s === 'strict') cookie.sameSite = 'Strict';
        else if (s === 'none' || s === 'no_restriction') cookie.sameSite = 'None';
      }

      return cookie;
    });

    await context.addCookies(cookies);
    console.log(`Cookie caricati con successo (${cookies.length} cookie).`);
    return true;
  } catch (e) {
    console.log('Errore nel caricamento dei cookie:', e.message);
    return false;
  }
}

// Parte 2: chiudere popup
async function chiudiPopup(page) {
  try {
    await page.keyboard.press('Escape');
    await sleep(500);

    const testi = ['Non ora', 'Not Now', 'Chiudi', 'Close', 'Cancel'];

    for (const t of testi) {
      const btn = page.locator(`button:has-text("${t}")`);
      const count = await btn.count();
      if (count > 0 && await btn.first().isVisible()) {
        await btn.first().click({ timeout: 3000 });
        await sleep(500);
        break;
      }
    }
  } catch {
    // ignora errori dei popup
  }
}

// Parte 3: trovare i bottoni Segui/Follow
async function trovaBottoniSegui(page) {
  // Selector semplificato: qualsiasi bottone con testo Segui/Follow
  const locatorSeg = page.locator('button:has-text("Segui")');
  const locatorFollow = page.locator('button:has-text("Follow")');

  const countSeg = await locatorSeg.count();
  const countFollow = await locatorFollow.count();
  console.log(`Bottoni Segui: ${countSeg}, Bottoni Follow: ${countFollow}`);

  const bottoni = [];
  for (let i = 0; i < countSeg; i++) bottoni.push(locatorSeg.nth(i));
  for (let i = 0; i < countFollow; i++) bottoni.push(locatorFollow.nth(i));

  return bottoni;
}

// Parte 4: logica principale (segui suggeriti, restando su /explore/people/)
async function seguiAccountSuggeriti(page) {
  console.log('Navigo sulla pagina degli account suggeriti...');
  await page.goto(SUGGERITI_URL, { timeout: 60000 });
  await page.waitForTimeout(5000);

  console.log('Inizio follow sulla pagina suggerimenti...');
  let seguiti = 0;
  let tentativiFalliti = 0;

  while (seguiti < MAX_FOLLOW) {
    try {
      await chiudiPopup(page);

      const bottoni = await trovaBottoniSegui(page);

      if (bottoni.length === 0) {
        console.log('Nessun bottone Segui trovato. Ricarico la pagina suggerimenti...');
        await page.goto(SUGGERITI_URL, { timeout: 60000 });
        await page.waitForTimeout(4000);
        tentativiFalliti++;
        if (tentativiFalliti >= MAX_TENTATIVI_FALLITI) {
          console.log('Troppi tentativi senza bottoni. Uscita.');
          break;
        }
        continue;
      }

      let cliccato = false;

      for (const bottone of bottoni) {
        try {
          await chiudiPopup(page);
          await bottone.scrollIntoViewIfNeeded();
          await bottone.click({ timeout: 3000, force: true });
          await page.waitForTimeout(1000);

          seguiti++;
          tentativiFalliti = 0;
          console.log(`Seguito account ${seguiti}/${MAX_FOLLOW}`);
          cliccato = true;

          await sleep(2000);

          if (seguiti % 5 === 0) {
            console.log('Ricarico la pagina suggerimenti dopo 5 follow...');
            await page.goto(SUGGERITI_URL, { timeout: 60000 });
            await page.waitForTimeout(4000);
          }

          break; // torna al while
        } catch (e) {
          console.log('Errore click bottone:', e.message);
          await chiudiPopup(page);
        }
      }

      if (!cliccato) {
        tentativiFalliti++;
        console.log(`Nessun bottone cliccabile trovato (tentativo ${tentativiFalliti})`);
        await page.keyboard.press('End');
        await sleep(2000);
        if (tentativiFalliti >= MAX_TENTATIVI_FALLITI) {
          console.log('Troppi tentativi falliti di fila. Ricarico /explore/people/ ...');
          await page.goto(SUGGERITI_URL, { timeout: 60000 });
          await page.waitForTimeout(4000);
          tentativiFalliti = 0;
        }
      }
    } catch (e) {
      console.log('Errore nel loop principale:', e.message);
      tentativiFalliti++;
      await sleep(2000);
    }
  }

  console.log(`Operazione completata. Account seguiti oggi: ${seguiti}`);
}

// Entry point: home -> suggeriti -> follow (restando sui suggeriti)
(async () => {
  try {
    const browser = await chromium.launch({
      headless: true,
    });

    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
        'AppleWebKit/537.36 (KHTML, like Gecko) ' +
        'Chrome/120.0.0.0 Safari/537.36',
    });

    // 1) Carica i cookie nel contesto
    const ok = await caricaCookies(context);
    if (!ok) {
      await browser.close();
      return;
    }

    const page = await context.newPage();

    // 2) Vai sulla home una volta (solo per coerenza di sessione)
    console.log('Apro la home di Instagram per validare i cookie...');
    await page.goto('https://www.instagram.com/', { timeout: 60000 });
    await page.waitForTimeout(5000);

    console.log('Ora apro direttamente la pagina dei suggerimenti...');
    // 3) Da qui in poi resta sempre su /explore/people/
    await seguiAccountSuggeriti(page);

    await browser.close();
  } catch (e) {
    console.log('Errore imprevisto:', e.message);
  }
})();
