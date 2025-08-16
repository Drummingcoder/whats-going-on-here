// Content script: sends page title to background when requested and tracks visibility
console.log("Content script loaded");

let lastActivityTime = Date.now();
let activityCheckInterval = null;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("Content script received message:", request);
  if (request.action === "getPageTitle") {
    sendResponse({ title: document.title });
    console.log("Sent page title:", document.title);
  }
});

// Track page visibility changes to detect when user switches away from Chrome
document.addEventListener('visibilitychange', () => {
  const isHidden = document.hidden;
  console.log('Page visibility changed:', isHidden ? 'hidden' : 'visible');
  
  // Update activity time
  lastActivityTime = Date.now();
  
  // Send visibility change to background script
  chrome.runtime.sendMessage({
    action: 'pageVisibilityChanged',
    hidden: isHidden,
    url: window.location.href,
    timestamp: Date.now()
  });
  
  // Start or stop activity monitoring based on visibility
  if (!isHidden) {
    startActivityMonitoring();
  } else {
    stopActivityMonitoring();
  }
});

// Track user activity on the page to detect device sleep/inactivity
function trackUserActivity() {
  lastActivityTime = Date.now();
}

function startActivityMonitoring() {
  // Add activity listeners
  ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'].forEach(eventType => {
    document.addEventListener(eventType, trackUserActivity, true);
  });
  
  // Start periodic check for inactivity
  if (activityCheckInterval) {
    clearInterval(activityCheckInterval);
  }
  
  activityCheckInterval = setInterval(() => {
    const now = Date.now();
    const timeSinceActivity = now - lastActivityTime;
    
    // If no activity for 10 minutes and page is visible, might indicate device sleep
    if (timeSinceActivity > 10 * 60 * 1000 && !document.hidden) {
      console.log('Extended inactivity detected, possible device sleep');
      chrome.runtime.sendMessage({
        action: 'extendedInactivity',
        url: window.location.href,
        inactivityDuration: timeSinceActivity,
        timestamp: now
      });
    }
  }, 60000); // Check every minute
}

function stopActivityMonitoring() {
  // Remove activity listeners
  ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'].forEach(eventType => {
    document.removeEventListener(eventType, trackUserActivity, true);
  });
  
  // Clear interval
  if (activityCheckInterval) {
    clearInterval(activityCheckInterval);
    activityCheckInterval = null;
  }
}

// Start monitoring if page is initially visible
if (!document.hidden) {
  startActivityMonitoring();
}

// Track focus/blur events on the window
window.addEventListener('focus', () => {
  lastActivityTime = Date.now();
  chrome.runtime.sendMessage({
    action: 'windowFocus',
    url: window.location.href,
    timestamp: Date.now()
  });
});

window.addEventListener('blur', () => {
  chrome.runtime.sendMessage({
    action: 'windowBlur',
    url: window.location.href,
    timestamp: Date.now()
  });
});
