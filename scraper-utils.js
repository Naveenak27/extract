const axios = require('axios');
const cheerio = require('cheerio');

// Improved email extraction with expanded HR classification and duplicate prevention
// Modified extractEmails function to capture ALL emails, not just HR-related ones
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
// Add this to your scraper-utils.js file

/**
 * Simulates realistic human-like browsing behavior on a webpage
 * Scrolls naturally from top to bottom, pausing at key points of interest
 * @param {string} url - The URL being visited
 * @returns {Promise<void>}
 */
const simulateHumanBrowsing = async (url) => {
  console.log(`🧑‍💻 Simulating human-like browsing behavior on ${url}`);
  
  // Initial page load pause - humans take time to start reading
  const initialViewTime = Math.floor(Math.random() * 1000) + 1000; // 1-2 seconds
  console.log(`  👀 Looking at the page for ${initialViewTime/1000}s...`);
  await new Promise(resolve => setTimeout(resolve, initialViewTime));
  
  // Simulate sequential scrolling from top to bottom with realistic pauses
  // Most humans start at the top and scroll down gradually
  
  // Determine number of scroll actions based on page size estimation
  // We'll use 5-10 scroll actions for a typical page
  const scrollActions = Math.floor(Math.random() * 5) + 5;
  
  for (let i = 1; i <= scrollActions; i++) {
    // Calculate scroll percentage - gradually move down the page
    const scrollPercent = (i / scrollActions) * 100;
    
    // Log scroll action with emoji to visualize scroll direction
    console.log(`  ⬇️ Scrolling down to ${Math.round(scrollPercent)}% of the page...`);
    
    // Simulate variable scroll speed - humans scroll at different speeds
    // based on content interest (slower at interesting content)
    const scrollTime = Math.floor(Math.random() * 300) + 200; // 200-500ms for scroll motion
    await new Promise(resolve => setTimeout(resolve, scrollTime));
    
    // Pause after scrolling to simulate reading content
    // Longer pauses in the middle sections where main content usually is
    let readingTime;
    if (scrollPercent > 30 && scrollPercent < 70) {
      // Middle of page - where main content is typically found
      // Longer pause to simulate reading main content
      readingTime = Math.floor(Math.random() * 1500) + 1000; // 1-2.5 seconds
      console.log(`  📑 Reading content carefully at ${Math.round(scrollPercent)}% (${readingTime/1000}s)`);
    } else {
      // Top or bottom sections - usually headers/footers/navigation
      // Shorter pause as these areas often have less main content
      readingTime = Math.floor(Math.random() * 500) + 300; // 300-800ms
      console.log(`  👁️ Scanning content at ${Math.round(scrollPercent)}% (${readingTime/1000}s)`);
    }
    await new Promise(resolve => setTimeout(resolve, readingTime));
    
    // Occasionally simulate a user finding something interesting and pausing longer
    if (Math.random() < 0.2) { // 20% chance
      const interestPause = Math.floor(Math.random() * 2000) + 1000; // 1-3 seconds
      console.log(`  🔍 Found something interesting! Pausing for ${interestPause/1000}s...`);
      await new Promise(resolve => setTimeout(resolve, interestPause));
    }
  }
  
  // Sometimes simulate scrolling back up a bit to review something
  if (Math.random() < 0.3) { // 30% chance
    console.log(`  ⬆️ Scrolling back up a bit to review something...`);
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Pause to review content
    const reviewTime = Math.floor(Math.random() * 1500) + 1000;
    console.log(`  🔄 Reviewing previous content (${reviewTime/1000}s)...`);
    await new Promise(resolve => setTimeout(resolve, reviewTime));
    
    // Scroll back down
    console.log(`  ⬇️ Scrolling back down...`);
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  // Final page review - sometimes users spend time at the bottom
  // (contact info, footer links, etc. often contain valuable HR info)
  const finalReviewTime = Math.floor(Math.random() * 1000) + 800; // 0.8-1.8 seconds
  console.log(`  🏁 Reviewing bottom of page for ${finalReviewTime/1000}s...`);
  await new Promise(resolve => setTimeout(resolve, finalReviewTime));
  
  console.log(`  ✅ Completed human-like browsing of ${url}`);
};

/**
 * Enhanced email extraction that processes HTML in a top-down order
 * to better mimic how humans would see emails on a page
 * @param {string} html - The HTML content of the page
 * @param {string} sourceUrl - The URL where this HTML was found
 * @returns {Array} Array of email objects with context
 */
const extractEmails = (html, sourceUrl) => {
  const foundEmails = [];
  const $ = cheerio.load(html);
  
  console.log(`  🔍 Looking for emails in page content (top to bottom)...`);
  
  // Process the body content in document order (top to bottom)
  // This ensures we find emails in the same order a human would see them
  $('body *').each((index, element) => {
    // Get all text nodes within this element
    const textNodes = [];
    
    // Function to collect text nodes in document order
    const collectTextNodes = (node) => {
      if (node.type === 'text') {
        const text = $(node).text().trim();
        if (text) textNodes.push(text);
      } else if (node.children && node.children.length > 0) {
        node.children.forEach(child => collectTextNodes(child));
      }
    };
    
    collectTextNodes(element);
    
    // Process all text nodes for this element
    textNodes.forEach(text => {
      // Look for email patterns
      const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
      const emails = text.match(emailRegex);
      
      if (emails) {
        emails.forEach(email => {
          // Avoid duplicates within this page
          if (!foundEmails.some(e => e.email.toLowerCase() === email.toLowerCase())) {
            // Get surrounding context (the element and its parent for better context)
            const elementHtml = $(element).html();
            const parentHtml = $(element).parent().html();
            const context = elementHtml || parentHtml || text;
            
            // Check if this looks like an HR-related email
            const lowerEmail = email.toLowerCase();
            const lowerContext = context.toLowerCase();
            
            // Calculate the likelihood that this is an HR email
            // Both from email content and surrounding context
            const isHrRelated = 
              // Email patterns common for HR departments
              lowerEmail.includes('hr') || 
              lowerEmail.includes('recruit') || 
              lowerEmail.includes('career') || 
              lowerEmail.includes('job') || 
              lowerEmail.includes('talent') ||
              lowerEmail.includes('people') ||
              lowerEmail.includes('human') ||
              lowerEmail.includes('resource') ||
              lowerEmail.includes('hiring') ||
              lowerEmail.includes('apply') ||
              lowerEmail.includes('application') ||
              // Context patterns that suggest HR content
              lowerContext.includes('human resource') ||
              lowerContext.includes('hr department') ||
              lowerContext.includes('recruitment') ||
              lowerContext.includes('career') ||
              lowerContext.includes('job') ||
              lowerContext.includes('apply') ||
              lowerContext.includes('hiring') ||
              lowerContext.includes('talent') ||
              lowerContext.includes('position') ||
              lowerContext.includes('employment') ||
              lowerContext.includes('opportunity') ||
              lowerContext.includes('application') ||
              lowerContext.includes('resume') ||
              lowerContext.includes('cv');
            
            foundEmails.push({
              email,
              context: truncateContext(context, 200), // Limit context length
              isHrRelated,
              section: getSectionName(element, $) // Get page section (header, main, footer)
            });
            
            // Log discovery with section information
            console.log(`    📧 Found email ${email} in ${getSectionName(element, $)} section (HR: ${isHrRelated ? 'Yes' : 'Possibly'})`);
          }
        });
      }
    });
  });
  
  // Additional processing: if we found emails in what appears to be a contact section
  // but none were flagged as HR, we might want to increase confidence for some of them
  if (foundEmails.length > 0 && !foundEmails.some(e => e.isHrRelated)) {
    // Check if we're on a careers or contact page
    const isCareerPage = /\/(careers?|jobs?|employment|vacancies|opportunities|positions|openings)(\/|\.|$)/i.test(sourceUrl);
    const isContactPage = /\/(contact|about)(\/|\.|$)/i.test(sourceUrl);
    
    if (isCareerPage) {
      console.log(`    📈 Increasing confidence for emails found on careers page`);
      // If we're on a careers page, all emails are likely related to HR
      foundEmails.forEach(email => {
        email.isHrRelated = true;
      });
    } else if (isContactPage && foundEmails.length <= 3) {
      // If on contact page with few emails, the general contact might handle HR
      console.log(`    📊 Contact page with limited emails - marking as potential HR contacts`);
      foundEmails.forEach(email => {
        if (!email.isHrRelated) {
          email.isHrRelated = true;
          email.confidenceNote = "Found on contact page - may handle HR inquiries";
        }
      });
    }
  }
  
  return foundEmails;
};

/**
 * Helper to determine which section of the page an element is in
 * @param {Element} element - The DOM element
 * @param {CheerioStatic} $ - Cheerio instance
 * @returns {string} Section name (header, footer, main content, etc.)
 */
const getSectionName = (element, $) => {
  // Check if element is within common page sections
  const isInHeader = $(element).closest('header, .header, nav, .nav, .navbar, .navigation').length > 0;
  const isInFooter = $(element).closest('footer, .footer').length > 0;
  const isInSidebar = $(element).closest('.sidebar, aside, .aside').length > 0;
  const isInContactSection = $(element).closest('.contact, #contact, [id*=contact], [class*=contact]').length > 0;
  
  if (isInHeader) return 'header';
  if (isInFooter) return 'footer';
  if (isInSidebar) return 'sidebar';
  if (isInContactSection) return 'contact section';
  
  // Check position on page (roughly)
  const elementOffset = $(element).offset();
  if (elementOffset) {
    // This would work in a browser but not in Node.js/Cheerio without additional setup
    // Just a placeholder for the concept
    // const pageHeight = $(document).height();
    // const position = elementOffset.top / pageHeight;
    
    // Fallback approach - check if certain keywords are in parent elements
    const parentText = $(element).parents().text().toLowerCase();
    if (parentText.includes('contact') || parentText.includes('reach us')) return 'contact section';
    if (parentText.includes('about us')) return 'about section';
    if (parentText.includes('careers') || parentText.includes('jobs')) return 'careers section';
  }
  
  return 'main content';
};

/**
 * Helper to truncate context to a reasonable length
 * @param {string} context - The context string
 * @param {number} maxLength - Maximum length to keep
 * @returns {string} Truncated context
 */
const truncateContext = (context, maxLength) => {
  if (context.length <= maxLength) return context;
  return context.substring(0, maxLength) + '...';
};
module.exports = {
  scrapeForHREmails,enhancedFetchPage,
  extractEmails,
  extractLinks,
  fetchPage,
  prioritizeUrls,
  storeEmailInSupabase,
  scrapeSiteWithMemoryManagement // Export the new function
};
