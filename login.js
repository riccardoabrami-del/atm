const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: true , args: ['--no-sandbox']});
  const page = await browser.newPage();
  // Navigate to we-wealth.com
  await page.goto('https://www.we-wealth.com');
  // Wait for 20 seconds (20000 ms)
  await new Promise(resolve => setTimeout(resolve, 20000));
  // Attempt to accept cookies by clicking a button containing 'Accetta' or 'Accept'
  try {
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const acceptButton = buttons.find(btn => /accetta|accept/i.test(btn.textContent));
      if (acceptButton) acceptButton.click();
    });
  } catch (err) {
    console.error('Could not find or click the accept cookies button:', err);
  }

  // Step 2: Wait for 'Accedi' button and click
   
  try {
      await page.waitForSelector('a[title="Accedi"]', { timeout: 60000 });
      await page.click('a[title="Accedi"]');
  } catch (err) {
      console.error('Could not find or click the Accedi link:', err);
  }

  // Step 2.b: Wait for 'Accedi o registrati' button and click
  try {
      await page.waitForSelector('button#otp-submit-button', { timeout: 60000 });
      await page.click('button#otp-submit-button');
  } catch (err) {
      console.error('Could not find or click the Accedi o registrati button:', err);
    // Close the browser
  await browser.close();
})();

    await page.waitForSelector('a.btn-accedi.otp-popup-button', { timeout: 60000 });
    await page.click('a.btn-accedi.otp-popup-button');
  } catch (err) {
    console.error('Could not find or click the Accedi link:', err);
  }

  // Close the browserr
  await browser.close();
})();
