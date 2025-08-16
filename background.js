// Track open Chrome windows
let openWindowCount = 0;

// Track device state and last activity
let lastActivityTimestamp = Date.now();
let deviceSleepThreshold = 5 * 60 * 1000; // 5 minutes
let isDeviceAsleep = false;
let heartbeatInterval = null;

// Session timeout management
let sessionTimeoutThreshold = 5 * 60 * 1000; // 5 minutes
let sessionHardLimit = 12 * 60 * 60 * 1000; // 12 hours
let sessionTimeoutId = null;
let sessionHardLimitId = null;
let lastSessionActivity = Date.now();

// Initialize window count on startup
chrome.windows.getAll({}, (windows) => {
  openWindowCount = windows.length;

  // On startup, check for a gap since last heartbeat to infer device offline
  chrome.storage.local.get(['lastHeartbeat'], (result) => {
    const lastHeartbeat = result.lastHeartbeat || Date.now();
    const now = Date.now();
    const timeSinceLastHeartbeat = now - lastHeartbeat;
    // If more than deviceSleepThreshold has passed, infer device was offline
    if (timeSinceLastHeartbeat > deviceSleepThreshold) {
      logEvent('device_offline_inferred', null, null, {
        offlineStart: lastHeartbeat,
        offlineEnd: now,
        offlineDurationMs: timeSinceLastHeartbeat
      });
    }
    // Continue with normal wakeup and heartbeat logic
    checkForDeviceWakeup();
    startHeartbeat();
  });
  
  // Check for pending blocking updates
  chrome.storage.sync.get(['pendingBlockingUpdate'], (result) => {
    if (result.pendingBlockingUpdate) {
      console.log('Found pending blocking update, applying now');
      updateBlockingRules(result.pendingBlockingUpdate, (success, error) => {
        if (success) {
          console.log('Applied pending blocking rules successfully');
          chrome.storage.sync.remove(['pendingBlockingUpdate']);
        } else {
          console.error('Failed to apply pending blocking rules:', error);
        }
      });
    } else {
      // Normal initialization
      initializeBlockingRules();
    }
  });
}
);
function startHeartbeat() {
  // Clear any existing heartbeat
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
  }
  
  // Check for device sleep and session timeouts every 30 seconds
  heartbeatInterval = setInterval(() => {
    const now = Date.now();
    const timeSinceLastActivity = now - lastActivityTimestamp;
    const timeSinceLastSessionActivity = now - lastSessionActivity;
    
    // Check for session timeout (if we have an active session)
    if (activeDomain && timeSinceLastSessionActivity > sessionTimeoutThreshold) {
      console.log('Heartbeat detected session timeout');
      endSessionDueToInactivity();
    }
    
    // If it's been more than our threshold since last activity, device might be asleep
    if (timeSinceLastActivity > deviceSleepThreshold && !isDeviceAsleep) {
      logEvent('device_sleep_inferred');
      isDeviceAsleep = true;
      
      // Stop tracking current session
      if (activeDomain) {
        logEvent('tab_deactivated', activeDomain, activeTitle);
        // Clear session timeout since device is asleep
        clearSessionTimeout();
        // Don't clear variables - we want to resume when device wakes
      }
    }
    
    // Update last activity timestamp
    lastActivityTimestamp = now;
  }, 30000); // Check every 30 seconds
}

function checkForDeviceWakeup() {
  // Get the last recorded timestamp from storage
  chrome.storage.local.get(['lastHeartbeat'], (result) => {
    const lastHeartbeat = result.lastHeartbeat || Date.now();
    const now = Date.now();
    const timeSinceLastHeartbeat = now - lastHeartbeat;
    
    // If more than deviceSleepThreshold has passed, we likely woke from sleep
    if (timeSinceLastHeartbeat > deviceSleepThreshold) {
      logEvent('device_wakeup_inferred');
      
      // If we had an active session before sleep, restart it
      if (activeDomain) {
        logEvent('tab_activated', activeDomain, activeTitle);
      }
    }
    
    // Update heartbeat timestamp
    chrome.storage.local.set({ lastHeartbeat: now });
    isDeviceAsleep = false;
  });
}

// Update heartbeat on any browser activity
function updateActivity() {
  lastActivityTimestamp = Date.now();
  lastSessionActivity = Date.now();
  chrome.storage.local.set({ lastHeartbeat: lastActivityTimestamp });
  
  // Reset session timeout if we have an active session
  if (activeDomain) {
    resetSessionTimeout();
  }
  
  // If we were asleep and now have activity, device woke up
  if (isDeviceAsleep) {
    logEvent('device_wakeup_inferred');
    isDeviceAsleep = false;
    
    // Resume tracking if we had an active session
    if (activeDomain) {
      logEvent('tab_activated', activeDomain, activeTitle);
    }
  }
}

function resetSessionTimeout() {
  // Clear existing timeout
  if (sessionTimeoutId) {
    clearTimeout(sessionTimeoutId);
    sessionTimeoutId = null;
  }
  
  // Only set timeout if we have an active session
  if (activeDomain) {
    sessionTimeoutId = setTimeout(() => {
      console.log('Session timeout reached - ending session due to inactivity');
      endSessionDueToInactivity();
    }, sessionTimeoutThreshold);
  }
}

function endSessionDueToInactivity() {
  if (activeDomain) {
    console.log(`Ending session for ${activeDomain} due to ${sessionTimeoutThreshold / 1000 / 60} minutes of inactivity`);
    
    // Log session end due to inactivity
    logEvent('session_timeout', activeDomain, activeTitle);
    
    // Clear active session
    activeTabId = null;
    activeDomain = null;
    activeStartTime = null;
    activeTitle = null;
  }
  
  // Clear timeouts
  sessionTimeoutId = null;
  clearSessionHardLimit();
}

function clearSessionTimeout() {
  if (sessionTimeoutId) {
    clearTimeout(sessionTimeoutId);
    sessionTimeoutId = null;
  }
}

function endSessionDueToHardLimit() {
  if (activeDomain) {
    console.log(`Ending session for ${activeDomain} due to 12-hour hard limit reached`);
    
    // Log session end due to hard limit
    logEvent('session_hard_limit', activeDomain, activeTitle);
    
    // Clear active session
    activeTabId = null;
    activeDomain = null;
    activeStartTime = null;
    activeTitle = null;
  }
  
  // Clear timeouts
  sessionHardLimitId = null;
  clearSessionTimeout();
}

function clearSessionHardLimit() {
  if (sessionHardLimitId) {
    clearTimeout(sessionHardLimitId);
    sessionHardLimitId = null;
  }
}

function startSessionHardLimit() {
  // Clear any existing hard limit timer
  clearSessionHardLimit();
  
  // Set new hard limit timer
  sessionHardLimitId = setTimeout(() => {
    endSessionDueToHardLimit();
  }, sessionHardLimit);
  
  console.log(`Started 12-hour session hard limit timer`);
}

chrome.windows.onCreated.addListener(() => {
  updateActivity(); // Mark activity
  if (openWindowCount === 0) {
    logEvent('browser_opened');
  }
  openWindowCount++;
});

chrome.windows.onRemoved.addListener(() => {
  updateActivity(); // Mark activity
  openWindowCount--;
  if (openWindowCount <= 0) {
    stopTracking(); // Properly close out the last active page
    logEvent('browser_closed');
    openWindowCount = 0;
  }
});

// Log browser startup event
chrome.runtime.onStartup.addListener(() => {
  updateActivity(); // Mark activity
  logEvent('browser_startup');
  checkForDeviceWakeup();
  startHeartbeat();
});
// Event-based tracking variables
let activeTabId = null;
let activeStartTime = null;
let activeDomain = null;
let activeTitle = null;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getSettings") {
    chrome.storage.sync.get(['allowedSites'], (result) => {
      sendResponse({
        allowedSites: result.allowedSites || []
      });
    });
    return true;
  }
  // Provide current active session info for popup
  if (request.action === "getActiveSessionInfo") {
    // Return the current active tab's domain, activeStartTime, and title (if any)
    if (activeDomain && activeStartTime) {
      sendResponse({
        domain: activeDomain,
        activeStartTime: activeStartTime,
        title: activeTitle
      });
    } else {
      sendResponse({ domain: null, activeStartTime: null, title: null });
    }
    return true;
  }
  
  // Handle page visibility changes from content scripts
  if (request.action === "pageVisibilityChanged") {
    updateActivity(); // Mark activity
    const domain = getDomainFromUrl(request.url);
    if (domain && domain === activeDomain) {
      if (request.hidden) {
        // Page became hidden - user likely switched away from Chrome
        logEvent('page_hidden', domain, activeTitle);
      } else {
        // Page became visible - user likely switched back to Chrome
        logEvent('page_visible', domain, activeTitle);
      }
    }
    return true;
  }
  
  // Handle extended inactivity from content scripts
  if (request.action === "extendedInactivity") {
    const domain = getDomainFromUrl(request.url);
    if (domain && domain === activeDomain) {
      logEvent('extended_inactivity', domain, activeTitle, request.timestamp);
      // Don't mark as activity - this indicates lack of activity
    }
    return true;
  }
  
  // Handle user activity from content scripts
  if (request.action === "userActivity") {
    updateActivity(); // Mark activity and reset session timeout
    return true;
  }
  
  // Handle window focus/blur from content scripts
  if (request.action === "windowFocus") {
    updateActivity(); // Mark activity
    const domain = getDomainFromUrl(request.url);
    if (domain && domain === activeDomain) {
      logEvent('window_focus', domain, activeTitle);
    }
    return true;
  }
  
  if (request.action === "windowBlur") {
    updateActivity(); // Mark activity
    const domain = getDomainFromUrl(request.url);
    if (domain && domain === activeDomain) {
      logEvent('window_blur', domain, activeTitle);
    }
    return true;
  }
  
  // Handle blocking settings updates
  if (request.action === "updateBlockingRules") {
    // Keep service worker alive during the operation
    const keepAlive = setInterval(() => {}, 25000);
    
    updateBlockingRules(request.settings, (success, error) => {
      clearInterval(keepAlive);
      sendResponse({ success: success, error: error });
    });
    return true; // Keep message channel open for async response
  }
  
  if (request.action === "getTimeData") {
    chrome.storage.local.get(['timeTracking'], (result) => {
      sendResponse({
        timeData: result.timeTracking || {}
      });
    });
    return true;
  }
  
  if (request.action === "getEventLog") {
    chrome.storage.local.get(['eventLog'], (result) => {
      sendResponse({
        eventLog: result.eventLog || {}
      });
    });
    return true;
  }
  
  if (request.action === "debugBlockingRules") {
    chrome.declarativeNetRequest.getDynamicRules((rules) => {
      console.log('Current blocking rules:', rules);
      sendResponse({ rules: rules });
    });
    return true;
  }
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(['allowedSites'], (result) => {
    const defaults = {};
    
    if (!result.allowedSites) {
      defaults.allowedSites = [];
    }
    
    if (Object.keys(defaults).length > 0) {
      chrome.storage.sync.set(defaults);
    }
  });
});

// Initialize blocking rules on startup
chrome.runtime.onStartup.addListener(() => {
  initializeBlockingRules();
});

// Website blocking functionality
function initializeBlockingRules() {
  chrome.storage.sync.get(['blockedSitesList', 'redirectUrl'], (result) => {
    if (result.blockedSitesList && result.blockedSitesList.length > 0) {
      const enabledSites = result.blockedSitesList
        .filter(site => site.enabled !== false)
        .map(site => site.domain);
      
      if (enabledSites.length > 0) {
        updateBlockingRules({
          blockedSites: enabledSites,
          redirectUrl: result.redirectUrl || ''
        }, (success, error) => {
          if (success) {
            console.log('Initial blocking rules loaded successfully');
          } else {
            console.error('Failed to load initial blocking rules:', error);
          }
        });
      }
    }
  });
}

function updateBlockingRules(settings, callback) {
  console.log('Updating blocking rules with settings:', settings);
  
  // Ensure we have valid settings
  if (!settings) {
    console.error('No settings provided');
    if (callback) callback(false, 'No settings provided');
    return;
  }
  
  // Use timeout to prevent hanging
  let responseTimeout = setTimeout(() => {
    console.error('updateBlockingRules timed out');
    if (callback) callback(false, 'Operation timed out');
    callback = null; // Prevent double callback
  }, 10000);
  
  const safeCallback = (success, error) => {
    if (callback) {
      clearTimeout(responseTimeout);
      callback(success, error);
      callback = null;
    }
  };
  
  try {
    // Clear existing rules first
    chrome.declarativeNetRequest.getDynamicRules((rules) => {
      if (chrome.runtime.lastError) {
        console.error('Error getting dynamic rules:', chrome.runtime.lastError);
        safeCallback(false, chrome.runtime.lastError.message);
        return;
      }
      
      const ruleIds = rules.map(rule => rule.id);
      console.log('Removing existing rules:', ruleIds);
      
      const newRules = settings.blockedSites && settings.blockedSites.length > 0 ? 
        createBlockingRules(settings.blockedSites, settings.redirectUrl) : [];
      
      console.log('Adding new rules:', newRules);
      
      chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: ruleIds,
        addRules: newRules
      }, () => {
        if (chrome.runtime.lastError) {
          console.error('Error updating blocking rules:', chrome.runtime.lastError);
          safeCallback(false, chrome.runtime.lastError.message);
        } else {
          console.log('Blocking rules updated successfully. Active rules:', newRules.length);
          safeCallback(true);
        }
      });
    });
  } catch (error) {
    console.error('Exception in updateBlockingRules:', error);
    safeCallback(false, error.message);
  }
}

function normalizeDomain(domain) {
  try {
    // Remove protocol if present
    let normalized = domain.replace(/^https?:\/\//, '');
    
    // Remove www prefix if present
    normalized = normalized.replace(/^www\./, '');
    
    // Remove trailing slash and path
    normalized = normalized.split('/')[0];
    
    // Remove port if present
    normalized = normalized.split(':')[0];
    
    // Convert to lowercase
    normalized = normalized.toLowerCase().trim();
    
    return normalized || null;
  } catch (error) {
    return null;
  }
}

function createBlockingRules(blockedSites, redirectUrl) {
  const rules = [];
  let ruleId = 1;
  
  blockedSites.forEach(domain => {
    // Normalize the domain consistently
    const cleanDomain = normalizeDomain(domain);
    
    if (!cleanDomain) {
      console.warn(`Skipping invalid domain: ${domain}`);
      return;
    }
    
    console.log(`Creating blocking rules for: ${cleanDomain}`);
    
    // Strategy: Create comprehensive rules that catch all variations
    
    // Rule 1: Block exact domain with any path
    rules.push({
      id: ruleId++,
      priority: 1,
      action: redirectUrl ? 
        { type: "redirect", redirect: { url: redirectUrl } } : 
        { type: "block" },
      condition: {
        urlFilter: `||${cleanDomain}`,
        resourceTypes: ["main_frame"]
      }
    });
    
    // Rule 2: Block www version  
    rules.push({
      id: ruleId++,
      priority: 1,
      action: redirectUrl ? 
        { type: "redirect", redirect: { url: redirectUrl } } : 
        { type: "block" },
      condition: {
        urlFilter: `||www.${cleanDomain}`,
        resourceTypes: ["main_frame"]
      }
    });
    
    // Rule 3: Block all subdomains
    rules.push({
      id: ruleId++,
      priority: 1,
      action: redirectUrl ? 
        { type: "redirect", redirect: { url: redirectUrl } } : 
        { type: "block" },
      condition: {
        urlFilter: `||*.${cleanDomain}`,
        resourceTypes: ["main_frame"]
      }
    });
    
    // Rule 4: Alternative pattern using requestDomains (more reliable)
    rules.push({
      id: ruleId++,
      priority: 1,
      action: redirectUrl ? 
        { type: "redirect", redirect: { url: redirectUrl } } : 
        { type: "block" },
      condition: {
        requestDomains: [cleanDomain, `www.${cleanDomain}`],
        resourceTypes: ["main_frame"]
      }
    });
    
    console.log(`Created 4 rules for ${cleanDomain}`);
  });
  
  console.log(`Total blocking rules created: ${rules.length}`);
  console.log('All rules:', JSON.stringify(rules, null, 2));
  return rules;
}

// Event-based logging function
function logEvent(eventType, domain = null, title = null, timestamp = Date.now()) {
  const today = new Date(timestamp).toDateString();
  const event = {
    type: eventType,
    domain: domain,
    title: title,
    timestamp: timestamp
  };

  chrome.storage.local.get(['eventLog'], (result) => {
    const eventLog = result.eventLog || {};
    if (!eventLog[today]) {
      eventLog[today] = [];
    }
    eventLog[today].push(event);
    chrome.storage.local.set({ eventLog: eventLog });
    console.log('Event logged:', event);
  });
}

function getDomainFromUrl(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch (error) {
    return null;
  }
}

function getPageTitle(tabId, callback) {
  if (!tabId) {
    callback(null);
    return;
  }
  
  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError || !tab) {
      callback(null);
      return;
    }
    
    if (isRestrictedUrl(tab.url)) {
      callback(tab.title || 'Restricted Page');
      return;
    }
    
    chrome.tabs.sendMessage(tabId, { action: "getPageTitle" }, (response) => {
      if (chrome.runtime.lastError || !response || !response.title) {
        callback(tab.title || 'Unknown Page');
      } else {
        callback(response.title);
      }
    });
  });
}

function isRestrictedUrl(url) {
  return (
    !url ||
    (url.startsWith('chrome://') && !url.startsWith('chrome://newtab')) ||
    url.startsWith('about:') ||
    url.startsWith('file://')
  );
}

function startTracking(tabId, url) {
  let domain = getDomainFromUrl(url);
  let title = null;
  
  console.log('Starting tracking for tab:', tabId, 'URL:', url);
  // Handle restricted URLs and new tab
  if (url.startsWith('chrome://newtab')) {
    domain = 'chrome://newtab';
    title = 'New Tab';
  } else if (url.startsWith('chrome-extension://')) {
    // For extension pages, use the extension ID as domain and get the title normally
    // Don't override with 'chrome-tab-unknown'
    domain = getDomainFromUrl(url); // Keep the extension ID as domain
    title = null; // Will get actual title from tab
  } else if (isRestrictedUrl(url)) {
    // Only treat as unknown if restricted and NOT an extension page
    domain = 'chrome-tab-unknown';
    title = 'Chrome Tab (Unknown)';
  } else if (!domain) {
    // If no domain, treat as unknown Chrome tab
    domain = 'chrome-tab-unknown';
    title = 'Chrome Tab (Unknown)';
  }

  // Log tab deactivation event for previous tab if there was one
  if (activeDomain) {
    logEvent('tab_deactivated', activeDomain, activeTitle);
  }

  // Update active tracking
  activeTabId = tabId;
  activeDomain = domain;
  activeStartTime = Date.now();
  activeTitle = title;
  lastSessionActivity = Date.now();

  // Only get page title for non-restricted URLs
  if (!title) {
    getPageTitle(tabId, (resolvedTitle) => {
      activeTitle = resolvedTitle;
      logEvent('tab_activated', domain, resolvedTitle);
      // Start session timeout for new session
      resetSessionTimeout();
      // Start hard limit timer for new session
      startSessionHardLimit();
    });
  } else {
    logEvent('tab_activated', domain, title);
    // Start session timeout for new session
    resetSessionTimeout();
    // Start hard limit timer for new session
    startSessionHardLimit();
  }
}

function stopTracking() {
  if (activeDomain) {
    logEvent('tab_closed', activeDomain, activeTitle);
  }
  
  // Clear session timeouts
  clearSessionTimeout();
  clearSessionHardLimit();
  
  activeTabId = null;
  activeDomain = null;
  activeStartTime = null;
  activeTitle = null;
}

// Tab event listeners
chrome.tabs.onActivated.addListener((activeInfo) => {
  updateActivity(); // Mark activity
  chrome.tabs.get(activeInfo.tabId, (tab) => {
    if (tab.url) {
      startTracking(tab.id, tab.url);
    } else {
      stopTracking();
    }
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  updateActivity(); // Mark activity
  if (changeInfo.url && tabId === activeTabId) {
    startTracking(tabId, changeInfo.url);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  updateActivity(); // Mark activity
  if (tabId === activeTabId) {
    stopTracking();
  }
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  updateActivity(); // Mark activity
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    // Browser lost focus
    logEvent('browser_blur');
    if (activeDomain) {
      logEvent('tab_deactivated', activeDomain, activeTitle);
    }
    // Clear active tracking but don't log tab_closed
    activeTabId = null;
    activeDomain = null;
    activeStartTime = null;
    activeTitle = null;
  } else {
    // Browser gained focus
    logEvent('browser_focus');
    chrome.tabs.query({ active: true, windowId: windowId }, (tabs) => {
      if (tabs.length > 0 && tabs[0].url) {
        startTracking(tabs[0].id, tabs[0].url);
      }
    });
  }
});