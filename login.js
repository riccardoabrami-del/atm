// login.js - We Wealth login automatico con Playwright
// Installa le dipendenze: npm install playwright
// Usa variabili d'ambiente per le credenziali:
//   WW_EMAIL=tua@email.com
//   WW_PASSWORD=tuapassword
// Esegui: node login.js

const { chromium } = require('playwright');

(async () => {
  const email = process.env.WW_EMAIL;
  const password = process.env.WW_PASSWORD;

  if (!email || !password) {
    console.error('Errore: imposta le variabili WW_EMAIL e WW_PASSWORD');
    process.exit(1);
  }

  // Ogni run apre un browser pulito (nessuna sessione salvata)
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('Apertura pagina di login We Wealth...');
  await page.goto('https://www.we-wealth.com/en/login');

  // Attende che il form sia visibile
  await page.waitForSelector('#username', { state: 'visible' });

  // Deseleziona "Remember me" (vogliamo login fresco ogni volta)
  const rememberMe = await page.$('#rememberme');
  if (await rememberMe.isChecked()) {
    await rememberMe.uncheck();
  }

  // Compila le credenziali
  await page.fill('#username', email);
  await page.fill('#password', password);

  console.log('Invio credenziali...');
  await page.click('button[type="submit"]');

  // Attende il redirect alla dashboard dopo il login
  await page.waitForURL('**/dashboard', { timeout: 15000 });

  console.log('Login riuscito! URL corrente:', page.url());

  // --- Inserisci qui le azioni da fare da loggato ---

  await browser.close();
  console.log('Browser chiuso.');
})();
