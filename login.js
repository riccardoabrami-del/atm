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
    // STEP 1
    console.log('STEP 1 - Caricamento we-wealth.com...');
    await page.goto('https://www.we-wealth.com', { waitUntil: 'networkidle', timeout: 60000 });
    console.log('Pagina caricata, URL: ' + page.url());

    // STEP 2 - Clicca pulsante Accedi via JS
    console.log('STEP 2 - Click pulsante Accedi...');
    await page.evaluate(() => {
      const btn = document.querySelector('a.otp-popup-button') ||
        document.querySelector('a[href="/#"]') ||
        document.querySelector('a[href="#"]');
      if (btn) btn.click();
      else throw new Error('Pulsante Accedi non trovato');
    });
    await page.waitForTimeout(1500);

    // STEP 2b - Chiudi banner cookie
    console.log('STEP 2b - Chiusura banner cookie...');
    try {
      await page.click(
        'button:has-text("Accetta"), button:has-text("Accetto"), button:has-text("Accept"), button:has-text("Chiudi"), button:has-text("OK"), #CybotCookiebotDialogBodyButtonAccept, .cc-accept, [aria-label*="cookie" i], .cookie-accept',
        { timeout: 5000 }
      );
      console.log('Banner cookie chiuso.');
      await page.waitForTimeout(1000);
    } catch (_) {
      console.log('Nessun banner cookie trovato, procedo.');
    }

    // STEP 3
    console.log('STEP 3 - Click Accedi o registrati...');
    await page.click('#otp-submit-button', { timeout: 10000 });
    await page.waitForTimeout(1500);

    // STEP 4
    console.log('STEP 4 - Inserimento email: ' + email);
    await page.waitForSelector(
      'input[type="email"], input[placeholder*="mail"], input[placeholder*="Mail"]',
      { state: 'visible', timeout: 15000 }
    );
    await page.fill(
      'input[type="email"], input[placeholder*="mail"], input[placeholder*="Mail"]',
      email
    );
    await page.waitForTimeout(500);

    
    // STEP 5
    console.log('STEP 5 - Click ...');
    await page.click('text=');
    const otpRequestTime = Date.now();
await page.waitForTimeout(3000);

    // STEP 6
    console.log('STEP 6 - Lettura OTP da Gmail...');
    otp = await getOtpFromGmail(otRequestTime);
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
