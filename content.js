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

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!extensionContextValid) {
    return;
  }
  
  if (request.action === "getPageTitle") {
    try {
      sendResponse({ title: document.title });
    } catch (error) {
      if (error.message.includes('Extension context invalidated')) {
        extensionContextValid = false;
        stopActivityMonitoring();
        return;
      }
      console.error('Error sending response:', error);
    }
  }
});

document.addEventListener('visibilitychange', () => {
  const isHidden = document.hidden;
  lastActivityTime = Date.now();
  
  safeSendMessage({
    action: 'pageVisibilityChanged',
    hidden: isHidden,
    url: window.location.href,
    timestamp: Date.now()
  });
  
  if (!isHidden) {
    startActivityMonitoring();
  } else {
    stopActivityMonitoring();
  }
});

function startActivityMonitoring() {
  if (!extensionContextValid) {
    return;
  }
  
  ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'].forEach(eventType => {
    document.addEventListener(eventType, () => { lastActivityTime = Date.now(); }, true);
  });
  

  if (activityCheckInterval) {
    clearInterval(activityCheckInterval);
  }
  activityCheckInterval = setInterval(() => {
    const now = Date.now();
    const timeSinceActivity = now - lastActivityTime;
    if (timeSinceActivity > 600000 && !document.hidden) { // 10 minutes
      safeSendMessage({
        action: 'extendedInactivity',
        url: window.location.href,
        inactivityDuration: timeSinceActivity,
        timestamp: now
      });
    }
  }, 60000);
}

function stopActivityMonitoring() {
  if (!extensionContextValid) {
    return;
  }
  
  ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'].forEach(eventType => {
    document.removeEventListener(eventType, () => { lastActivityTime = Date.now(); }, true);
  });
  
  if (activityCheckInterval) {
    clearInterval(activityCheckInterval);
    activityCheckInterval = null;
  }
}


// Startup script
if (!document.hidden && extensionContextValid) {
  startActivityMonitoring();
}

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
}, 5000);

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

function safeSendMessage(message) { //to background script
  if (!extensionContextValid) {
    return;
  }
  
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