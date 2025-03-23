const axios = require('axios');
const cheerio = require('cheerio');

// Improved email extraction with expanded HR classification and duplicate prevention
// Modified extractEmails function to capture ALL emails, not just HR-related ones
const extractEmails = (html, pageUrl) => {
  // Regular expression for email detection
  const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
  
  // HR-related keywords are kept for classification purposes only
  const hrKeywords = [
    // Basic HR terms
    'hr', 'human', 'resource', 'career', 'job', 'recruit', 'hiring',
    'apply', 'resume', 'cv', 'talent', 'position', 'employment',
    'hr', 'human', 'resource', 'humanresource', 'humanresources', 'h.r', 'h-r', 'h_r',
    
    // Recruiting and hiring
    'career', 'careers', 'job', 'jobs', 'vacancy', 'vacancies', 'opening', 'openings',
    'recruit', 'recruiter', 'recruiting', 'recruitment', 'talent', 'talents', 'talentacquisition',
    'hiring', 'hire', 'onboarding', 'staffing', 'personnel',
    
    // Application related
    'apply', 'application', 'applicant', 'candidate', 'candidates', 'resume', 'resumes', 'cv',
    
    // Position types
    'position', 'employment', 'intern', 'internship', 'jobopportunity',
    
    // Departments and roles
    'placement', 'payroll', 'compensation', 'benefits', 'training', 'development',
    'workforce', 'workday', 'employee', 'employer', 'staff', 'talent', 'people', 'peopleops',
    
    // Common HR email prefixes
    'jobs', 'work', 'career', 'careers', 'jobopportunities', 'joboffer', 'joboffers',
    'join', 'joinus', 'hiringteam', 'hiringmanager', 'talentteam', 'talentacquisition',
    'recruitment', 'recruiting', 'opportunities', 'opportunity', 'employ', 'employment',
    'employer', 'jobportal', 'jobboard', 'careerportal', 'careerpage', 'jobsearch',
    
    // Generic business contact that may handle job inquiries
    'info', 'information', 'contact', 'contactus', 'hello', 'admin', 'administrator',
    
    // Department specific
    'corporate', 'headquarters', 'hq', 'office', 'enquiry', 'inquiry', 'general',
    
    // Application portal related
    'applications', 'applicants', 'apply-now', 'applynow', 'jobapp', 'jobapplication',
    
    // Common formats
    'cv-submission', 'cvsubmission', 'resume-submission', 'resumesubmission'
  ];
  
  // Extract all emails
  let allEmails = html.match(emailRegex) || [];
  allEmails = [...new Set(allEmails)]; // Remove duplicates
  
  // Parse HTML for context analysis
  const $ = cheerio.load(html);
  
  // Store emails with their context
  const emailDetails = [];
  
  // Process each found email
  allEmails.forEach(email => {
    // Check if email appears in an HR-related context (for classification only)
    let isHrRelated = false;
    let context = '';
    
    // Look for elements containing this specific email
    $(`*:contains("${email}")`).each((_, element) => {
      const parentText = $(element).parent().text().trim();
      if (parentText.length > 0 && parentText.length < 500) {
        context = parentText;
        
        // Check if context contains HR keywords (for classification only)
        if (hrKeywords.some(keyword => parentText.toLowerCase().includes(keyword))) {
          isHrRelated = true;
        }
      }
    });
    
    // Check email prefix for HR keywords (for classification only)
    const localPart = email.split('@')[0].toLowerCase();
    if (hrKeywords.some(keyword => localPart.includes(keyword))) {
      isHrRelated = true;
    }
    
    // Common HR email pattern checks (for classification only)
    const commonHrPatterns = [
      /^jobs@/i, /^careers@/i, /^hr@/i, /^recruiting@/i, /^recruitment@/i,
      /^apply@/i, /^applications@/i, /^resumes?@/i, /^cv@/i, /^talent@/i,
      /^employment@/i, /^hiringteam@/i, /^joinus@/i
    ];
    
    if (commonHrPatterns.some(pattern => pattern.test(email))) {
      isHrRelated = true;
    }
    
    // Additional check for numeric-suffixed HR emails (for classification only)
    const hrWithNumberPattern = /^(hr|recruit|career|job|talent|apply|hiring)\d+@/i;
    if (hrWithNumberPattern.test(email)) {
      isHrRelated = true;
    }
    
    // Add ALL emails to the results (not just HR-related ones)
    emailDetails.push({
      email,
      isHrRelated, // Keep the classification for filtering options later
      context: context || 'No context found',
      foundOn: pageUrl
    });
  });
  
  return emailDetails;
};
// Extract all links from a page
const extractLinks = (html, baseUrl) => {
  const $ = cheerio.load(html);
  const links = new Set();
  
  $('a').each((_, element) => {
    let href = $(element).attr('href');
    if (!href) return;
    
    // Clean the URL
    href = href.split('#')[0]; // Remove hash fragments
    if (!href) return;
    
    try {
      // Convert relative URLs to absolute
      const absoluteUrl = new URL(href, baseUrl).href;
      
      // Only include links from the same domain and valid extensions
      const url = new URL(absoluteUrl);
      const baseHostname = new URL(baseUrl).hostname;
      
      if (url.hostname === baseHostname) {
        // Skip file downloads and other non-HTML resources
        const path = url.pathname.toLowerCase();
        if (path.endsWith('.pdf') || path.endsWith('.doc') || path.endsWith('.docx') || 
            path.endsWith('.jpg') || path.endsWith('.png') || path.endsWith('.zip') ||
            path.endsWith('.mp4') || path.endsWith('.mp3')) {
          return;
        }
        
        links.add(absoluteUrl);
      }
    } catch (e) {
      // Invalid URL, skip
    }
  });
  
  return [...links];
};

// Improved page fetcher with retry logic

// Prioritize URLs based on job relevance
// Add this function to your scraper-utils.js file

/**
/**
 * Stores an email in the Supabase database
 * @param {Object} supabase - Supabase client instance
 * @param {Object} emailData - Email data object to store
 * @param {string} emailData.email - The email address
 * @param {string} emailData.source - The source URL where the email was found
 * @param {string} [emailData.context] - Optional context around where the email was found
 * @param {boolean} [emailData.isHrRelated] - Whether the email appears to be HR-related
 * @returns {Promise<Object>} - Result of the database operation
 */



// Memory-optimized email extraction with improved HR detection

// Memory-optimized link extraction

// Improved page fetcher with timeout and memory management
const fetchPage = async (url, retries = 2, timeout = 20000) => {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      console.log(`Fetching: ${url} (Attempt ${attempt + 1}/${retries + 1})`);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      
      const response = await axios.get(url, { 
        timeout: timeout,
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
          'Cache-Control': 'max-age=0'
        },
        maxRedirects: 5,
        maxContentLength: 10 * 1024 * 1024, // 10MB limit to prevent memory issues
        decompress: true
      });
      
      clearTimeout(timeoutId);
      
      // Return only the HTML content, not the full response object
      return response.data;
    } catch (error) {
      const errorMsg = error.code === 'ECONNABORTED' || error.name === 'AbortError'
        ? `Timeout fetching ${url}` 
        : `Error fetching ${url}: ${error.message}`;
      
      console.log(`${errorMsg} (Attempt ${attempt + 1}/${retries + 1})`);
      
      if (attempt === retries) {
        return null;
      }
      
      // Wait before retrying (exponential backoff)
      await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
    }
  }
  
  return null;
};

// Enhanced URL prioritization with better job page detection
const prioritizeUrls = (urls) => {
  const criticalPriority = [];
  const highPriority = [];
  const mediumPriority = [];
  const lowPriority = [];
  
  // Critical priority patterns - expanded to catch more job pages
  const criticalPriorityPatterns = [
    /careers?\/?($|\/)|jobs?\/?($|\/)|work.*?with.*?us\/?$|join.*?us\/?$/i,
    /employment\/?($|\/)|vacancies\/?($|\/)|openings\/?($|\/)|positions\/?($|\/)/i,
    /careers?\.html|jobs?\.html|careers?\.php|jobs?\.php|recruitment|hiring/i,
    /apply.*?now|apply.*?job|join.*?team|careers?.*?page|jobs?.*?page/i
  ];
  
  // High priority patterns - likely to contain job info
  const highPriorityPatterns = [
    /recruit|hiring|apply|application|vacancy|position|opportunity/i,
    /internship|graduate|employment|talent|job.*?listing|career.*?listing/i
  ];
  
  // Medium priority patterns - might contain contact info for HR
  const mediumPriorityPatterns = [
    /contact|about.*?us|team|people|staff|directory|department|meet.*?team/i,
    /our.*?people|who.*?we.*?are|leadership|management|hr.*?team|hr.*?department/i
  ];
  
  // Analyze and categorize each URL
  urls.forEach(url => {
    try {
      const urlLower = url.toLowerCase();
      
      // Check critical patterns first
      if (criticalPriorityPatterns.some(pattern => pattern.test(urlLower))) {
        criticalPriority.push(url);
      } else if (highPriorityPatterns.some(pattern => pattern.test(urlLower))) {
        highPriority.push(url);
      } else if (mediumPriorityPatterns.some(pattern => pattern.test(urlLower))) {
        mediumPriority.push(url);
      } else {
        lowPriority.push(url);
      }
    } catch (e) {
      // If any error in processing, put in low priority
      lowPriority.push(url);
    }
  });
  
  // Return prioritized URLs
  return [...criticalPriority, ...highPriority, ...mediumPriority, ...lowPriority];
};

// Memory-efficient email storage in Supabase
const storeEmailInSupabase = async (supabase, emailData) => {
  try {
    // Trim and normalize data to reduce memory usage
    const normalizedEmail = emailData.email.toLowerCase().trim();
    const normalizedContext = emailData.context ? 
                             emailData.context.slice(0, 500) : 'No context found';
    
    // Check if email already exists to avoid duplicates
    const { data: existingEmails, error: queryError } = await supabase
      .from('emails')
      .select('id')
      .eq('email', normalizedEmail)
      .limit(1); // Limit to 1 to save resources
    
    if (queryError) {
      console.error('Error checking for existing email:', queryError);
      throw queryError;
    }
    
    // If email already exists, don't insert again
    if (existingEmails && existingEmails.length > 0) {
      console.log(`Email already exists: ${normalizedEmail}`);
      return { success: true, status: 'exists', id: existingEmails[0].id };
    }
    
    // Insert the new email with all metadata
    const { data, error } = await supabase
      .from('emails')
      .insert([
        {
          email: normalizedEmail,
          source_url: emailData.source,
          context: normalizedContext,
          is_hr_related: emailData.isHrRelated || false,
          active: 1,
          discovered_at: new Date().toISOString()
        }
      ])
      .select('id'); // Only select ID to reduce data transfer
    
    if (error) {
      console.error('Error storing email in Supabase:', error);
      throw error;
    }
    
    console.log(`Successfully stored email in database: ${normalizedEmail}`);
    return { success: true, status: 'inserted', id: data[0].id };
  } catch (error) {
    console.error('Failed to store email:', error);
    return { success: false, error: error.message };
  }
};

// New function: Memory-efficient web scraper with pagination
const scrapeSiteWithMemoryManagement = async (baseUrl, supabase, maxPages = 50, maxConcurrent = 3) => {
  console.log(`Starting memory-optimized scraping of: ${baseUrl}`);
  
  // Track visited URLs to avoid duplicates
  const visitedUrls = new Set();
  // Track found emails to avoid duplicates
  const foundEmails = new Set();
  // Queue of URLs to visit
  let urlQueue = [];
  // Total emails found
  let totalEmailsFound = 0;
  // Total HR-related emails found
  let totalHrEmailsFound = 0;
  
  try {
    // Initial page fetch
    const htmlContent = await fetchPage(baseUrl);
    if (!htmlContent) {
      console.error(`Failed to fetch the base URL: ${baseUrl}`);
      return { success: false, error: 'Failed to fetch base URL' };
    }
    
    // Mark as visited
    visitedUrls.add(baseUrl);
    
    // Extract and process emails from the base page
    const basePageEmails = extractEmails(htmlContent, baseUrl);
    console.log(`Found ${basePageEmails.length} emails on base page`);
    
    // Store emails from base page
    for (const emailData of basePageEmails) {
      if (!foundEmails.has(emailData.email.toLowerCase())) {
        foundEmails.add(emailData.email.toLowerCase());
        
        // Store in database
        await storeEmailInSupabase(supabase, {
          email: emailData.email,
          source: baseUrl,
          context: emailData.context,
          isHrRelated: emailData.isHrRelated
        });
        
        totalEmailsFound++;
        if (emailData.isHrRelated) totalHrEmailsFound++;
      }
    }
    
    // Extract links from the base page
    const links = extractLinks(htmlContent, baseUrl);
    
    // Prioritize URLs for better discovery
    urlQueue = prioritizeUrls(links);
    
    // Memory management - release references
    const gcTrigger = () => {
      if (global.gc) {
        try {
          global.gc();
          console.log('Manual garbage collection triggered');
        } catch (e) {
          console.error('Failed to trigger garbage collection', e);
        }
      }
    };
    
    // Process the queue with concurrency control
    let pagesScraped = 1; // Count the base page
    let concurrentRequests = 0;
    
    while (urlQueue.length > 0 && pagesScraped < maxPages) {
      // Check if we can start a new request
      if (concurrentRequests >= maxConcurrent) {
        await new Promise(resolve => setTimeout(resolve, 100));
        continue;
      }
      
      // Get the next URL
      const url = urlQueue.shift();
      
      // Skip if already visited
      if (visitedUrls.has(url)) {
        continue;
      }
      
      // Mark as visited
      visitedUrls.add(url);
      
      // Start processing
      concurrentRequests++;
      
      // Use setTimeout to avoid blocking the event loop
      setTimeout(async () => {
        try {
          // Fetch page
          console.log(`Processing ${pagesScraped}/${maxPages}: ${url}`);
          const html = await fetchPage(url);
          
          if (html) {
            // Extract and process emails
            const pageEmails = extractEmails(html, url);
            
            // Log found emails
            if (pageEmails.length > 0) {
              console.log(`Found ${pageEmails.length} emails on ${url}`);
              
              // Store emails
              for (const emailData of pageEmails) {
                if (!foundEmails.has(emailData.email.toLowerCase())) {
                  foundEmails.add(emailData.email.toLowerCase());
                  
                  // Store in database
                  await storeEmailInSupabase(supabase, {
                    email: emailData.email,
                    source: url,
                    context: emailData.context,
                    isHrRelated: emailData.isHrRelated
                  });
                  
                  totalEmailsFound++;
                  if (emailData.isHrRelated) totalHrEmailsFound++;
                }
              }
            }
            
            // Extract new links only if we haven't reached our page limit
            if (pagesScraped < maxPages) {
              const newLinks = extractLinks(html, url);
              
              // Add new links to queue (if not already visited)
              const newFilteredLinks = newLinks.filter(link => !visitedUrls.has(link));
              const prioritizedNewLinks = prioritizeUrls(newFilteredLinks);
              
              // Merge with existing queue, but maintain priority
              urlQueue = [...prioritizedNewLinks.filter(link => !urlQueue.includes(link)), ...urlQueue];
            }
          }
          
          pagesScraped++;
          
          // Periodically trigger garbage collection
          if (pagesScraped % 10 === 0) {
            gcTrigger();
          }
        } catch (error) {
          console.error(`Error processing ${url}:`, error);
        } finally {
          concurrentRequests--;
        }
      }, 0);
      
      // Rate limiting to prevent overloading the server
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    // Wait for all concurrent requests to finish
    while (concurrentRequests > 0) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    console.log(`Scraping complete. Processed ${pagesScraped} pages.`);
    console.log(`Found ${totalEmailsFound} unique emails, ${totalHrEmailsFound} HR-related.`);
    
    return {
      success: true,
      pagesScraped,
      totalEmailsFound,
      totalHrEmailsFound
    };
  } catch (error) {
    console.error('Error in scraping process:', error);
    return { success: false, error: error.message };
  }
};

module.exports = {
  extractEmails,
  extractLinks,
  fetchPage,
  prioritizeUrls,
  storeEmailInSupabase,
  scrapeSiteWithMemoryManagement // Export the new function
};
