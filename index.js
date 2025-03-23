require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const { scrapeForHREmails } = require('./scraper-utils');
const { extractEmails, extractLinks, fetchPage, prioritizeUrls, storeEmailInSupabase } = require('./scraper-utils');
const bulkScraper = require('./bulk-scraper');

const app = express();
const PORT = process.env.PORT || 5000;

// Initialize Supabase client
const SUPABASE_URL = 'https://iweptmijpkljukcmroxv.supabase.co';

const SUPABASE_KEY = process.env.SUPABASE_KEY; // Make sure to set this in your environment
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// At the top of your file, before other requires

// Middleware
app.use(cors());
app.use(express.json());

// Main scraping endpoint
app.post('/scrape', async (req, res) => {
  try {
    const { 
      url, 
      maxPages = 100, 
      thoroughScan = false, 
      onlyHrEmails = true 
    } = req.body;
    
    // Input validation
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }
    
    // Validate URL
    try {
      new URL(url);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid URL format' });
    }
    
    // Adjust scan depth based on thoroughScan flag
    const scanOptions = {
      maxPages: thoroughScan ? 300 : maxPages,
      maxConcurrent: thoroughScan ? 3 : 5,
      thoroughScan,
      onlyHrEmails
    };
    
    console.log('='.repeat(50));
    console.log(`STARTING HUMAN-LIKE HR EMAIL SCRAPER: ${url}`);
    console.log(`Maximum pages to scan: ${scanOptions.maxPages}`);
    console.log(`Thorough scan mode: ${thoroughScan ? 'ENABLED' : 'DISABLED'}`);
    console.log(`Human-like browsing: ENABLED`);
    console.log(`HR focus: ${onlyHrEmails ? 'EXCLUSIVE' : 'PRIORITIZED'}`);
    console.log('='.repeat(50));
    
    // Execute the enhanced human-like scraper
    const results = await scrapeForHREmails(url, supabase, scanOptions);
    
    // Add timestamp to results
    results.timestamp = new Date().toISOString();
    
    // Log scan summary
    if (results.success) {
      console.log('='.repeat(50));
      console.log('SCAN COMPLETED SUCCESSFULLY');
      console.log('='.repeat(50));
      console.log(`Pages scanned: ${results.stats.pagesScanned}`);
      console.log(`HR emails found: ${results.stats.hrEmailsFound}`);
      console.log(`Potential HR emails: ${results.stats.potentialHrEmailsFound}`);
      console.log(`Scan duration: ${results.stats.scanDurationSeconds} seconds`);
      
      // Log email domains
      if (results.emailsByDomain) {
        console.log("\nEmails by domain:");
        Object.entries(results.emailsByDomain).forEach(([domain, emails]) => {
          console.log(`  @${domain}: ${emails.length} email(s)`);
        });
      }
      
      console.log('='.repeat(50));
    } else {
      console.log('='.repeat(50));
      console.log('SCAN FAILED');
      console.log(`Error: ${results.error}`);
      console.log('='.repeat(50));
    }
    
    return res.json(results);
  } catch (error) {
    console.error('Error in scraper controller:', error);
    return res.status(500).json({ 
      success: false, 
      error: 'Failed to scrape website', 
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});
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
