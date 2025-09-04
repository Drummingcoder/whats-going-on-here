let openWindowCount = 0;

// last activity
let lastActivityTimestamp = Date.now();
let isDeviceAsleep = false;
let heartbeatInterval = null;

// Session timeout management
let sessionTimeout = 300000; // 5 minutes
let sessionHardLimit = 43200000; // 12 hours
let sessionTimeoutId = null;
let sessionHardLimitId = null;
let lastSessionActivity = Date.now();
let lastSessionDate = (new Date()).toDateString();

// Event-based tracking variables
let activeTabId = null;
let activeStartTime = null;
let activeDomain = null;
let activeTitle = null;

// Track active sessions by tab ID
let activeSessionsByTab = new Map();

/* Event Listeners */
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(['allowedSites', 'blockedSitesList', 'blockingScheduleRules', 'blockingPassword', 'redirectUrl'], (result) => {
    const defaults = {};
    if (!result.allowedSites) {
      defaults.allowedSites = [];
    }
    if (!result.blockedSitesList) {
      defaults.blockedSitesList = [];
    }
    if (!result.blockingScheduleRules) {
      defaults.blockingScheduleRules = [];
    }
    if (!result.blockingPassword) {
      defaults.blockingPassword = '';
    }
    if (!result.redirectUrl) {
      defaults.redirectUrl = '';
    }
    if (Object.keys(defaults).length > 0) {
      chrome.storage.sync.set(defaults);
    }
  });
  chrome.storage.local.get(['eventLog', 'timeTracking', 'lastHeartbeat'], (result) => {
    const localDefaults = {};
    if (!result.eventLog) {
      localDefaults.eventLog = {};
    }
    if (!result.timeTracking) {
      localDefaults.timeTracking = {};
    }
    if (!result.lastHeartbeat) {
      localDefaults.lastHeartbeat = Date.now();
    }
    if (Object.keys(localDefaults).length > 0) {
      chrome.storage.local.set(localDefaults);
    }
  });
});

chrome.windows.getAll({}, (windows) => {
  openWindowCount = windows.length;

  chrome.storage.local.get(['lastHeartbeat'], (result) => {
    const lastHeartbeat = result.lastHeartbeat || Date.now();
    if (Date.now() - lastHeartbeat > sessionTimeout) {
      logEvent('device_offline_inferred', null, null, lastHeartbeat + sessionTimeout);

      // Issue a device_shutdown event and stop tracking 5 minutes after the last heartbeat
      const shutdownTimestamp = lastHeartbeat + sessionTimeout;
      chrome.storage.local.get(['persistedSession'], (result) => {
        const persisted = result.persistedSession;
        if (persisted && persisted.domain) {
          logEvent('device_shutdown', persisted.domain, persisted.title, shutdownTimestamp);
          stopTracking();
        }
      });
    }
    updateActivity();
    startHeartbeat();
    addEndOfDayEvents();
  });
  
  chrome.storage.sync.get(['pendingBlockingUpdate'], (result) => {
    if (result.pendingBlockingUpdate) {
      console.log('Found pending blocking update, applying now');
      updateBlockingRules(result.pendingBlockingUpdate, (success, error) => {
        if (success) {
          chrome.storage.sync.remove(['pendingBlockingUpdate']);
        } else {
          console.error('Failed to apply pending blocking rules:', error);
        }
      });
    } else {
      initializeBlockingRules();
    }
  });
  
  initializeActiveTabTracking();
}
);

chrome.runtime.onStartup.addListener(() => {
  updateActivity();
  logEvent('browser_startup');
  startHeartbeat();
  initializeBlockingRules();
  initializeActiveTabTracking();
});

chrome.windows.onCreated.addListener(() => {
  updateActivity();
  if (openWindowCount === 0) {
    logEvent('browser_opened');
  }
  openWindowCount++;
});

chrome.windows.onRemoved.addListener(() => {
  updateActivity();
  openWindowCount--;
  if (openWindowCount <= 0) {
    stopTracking();
    logEvent('browser_closed');
    openWindowCount = 0;
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getSettings") {
    chrome.storage.sync.get(['allowedSites'], (result) => {
      sendResponse({
        allowedSites: result.allowedSites || []
      });
    });
    return true;
  }
  
  if (request.action === "getActiveSessionInfo") {
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

    if (request.action === "getEventLog") {
    chrome.storage.local.get(['eventLog'], (result) => {
      sendResponse({
        eventLog: result.eventLog || {}
      });
    });
    return true;
  }

  if (request.action === "getTabSessionInfo" && request.tabId) { //to be fixed
    const session = activeSessionsByTab.get(request.tabId);
    
    if (session) {
      sendResponse({
        domain: session.domain,
        startTime: session.startTime,
        title: session.title
      });
    } else {
      if (request.tabId === activeTabId && activeDomain && activeStartTime) {
        activeSessionsByTab.set(request.tabId, {
          domain: activeDomain,
          startTime: activeStartTime,
          title: activeTitle
        });
        sendResponse({
          domain: activeDomain,
          startTime: activeStartTime,
          title: activeTitle
        });
      } else {
        sendResponse({ domain: null, startTime: null, title: null });
      }
    }
    return true;
  }
  
  // Handle content script messages
  if (request.action === "pageVisibilityChanged") {
    updateActivity();
    const domain = getDomainFromUrl(request.url);
    if (domain && domain === activeDomain) {
      if (request.hidden) {
        logEvent('page_hidden', domain, activeTitle);
      } else {
        logEvent('page_visible', domain, activeTitle);
      }
    }
    return true;
  }
  if (request.action === "extendedInactivity") {
    const domain = getDomainFromUrl(request.url);
    if (domain && domain === activeDomain) {
      logEvent('extended_inactivity', domain, activeTitle, request.timestamp);
    }
    return true;
  }
  if (request.action === "windowFocus") {
    updateActivity();
    const domain = getDomainFromUrl(request.url);
    if (domain && domain === activeDomain) {
      logEvent('window_focus', domain, activeTitle);
    }
    return true;
  }  
  if (request.action === "windowBlur") {
    updateActivity();
    const domain = getDomainFromUrl(request.url);
    if (domain && domain === activeDomain) {
      logEvent('window_blur', domain, activeTitle);
    }
    return true;
  }
  
  if (request.action === "updateBlockingRules") {
    const keepAlive = setInterval(() => {}, 25000);
    
    updateBlockingRules(request.settings, (success, error) => {
      clearInterval(keepAlive);
      sendResponse({ success: success, error: error });
    });
    return true;
  }
});

// Tab event listeners
chrome.tabs.onActivated.addListener((activeInfo) => {
  updateActivity();
  chrome.tabs.get(activeInfo.tabId, (tab) => {
    if (tab.url) {
      startTracking(tab.id, tab.url);
    }
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  updateActivity();
  if (changeInfo.url && tabId === activeTabId) {
    startTracking(tabId, changeInfo.url);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  updateActivity();
  if (tabId === activeTabId) {
    stopTracking();
  }
  activeSessionsByTab.delete(tabId);
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  updateActivity();
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    logEvent('browser_blur');
    if (activeDomain) {
      logEvent('tab_deactivated', activeDomain, activeTitle);
    }
    activeTabId = null;
    activeDomain = null;
    activeStartTime = null;
    activeTitle = null;
  } else {
    logEvent('browser_focus');
    chrome.tabs.query({ active: true, windowId: windowId }, (tabs) => {
      if (tabs.length > 0 && tabs[0].url) {
        startTracking(tabs[0].id, tabs[0].url);
      }
    });
  }
});

/* Core Tracking Functions */

// Update heartbeat on any browser activity
function updateActivity() {
  const now = Date.now();
  lastActivityTimestamp = now;
  lastSessionActivity = now;

  // Heartbeat gap detection (moved from logEvent)
  chrome.storage.local.get(['lastHeartbeat', 'persistedSession'], (result) => {
    const lastHeartbeat = result && typeof result.lastHeartbeat === 'number' ? result.lastHeartbeat : null;
    if (lastHeartbeat !== null) {
      const timeSinceLastHeartbeat = now - lastHeartbeat;
      if (timeSinceLastHeartbeat > sessionTimeout) {
        // Only issue shutdown if we had an active session
        const persisted = result && result.persistedSession ? result.persistedSession : null;
        if (persisted && typeof persisted === 'object' && persisted.domain) {
          const shutdownTimestamp = lastHeartbeat + sessionTimeout;
          logEvent('device_shutdown', persisted.domain, persisted.title, shutdownTimestamp);
          chrome.storage.local.remove('persistedSession', () => {
            if (chrome.runtime && chrome.runtime.lastError) {
              console.warn('Failed to remove persistedSession:', chrome.runtime.lastError.message);
            }
          });
        }
      }
    }
    chrome.storage.local.set({ lastHeartbeat: now }, () => {
      if (chrome.runtime && chrome.runtime.lastError) {
        console.warn('Failed to set lastHeartbeat:', chrome.runtime.lastError.message);
      }
    });
  });

  // --- Additional session safety checks ---
  try {
    // Session inactivity (timeout)
    if (activeDomain && typeof lastSessionActivity === 'number') {
      const timeSinceLastSessionActivity = now - lastSessionActivity;
      if (timeSinceLastSessionActivity > sessionTimeout) {
        console.log('updateActivity: Session timeout detected');
        endSessionDueToInactivity();
      }
    }
    // Session day rollover
    const currentDateString = (new Date()).toDateString();
    if (activeDomain && currentDateString !== lastSessionDate) {
      console.log('updateActivity: Session day rollover detected');
      endSessionDueToDay('day_rollover');
      lastSessionDate = currentDateString;
    }
    // Session hard limit
    if (activeDomain && typeof activeStartTime === 'number') {
      if (now - activeStartTime > sessionHardLimit) {
        console.log('updateActivity: Session hard limit reached');
        endSessionDueToHardLimit();
      }
    }
  } catch (e) {
    console.warn('Session safety checks failed:', e);
  }

  // Reset session timeout if we have an active session
  if (activeDomain) {
    try {
      resetSessionTimeout();
    } catch (e) {
      console.warn('Failed to reset session timeout:', e);
    }
  }

  // If we were asleep and now have activity, device woke up
  if (isDeviceAsleep) {
    try {
      logEvent('device_wakeup_inferred');
      isDeviceAsleep = false;
      if (activeDomain) {
        logEvent('tab_activated', activeDomain, activeTitle);
      }
    } catch (e) {
      console.warn('Failed to log device wakeup:', e);
    }
  }

  // Add end_of_day events for previous days if needed
  try {
    addEndOfDayEvents();
  } catch (e) {
    console.warn('Failed to add end_of_day events:', e);
  }
}


// Event-based logging function
function logEvent(eventType, domain = null, title = null, timestamp = Date.now()) {
  // Only log the event (heartbeat gap detection is now in updateActivity)
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

function initializeActiveTabTracking() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs.length > 0) {
      const tab = tabs[0];
      if (tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://')) {
        console.log('Initializing tracking for active tab on startup:', tab.id, tab.url);
        startTracking(tab.id, tab.url);
      }
    }
  });
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
  
  continueStartTracking(tabId, domain, title);
}

function continueStartTracking(tabId, domain, title) {

  // Log tab deactivation event for previous tab if there was one
  if (activeDomain) {
    logEvent('tab_deactivated', activeDomain, activeTitle);
  }

  // Check if we're already tracking this tab with the same domain
  const existingSession = activeSessionsByTab.get(tabId);
  let sessionStartTime;
  
  if (existingSession && existingSession.domain === domain) {
    // Keep existing start time for same tab/domain
    sessionStartTime = existingSession.startTime;
    console.log('Preserving existing session for tab', tabId, 'domain:', domain, 'startTime:', new Date(sessionStartTime).toLocaleTimeString());
  } else {
    // New session - use current time
    sessionStartTime = Date.now();
    console.log('Starting new session for tab', tabId, 'domain:', domain, 'startTime:', new Date(sessionStartTime).toLocaleTimeString());
  }

  // Update active tracking
  activeTabId = tabId;
  activeDomain = domain;
  activeStartTime = sessionStartTime;
  activeTitle = title;
  lastSessionActivity = Date.now();
  lastSessionDate = (new Date()).toDateString();

  // Track this session in our tab map
  activeSessionsByTab.set(tabId, {
    domain: domain,
    startTime: sessionStartTime,
    title: title
  });

  // Persist session info in storage
  chrome.storage.local.set({
    persistedSession: {
      domain: activeDomain,
      title: activeTitle,
      startTime: activeStartTime,
      startDate: lastSessionDate
    }
  });

  // Always try to get the actual page title
  chrome.tabs.get(tabId, (tab) => {
    if (tab && tab.title) {
      const finalTitle = tab.title;
      activeTitle = finalTitle;
      // Update the session map with the actual title
      if (activeSessionsByTab.has(tabId)) {
        const session = activeSessionsByTab.get(tabId);
        session.title = finalTitle;
        activeSessionsByTab.set(tabId, session);
        console.log('Updated session title for tab', tabId, 'to:', finalTitle);
      }
      logEvent('tab_activated', domain, finalTitle);
    } else if (!title) {
      // Fallback to getPageTitle for non-restricted URLs
      getPageTitle(tabId, (resolvedTitle) => {
        activeTitle = resolvedTitle;
        // Update the session map with the resolved title
        if (activeSessionsByTab.has(tabId)) {
          const session = activeSessionsByTab.get(tabId);
          session.title = resolvedTitle;
          activeSessionsByTab.set(tabId, session);
        }
        logEvent('tab_activated', domain, resolvedTitle);
      });
    } else {
      logEvent('tab_activated', domain, title);
    }
    
    // Start session timeout for new session
    resetSessionTimeout();
    // Start hard limit timer for new session
    startSessionHardLimit();
  });
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

  // Remove persisted session info
  chrome.storage.local.remove('persistedSession');
}

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
    const currentDateString = (new Date()).toDateString();

    // Log a heartbeat event every interval
    updateActivity();

    // Check for any persisted session from a previous day
    chrome.storage.local.get(['persistedSession'], (result) => {
      const persisted = result.persistedSession;
      if (persisted && persisted.startDate && persisted.startDate !== currentDateString) {
        // End the old session
        console.log('Ending stale session from previous day:', persisted.domain);
        endSessionDueToDay('end_of_day', persisted.domain, persisted.title);
      }
    });
    // If the date has changed, end the session at midnight
    if (activeDomain && currentDateString !== lastSessionDate) {
      console.log('Ending session due to day rollover');
      endSessionDueToDay('day_rollover');
      lastSessionDate = currentDateString;
      // Optionally, you could start a new session here if user is still active
      return;
    }

    // Check for session timeout (if we have an active session)
    if (activeDomain && timeSinceLastSessionActivity > sessionTimeout) {
      console.log('Heartbeat detected session timeout');
      endSessionDueToInactivity();
    }

    // If it's been more than our threshold since last activity, device might be asleep
    if (timeSinceLastActivity > sessionTimeout && !isDeviceAsleep) {
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

    // Check and update blocking rules based on schedule (every minute)
    const currentMinute = Math.floor(now / 60000);
    const lastMinute = Math.floor(lastActivityTimestamp / 60000);
    if (currentMinute !== lastMinute) {
      updateBlockingBasedOnSchedule();
    }

    // Update last activity timestamp
    lastActivityTimestamp = now;
  }, 30000); // Check every 30 seconds
}

/* End Session Functions */

// Add end_of_day events for all dates that don't have them
function addEndOfDayEvents() {
  chrome.storage.local.get(['eventLog'], (result) => {
    const eventLog = result.eventLog || {};
    const today = new Date().toDateString();
    let modified = false;

    // Go through each date with activity
    Object.keys(eventLog).forEach(dateString => {
      // Skip today - we don't want to add end_of_day for current day
      if (dateString === today) {
        return;
      }

      const dayEvents = eventLog[dateString];
      if (!dayEvents || dayEvents.length === 0) {
        return;
      }

      // Check if this date already has an end_of_day event
      const hasEndOfDay = dayEvents.some(event => 
        event.type === 'end_of_day' || 
        event.type === 'browser_closed' || 
        event.type === 'session_day_rollover'
      );

      if (!hasEndOfDay) {
        // Find the last event of the day to get the domain/title
        const lastEvent = dayEvents[dayEvents.length - 1];
        
        // Create end of day timestamp (11:59:59 PM of that date)
        const dateObj = new Date(dateString);
        dateObj.setHours(23, 59, 59, 999);
        const endOfDayTimestamp = dateObj.getTime();

        // Add end_of_day event
        const endOfDayEvent = {
          type: 'end_of_day',
          domain: lastEvent.domain || null,
          title: lastEvent.title || null,
          timestamp: endOfDayTimestamp
        };

        dayEvents.push(endOfDayEvent);
        modified = true;
        console.log(`Added end_of_day event for ${dateString}`);
      }
    });

    // Save the updated event log if any changes were made
    if (modified) {
      chrome.storage.local.set({ eventLog: eventLog }, () => {
        console.log('End of day events added successfully');
      });
    }
  });
}

// Unified function to end sessions due to day changes
function endSessionDueToDay(reason = 'day_rollover', domain = null, title = null) {
  const sessionDomain = activeDomain || domain;
  const sessionTitle = activeTitle || title;
  
  if (sessionDomain) {
    console.log(`Ending session for ${sessionDomain} due to ${reason}`);
    
    // Log appropriate event based on reason
    if (reason === 'day_rollover') {
      logEvent('session_day_rollover', sessionDomain, sessionTitle);
    } else {
      logEvent('end_of_day', sessionDomain, sessionTitle);
    }
    
    // Clear active session variables
    activeTabId = null;
    activeDomain = null;
    activeStartTime = null;
    activeTitle = null;
  }
  
  // Clear timeouts and persisted session
  clearSessionTimeout();
  clearSessionHardLimit();
  chrome.storage.local.remove('persistedSession');
}

function endSessionDueToInactivity() {
  if (activeDomain) {
    console.log(`Ending session for ${activeDomain} due to ${sessionTimeout / 1000 / 60} minutes of inactivity`);

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

  // Remove persisted session info
  chrome.storage.local.remove('persistedSession');
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

  // Remove persisted session info
  chrome.storage.local.remove('persistedSession');
}

/* Timeout Functions */

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
    }, sessionTimeout);
  }
}

function clearSessionTimeout() {
  if (sessionTimeoutId) {
    clearTimeout(sessionTimeoutId);
    sessionTimeoutId = null;
  }
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

/* Helper Functions */
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

// Website blocking functionality
let updateBlockingTimeout = null;

function getSitesToBlockNow() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['blockedSitesList', 'blockingScheduleRules'], (result) => {
      const blockedSites = result.blockedSitesList || [];
      const scheduleRules = result.blockingScheduleRules || [];
      
      console.log('getSitesToBlockNow - blockedSites:', blockedSites);
      console.log('getSitesToBlockNow - scheduleRules:', scheduleRules);
      
      const enabledSites = blockedSites
        .filter(site => site.enabled !== false)
        .map(site => site.domain);
      
      console.log('getSitesToBlockNow - enabledSites:', enabledSites);
      
      // If no schedule rules exist, block all enabled sites 24/7
      if (scheduleRules.length === 0) {
        console.log('getSitesToBlockNow - No schedule rules, blocking all enabled sites 24/7:', enabledSites);
        resolve(enabledSites);
        return;
      }
      
      const now = new Date();
      const currentDay = now.getDay(); // 0=Sunday, 1=Monday, etc.
      const currentTime = now.getHours() * 60 + now.getMinutes(); // Minutes since midnight
      
      // Option B: Block all enabled sites 24/7 unless a schedule rule exists for that site
      const sitesToBlock = new Set();

      enabledSites.forEach(site => {
        // Normalize site for comparison
        const normalizedSite = normalizeDomain(site);
        // Find all schedule rules that include this site (normalize for comparison)
        const siteRules = scheduleRules.filter(rule =>
          rule.websites && rule.websites.some(w => normalizeDomain(w) === normalizedSite)
        );
        console.log(`Checking site: ${site} (normalized: ${normalizedSite})`);
        if (siteRules.length === 0) {
          // No schedule rules for this site: block 24/7
          sitesToBlock.add(site);
        } else {
          // There are schedule rules for this site: only block if any rule matches now
          let shouldBlock = false;
          for (const rule of siteRules) {
            if (!rule.days.includes(currentDay)) continue;
            const [startHour, startMin] = rule.startTime.split(':').map(n => parseInt(n));
            const [endHour, endMin] = rule.endTime.split(':').map(n => parseInt(n));
            const startTime = startHour * 60 + startMin;
            const endTime = endHour * 60 + endMin;
            const isInTimeRange = (startTime <= endTime)
              ? (currentTime >= startTime && currentTime <= endTime)
              : (currentTime >= startTime || currentTime <= endTime); // Handle overnight ranges
            if (isInTimeRange) {
              shouldBlock = true;
              break;
            }
          }
          if (shouldBlock) {
            sitesToBlock.add(site);
          }
        }
      });

      console.log('getSitesToBlockNow - Sites to block (Option B):', Array.from(sitesToBlock));
      resolve(Array.from(sitesToBlock));
    });
  });
}

function updateBlockingBasedOnSchedule() {
  chrome.storage.sync.get(['redirectUrl'], (result) => {
    getSitesToBlockNow().then(sitesToBlock => {
      updateBlockingRules({
        blockedSites: sitesToBlock,
        redirectUrl: result.redirectUrl || ''
      }, (success, error) => {
        if (success) {
          console.log('Blocking rules updated based on schedule');
        } else {
          console.error('Failed to update blocking rules based on schedule:', error);
        }
      });
    });
  });
}

function initializeBlockingRules() {
  chrome.storage.sync.get(['redirectUrl'], (result) => {
    getSitesToBlockNow().then(sitesToBlock => {
      if (sitesToBlock.length > 0) {
        updateBlockingRules({
          blockedSites: sitesToBlock,
          redirectUrl: result.redirectUrl || ''
        }, (success, error) => {
          if (success) {
            console.log('Initial blocking rules loaded successfully');
          } else {
            console.error('Failed to load initial blocking rules:', error);
          }
        });
      } else {
        // Clear all blocking rules if no sites should be blocked now
        updateBlockingRules({
          blockedSites: [],
          redirectUrl: result.redirectUrl || ''
        }, () => {
          console.log('No sites to block at this time');
        });
      }
    });
  });
}

function updateBlockingRules(settings, callback) {
  console.log('updateBlockingRules called with settings:', settings);
  
  // Clear any existing timeout to prevent multiple rapid updates
  if (updateBlockingTimeout) {
    clearTimeout(updateBlockingTimeout);
  }
  
  // Debounce the update to prevent race conditions
  updateBlockingTimeout = setTimeout(() => {
    performBlockingRulesUpdate(settings, callback);
  }, 100);
}

function performBlockingRulesUpdate(settings, callback) {
  console.log('performBlockingRulesUpdate called with settings:', settings);
  
  // Ensure we have valid settings
  if (!settings) {
    console.error('No settings provided');
    if (callback) callback(false, 'No settings provided');
    return;
  }
  
  console.log('performBlockingRulesUpdate - Sites to block:', settings.blockedSites);
  console.log('performBlockingRulesUpdate - Redirect URL:', settings.redirectUrl);
  
  // Use timeout to prevent hanging
  let responseTimeout = setTimeout(() => {
    console.error('performBlockingRulesUpdate timed out');
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
          
          // Force refresh tabs that match newly blocked sites
          if (settings.blockedSites && settings.blockedSites.length > 0) {
            refreshBlockedSiteTabs(settings.blockedSites);
          }
          
          safeCallback(true);
        }
      });
    });
  } catch (error) {
    console.error('Exception in performBlockingRulesUpdate:', error);
    safeCallback(false, error.message);
  }
}

function refreshBlockedSiteTabs(blockedSites) {
  // Get all open tabs
  chrome.tabs.query({}, (tabs) => {
    if (chrome.runtime.lastError) {
      console.warn('Could not query tabs to refresh blocked sites:', chrome.runtime.lastError);
      return;
    }
    
    tabs.forEach(tab => {
      if (!tab.url) return;
      
      try {
        const tabUrl = new URL(tab.url);
        const tabDomain = tabUrl.hostname.replace(/^www\./, '').toLowerCase();
        
        // Check if this tab's domain matches any of the blocked sites
        const isBlocked = blockedSites.some(blockedDomain => {
          const normalizedBlocked = normalizeDomain(blockedDomain);
          return normalizedBlocked === tabDomain || tabDomain.endsWith('.' + normalizedBlocked);
        });
        
        if (isBlocked) {
          console.log(`Refreshing tab for blocked site: ${tabDomain}`);
          chrome.tabs.reload(tab.id, () => {
            if (chrome.runtime.lastError) {
              console.warn(`Could not reload tab ${tab.id}:`, chrome.runtime.lastError);
            }
          });
        }
      } catch (error) {
        console.warn('Error processing tab URL:', tab.url, error);
      }
    });
  });
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
  
  // Ensure redirectUrl is valid (has protocol) if provided
  let safeRedirectUrl = redirectUrl;
  if (safeRedirectUrl && !/^https?:\/\//i.test(safeRedirectUrl)) {
    safeRedirectUrl = 'https://' + safeRedirectUrl;
  }

  blockedSites.forEach(domain => {
    // Normalize the domain consistently
    const cleanDomain = normalizeDomain(domain);
    
    if (!cleanDomain) {
      console.warn(`Skipping invalid domain: ${domain}`);
      return;
    }
    
    console.log(`Creating blocking rules for: ${cleanDomain}`);
    
    // Rule 1: Block using urlFilter (covers domain and all subdomains)
    rules.push({
      id: ruleId++,
      priority: 1,
      action: safeRedirectUrl ? 
        { type: "redirect", redirect: { url: safeRedirectUrl } } : 
        { type: "block" },
      condition: {
        urlFilter: `||${cleanDomain}`,
        resourceTypes: ["main_frame"]
      }
    });
    
    // Rule 2: Block using requestDomains (more reliable for some cases)
    rules.push({
      id: ruleId++,
      priority: 1,
      action: safeRedirectUrl ? 
        { type: "redirect", redirect: { url: safeRedirectUrl } } : 
        { type: "block" },
      condition: {
        requestDomains: [cleanDomain, `www.${cleanDomain}`],
        resourceTypes: ["main_frame"]
      }
    });
    
    console.log(`Created 2 rules for ${cleanDomain}`);
  });
  
  console.log(`Total blocking rules created: ${rules.length}`);
  console.log('All rules:', JSON.stringify(rules, null, 2));
  return rules;
}