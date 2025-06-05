/**
 * index.js
 *
 * • Accepts POST /scrape { url: "<targetUrl>" }.
 * • If targetUrl contains "upwork.com/jobs/", Puppeteer does an Upwork login first,
 *   using selectors that match the current Upwork login page.
 * • Uses puppeteer-extra + stealth plugin to bypass Cloudflare/“Just a moment…” gates.
 * • Returns the fully rendered HTML of the target page.
 */

const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
require('dotenv').config();

// Install the stealth plugin to hide headless signals
puppeteer.use(StealthPlugin());

const app = express();
app.use(express.json());

app.post('/scrape', async (req, res) => {
  const targetUrl = req.body.url;
  if (!targetUrl) {
    return res.status(400).json({ error: 'Missing URL' });
  }

  let browser;
  try {
    // 1) Launch Puppeteer-extra using system Chrome
    browser = await puppeteer.launch({
      executablePath: '/usr/bin/google-chrome-stable',
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage'
      ]
    });

    const page = await browser.newPage();
    // Spoof desktop user agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');

    // 2) Only do the Upwork login if the URL is an Upwork job
    if (targetUrl.includes('upwork.com/jobs/')) {
      // 2a) Go to Upwork login
      await page.goto('https://www.upwork.com/ab/account-security/login', {
        waitUntil: 'networkidle2',
        timeout: 60000
      });

      // 2b) Wait for the email/username input (handles both new and legacy selectors)
      const emailSelector = 'input[name="username"], input#login_username';
      await page.waitForSelector(emailSelector, { timeout: 20000 });
      await page.type(emailSelector, process.env.UPWORK_EMAIL, { delay: 50 });

      // 2c) Click the “Next” or “Submit” button to proceed to password step
      // This catches either a button[type="submit"] or a data-test login button
      const nextButtonSelector =
        'button[type="submit"], button[data-test="log-in-button"]';
      await page.click(nextButtonSelector);

      // 2d) Wait for the password input to appear (handles both selectors)
      const passwordSelector = 'input[name="password"], input#login_password';
      await page.waitForSelector(passwordSelector, { timeout: 20000 });
      await page.type(passwordSelector, process.env.UPWORK_PASSWORD, { delay: 50 });

      // 2e) Click the final “Submit” / “Log In” button
      await page.click(nextButtonSelector);
      // 2f) Wait for navigation after login
      await page.waitForNavigation({
        waitUntil: 'networkidle2',
        timeout: 60000
      });
    }

    // 3) Navigate to the target URL (Upwork job or any public page)
    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    // 4) Wait for <body> so we know the page is fully rendered
    await page.waitForSelector('body', { timeout: 20000 });

    // 5) Grab and return the rendered HTML
    const html = await page.content();
    await browser.close();
    return res.status(200).send(html);

  } catch (err) {
    console.error('Scraping error:', err.message);
    if (browser) await browser.close();
    return res.status(500).json({ error: 'Scraping failed', details: err.message });
  }
});

// Start the Express server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
