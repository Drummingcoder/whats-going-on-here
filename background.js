// Track open Chrome windows
let openWindowCount = 0;

// Initialize window count on startup
chrome.windows.getAll({}, (windows) => {
  openWindowCount = windows.length;
});

chrome.windows.onCreated.addListener(() => {
  if (openWindowCount === 0) {
    logEvent('browser_opened');
  }
  openWindowCount++;
});

chrome.windows.onRemoved.addListener(() => {
  openWindowCount--;
  if (openWindowCount <= 0) {
    stopTracking(); // Properly close out the last active page
    logEvent('browser_closed');
    openWindowCount = 0;
  }
});
// Log browser startup event
chrome.runtime.onStartup.addListener(() => {
  logEvent('browser_startup');
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

  // Only get page title for non-restricted URLs
  if (!title) {
    getPageTitle(tabId, (resolvedTitle) => {
      activeTitle = resolvedTitle;
      logEvent('tab_activated', domain, resolvedTitle);
    });
  } else {
    logEvent('tab_activated', domain, title);
  }
}

function stopTracking() {
  if (activeDomain) {
    logEvent('tab_closed', activeDomain, activeTitle);
  }
  
  activeTabId = null;
  activeDomain = null;
  activeStartTime = null;
  activeTitle = null;
}

// Tab event listeners
chrome.tabs.onActivated.addListener((activeInfo) => {
  chrome.tabs.get(activeInfo.tabId, (tab) => {
    if (tab.url) {
      startTracking(tab.id, tab.url);
    } else {
      stopTracking();
    }
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url && tabId === activeTabId) {
    startTracking(tabId, changeInfo.url);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === activeTabId) {
    stopTracking();
  }
});

chrome.windows.onFocusChanged.addListener((windowId) => {
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