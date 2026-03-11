// login.js - We Wealth: flusso OTP reale (v5 - IMAP invece di OAuth2)
// FLUSSO REALE:
//   STEP 1 - Carica we-wealth.com (networkidle)
//   STEP 2 - Clicca icona utente via JS -> apre popup
//   STEP 2b - DISMISSI BANNER COOKIE
//   STEP 3 - Clicca #otp-submit-button ("Accedi o registrati")
//   STEP 4 - Inserisci email riccardo.abrami+XXX@we-wealth.com
//   STEP 5 - Clicca INVIA CODICE VIA EMAIL
//   STEP 6 - Legge OTP da Gmail via IMAP (App Password, no OAuth)
//   STEP 7 - Inserisce OTP nel campo popup
//   STEP 8 - Manda notifica a milanotoonight@gmail.com

const { chromium } = require('playwright');
const nodemailer = require('nodemailer');
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const fs = require('fs');
const path = require('path');

function randomSuffix() {
  return String(Math.floor(Math.random() * 1000)).padStart(3, '0');
}

function logEntry(text) {
  const logFile = path.join(__dirname, 'registrations.log');
  fs.appendFileSync(logFile, new Date().toISOString() + ' - ' + text + '\n');
  console.log(text);
}

async function getOtpFromGmail(afterTimestamp) {
  const maxWaitMs = 90000;
  const pollIntervalMs = 6000;
  const start = Date.now();
  console.log('In attesa OTP da Gmail via IMAP...');

  while (Date.now() - start < maxWaitMs) {
    await new Promise(r => setTimeout(r, pollIntervalMs));
    const client = new ImapFlow({
      host: 'imap.gmail.com',
      port: 993,
      secure: true,
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD,
      },
      logger: false,
        connectionTimeout: 120000,
        greetingTimeout: 30000,
        socketTimeout: 300000
    });

        client.on('error', err => {
                console.error('IMAP error:', err.message, err.code);
              });

        client.on('close', () => {
                console.error('IMAP connection closed');
              });
    try {
      await client.connect();
      await client.mailboxOpen('INBOX');
      const since = new Date(afterTimestamp - 10000);
      const messages = client.fetch(
        { since, from: 'we-wealth' },
        { source: true }
      );
      for await (const msg of messages) {
        const parsed = await simpleParser(msg.source);
        const text = (parsed.text || '') + (parsed.html || '');
        const otpMatch = text.match(/\b(\d{4,8})\b/);
        if (otpMatch) {
          console.log('OTP trovato:', otpMatch[1]);
          await client.logout();
          return otpMatch[1];
        }
      }
      await client.logout();
    } catch (e) {
      console.log('Errore lettura Gmail IMAP:', e.message);
      try { await client.logout(); } catch (_) {}
    }
    console.log('OTP non ancora arrivato, riprovo...');
  }
  throw new Error('OTP non ricevuto entro 90 secondi');
}

async function sendNotification({ success, email, url, otp, error }) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) return;
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  const stato = success ? 'SUCCESSO' : 'ERRORE';
  const colore = success ? '#2ecc71' : '#e74c3c';
  const timestamp = new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome' });
  const html = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto">
    <h2 style="background:${colore};color:#fff;padding:12px 20px;border-radius:6px">ATM Bot - ${stato}</h2>
    <table style="width:100%;border-collapse:collapse">
      <tr><td style="padding:8px;border-bottom:1px solid #eee"><b>Timestamp</b></td><td style="padding:8px;border-bottom:1px solid #eee">${timestamp}</td></tr>
      <tr><td style="padding:8px;border-bottom:1px solid #eee"><b>Email</b></td><td style="padding:8px;border-bottom:1px solid #eee">${email}</td></tr>
      <tr><td style="padding:8px;border-bottom:1px solid #eee"><b>OTP</b></td><td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold;font-size:20px;letter-spacing:4px">${otp || '-'}</td></tr>
      <tr><td style="padding:8px;border-bottom:1px solid #eee"><b>URL finale</b></td><td style="padding:8px;border-bottom:1px solid #eee">${url || '-'}</td></tr>
      ${error ? '<tr><td style="padding:8px;color:#e74c3c"><b>Errore</b></td><td style="padding:8px;color:#e74c3c">' + error + '</td></tr>' : ''}
    </table></div>`;
  await transporter.sendMail({
    from: process.env.SMTP_USER,
    to: 'milanotoonight@gmail.com',
    subject: `[ATM Bot] We Wealth - ${stato} | ${email}`,
    html,
  });
  console.log('Notifica inviata a milanotoonight@gmail.com');
}

(async () => {
  const suffix = randomSuffix();
  const email = 'riccardo.abrami+' + suffix + '@we-wealth.com';
  let currentUrl = '';
  let otp = null;
  const startTime = Date.now();
  logEntry('Inizio flusso - email: ' + email);

  const browser = await chromium.launch({
    headless: process.env.PLAYWRIGHT_HEADLESS === 'true',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();
  try {
// STEP 1b - attesa e chiusura cookie
console.log('Attendo fino a 10 secondi la comparsa del banner cookie...');
try {
  const cookieButton = page.locator(
    'button:has-text("Accetta"), button:has-text("Accetto"), button:has-text("Accept"), button:has-text("Chiudi"), button:has-text("OK"), #CybotCookiebotDialogBodyButtonAccept, .cc-accept, .cookie-accept'
  ).first();

  await cookieButton.waitFor({ state: 'visible', timeout: 10000 });
  await cookieButton.click();

  console.log('Banner cookie chiuso.');
  await page.waitForTimeout(1000);
} catch (_) {
  console.log('Nessun banner cookie trovato entro 10 secondi, procedo.');
}

// STEP 2 - click personcina
console.log('STEP 2 - Click pulsante Accedi...');
const loginButtons = page.locator('a.otp-popup-button');
console.log('Numero pulsanti Accedi trovati:', await loginButtons.count());

const loginButton = loginButtons.nth(1);
await loginButton.waitFor({ state: 'visible', timeout: 15000 });
await loginButton.click({ force: true });
await page.waitForTimeout(2000);

// controllo popup
console.log('Popup aperto, verifico campo email...');
await page.locator('input[type="email"]').first().waitFor({ state: 'visible', timeout: 15000 });

// STEP 3 - inserimento email
console.log('STEP 3 - Inserimento email: ' + email);

const emailInput = page.locator('input[type="email"]').first();
await emailInput.waitFor({ state: 'visible', timeout: 15000 });
await emailInput.click({ force: true });
await emailInput.fill('');
await emailInput.press('Control+A');
await emailInput.press('Backspace');
await emailInput.type(email, { delay: 40 });

await page.evaluate((val) => {
  const el = document.querySelector('input[type="email"]');
  if (el) {
    el.value = val;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }
}, email);

const insertedValue = await emailInput.inputValue();
console.log('Valore presente nel campo email:', insertedValue);

if (insertedValue.trim().toLowerCase() !== email.trim().toLowerCase()) {
  throw new Error(`Email non inserita correttamente. Atteso: ${email}, trovato: ${insertedValue}`);
}

// STEP 4 - click invia codice
console.log('STEP 4 - Click INVIA CODICE VIA EMAIL...');
const sendButton = page.locator('#otp-start-process');
await sendButton.waitFor({ state: 'visible', timeout: 15000 });
await sendButton.click({ force: true });

const otpRequestTime = Date.now();
await page.waitForTimeout(5000);

// STEP 5 - lettura OTP
console.log('STEP 5 - Lettura OTP da Gmail...');
otp = await getOtpFromGmail(otpRequestTime);
logEntry('OTP ricevuto: ' + otp);

// STEP 6
console.log('STEP 6 - Lettura OTP da Gmail...');
otp = await getOtpFromGmail(otpRequestTime);
logEntry('OTP ricevuto: ' + otp);
 
    // STEP 7
    console.log('STEP 7 - Inserimento OTP: ' + otp);
  const otpSelector = '.modal input[type="text"]'; // Campo OTP generico nel popup modal    await page.waitForSelector(otpSelector, { state: 'visible', timeout: 30000 });
    await page.fill(otpSelector, otp);
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')];
      const btn = btns.find(b => /conferma|verifica|continua|avanti|invia/i.test(b.textContent));
      if (btn) btn.click();
      else document.querySelector('button[type="submit"]')?.click();
    });
    await page.waitForTimeout(4000);
    currentUrl = page.url();
    logEntry('Completato. URL finale: ' + currentUrl);

    // STEP 8
    await sendNotification({ success: true, email, url: currentUrl, otp });
  } catch (err) {
    currentUrl = page.url();
    logEntry('ERRORE: ' + err.message);
    await sendNotification({ success: false, email, url: currentUrl, otp, error: err.message });
  } finally {
    await browser.close();
    console.log('Browser chiuso.');
  }
})();
