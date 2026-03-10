// login.js - We Wealth: registrazione con flusso OTP corretto
// FLUSSO REALE:
//   STEP 1 - Inserisce solo l'email nel primo campo e clicca Continua
//   STEP 2 - We Wealth manda OTP all'email -> script lo legge da Gmail API
//   STEP 3 - Inserisce l'OTP nella pagina e conferma
//   STEP 4 - Compila il resto del form (nome, cognome, password, citta, ruolo)
//   STEP 5 - Invia notifica di completamento a milanotoonight@gmail.com
//
// Dipendenze: npm install playwright nodemailer googleapis
//
// Variabili d'ambiente:
//   WW_PASSWORD          - password per la registrazione
//   SMTP_USER            - Gmail mittente per la notifica
//   SMTP_PASS            - App Password Gmail mittente
//   GMAIL_CLIENT_ID      - OAuth2 Client ID (account riccardo.abrami@we-wealth.com)
//   GMAIL_CLIENT_SECRET  - OAuth2 Client Secret
//   GMAIL_REFRESH_TOKEN  - OAuth2 Refresh Token

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

// Legge l'OTP dalla Gmail di riccardo.abrami@we-wealth.com via Gmail API
async function getOtpFromGmail(afterTimestamp) {
  const oAuth2Client = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET
  );
  oAuth2Client.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
  const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });

  const maxWaitMs = 60000;
  const pollIntervalMs = 3000;
  const start = Date.now();

  console.log('In attesa OTP da Gmail (riccardo.abrami@we-wealth.com)...');

  while (Date.now() - start < maxWaitMs) {
    await new Promise(r => setTimeout(r, pollIntervalMs));

    const res = await gmail.users.messages.list({
      userId: 'me',
      q: 'from:we-wealth.com after:' + Math.floor(afterTimestamp / 1000),
      maxResults: 5,
    });

    for (const msg of (res.data.messages || [])) {
      const detail = await gmail.users.messages.get({
        userId: 'me',
        id: msg.id,
        format: 'full',
      });

      let body = '';
      const parts = detail.data.payload.parts || [detail.data.payload];
      for (const part of parts) {
        if (part.body && part.body.data) {
          body += Buffer.from(part.body.data, 'base64').toString('utf-8');
        }
      }

      const otpMatch = body.match(/\b(\d{4,8})\b/);
      if (otpMatch) {
        console.log('OTP trovato:', otpMatch[1]);
        return otpMatch[1];
      }
    }
    console.log('OTP non ancora arrivato, riprovo tra 3s...');
  }

  throw new Error('OTP non ricevuto entro 60 secondi');
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

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto">
      <h2 style="background:${colore};color:#fff;padding:12px 20px;border-radius:6px;margin:0">ATM Bot - ${stato}</h2>
      <table style="width:100%;border-collapse:collapse;margin-top:10px">
        <tr><td style="padding:8px;border-bottom:1px solid #eee"><b>Timestamp</b></td><td style="padding:8px;border-bottom:1px solid #eee">${timestamp}</td></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #eee"><b>Email registrata</b></td><td style="padding:8px;border-bottom:1px solid #eee">${email}</td></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #eee"><b>OTP utilizzato</b></td><td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold;font-size:20px;letter-spacing:4px">${otp || '-'}</td></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #eee"><b>URL finale</b></td><td style="padding:8px;border-bottom:1px solid #eee">${url || '-'}</td></tr>
        ${error ? '<tr><td style="padding:8px;color:#e74c3c"><b>Errore</b></td><td style="padding:8px;color:#e74c3c">' + error + '</td></tr>' : ''}
      </table>
      <p style="color:#aaa;font-size:11px;margin-top:16px">Generato automaticamente da ATM Bot</p>
    </div>`;

  await transporter.sendMail({
    from: process.env.SMTP_USER,
    to: 'milanotoonight@gmail.com',
    subject: `[ATM Bot] Registrazione We Wealth - ${stato} | ${email}`,
    html,
  });
  console.log('Notifica inviata a milanotoonight@gmail.com');
}

// SCRIPT PRINCIPALE
(async () => {
  const suffix = randomSuffix();
  const email = 'riccardo.abrami+' + suffix + '@we-wealth.com';
  const password = process.env.WW_PASSWORD || 'Password' + suffix + '!';
  let currentUrl = '';
  let otp = null;
  const startTime = Date.now();

  logEntry('Inizio registrazione - email: ' + email);

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto('https://www.we-wealth.com/en/registrazione');

    // ── STEP 1: inserisce solo l'email nel primo campo ──────────────────────
    console.log('STEP 1 - Inserimento email...');
    await page.waitForSelector('#email', { state: 'visible' });
    await page.fill('#email', email);

    // Clicca il bottone che attiva l'invio OTP (Next / Continua / Verifica)
    // Usa un selettore generico che cattura il primo bottone submit/next visibile
    await page.click('button[type="submit"], button:has-text("Next"), button:has-text("Continua"), button:has-text("Verifica"), button:has-text("Sign Up")');

    // ── STEP 2: legge l'OTP dalla Gmail ────────────────────────────────────
    console.log('STEP 2 - Lettura OTP da Gmail...');
    otp = await getOtpFromGmail(startTime);
    logEntry('OTP ricevuto: ' + otp);

    // ── STEP 3: inserisce l'OTP nel campo che appare ────────────────────────
    console.log('STEP 3 - Inserimento OTP nella pagina...');
    await page.waitForSelector(
      'input[name="otp"], input[id="otp"], input[placeholder*="OTP"], input[placeholder*="codice"], input[placeholder*="code"], input[placeholder*="verif"]',
      { state: 'visible', timeout: 20000 }
    );
    await page.fill(
      'input[name="otp"], input[id="otp"], input[placeholder*="OTP"], input[placeholder*="codice"], input[placeholder*="code"], input[placeholder*="verif"]',
      otp
    );
    await page.click('button[type="submit"]');
    await page.waitForTimeout(2000);

    // ── STEP 4: compila il resto del form ──────────────────────────────────
    console.log('STEP 4 - Compilazione form completo...');
    await page.waitForSelector('#fname', { state: 'visible', timeout: 10000 }).catch(() => {});
    if (await page.$('#fname')) await page.fill('#fname', 'Riccardo');
    if (await page.$('#lname')) await page.fill('#lname', 'Abrami');
    if (await page.$('#password')) await page.fill('#password', password);
    if (await page.$('#city')) await page.fill('#city', 'Milano');
    if (await page.$('#role')) await page.selectOption('#role', 'Investor');
    if (await page.$('#terms')) await page.check('#terms');

    await page.click('button[type="submit"]');
    await page.waitForTimeout(4000);

    currentUrl = page.url();
    logEntry('Registrazione completata. URL: ' + currentUrl);

    // ── STEP 5: notifica successo ──────────────────────────────────────────
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
