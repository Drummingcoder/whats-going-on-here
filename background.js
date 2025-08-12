// Time tracking variables
let activeTabId = null;
let activeStartTime = null;
let activeDomain = null;
let awayStartTime = null;
let isAwayTracking = false;

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
    // Return the current active tab's domain, startTime, and elapsed time (if any)
    if (activeDomain && activeStartTime) {
      sendResponse({
        domain: activeDomain,
        startTime: activeStartTime,
        elapsed: Date.now() - activeStartTime
      });
    } else {
      sendResponse({ domain: null, startTime: null, elapsed: 0 });
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
  
  if (request.action === "getSessionHistory") {
    chrome.storage.local.get(['sessionHistory'], (result) => {
      sendResponse({
        sessionHistory: result.sessionHistory || {}
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

// Time tracking functions
function getDomainFromUrl(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch (error) {
    return null;
  }
}

function saveTimeSpent(domain, timeSpent, startTime) {
  if (!domain || timeSpent < 1000) return; // Ignore very short sessions (less than 1 second)

  // Helper to save session with title
  function saveSessionWithTitle(title) {
    console.log('Saving session with title:', title);
    chrome.storage.local.get(['timeTracking', 'sessionHistory'], (result) => {
      const timeData = result.timeTracking || {};
      const sessionHistory = result.sessionHistory || {};
      const today = new Date().toDateString();
      const endTime = startTime + timeSpent;

      // Store session history for both pie charts and block schedules
      if (!sessionHistory[today]) {
        sessionHistory[today] = [];
      }
      sessionHistory[today].push({
        domain: domain,
        title: title,
        startTime: startTime,
        endTime: endTime,
        duration: timeSpent,
        timestamp: new Date(startTime).toISOString()
      });

      // Keep existing total tracking for backwards compatibility
      if (!timeData[today]) {
        timeData[today] = {};
      }
      if (!timeData[today][domain]) {
        timeData[today][domain] = 0;
      }
      timeData[today][domain] += timeSpent;

      chrome.storage.local.set({ 
        timeTracking: timeData,
        sessionHistory: sessionHistory
      });
    });
  }

  // For 'away-from-chrome', no tab, so no title
  if (domain === 'away-from-chrome') {
    saveSessionWithTitle('Away from Chrome');
    return;
  }

  // Try to get the tabId from activeTabId
  const tabId = typeof activeTabId === 'number' ? activeTabId : null;
  function isRestrictedUrl(url) {
    return (
      !url ||
      url.startsWith('chrome://') ||
      url.startsWith('chrome-extension://') ||
      url.startsWith('about:') ||
      url.startsWith('file://')
    );
  }

  if (tabId) {
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError || !tab || isRestrictedUrl(tab.url)) {
        saveSessionWithTitle(domain);
        return;
      }
      chrome.tabs.sendMessage(tabId, { action: "getPageTitle" }, (response) => {
        if (chrome.runtime.lastError || !response || !response.title) {
          saveSessionWithTitle(domain);
        } else {
          saveSessionWithTitle(response.title);
        }
      });
    });
  } else {
    // Fallback: try to get any active tab
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length > 0 && !isRestrictedUrl(tabs[0].url)) {
        chrome.tabs.sendMessage(tabs[0].id, { action: "getPageTitle" }, (response) => {
          if (chrome.runtime.lastError || !response || !response.title) {
            saveSessionWithTitle(domain);
          } else {
            saveSessionWithTitle(response.title);
          }
        });
      } else {
        saveSessionWithTitle(domain);
      }
    });
  }
}

function startTracking(tabId, url) {
  const domain = getDomainFromUrl(url);
  if (!domain) return;
  
  // Save time for previous domain if there was one
  if (activeDomain && activeStartTime) {
    const timeSpent = Date.now() - activeStartTime;
    saveTimeSpent(activeDomain, timeSpent, activeStartTime);
  }
  
  // Start tracking new domain
  activeTabId = tabId;
  activeDomain = domain;
  activeStartTime = Date.now();
}

function stopTracking() {
  if (activeDomain && activeStartTime) {
    const timeSpent = Date.now() - activeStartTime;
    saveTimeSpent(activeDomain, timeSpent, activeStartTime);
  }
  activeTabId = null;
  activeDomain = null;
  activeStartTime = null;
  // Stop away tracking if running
  if (isAwayTracking && awayStartTime) {
    const timeSpent = Date.now() - awayStartTime;
    saveTimeSpent('away-from-chrome', timeSpent, awayStartTime);
    awayStartTime = null;
    isAwayTracking = false;
  }
}

// Tab event listeners
chrome.tabs.onActivated.addListener((activeInfo) => {
  chrome.tabs.get(activeInfo.tabId, (tab) => {
    if (tab.url && !tab.url.startsWith('chrome://')) {
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
    // Browser lost focus: stop tab tracking, start away tracking
    stopTracking();
    if (!isAwayTracking) {
      awayStartTime = Date.now();
      isAwayTracking = true;
    }
  } else {
    // Browser gained focus: stop away tracking, resume tab tracking
    if (isAwayTracking && awayStartTime) {
      const timeSpent = Date.now() - awayStartTime;
      saveTimeSpent('away-from-chrome', timeSpent, awayStartTime);
      awayStartTime = null;
      isAwayTracking = false;
    }
    chrome.tabs.query({ active: true, windowId: windowId }, (tabs) => {
      if (tabs.length > 0 && tabs[0].url && !tabs[0].url.startsWith('chrome://')) {
        startTracking(tabs[0].id, tabs[0].url);
      }
    });
  }
});