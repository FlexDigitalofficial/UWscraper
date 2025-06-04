/**
 * index.js
 *
 * This Express server:
 *   1) Accepts POST /scrape { url: "<target>" }
 *   2) Uses puppeteer-core and the system Chrome (installed via apt) to navigate and fetch HTML.
 *   3) (Optional) You can insert a login flow before scraping Upwork URLs if authentication is required.
 */

const express = require('express');
const puppeteer = require('puppeteer-core');
require('dotenv').config();

const app = express();
app.use(express.json());

app.post('/scrape', async (req, res) => {
  const targetUrl = req.body.url;
  if (!targetUrl) {
    return res.status(400).json({ error: 'Missing URL' });
  }

  let browser;
  try {
    // 1) Launch Puppeteer pointing to the system Chrome binary in /usr/bin/google-chrome-stable
    browser = await puppeteer.launch({
      executablePath: '/usr/bin/google-chrome-stable',
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    // Spoof a common desktop UA
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');

    // --- OPTIONAL LOGIN FLOW FOR UPWORK (uncomment if needed) ---
    // await page.goto('https://www.upwork.com/ab/account-security/login', { waitUntil: 'networkidle2', timeout: 60000 });
    // await page.fill('input#login_username', process.env.UPWORK_EMAIL);
    // await page.fill('input#login_password', process.env.UPWORK_PASSWORD);
    // await page.click('button[type="submit"]');
    // await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 });
    // -----------------------------------------------------------

    // 2) Navigate to the target URL (Upwork job page or any public URL)
    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    // Wait for <body> so we know the page’s HTML is fully loaded
    await page.waitForSelector('body', { timeout: 20000 });

    // 3) Grab and return the rendered HTML
    const html = await page.content();
    await browser.close();
    return res.status(200).send(html);

  } catch (err) {
    console.error('Scraping error:', err.message);
    if (browser) await browser.close();
    return res.status(500).json({ error: 'Scraping failed', details: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));