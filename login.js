// login.js - We Wealth: registrazione + email di notifica a fine lavoro
// Dipendenze: npm install playwright nodemailer
//
// Variabili d'ambiente richieste:
//   WW_PASSWORD        - password usata per la registrazione
//   NOTIFY_EMAIL       - indirizzo a cui inviare la notifica (es. riccardo.abrami@gmail.com)
//   SMTP_USER          - email Gmail/SMTP mittente (es. bot@gmail.com)
//   SMTP_PASS          - App Password Gmail del mittente
//
// Esegui: node login.js

const { chromium } = require('playwright');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

// --- Genera numero casuale a 3 cifre ---
function randomSuffix() {
  return String(Math.floor(Math.random() * 1000)).padStart(3, '0');
}

// --- Salva log su file ---
function logEntry(text) {
  const logFile = path.join(__dirname, 'registrations.log');
  const entry = new Date().toISOString() + ' - ' + text + '\n';
  fs.appendFileSync(logFile, entry);
  console.log(entry.trim());
}

// --- Invia email di notifica via Gmail SMTP ---
async function sendNotification({ success, email, url, error }) {
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const notifyEmail = process.env.NOTIFY_EMAIL;

  if (!smtpUser || !smtpPass || !notifyEmail) {
    console.warn('ATTENZIONE: variabili SMTP_USER, SMTP_PASS o NOTIFY_EMAIL mancanti. Email non inviata.');
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
    <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto">
      <h2 style="background:${colore};color:#fff;padding:12px 20px;border-radius:6px;">
        ATM Bot - ${stato}
      </h2>
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="padding:8px;border-bottom:1px solid #eee;"><b>Timestamp</b></td><td style="padding:8px;border-bottom:1px solid #eee;">${timestamp}</td></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #eee;"><b>Email registrata</b></td><td style="padding:8px;border-bottom:1px solid #eee;">${email}</td></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #eee;"><b>URL finale</b></td><td style="padding:8px;border-bottom:1px solid #eee;">${url || '-'}</td></tr>
        ${error ? '<tr><td style="padding:8px;color:#e74c3c;"><b>Errore</b></td><td style="padding:8px;color:#e74c3c;">' + error + '</td></tr>' : ''}
      </table>
      <p style="color:#888;font-size:12px;margin-top:20px;">Generato automaticamente da ATM Bot</p>
    </div>
  `;

  await transporter.sendMail({
    from: smtpUser,
    to: notifyEmail,
    subject: `[ATM Bot] Registrazione We Wealth - ${stato} - ${email}`,
    html,
  });

  console.log('Email di notifica inviata a:', notifyEmail);
}

// --- Script principale ---
(async () => {
  const suffix = randomSuffix();
  const email = 'riccardo.abrami+' + suffix + '@we-wealth.com';
  const password = process.env.WW_PASSWORD || 'Password' + suffix + '!';
  let currentUrl = '';

  logEntry('Inizio registrazione con email: ' + email);

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log('Apertura pagina di registrazione...');
    await page.goto('https://www.we-wealth.com/en/registrazione');
    await page.waitForSelector('#fname', { state: 'visible' });

    // Compila il form
    await page.fill('#fname', 'Riccardo');
    await page.fill('#lname', 'Abrami');
    await page.fill('#email', email);
    await page.fill('#password', password);
    await page.fill('#city', 'Milano');
    await page.selectOption('#role', 'Investor');
    await page.check('#terms');

    console.log('Invio form...');
    await page.click('button:has-text("Sign Up")');
    await page.waitForTimeout(4000);

    currentUrl = page.url();
    logEntry('Registrazione completata. URL: ' + currentUrl);

    // Invia email di notifica SUCCESSO
    await sendNotification({ success: true, email, url: currentUrl });

  } catch (err) {
    currentUrl = page.url();
    logEntry('ERRORE: ' + err.message);

    // Invia email di notifica ERRORE
    await sendNotification({ success: false, email, url: currentUrl, error: err.message });

  } finally {
    await browser.close();
    console.log('Browser chiuso.');
  }
})();
