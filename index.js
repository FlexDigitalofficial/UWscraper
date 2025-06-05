/**
 * index.js
 *
 * • Accepts POST /scrape { url: "<targetUrl>" }.
 * • Navigates directly to targetUrl first.
 * • If the returned page contains a login prompt, perform the login,
 *   then navigate again to targetUrl.
 * • Uses puppeteer-extra + stealth plugin to bypass Cloudflare/JS checks.
 * • Finally returns the fully rendered HTML for the job page (or any other URL).
 */

const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
require('dotenv').config();

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
    // 1) Launch Puppeteer-extra with system Chrome
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
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');

    // 2) Try loading targetUrl directly
    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForSelector('body', { timeout: 20000 });

    // 3) Check for an Upwork login prompt
    //    We look for one of two indicators:
    //    - The presence of a login input (e.g. input[name="username"])
    //    - A “Please login” message in the HTML
    const content = await page.content();
    const needsLogin = content.includes('input[name="username"]')
      || content.includes('login_password')
      || content.includes('Please log in')
      || content.includes('account-security/login');

    if (needsLogin && process.env.UPWORK_EMAIL && process.env.UPWORK_PASSWORD) {
      // 4) Perform login only if we detect a login form AND credentials exist
      // 4a) Go to Upwork login
      await page.goto('https://www.upwork.com/ab/account-security/login', {
        waitUntil: 'networkidle2',
        timeout: 60000
      });

      // 4b) Type email and submit (Upwork’s two-step login)
      const emailSelector = 'input[name="username"], input#login_username';
      await page.waitForSelector(emailSelector, { timeout: 20000 });
      await page.type(emailSelector, process.env.UPWORK_EMAIL, { delay: 50 });
      await page.keyboard.press('Enter');

      // 4c) Wait for password field, then type password and submit
      const passwordSelector = 'input[name="password"], input#login_password';
      await page.waitForSelector(passwordSelector, { timeout: 20000 });
      await page.type(passwordSelector, process.env.UPWORK_PASSWORD, { delay: 50 });
      await page.keyboard.press('Enter');

      // 4d) Wait for post-login navigation
      await page.waitForNavigation({
        waitUntil: 'networkidle2',
        timeout: 60000
      });

      // 5) Now that we’re logged in, re‐navigate to the target job URL
      await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 60000 });
      await page.waitForSelector('body', { timeout: 20000 });
    }

    // 6) Grab & return the final HTML
    const finalHtml = await page.content();
    await browser.close();
    return res.status(200).send(finalHtml);

  } catch (err) {
    console.error('Scraping error:', err.message);
    if (browser) await browser.close();
    return res.status(500).json({ error: 'Scraping failed', details: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
