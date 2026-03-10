// login.js - We Wealth: registrazione + lettura OTP da Gmail + notifica
// Dipendenze: npm install playwright nodemailer googleapis
//
// Variabili d'ambiente richieste:
//   WW_PASSWORD     - password usata per la registrazione
//   SMTP_USER       - email Gmail mittente per la notifica finale
//   SMTP_PASS       - App Password Gmail del mittente
//   GMAIL_CLIENT_ID     - Client ID OAuth2 Gmail API
//   GMAIL_CLIENT_SECRET - Client Secret OAuth2 Gmail API
//   GMAIL_REFRESH_TOKEN - Refresh Token OAuth2 (per riccardo.abrami@we-wealth.com)
//
// Esegui: node login.js

const { chromium } = require('playwright');
const nodemailer = require('nodemailer');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

// ─── Genera numero casuale a 3 cifre ─────────────────────────────────────────
function randomSuffix() {
  return String(Math.floor(Math.random() * 1000)).padStart(3, '0');
}

// ─── Salva log su file ────────────────────────────────────────────────────────
function logEntry(text) {
  const logFile = path.join(__dirname, 'registrations.log');
  const entry = new Date().toISOString() + ' - ' + text + '\n';
  fs.appendFileSync(logFile, entry);
  console.log(entry.trim());
}

// ─── Legge OTP dall'inbox Gmail di riccardo.abrami@we-wealth.com ──────────────
// Usa Gmail API con OAuth2. Attende fino a 60 secondi che arrivi l'email con l'OTP.
async function getOtpFromGmail(afterTimestamp) {
  const oAuth2Client = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET
  );
  oAuth2Client.setCredentials({
    refresh_token: process.env.GMAIL_REFRESH_TOKEN,
  });

  const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });
  const maxWaitMs = 60000; // attende max 60 secondi
  const pollIntervalMs = 3000; // controlla ogni 3 secondi
  const start = Date.now();

  console.log('Attendo OTP via Gmail...');

  while (Date.now() - start < maxWaitMs) {
    await new Promise(r => setTimeout(r, pollIntervalMs));

    // Cerca email da We Wealth arrivate dopo l'inizio della registrazione
    const res = await gmail.users.messages.list({
      userId: 'me',
      q: 'from:we-wealth.com after:' + Math.floor(afterTimestamp / 1000),
      maxResults: 5,
    });

    const messages = res.data.messages || [];
    for (const msg of messages) {
      const detail = await gmail.users.messages.get({
        userId: 'me',
        id: msg.id,
        format: 'full',
      });

      // Legge il corpo dell'email (plain text o HTML)
      let body = '';
      const parts = detail.data.payload.parts || [detail.data.payload];
      for (const part of parts) {
        if (part.body && part.body.data) {
          body += Buffer.from(part.body.data, 'base64').toString('utf-8');
        }
      }

      // Cerca un codice OTP: sequenza di 4-8 cifre
      const otpMatch = body.match(/\b(\d{4,8})\b/);
      if (otpMatch) {
        console.log('OTP trovato:', otpMatch[1]);
        return otpMatch[1];
      }
    }
    console.log('OTP non ancora arrivato, riprovo...');
  }

  throw new Error('OTP non ricevuto entro 60 secondi');
}

// ─── Invia email di notifica finale ──────────────────────────────────────────
async function sendNotification({ success, email, url, otp, error }) {
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const notifyEmail = 'milanotoonight@gmail.com';

  if (!smtpUser || !smtpPass) {
    console.warn('SMTP_USER o SMTP_PASS mancanti. Notifica non inviata.');
    return;
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: smtpUser, pass: smtpPass },
  });

  const stato = success ? 'SUCCESSO' : 'ERRORE';
  const colore = success ? '#2ecc71' : '#e74c3c';
  const timestamp = new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome' });

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto">
      <h2 style="background:${colore};color:#fff;padding:12px 20px;border-radius:6px;margin:0">
        ATM Bot - ${stato}
      </h2>
      <table style="width:100%;border-collapse:collapse;margin-top:10px">
        <tr><td style="padding:8px;border-bottom:1px solid #eee"><b>Timestamp</b></td><td style="padding:8px;border-bottom:1px solid #eee">${timestamp}</td></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #eee"><b>Email registrata</b></td><td style="padding:8px;border-bottom:1px solid #eee">${email}</td></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #eee"><b>OTP utilizzato</b></td><td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold;font-size:18px;letter-spacing:3px">${otp || '-'}</td></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #eee"><b>URL finale</b></td><td style="padding:8px;border-bottom:1px solid #eee">${url || '-'}</td></tr>
        ${error ? '<tr><td style="padding:8px;color:#e74c3c"><b>Errore</b></td><td style="padding:8px;color:#e74c3c">' + error + '</td></tr>' : ''}
      </table>
      <p style="color:#aaa;font-size:11px;margin-top:16px">Generato automaticamente da ATM Bot</p>
    </div>
  `;

  await transporter.sendMail({
    from: smtpUser,
    to: notifyEmail,
    subject: `[ATM Bot] Registrazione We Wealth - ${stato} | ${email}`,
    html,
  });

  console.log('Email di notifica inviata a:', notifyEmail);
}

// ─── Script principale ────────────────────────────────────────────────────────
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
    // 1. Apre pagina di registrazione
    await page.goto('https://www.we-wealth.com/en/registrazione');
    await page.waitForSelector('#fname', { state: 'visible' });

    // 2. Compila il form
    await page.fill('#fname', 'Riccardo');
    await page.fill('#lname', 'Abrami');
    await page.fill('#email', email);
    await page.fill('#password', password);
    await page.fill('#city', 'Milano');
    await page.selectOption('#role', 'Investor');
    await page.check('#terms');

    // 3. Invia il form (We Wealth manda OTP a riccardo.abrami@we-wealth.com)
    console.log('Invio form - We Wealth inviera OTP a riccardo.abrami@we-wealth.com...');
    await page.click('button:has-text("Sign Up")');

    // 4. Legge l'OTP dalla Gmail di riccardo.abrami@we-wealth.com
    otp = await getOtpFromGmail(startTime);
    logEntry('OTP ricevuto: ' + otp);

    // 5. Inserisce l'OTP nella pagina (attende il campo OTP)
    await page.waitForSelector('input[name="otp"], input[type="number"], input[placeholder*="OTP"], input[placeholder*="code"], input[placeholder*="codice"]', { state: 'visible', timeout: 15000 });
    await page.fill('input[name="otp"], input[type="number"], input[placeholder*="OTP"], input[placeholder*="code"], input[placeholder*="codice"]', otp);

    // 6. Conferma l'OTP
    await page.click('button[type="submit"]');
    await page.waitForTimeout(4000);

    currentUrl = page.url();
    logEntry('Registrazione completata. URL: ' + currentUrl);

    // 7. Invia email di notifica SUCCESSO
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
