const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const { extractEmails, extractLinks, fetchPage, prioritizeUrls, storeEmailInSupabase } = require('./scraper-utils');
const bulkScraper = require('./bulk-scraper');

const app = express();
const PORT = process.env.PORT || 5000;

// Initialize Supabase client
const SUPABASE_URL = 'https://iweptmijpkljukcmroxv.supabase.co';

const SUPABASE_KEY = process.env.SUPABASE_KEY; // Make sure to set this in your environment
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// At the top of your file, before other requires
require('dotenv').config();

// Middleware
app.use(cors());
app.use(express.json());

// Main scraping endpoint
app.post('/scrape', async (req, res) => {
  try {
    const { url, maxPages = 100 } = req.body;
    
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }
    
    // Validate URL
    try {
      new URL(url);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid URL format' });
    }
    
    console.log('='.repeat(50));
    console.log(`STARTING COMPLETE WEBSITE SCAN: ${url}`);
    console.log(`Maximum pages to scan: ${maxPages}`);
    console.log('='.repeat(50));
    
    // Track progress
    const startTime = Date.now();
    let totalEmailsFound = 0;
    let emailsStoredInDb = 0;
    
    // Store processed URLs to avoid duplicates
    const processedUrls = new Set();
    let urlsToProcess = [url];
    const foundEmails = [];
    const errors = [];
    
    // Use a Set to track unique emails (case insensitive)
    const uniqueEmails = new Set();
    
    // First pass: focus on career/job pages
    console.log('PHASE 1: Scanning job and career-related pages');
    let pagesScanned = 0;
    
    while (urlsToProcess.length > 0 && pagesScanned < maxPages) {
      // Sort URLs by priority (career/job pages first)
      urlsToProcess = prioritizeUrls(urlsToProcess);
      
      const currentUrl = urlsToProcess.shift();
      
      if (processedUrls.has(currentUrl)) {
        continue;
      }
      
      processedUrls.add(currentUrl);
      pagesScanned++;
      
      // Progress update
      console.log(`[${pagesScanned}/${maxPages}] Processing: ${currentUrl}`);
      
      // Add a small delay to avoid overwhelming the server
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Fetch page content
      const html = await fetchPage(currentUrl);
      
      if (!html) {
        errors.push(`Failed to fetch: ${currentUrl}`);
        continue;
      }
      
      // Extract emails from this page
      const emailsOnPage = extractEmails(html, currentUrl);
      
      if (emailsOnPage.length > 0) {
        // Check each email for uniqueness before adding
        let newEmailsCount = 0;
        
        // Process each email
        for (const item of emailsOnPage) {
          const lowerCaseEmail = item.email.toLowerCase();
          if (!uniqueEmails.has(lowerCaseEmail)) {
            uniqueEmails.add(lowerCaseEmail);
            foundEmails.push(item);
            newEmailsCount++;
            
            // Store email in Supabase
            try {
              const storageResult = await storeEmailInSupabase(supabase, {
                email: lowerCaseEmail,
                source: item.source,
                context: item.context || null
              });
              
              if (storageResult.success) {
                if (storageResult.status === 'inserted') {
                  emailsStoredInDb++;
                  console.log(`  ✓ Stored in database: ${lowerCaseEmail}`);
                } else {
                  console.log(`  • Already in database: ${lowerCaseEmail}`);
                }
              } else {
                console.log(`  ✗ Failed to store in database: ${lowerCaseEmail} - ${storageResult.error}`);
              }
            } catch (dbError) {
              console.error(`  ✗ Database error for ${lowerCaseEmail}:`, dbError);
            }
          }
        }
        
        totalEmailsFound += newEmailsCount;
        console.log(`  Found ${newEmailsCount} new email(s) on this page`);
      }
      
      // Get links to other pages on the same site
      const links = extractLinks(html, currentUrl);
      
      // Add new links to the processing queue
      for (const link of links) {
        if (!processedUrls.has(link) && !urlsToProcess.includes(link)) {
          urlsToProcess.push(link);
        }
      }
      
      // Progress report
      const elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
      console.log(`  Progress: ${pagesScanned}/${maxPages} pages | ${totalEmailsFound} unique emails | ${emailsStoredInDb} stored in DB | ${elapsedSeconds}s elapsed`);
    }
    
    // Final scan report
    const totalTimeSeconds = Math.floor((Date.now() - startTime) / 1000);
    console.log('='.repeat(50));
    console.log('SCAN COMPLETED');
    console.log('='.repeat(50));
    console.log(`Total pages scanned: ${pagesScanned}`);
    console.log(`Total unique emails found: ${totalEmailsFound}`);
    console.log(`Total emails stored in database: ${emailsStoredInDb}`);
    console.log(`Scan duration: ${totalTimeSeconds} seconds`);
    console.log(`Pages per second: ${(pagesScanned / totalTimeSeconds).toFixed(2)}`);
    
    if (errors.length > 0) {
      console.log(`Errors encountered: ${errors.length}`);
    }
    
    console.log('='.repeat(50));
    
    // Group emails by domain for analysis
    const emailsByDomain = foundEmails.reduce((acc, item) => {
      const domain = item.email.split('@')[1];
      if (!acc[domain]) {
        acc[domain] = [];
      }
      acc[domain].push(item.email);
      return acc;
    }, {});
    
    // Return the results
    return res.json({ 
      success: true,
      stats: {
        pagesScanned,
        totalEmailsFound: foundEmails.length,
        emailsStoredInDb,
        scanDurationSeconds: totalTimeSeconds
      },
      emailDetails: foundEmails,
      emailsByDomain,
      errors: errors.length > 0 ? errors : undefined
    });    
  } catch (error) {
    console.error('Scraping error:', error);
    return res.status(500).json({ 
      error: 'Failed to scrape website', 
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Status endpoint to check if server is running
app.get('/status', (req, res) => {
  res.json({ status: 'Server is running' });
});

// Register the bulk scraper routes
app.use(bulkScraper);

// Start the server
app.listen(PORT, () => {
  console.log(`Email scraper server running on port ${PORT}`);
  console.log(`Server ready to scan websites for emails and store them in Supabase`);
});