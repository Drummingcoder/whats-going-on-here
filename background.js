chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getSettings") {
    chrome.storage.sync.get(['allowedSites', 'timerDuration'], (result) => {
      sendResponse({
        allowedSites: result.allowedSites || [],
        timerDuration: result.timerDuration || 5
      });
    });
    return true;
  }
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(['allowedSites', 'timerDuration'], (result) => {
    const defaults = {};
    
    if (!result.allowedSites) {
      defaults.allowedSites = [];
    }
    
    if (!result.timerDuration) {
      defaults.timerDuration = 5;
    }
    
    if (Object.keys(defaults).length > 0) {
      chrome.storage.sync.set(defaults);
    }
  });
});