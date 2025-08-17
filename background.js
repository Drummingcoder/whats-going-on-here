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
let lastSessionDate = (new Date()).toDateString();

// Event-based tracking variables
let activeTabId = null;
let activeStartTime = null;
let activeDomain = null;
let activeTitle = null;

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
      logEvent('device_offline_inferred', null, null, lastHeartbeat + deviceSleepThreshold);

      // Issue a device_shutdown event and stop tracking 5 minutes after the last heartbeat
      const shutdownTimestamp = lastHeartbeat + deviceSleepThreshold;
      chrome.storage.local.get(['persistedSession'], (result) => {
        const persisted = result.persistedSession;
        if (persisted && persisted.domain) {
          // Log device_shutdown event at the shutdown timestamp
          logEvent('device_shutdown', persisted.domain, persisted.title, shutdownTimestamp);
          stopTracking();
        }
      });
    }
    // Continue with normal wakeup and heartbeat logic
    updateActivity();
    startHeartbeat();
    
    // Add missing end_of_day events for previous dates
    addEndOfDayEvents();
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

// Log browser startup event
chrome.runtime.onStartup.addListener(() => {
  updateActivity(); // Mark activity
  logEvent('browser_startup');
  startHeartbeat();
  initializeBlockingRules();
});

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
      if (timeSinceLastHeartbeat > deviceSleepThreshold) {
        // Only issue shutdown if we had an active session
        const persisted = result && result.persistedSession ? result.persistedSession : null;
        if (persisted && typeof persisted === 'object' && persisted.domain) {
          const shutdownTimestamp = lastHeartbeat + deviceSleepThreshold;
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
      if (timeSinceLastSessionActivity > sessionTimeoutThreshold) {
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
  lastSessionDate = (new Date()).toDateString();

  // Persist session info in storage
  chrome.storage.local.set({
    persistedSession: {
      domain: activeDomain,
      title: activeTitle,
      startTime: activeStartTime,
      startDate: lastSessionDate
    }
  });

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
    resetSessionTimeout();
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
    }, sessionTimeoutThreshold);
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
function getSitesToBlockNow() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['blockedSitesList', 'blockingScheduleRules'], (result) => {
      const blockedSites = result.blockedSitesList || [];
      const scheduleRules = result.blockingScheduleRules || [];
      
      const enabledSites = blockedSites
        .filter(site => site.enabled !== false)
        .map(site => site.domain);
      
      // If no schedule rules exist, block all enabled sites 24/7
      if (scheduleRules.length === 0) {
        resolve(enabledSites);
        return;
      }
      
      const now = new Date();
      const currentDay = now.getDay(); // 0=Sunday, 1=Monday, etc.
      const currentTime = now.getHours() * 60 + now.getMinutes(); // Minutes since midnight
      
      // Collect sites that should be blocked based on active schedule rules
      const sitesToBlock = new Set();
      
      scheduleRules.forEach(rule => {
        // Check if current day is in rule's days
        if (!rule.days.includes(currentDay)) {
          return;
        }
        
        // Parse time range
        const [startHour, startMin] = rule.startTime.split(':').map(n => parseInt(n));
        const [endHour, endMin] = rule.endTime.split(':').map(n => parseInt(n));
        const startTime = startHour * 60 + startMin;
        const endTime = endHour * 60 + endMin;
        
        // Check if current time is in rule's time range
        const isInTimeRange = (startTime <= endTime) 
          ? (currentTime >= startTime && currentTime <= endTime)
          : (currentTime >= startTime || currentTime <= endTime); // Handle overnight ranges
        
        if (isInTimeRange) {
          // Add all websites from this rule to the blocking list
          rule.websites.forEach(website => {
            if (enabledSites.includes(website)) {
              sitesToBlock.add(website);
            }
          });
        }
      });
      
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