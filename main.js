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

      // sameSite: mappa solo valori validi per Playwright JS [web:53][web:55]
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
  const baseSelector =
    '#mount_0_0_T8 > div > div > div.x9f619.x1n2onr6.x1ja2u2z > div > div > ' +
    'div.x78zum5.xdt5ytf.x1t2pt76.x1n2onr6.x1ja2u2z.x10cihs4 > ' +
    'div.html-div.xdj266r.x14z9mp.xat24cr.x1lziwak.xexx8yu.xyri2b.x18d9i69.' +
    'x1c1uobl.x9f619.x16ye13r.xvbhtw8.x78zum5.x15mokao.x1ga7v0g.x16uus16.' +
    'xbiv7yw.x1uhb9sk.x1plvlek.xryxfnj.x1c4vz4f.x2lah0s.x1q0g3np.xqjyukv.' +
    'x1qjc9v5.x1oa3qoh.x1qughib > div.x10o80wk.x14k21rp.xh8yej3 > section > ' +
    'main > div > div.html-div.xdj266r.x14z9mp.xat24cr.x1lziwak.xyri2b.' +
    'x1c1uobl.x9f619.xjbqb8w.x78zum5.x15mokao.x1ga7v0g.x16uus16.xbiv7yw.' +
    'xwib8y2.x1y1aw1k.x1uhb9sk.x1plvlek.xryxfnj.x1c4vz4f.x2lah0s.xdt5ytf.' +
    'xqjyukv.x1qjc9v5.x1oa3qoh.x1nhvcw1 > div > div > div:nth-child(2) > ' +
    'div > div > div > div:nth-child(3) > div > button';

  const locatorSeg = page.locator(`${baseSelector}:has-text("Segui")`);
  const locatorFollow = page.locator(`${baseSelector}:has-text("Follow")`);

  const countSeg = await locatorSeg.count();
  const countFollow = await locatorFollow.count();
  console.log(`Bottoni Segui: ${countSeg}, Bottoni Follow: ${countFollow}`);

  const bottoni = [];
  for (let i = 0; i < countSeg; i++) bottoni.push(locatorSeg.nth(i));
  for (let i = 0; i < countFollow; i++) bottoni.push(locatorFollow.nth(i));

  return bottoni;
}

// Parte 4: logica principale (segui suggeriti)
async function seguiAccountSuggeriti(page) {
  console.log('Navigo sulla pagina degli account suggeriti...');
  await page.goto(SUGGERITI_URL, { timeout: 60000 });
  await page.waitForTimeout(5000);

  if (page.url().includes('accounts/login')) {
    console.log('Errore: non loggato. I cookie potrebbero essere scaduti.');
    return;
  }

  console.log('Login confermato tramite cookie. Inizio follow...');
  let seguiti = 0;
  let tentativiFalliti = 0;

  while (seguiti < MAX_FOLLOW) {
    try {
      await chiudiPopup(page);

      const bottoni = await trovaBottoniSegui(page);

      if (bottoni.length === 0) {
        console.log('Nessun bottone Segui trovato. Ricarico la pagina...');
        await page.goto(SUGGERITI_URL, { timeout: 60000 });
        await page.waitForTimeout(4000);
        tentativiFalliti++;
        if (tentativiFalliti >= MAX_TENTATIVI_FALLITI) {
          console.log('Troppi tentativi falliti. Uscita.');
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
            await page.reload();
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

// Entry point: home -> suggeriti -> follow
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

    // 2) Vai prima sulla home di Instagram usando questi cookie
    console.log('Apro la home di Instagram per validare i cookie...');
    await page.goto('https://www.instagram.com/', { timeout: 60000 });
    await page.waitForTimeout(5000);

    if (page.url().includes('accounts/login')) {
      console.log('Errore: ancora sulla pagina di login, i cookie non funzionano.');
      await browser.close();
      return;
    }

    console.log('Login confermato dalla home. Ora apro la pagina dei suggerimenti...');

    // 3) Da qui passa alla logica che apre la pagina suggerimenti e segue account
    await seguiAccountSuggeriti(page);

    await browser.close();
  } catch (e) {
    console.log('Errore imprevisto:', e.message);
  }
})();
