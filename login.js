// login.js - We Wealth: registrazione con flusso OTP corretto
// FLUSSO REALE:
//   STEP 1 - Attende caricamento pagina, compila TUTTI i campi del form
//   STEP 2 - Clicca Sign Up -> We Wealth manda OTP all'email riccardo.abrami@we-wealth.com
//   STEP 3 - Script legge OTP da Gmail API (account riccardo.abrami@we-wealth.com)
//   STEP 4 - Inserisce OTP nel campo che appare
//   STEP 5 - Invia notifica a milanotoonight@gmail.com

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
        const payload = detail.data.payload;
        const parts = payload.parts || [payload];
        for (const part of parts) {
          if (part.mimeType === 'text/plain' && part.body && part.body.data) {
            body += Buffer.from(part.body.data, 'base64').toString('utf-8');
          } else if (part.mimeType === 'text/html' && part.body && part.body.data) {
            body += Buffer.from(part.body.data, 'base64').toString('utf-8');
          }
          // gestisci parti multipart annidate
          if (part.parts) {
            for (const subpart of part.parts) {
              if (subpart.body && subpart.body.data) {
                body += Buffer.from(subpart.body.data, 'base64').toString('utf-8');
              }
            }
          }
        }
        // cerca OTP: sequenza di 4-8 cifre isolata
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
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    },
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
    subject: `[ATM Bot] Registrazione We Wealth - ${stato} | ${email}`,
    html,
  });
  console.log('Notifica inviata a milanotoonight@gmail.com');
}

(async () => {
  const suffix = randomSuffix();
  const email = 'riccardo.abrami+' + suffix + '@we-wealth.com';
  const password = process.env.WW_PASSWORD || 'Password' + suffix + '!';
  let currentUrl = '';
  let otp = null;
  const startTime = Date.now();

  logEntry('Inizio registrazione - email: ' + email);

  const browser = await chromium.launch({
    headless: process.env.PLAYWRIGHT_HEADLESS === 'true',
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // STEP 1 - Carica la pagina e compila il form
    console.log('STEP 1 - Caricamento pagina registrazione...');
    await page.goto('https://www.we-wealth.com/en/registrazione', {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });

    // Attende che il form sia visibile
    await page.waitForSelector('#email', { state: 'visible', timeout: 30000 });

    console.log('STEP 1 - Compilazione form...');
    await page.fill('#fname', 'Riccardo');
    await page.fill('#lname', 'Abrami');
    await page.fill('#email', email);
    await page.fill('#password', password);
    await page.fill('#city', 'Milano');
    await page.selectOption('#role', 'Investor');
    await page.check('#terms');

    console.log('STEP 2 - Invio form Sign Up...');
    await page.click('input[aria-label="Sign Up"]');
    await page.waitForTimeout(5000);

    // STEP 3 - Leggi OTP da Gmail
    console.log('STEP 3 - Lettura OTP da Gmail...');
    otp = await getOtpFromGmail(startTime);
    logEntry('OTP ricevuto: ' + otp);

    // STEP 4 - Inserisce OTP nel campo che appare
    console.log('STEP 4 - Inserimento OTP...');
    const otpSelector = [
      'input[name="otp"]',
      'input[id="otp"]',
      'input[type="number"][maxlength]',
      'input[placeholder*="OTP"]',
      'input[placeholder*="code"]',
      'input[placeholder*="codice"]',
      'input[placeholder*="verif"]',
    ].join(', ');

    await page.waitForSelector(otpSelector, { state: 'visible', timeout: 30000 });
    await page.fill(otpSelector, otp);
    await page.waitForTimeout(1000);
    await page.click('button[type="submit"]');
    await page.waitForTimeout(5000);

    currentUrl = page.url();
    logEntry('Registrazione completata. URL: ' + currentUrl);

    // STEP 5 - Notifica
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
