// Content script: sends page title to background when requested
console.log("Content script loaded");
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("Content script received message:", request);
  if (request.action === "getPageTitle") {
    sendResponse({ title: document.title });
    console.log("Sent page title:", document.title);
  }
});
