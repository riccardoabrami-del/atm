// login.js - We Wealth: flusso OTP reale
// FLUSSO REALE (scoperto ispezionando il sito):
//
//   STEP 1 - Vai su we-wealth.com
//   STEP 2 - Clicca icona utente in alto a destra (link .otp-popup-button o href="/#")
//            -> Si apre popup "Entra in We Wealth"
//   STEP 3 - Clicca "ACCEDI O REGISTRATI"
//            -> Mostra campo email: "Inserisci la tua email"
//   STEP 4 - Inserisci riccardo.abrami+XXX@we-wealth.com e clicca "INVIA CODICE VIA EMAIL"
//            -> We Wealth manda OTP all'email riccardo.abrami@we-wealth.com
//   STEP 5 - Script legge OTP da Gmail API (account riccardo.abrami@we-wealth.com)
//   STEP 6 - Inserisce OTP nel campo del popup
//   STEP 7 - Completa registrazione (nome, cognome, ruolo, termini)
//   STEP 8 - Invia notifica a milanotoonight@gmail.com

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
        const extractBody = (parts) => {
          for (const part of parts) {
            if (part.body && part.body.data) {
              body += Buffer.from(part.body.data, 'base64').toString('utf-8');
            }
            if (part.parts) extractBody(part.parts);
          }
        };
        extractBody(payload.parts || [payload]);
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
    <tr><td style="padding:8px;border-bottom:1px solid #eee"><b>Email registrata</b></td><td style="padding:8px;border-bottom:1px solid #eee">${email}</td></tr>
    <tr><td style="padding:8px;border-bottom:1px solid #eee"><b>OTP usato</b></td><td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold;font-size:20px;letter-spacing:4px">${otp || '-'}</td></tr>
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
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // STEP 1 - Vai su we-wealth.com
    console.log('STEP 1 - Caricamento we-wealth.com...');
    await page.goto('https://www.we-wealth.com', {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    await page.waitForTimeout(2000);

    // STEP 2 - Clicca il pulsante Accedi (icona utente / otp-popup-button)
    console.log('STEP 2 - Click pulsante Accedi...');
    await page.click('a.otp-popup-button, a[href="/#"]');
    await page.waitForTimeout(1500);

    // Nel primo popup clicca "ACCEDI O REGISTRATI"
    console.log('STEP 2b - Click ACCEDI O REGISTRATI...');
    await page.click('text=ACCEDI O REGISTRATI');
    await page.waitForTimeout(1500);

    // STEP 3 - Inserisci email univoca
    console.log('STEP 3 - Inserimento email: ' + email);
    const emailField = await page.waitForSelector(
      'input[type="email"], input[name="email"], input[placeholder*="email"], input[placeholder*="Email"]',
      { state: 'visible', timeout: 15000 }
    );
    await emailField.fill(email);
    await page.waitForTimeout(500);

    // Clicca "INVIA CODICE VIA EMAIL"
    console.log('STEP 3b - Click INVIA CODICE VIA EMAIL...');
    await page.click('text=INVIA CODICE VIA EMAIL');
    await page.waitForTimeout(3000);

    // STEP 4+5 - Leggi OTP da Gmail
    console.log('STEP 4 - Lettura OTP da Gmail...');
    otp = await getOtpFromGmail(startTime);
    logEntry('OTP ricevuto: ' + otp);

    // STEP 6 - Inserisci OTP nel popup
    console.log('STEP 5 - Inserimento OTP nel popup...');
    const otpField = await page.waitForSelector(
      'input[type="number"], input[name="otp"], input[id="otp"], input[maxlength], input[placeholder*="codice"], input[placeholder*="OTP"], input[placeholder*="code"]',
      { state: 'visible', timeout: 30000 }
    );
    await otpField.fill(otp);
    await page.waitForTimeout(500);

    // Clicca il pulsante di conferma OTP
    await page.click('button[type="submit"], text=CONFERMA, text=VERIFICA, text=CONTINUA');
    await page.waitForTimeout(3000);

    // STEP 7 - Completa registrazione (potrebbero apparire campi extra)
    console.log('STEP 6 - Completamento registrazione...');
    currentUrl = page.url();

    // Compila eventuali campi aggiuntivi del profilo
    const fnameField = page.$('input[name="first_name"], input[id="fname"], input[placeholder*="nome"], input[placeholder*="Nome"]');
    if (await fnameField) await (await fnameField).fill('Riccardo');

    const lnameField = page.$('input[name="last_name"], input[id="lname"], input[placeholder*="cognome"], input[placeholder*="Cognome"]');
    if (await lnameField) await (await lnameField).fill('Abrami');

    // Accetta termini se visibili
    const termsCheck = page.$('input[type="checkbox"]');
    if (await termsCheck) {
      const checked = await (await termsCheck).isChecked();
      if (!checked) await (await termsCheck).check();
    }

    // Clicca eventuale pulsante di completamento
    try {
      await page.click('button[type="submit"], text=SALVA, text=COMPLETA, text=CONFERMA', { timeout: 5000 });
      await page.waitForTimeout(3000);
    } catch (_) {
      console.log('Nessun pulsante finale da cliccare.');
    }

    currentUrl = page.url();
    logEntry('Completato. URL finale: ' + currentUrl);

    // STEP 8 - Notifica email
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
