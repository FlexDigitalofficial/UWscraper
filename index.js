/**
 * index.js
 *
 * • Accepts POST /scrape { url: "<target>" }.
 * • Navigates to targetUrl using puppeteer-extra + stealth.
 * • If Cloudflare challenge appears, waits for document.title to change from "Just a moment..."
 * and tries to wait for Cloudflare elements to disappear.
 * • If an Upwork login form appears afterward, logs in, re-navigates, and again waits for
 * the title to move away from "Just a moment...".
 * • **Crucially, waits for the main job content to be fully loaded.**
 * • Finally returns the fully rendered HTML of the real job page (or any public page).
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
    console.error('Validation error: Missing URL in request body.');
    return res.status(400).json({ error: 'Missing URL' });
  }

  let browser;
  try {
    console.log(`[SCRAPER] Starting scrape for URL: ${targetUrl}`);
    // 1) Launch headless Chrome with stealth
    browser = await puppeteer.launch({
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/google-chrome-stable',
      headless: true, // true for production, false for local debugging
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--single-process'
      ]
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    page.setDefaultTimeout(90000); // 90 seconds default timeout for all page operations

    // 2) Go to the target URL (Upwork job or any public page)
    console.log(`[SCRAPER] Navigating to target URL: ${targetUrl}`);
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 120000 }); // Longer initial goto timeout

    // 3) If title is "Just a moment...", we're stuck on Cloudflare's challenge page.
    let title = await page.title();
    console.log(`[SCRAPER] Initial page title: "${title}"`);

    if (title.includes('Just a moment')) {
      console.log('[SCRAPER] Cloudflare challenge detected. Waiting for resolution...');
      // Wait up to 60s for the title to change away from "Just a moment..."
      await page.waitForFunction(
        () => !document.title.includes('Just a moment'),
        { timeout: 60000 } // Increased timeout for title change
      ).catch(e => console.log(`[SCRAPER] Timeout waiting for title to change from Cloudflare: ${e.message}`));

      // Try to wait for common Cloudflare wrapper elements to disappear
      try {
        await page.waitForSelector('#cf-wrapper', { hidden: true, timeout: 20000 });
        console.log('[SCRAPER] Cloudflare #cf-wrapper disappeared.');
      } catch (e) {
        console.log(`[SCRAPER] Cloudflare #cf-wrapper did not disappear or was not found (might be normal): ${e.message}`);
      }

      try {
        await page.waitForSelector('input[type="checkbox"][name="cf_challenge_response"]', { hidden: true, timeout: 20000 });
        console.log('[SCRAPER] Cloudflare checkbox disappeared.');
      } catch (e) {
        console.log(`[SCRAPER] Cloudflare checkbox did not disappear or was not found (might be normal): ${e.message}`);
      }

      // After initial Cloudflare resolution, give the page a moment to load and settle
      await page.waitForTimeout(5000); // Wait 5 seconds for content to render and initial JS to run
      console.log('[SCRAPER] Finished initial waiting for Cloudflare elements.');
      title = await page.title(); // Re-check title after waiting
      console.log(`[SCRAPER] Page title after Cloudflare wait: "${title}"`);

      // After Cloudflare, wait for network to become idle, meaning all initial content should be loaded
      console.log('[SCRAPER] Waiting for network to be idle after Cloudflare...');
      await page.waitForLoadState('networkidle0', { timeout: 45000 }).catch(e => console.log(`[SCRAPER] Timeout waiting for network idle after Cloudflare: ${e.message}`));
    }


    // --- CRUCIAL ADDITION FOR WAITING FOR RENDERED CONTENT ---
    // This is the most important part for getting the fully rendered page.
    // You need to find a CSS selector for an element that *only appears*
    // when the job description or main content is fully loaded.
    //
    // Common examples:
    // - '.job-description-content'
    // - '#job-details-container'
    // - '.job-title'
    // - 'h1.job-title'
    //
    // For now, I'll use a generic one. You might need to inspect the Upwork job page HTML
    // (after it's fully loaded in your own browser) to find the best selector.
    const jobContentSelector = 'h1.job-title, div[data-test="job-details"]'; // Common Upwork selectors example
    console.log(`[SCRAPER] Waiting for main job content selector: "${jobContentSelector}"`);
    try {
        await page.waitForSelector(jobContentSelector, { timeout: 60000 }); // Wait up to 60 seconds for this element
        console.log(`[SCRAPER] Main job content selector "${jobContentSelector}" found. Page should be fully rendered.`);
    } catch (e) {
        console.warn(`[SCRAPER] Warning: Main job content selector "${jobContentSelector}" not found within timeout. Page might not be fully rendered. Error: ${e.message}`);
    }

    // Give a final brief moment for any last-minute rendering or animations
    await page.waitForTimeout(2000); // 2 seconds final settle time

    // 4) Grab the fully rendered HTML.
    let html = await page.content();
    console.log(`[SCRAPER] Content length after waiting for rendering: ${html.length} bytes.`);

    // 5) Check if the Upwork login form is present (for private jobs)
    const loginFormPresent = html.includes('input[name="username"]') || html.includes('input#login_username') || html.includes('input[data-test="username-input"]');
    const loginContinueButtonPresent = html.includes('button[type="submit"]') || html.includes('button#login_password_continue') || html.includes('button[data-test="login-button"]');

    if (loginFormPresent && loginContinueButtonPresent && process.env.UPWORK_EMAIL && process.env.UPWORK_PASSWORD) {
      console.log('[SCRAPER] Upwork login form detected. Attempting to log in...');
      try {
        await page.type('input[name="username"]', process.env.UPWORK_EMAIL, { delay: 50 });
        await page.click('button[type="submit"]'); // Assumes this button proceeds from email to password
        await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 });

        await page.waitForSelector('input[name="password"]', { timeout: 20000 });
        await page.type('input[name="password"]', process.env.UPWORK_PASSWORD, { delay: 50 });
        await page.click('button[type="submit"]'); // Assumes this button logs in
        await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 90000 }); // Wait for navigation after login
        console.log('[SCRAPER] Successfully logged into Upwork (hopefully).');

      } catch (loginErr) {
        console.error(`[SCRAPER] Upwork login failed: ${loginErr.message}`);
        // If login fails, we'll proceed to the final HTML capture, which might still be the login page
      }

      // 5b) Re‐navigate to the original target URL (job page) after login
      console.log(`[SCRAPER] Re-navigating to target URL after login: ${targetUrl}`);
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });

      // 5c) Check for Cloudflare once more (rare after login but possible)
      title = await page.title();
      if (title.includes('Just a moment')) {
        console.log('[SCRAPER] Cloudflare challenge detected AFTER LOGIN. Waiting for resolution...');
        await page.waitForFunction(
          () => !document.title.includes('Just a moment'),
          { timeout: 60000 }
        ).catch(e => console.log(`[SCRAPER] Timeout waiting for title to change after login Cloudflare: ${e.message}`));
        try {
          await page.waitForSelector('#cf-wrapper', { hidden: true, timeout: 20000 });
        } catch (e) { /* ignore */ }
        await page.waitForTimeout(5000);
        await page.waitForLoadState('networkidle0', { timeout: 45000 }).catch(e => console.log(`[SCRAPER] Timeout waiting for network idle after login Cloudflare: ${e.message}`));
      }

      // Re-wait for the job content selector after re-navigation
      console.log(`[SCRAPER] Re-waiting for main job content selector after login: "${jobContentSelector}"`);
      try {
          await page.waitForSelector(jobContentSelector, { timeout: 60000 });
          console.log(`[SCRAPER] Main job content selector "${jobContentSelector}" found after login.`);
      } catch (e) {
          console.warn(`[SCRAPER] Warning: Main job content selector "${jobContentSelector}" not found after login. Page might not be fully rendered. Error: ${e.message}`);
      }
      await page.waitForTimeout(2000);

      // 5d) Grab the final HTML after login & Cloudflare bypass
      html = await page.content();
      console.log(`[SCRAPER] Final content length after login and Cloudflare check: ${html.length} bytes.`);
    } else if (loginFormPresent || loginContinueButtonPresent) {
      console.log('[SCRAPER] Upwork login form detected, but UPWORK_EMAIL or UPWORK_PASSWORD environment variables are missing. Skipping login.');
    } else {
      console.log('[SCRAPER] Upwork login form not detected or credentials not required.');
    }

    await browser.close();
    console.log('[SCRAPER] Browser closed. Sending response.');
    return res.status(200).send(html);

  } catch (err) {
    console.error(`[SCRAPER] Critical scraping error: ${err.message}`);
    if (browser) {
      try {
        const pages = await browser.pages();
        if (pages.length > 0) {
          const currentPage = pages[0];
          const screenshotPath = `/tmp/error_screenshot_${Date.now()}.png`; // Use /tmp for Render's ephemeral storage
          await currentPage.screenshot({ path: screenshotPath });
          console.error(`[SCRAPER] Screenshot taken on error (check /tmp for local runs): ${screenshotPath}`);
        }
      } catch (screenshotError) {
        console.error(`[SCRAPER] Failed to take screenshot on error: ${screenshotError.message}`);
      }
      await browser.close();
    }
    return res.status(500).json({ error: 'Scraping failed', details: err.message, screenshot_info: 'Screenshot might be available if run locally' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.
