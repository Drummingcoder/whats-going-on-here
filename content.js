let extensionContextValid = true;
try {
  if (!chrome.runtime || !chrome.runtime.id) {
    extensionContextValid = false;
    console.log('Extension context not available at startup');
  }
} catch (error) {
  extensionContextValid = false;
  console.log('Extension context check failed:', error);
}

let lastActivityTime = Date.now();
let activityCheckInterval = null;

// Helper function to safely send messages to background script
function safeSendMessage(message) {
  if (!extensionContextValid) {
    return;
  }
  
  // Double-check runtime availability
  try {
    if (!chrome.runtime || !chrome.runtime.id) {
      console.log('Chrome runtime not available, disabling content script');
      extensionContextValid = false;
      stopActivityMonitoring();
      return;
    }
    
    chrome.runtime.sendMessage(message);
  } catch (error) {
    if (error.message.includes('Extension context invalidated') || 
        error.message.includes('receiving end does not exist')) {
      console.log('Extension context invalidated, disabling content script');
      extensionContextValid = false;
      stopActivityMonitoring();
      return;
    }
    console.error('Error sending message to background script:', error);
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!extensionContextValid) {
    return;
  }
  
  console.log("Content script received message:", request);
  if (request.action === "getPageTitle") {
    try {
      sendResponse({ title: document.title });
      console.log("Sent page title:", document.title);
    } catch (error) {
      if (error.message.includes('Extension context invalidated')) {
        console.log('Extension context invalidated during message response');
        extensionContextValid = false;
        stopActivityMonitoring();
        return;
      }
      console.error('Error sending response:', error);
    }
  }
});

// Track page visibility changes to detect when user switches away from Chrome
document.addEventListener('visibilitychange', () => {
  const isHidden = document.hidden;
  console.log('Page visibility changed:', isHidden ? 'hidden' : 'visible');
  
  // Update activity time
  lastActivityTime = Date.now();
  
  // Send visibility change to background script
  safeSendMessage({
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
  if (!extensionContextValid) {
    return;
  }
  
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
      safeSendMessage({
        action: 'extendedInactivity',
        url: window.location.href,
        inactivityDuration: timeSinceActivity,
        timestamp: now
      });
    }
  }, 60000); // Check every minute
}

function stopActivityMonitoring() {
  if (!extensionContextValid) {
    return;
  }
  
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

// Start monitoring if page is initially visible and extension context is valid
if (!document.hidden && extensionContextValid) {
  startActivityMonitoring();
}

// Periodic check for extension context validity
setInterval(() => {
  if (extensionContextValid) {
    try {
      if (!chrome.runtime || !chrome.runtime.id) {
        console.log('Extension context lost, disabling content script');
        extensionContextValid = false;
        stopActivityMonitoring();
      }
    } catch (error) {
      console.log('Extension context check failed, disabling content script');
      extensionContextValid = false;
      stopActivityMonitoring();
    }
  }
}, 5000); // Check every 5 seconds

// Track focus/blur events on the window
window.addEventListener('focus', () => {
  lastActivityTime = Date.now();
  safeSendMessage({
    action: 'windowFocus',
    url: window.location.href,
    timestamp: Date.now()
  });
});

window.addEventListener('blur', () => {
  safeSendMessage({
    action: 'windowBlur',
    url: window.location.href,
    timestamp: Date.now()
  });
});
