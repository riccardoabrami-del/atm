// login.js - We Wealth registrazione automatica con Playwright
// Genera un numero casuale a 3 cifre e lo usa come suffisso dell'email:
//   riccardo.abrami+XYZ@we-wealth.com
// Installa le dipendenze: npm install playwright
// Esegui: node login.js

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// Genera un numero casuale a 3 cifre (000-999)
function randomSuffix() {
  return String(Math.floor(Math.random() * 1000)).padStart(3, '0');
}

// Salva il suffisso usato in un file di log per tracciabilita'
function logEmail(email) {
  const logFile = path.join(__dirname, 'registrations.log');
  const entry = new Date().toISOString() + ' - ' + email + '\n';
  fs.appendFileSync(logFile, entry);
  console.log('Email usata:', email);
  console.log('Log salvato in registrations.log');
}

(async () => {
  const suffix = randomSuffix();
  const email = 'riccardo.abrami+' + suffix + '@we-wealth.com';
  const password = process.env.WW_PASSWORD || 'Password' + suffix + '!';

  logEmail(email);

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('Apertura pagina di registrazione We Wealth...');
  await page.goto('https://www.we-wealth.com/en/registrazione');

  // Attende che il form sia visibile
  await page.waitForSelector('#fname', { state: 'visible' });

  // Compila il form di registrazione
  await page.fill('#fname', 'Riccardo');
  await page.fill('#lname', 'Abrami');
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.fill('#city', 'Milano');

  // Seleziona il ruolo
  await page.selectOption('#role', 'Investor');

  // Accetta i termini e condizioni
  await page.check('#terms');

  console.log('Invio form di registrazione...');
  await page.click('button:has-text("Sign Up")');

  // Attende conferma registrazione (redirect o messaggio di successo)
  await page.waitForTimeout(3000);
  console.log('Registrazione completata. URL corrente:', page.url());

  // --- Inserisci qui le azioni da fare dopo la registrazione ---

  await browser.close();
  console.log('Browser chiuso.');
})();
