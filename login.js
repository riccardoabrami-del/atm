// login.js - We Wealth: flusso OTP reale (v3 - fix selettore pulsante Accedi)
// FLUSSO REALE:
//   STEP 1 - Vai su we-wealth.com e aspetta networkidle
//   STEP 2 - Clicca il pulsante Accedi via JS evaluate (selettore href="/#")
//            -> Si apre popup "Entra in We Wealth"
//   STEP 3 - Clicca "ACCEDI O REGISTRATI"
//            -> Mostra campo email "Inserisci la tua email"
//   STEP 4 - Inserisci email riccardo.abrami+XXX@we-wealth.com
//   STEP 5 - Clicca "INVIA CODICE VIA EMAIL"
//   STEP 6 - Legge OTP da Gmail API
//   STEP 7 - Inserisce OTP nel campo popup
//   STEP 8 - Completa profilo e manda notifica a milanotoonight@gmail.com

const { chromium } = require('playwright');
const nodemailer = require('nodemailer');
const { google } = require('googleapis');
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
  const oAuth2Client = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET
  );
  oAuth2Client.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
  const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });

  const maxWaitMs = 90000;
  const pollIntervalMs = 5000;
  const start = Date.now();
  console.log('In attesa OTP da Gmail...');

  while (Date.now() - start < maxWaitMs) {
    await new Promise(r => setTimeout(r, pollIntervalMs));
    try {
      const res = await gmail.users.messages.list({
        userId: 'me',
        q: 'from:we-wealth.com after:' + Math.floor(afterTimestamp / 1000),
        maxResults: 10,
      });
      for (const msg of (res.data.messages || [])) {
        const detail = await gmail.users.messages.get({
          userId: 'me',
          id: msg.id,
          format: 'full'
        });
        let body = '';
        const extractBody = (parts) => {
          for (const part of (parts || [])) {
            if (part.body && part.body.data) {
              body += Buffer.from(part.body.data, 'base64').toString('utf-8');
            }
            if (part.parts) extractBody(part.parts);
          }
        };
        extractBody(detail.data.payload.parts || [detail.data.payload]);
        const otpMatch = body.match(/\b(\d{4,8})\b/);
        if (otpMatch) {
          console.log('OTP trovato:', otpMatch[1]);
          return otpMatch[1];
        }
      }
    } catch (e) {
      console.log('Errore lettura Gmail:', e.message);
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
  </table>
</div>`;
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
    // STEP 1 - Carica we-wealth.com aspettando che la pagina sia pronta
    console.log('STEP 1 - Caricamento we-wealth.com...');
    await page.goto('https://www.we-wealth.com', {
      waitUntil: 'networkidle',
      timeout: 60000,
    });
    console.log('Pagina caricata, URL: ' + page.url());

    // STEP 2 - Clicca il pulsante Accedi tramite JavaScript per massima robustezza
    console.log('STEP 2 - Click pulsante Accedi via JavaScript...');
    await page.evaluate(() => {
      // Prova prima la classe otp-popup-button
      const btn = document.querySelector('a.otp-popup-button') ||
                  document.querySelector('a[href="/#"]') ||
                  document.querySelector('a[href="#"]');
      if (btn) btn.click();
      else throw new Error('Pulsante Accedi non trovato nel DOM');
    });
    await page.waitForTimeout(2000);

    // Verifica che il popup sia apparso
    console.log('STEP 2b - Attesa popup "Entra in We Wealth"...');
    await page.waitForSelector('text=ACCEDI O REGISTRATI', { state: 'visible', timeout: 10000 });

    // Clicca ACCEDI O REGISTRATI
    await page.click('text=ACCEDI O REGISTRATI');
    await page.waitForTimeout(1500);

    // STEP 3 - Inserisci email nel campo del popup
    console.log('STEP 3 - Inserimento email: ' + email);
    await page.waitForSelector(
      'input[type="email"], input[placeholder*="mail"], input[placeholder*="Mail"]',
      { state: 'visible', timeout: 15000 }
    );
    await page.fill(
      'input[type="email"], input[placeholder*="mail"], input[placeholder*="Mail"]',
      email
    );
    await page.waitForTimeout(500);

    // STEP 4 - Clicca INVIA CODICE VIA EMAIL
    console.log('STEP 4 - Click INVIA CODICE VIA EMAIL...');
    await page.click('text=INVIA CODICE VIA EMAIL');
    await page.waitForTimeout(3000);

    // STEP 5 - Leggi OTP da Gmail
    console.log('STEP 5 - Lettura OTP da Gmail...');
    otp = await getOtpFromGmail(startTime);
    logEntry('OTP ricevuto: ' + otp);

    // STEP 6 - Inserisci OTP nel popup
    console.log('STEP 6 - Inserimento OTP: ' + otp);
    const otpSelector = 'input[type="number"], input[name="otp"], input[id="otp"], input[maxlength="6"], input[maxlength="4"], input[maxlength="8"], input[placeholder*="codice"], input[placeholder*="OTP"], input[placeholder*="code"]';
    await page.waitForSelector(otpSelector, { state: 'visible', timeout: 30000 });
    await page.fill(otpSelector, otp);
    await page.waitForTimeout(500);

    // Clicca conferma OTP
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')];
      const btn = btns.find(b => /conferma|verifica|continua|avanti|invia/i.test(b.textContent));
      if (btn) btn.click();
      else document.querySelector('button[type="submit"]')?.click();
    });
    await page.waitForTimeout(4000);

    currentUrl = page.url();
    logEntry('Completato. URL finale: ' + currentUrl);

    // STEP 7 - Notifica
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
