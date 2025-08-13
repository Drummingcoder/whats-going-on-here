// Content script: sends page title to background when requested and tracks visibility
console.log("Content script loaded");

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
  
  // Send visibility change to background script
  chrome.runtime.sendMessage({
    action: 'pageVisibilityChanged',
    hidden: isHidden,
    url: window.location.href,
    timestamp: Date.now()
  });
});
