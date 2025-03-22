const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const { extractEmails, extractLinks, fetchPage, prioritizeUrls, storeEmailInSupabase } = require('./scraper-utils');

// Initialize Supabase client
const SUPABASE_URL = 'https://iweptmijpkljukcmroxv.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY; // Make sure to set this in your environment
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Bulk processing endpoint
// At the top of your file, before other requires
require('dotenv').config();
router.post('/scrape-bulk', async (req, res) => {
  try {
    const { urls, maxPagesPerSite = 50 } = req.body;
    
    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({ error: 'URLs array is required' });
    }
    
    // Initial response to let client know we've started processing
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Transfer-Encoding': 'chunked'
    });
    
    // Send initial status
    res.write(JSON.stringify({
      status: 'started',
      totalUrls: urls.length,
      processed: 0
    }) + '\n');
    
    const allResults = [];
    const errors = [];
    let totalEmailsStoredInDb = 0;
    
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      
      try {
        // Setup scraping for this URL
        console.log(`Processing bulk URL ${i+1}/${urls.length}: ${url}`);
        
        // Update client on progress
        res.write(JSON.stringify({
          status: 'processing',
          currentUrl: url,
          processed: i,
          totalUrls: urls.length
        }) + '\n');
        
        // Validate URL
        try {
          new URL(url);
        } catch (e) {
          console.log(`Invalid URL format: ${url}`);
          errors.push({ url, error: 'Invalid URL format' });
          
          // Send validation error to frontend
          res.write(JSON.stringify({
            status: 'urlError',
            url,
            error: 'Invalid URL format',
            processed: i + 1,
            totalUrls: urls.length
          }) + '\n');
          
          continue;
        }
        
        // Track progress for this specific URL
        const urlStartTime = Date.now();
        const processedUrls = new Set();
        let urlsToProcess = [url];
        const foundEmails = [];
        // Track unique emails per site
        const uniqueEmails = new Set();
        let pagesScanned = 0;
        let emailsStoredForThisUrl = 0;
        
        // Send interim email updates to frontend
        const sendInterimEmailUpdate = (emails, emailsStoredCount) => {
          if (emails.length > 0) {
            res.write(JSON.stringify({
              status: 'interimEmailUpdate',
              url,
              currentProgress: {
                pagesScanned, 
                emailsFound: emails.length,
                emailsStored: emailsStoredCount
              },
              emailsFound: emails.map(item => item.email)
            }) + '\n');
          }
        };
        
        // Process pages for this URL
        while (urlsToProcess.length > 0 && pagesScanned < maxPagesPerSite) {
          // Sort URLs by priority
          urlsToProcess = prioritizeUrls(urlsToProcess);
          
          const currentUrl = urlsToProcess.shift();
          
          if (processedUrls.has(currentUrl)) {
            continue;
          }
          
          processedUrls.add(currentUrl);
          pagesScanned++;
          
          // Fetch page content
          const html = await fetchPage(currentUrl);
          
          if (!html) {
            console.log(`Failed to fetch: ${currentUrl}`);
            continue;
          }
          
          // Extract emails from this page
          const emailsOnPage = extractEmails(html, currentUrl);
          
          // Keep track of new emails found on this page
          const newEmailsFound = [];
          let newEmailsStored = 0;
          
          if (emailsOnPage.length > 0) {
            // Process each email
            for (const item of emailsOnPage) {
              const lowerCaseEmail = item.email.toLowerCase();
              if (!uniqueEmails.has(lowerCaseEmail)) {
                uniqueEmails.add(lowerCaseEmail);
                foundEmails.push(item);
                newEmailsFound.push(item);
                
                // Store email in Supabase
                try {
                  const storageResult = await storeEmailInSupabase(supabase, {
                    email: lowerCaseEmail,
                    source: item.source,
                    context: item.context || null
                  });
                  
                  if (storageResult.success && storageResult.status === 'inserted') {
                    newEmailsStored++;
                    emailsStoredForThisUrl++;
                    totalEmailsStoredInDb++;
                  }
                } catch (dbError) {
                  console.error(`Database error for ${lowerCaseEmail}:`, dbError);
                }
              }
            }
            
            // Send interim email update if we found new emails
            if (newEmailsFound.length > 0) {
              sendInterimEmailUpdate(newEmailsFound, newEmailsStored);
            }
          }
          
          // Get links to other pages on the same site
          const links = extractLinks(html, currentUrl);
          
          // Add new links to the processing queue
          for (const link of links) {
            if (!processedUrls.has(link) && !urlsToProcess.includes(link)) {
              urlsToProcess.push(link);
            }
          }
          
          // Send periodic progress update every 5 pages
          if (pagesScanned % 5 === 0 || urlsToProcess.length === 0) {
            res.write(JSON.stringify({
              status: 'progressUpdate',
              url,
              pagesScanned,
              totalEmailsFound: foundEmails.length,
              emailsStored: emailsStoredForThisUrl,
              processed: i,
              totalUrls: urls.length,
              remainingPages: urlsToProcess.length
            }) + '\n');
          }
        }
        
        // Add to overall results
        const urlResult = {
          url,
          pagesScanned,
          totalEmailsFound: foundEmails.length,
          emailsStored: emailsStoredForThisUrl,
          scanDurationSeconds: Math.floor((Date.now() - urlStartTime) / 1000),
          emails: foundEmails
        };
        
        allResults.push(urlResult);
        
        // Send URL completion update with ALL emails from this URL
        res.write(JSON.stringify({
          status: 'urlCompleted',
          url,
          pagesScanned,
          emailsFound: foundEmails.length,
          emailsStored: emailsStoredForThisUrl,
          processed: i + 1,
          totalUrls: urls.length,
          // Include all details for the frontend
          emails: foundEmails,
          result: urlResult
        }) + '\n');
        
      } catch (error) {
        console.error(`Error processing ${url}:`, error);
        errors.push({ url, error: error.message });
        
        // Send error to frontend
        res.write(JSON.stringify({
          status: 'urlError',
          url,
          error: error.message,
          processed: i + 1,
          totalUrls: urls.length
        }) + '\n');
      }
    }
    
    // Send final results
    res.write(JSON.stringify({
      status: 'completed',
      results: allResults,
      errors,
      totalProcessed: urls.length,
      totalEmailsFound: allResults.reduce((acc, curr) => acc + curr.totalEmailsFound, 0),
      totalEmailsStored: totalEmailsStoredInDb
    }));
    
    res.end();
    
  } catch (error) {
    console.error('Bulk scraping error:', error);
    
    // If headers weren't sent yet
    if (!res.headersSent) {
      return res.status(500).json({ 
        error: 'Failed to process bulk scraping', 
        message: error.message 
      });
    } else {
      // If we've already started streaming, send error in stream
      res.write(JSON.stringify({
        status: 'error',
        error: error.message
      }));
      res.end();
    }
  }
});

module.exports = router;