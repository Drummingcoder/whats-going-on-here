class SimplePopupManager {
  timerId = null;
  constructor() {
    this.activeTabDomain = null;
    this.activeTabTime = 0;
    this.sessionStartTimestamp = null;
    this.activeTabTitle = null;
    this.totalTimeToday = 0;
    this.tab = null;
    this.init();
  }

  async init() {
    try {
      await this.fetchSessionDataOnce();
      this.setupEventListeners();
      this.startTimerUpdate();
    } catch (error) {
      console.error('Popup initialization error:', error);
      this.showNoActivity();
    }
  }

  async fetchSessionDataOnce() {
    // Get current active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) {
      this.showNoActivity();
      return;
    }
    this.tab = tab;
    const currentDomain = this.extractDomain(tab.url);
    this.activeTabDomain = currentDomain;

    // Get session info for this specific tab from background script
    const sessionData = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: "getTabSessionInfo", tabId: tab.id }, (response) => {
        resolve(response || { domain: null, startTime: null, title: null });
      });
    });

    this.sessionStartTimestamp = sessionData.startTime;
    this.activeTabTitle = sessionData.title || tab.title || this.getSiteName(currentDomain);

    // Get total time spent on this domain today
    this.totalTimeToday = await this.getTotalTimeForDomain(currentDomain);

    // Set initial session time
    if (this.sessionStartTimestamp) {
      this.activeTabTime = Math.floor((Date.now() - this.sessionStartTimestamp) / 1000);
    } else {
      this.activeTabTime = 0;
    }

    this.displayCurrentSession(this.tab, this.totalTimeToday);
  }

  startTimerUpdate() {
    if (this.timerId) {
      clearInterval(this.timerId);
    }
    this.timerId = setInterval(() => {
      if (this.sessionStartTimestamp) {
        this.activeTabTime = Math.floor((Date.now() - this.sessionStartTimestamp) / 1000);
      } else {
        this.activeTabTime = 0;
      }
      this.displayCurrentSession(this.tab, this.totalTimeToday);
    }, 1000);
  }

  setupEventListeners() {
    // Open Overview button
    document.getElementById('openOverview')?.addEventListener('click', () => {
      this.openOverviewWindow();
    });

  }

  // loadCurrentSessionData is no longer needed

  async getCurrentSessionFromEvents(domain) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: "getEventLog" }, (response) => {
        if (response && response.eventLog) {
          const today = new Date().toDateString();
          const todayEvents = response.eventLog[today] || [];
          
          // Find the current active session for this domain
          const sessionInfo = this.findCurrentSession(todayEvents, domain);
          resolve(sessionInfo);
        } else {
          resolve({ currentSessionSeconds: 0, title: null });
        }
      });
    });
  }

  findCurrentSession(events, targetDomain) {
    // Sort events by timestamp
    const sortedEvents = [...events].sort((a, b) => a.timestamp - b.timestamp);
    let currentSessionStart = null;
    let currentSessionTitle = null;
    let isInTargetSession = false;
    // Go through events chronologically to find the current session
    for (const event of sortedEvents) {
      if (event.domain === targetDomain) {
        // Events that start a session for our target domain
        if (event.type === 'tab_activated' || event.type === 'browser_focus' || event.type === 'page_visible') {
          if (!isInTargetSession) {
            currentSessionStart = event.timestamp;
            currentSessionTitle = event.title;
            isInTargetSession = true;
          }
        }
        // Events that end a session for our target domain
        else if (event.type === 'tab_deactivated' || event.type === 'tab_closed' || event.type === 'browser_blur' || event.type === 'page_hidden') {
          if (isInTargetSession) {
            // Session ended, reset
            currentSessionStart = null;
            currentSessionTitle = null;
            isInTargetSession = false;
          }
        }
      } else {
        // Event from a different domain
        if (event.type === 'tab_activated' || event.type === 'browser_focus') {
          // User switched to a different domain, end our session
          if (isInTargetSession) {
            currentSessionStart = null;
            currentSessionTitle = null;
            isInTargetSession = false;
          }
        }
      }
    }
    // Calculate current session time
    let currentSessionSeconds = 0;
    let currentSessionStartTimestamp = null;
    if (currentSessionStart && isInTargetSession) {
      currentSessionStartTimestamp = currentSessionStart;
      currentSessionSeconds = Math.floor((Date.now() - currentSessionStart) / 1000);
    }
    return {
      currentSessionSeconds,
      currentSessionStartTimestamp,
      title: currentSessionTitle
    };
  }

  async getTotalTimeForDomain(domain) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: "getEventLog" }, (response) => {
        if (response && response.eventLog) {
          const today = new Date().toDateString();
          const todayEvents = response.eventLog[today] || [];
          
          // Process events to calculate total time for this domain
          const totalTime = this.calculateDomainTimeFromEvents(todayEvents, domain);
          resolve(totalTime);
        } else {
          resolve(0);
        }
      });
    });
  }

  calculateDomainTimeFromEvents(events, targetDomain) {
    // Sort events by timestamp
    const sortedEvents = [...events].sort((a, b) => a.timestamp - b.timestamp);
    let totalTime = 0;
    let sessionStart = null;
    
    for (const event of sortedEvents) {
      if (event.domain === targetDomain) {
        if (event.type === 'tab_activated' && !sessionStart) {
          sessionStart = event.timestamp;
        } else if ((event.type === 'tab_deactivated' || event.type === 'tab_closed') && sessionStart) {
          totalTime += event.timestamp - sessionStart;
          sessionStart = null;
        }
      } else if (sessionStart && (event.type === 'tab_activated' || event.type === 'browser_blur')) {
        // Session ended because user switched to different domain
        totalTime += event.timestamp - sessionStart;
        sessionStart = null;
      }
    }
    
    // If session is still ongoing, add time up to now
    if (sessionStart) {
      totalTime += Date.now() - sessionStart;
    }
    
    return Math.floor(totalTime / 1000); // Return in seconds
  }

  async getPastSessionTime(domain) {
    // Get today's session data from storage and sum all completed sessions for this domain
    const today = new Date().toDateString();
    const sessionKey = `timeTracking_${today}`;
    const result = await chrome.storage.local.get([sessionKey]);
    const sessionData = result[sessionKey] || {};
    let totalTime = 0;
    Object.entries(sessionData).forEach(([key, value]) => {
      if (key.includes(domain)) {
        if (Array.isArray(value)) {
          value.forEach(session => {
            if (session.endTime) {
              totalTime += session.endTime - session.startTime;
            }
          });
        }
      }
    });
    return Math.max(0, Math.round(totalTime / 1000 / 60));
  }

  calculateDomainTime(sessionData, domain) {
    let totalTime = 0;
    // Find all sessions for this domain and sum their times
    Object.entries(sessionData).forEach(([key, value]) => {
      if (key.includes(domain)) {
        if (Array.isArray(value)) {
          value.forEach(session => {
            if (session.endTime) {
              totalTime += session.endTime - session.startTime;
            } else if (session.startTime && !session.endTime) {
              // Ongoing session: count up to now
              totalTime += Date.now() - session.startTime;
            }
          });
        }
      }
    });
    return Math.max(0, Math.round(totalTime / 1000 / 60)); // Convert to minutes
  }

  displayCurrentSession(tab, totalTimeToday = 0) {
    const currentSessionDiv = document.getElementById('currentSession');
    const siteName = this.getSiteName(this.activeTabDomain);
    const displayTitle = this.activeTabTitle || siteName;
    const totalMinutes = Math.floor(totalTimeToday / 60);
    const faviconUrl = tab && tab.favIconUrl ? tab.favIconUrl : 'https://www.google.com/s2/favicons?domain=' + this.activeTabDomain;
    if (this.activeTabTime > 0) {
      currentSessionDiv.innerHTML = `
        <div class="session-icon"><img src="${faviconUrl}" alt="favicon" style="width:24px;height:24px;border-radius:4px;"></div>
        <div class="session-site">${displayTitle}</div>
        <div class="session-domain">${this.activeTabDomain}</div>
        <div class="session-time">${this.formatTimeWithSeconds(this.activeTabTime)}</div>
        <div class="session-label">Current Session</div>
        ${totalMinutes > 0 ? `<div style="margin-top: 8px; font-size: 12px; color: #6b7280;">Total today: ${this.formatTime(totalMinutes)}</div>` : ''}
      `;
    } else {
      currentSessionDiv.innerHTML = `
        <div class="session-icon"><img src="${faviconUrl}" alt="favicon" style="width:24px;height:24px;border-radius:4px;"></div>
        <div class="session-site">${displayTitle}</div>
        <div class="session-domain">${this.activeTabDomain}</div>
        <div class="session-time">0m 0s</div>
        <div class="session-label">New Session</div>
        ${totalMinutes > 0 ? `<div style="margin-top: 8px; font-size: 12px; color: #6b7280;">Total today: ${this.formatTime(totalMinutes)}</div>` : ''}
      `;
    }
  }

  formatTimeWithSeconds(totalSeconds) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    } else {
      return `${seconds}s`;
    }
  }

  showNoActivity() {
    const currentSessionDiv = document.getElementById('currentSession');
    currentSessionDiv.innerHTML = `
      <div class="no-activity-icon">🤷‍♂️</div>
      <div class="no-activity">
        No trackable activity detected.<br>
        Visit a website to start tracking.
      </div>
    `;
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  openOverviewWindow() {
    // Open the overview.html in a new tab
    chrome.tabs.create({
      url: chrome.runtime.getURL('overview.html'),
      active: true
    });
  }

  async resetTodayData() {
    if (!confirm('Are you sure you want to reset all time tracking data for today? This cannot be undone.')) {
      return;
    }

    try {
      const today = new Date().toDateString();
      
      // Get current data and remove only today's entries
      chrome.storage.local.get(['timeTracking', 'eventLog'], (result) => {
        const timeTracking = result.timeTracking || {};
        const eventLog = result.eventLog || {};
        
        // Remove today's data
        delete timeTracking[today];
        delete eventLog[today];
        
        // Save the updated data
        chrome.storage.local.set({ 
          timeTracking: timeTracking,
          eventLog: eventLog 
        }, () => {
          // Reload the popup data
          this.loadCurrentSessionData();
          console.log('Today\'s session data has been reset');
        });
      });
      
    } catch (error) {
      console.error('Error resetting session data:', error);
    }
  }

  extractDomain(url) {
    try {
      if (url.startsWith('chrome://newtab')) {
        return 'chrome://newtab';
      }
      if (url.startsWith('chrome-extension://')) {
        const urlObj = new URL(url);
        return urlObj.hostname; // Keep extension ID as domain
      }
      if (url.startsWith('chrome://') || url.startsWith('about:') || url.startsWith('file://')) {
        return 'chrome-tab-unknown';
      }
      
      const urlObj = new URL(url);
      return urlObj.hostname; // Don't remove www. - keep exact domain
    } catch (error) {
      return 'chrome-tab-unknown';
    }
  }

  getSiteName(domain) {
    const siteNames = {
      'youtube.com': 'YouTube',
      'google.com': 'Google',
      'facebook.com': 'Facebook',
      'twitter.com': 'Twitter',
      'x.com': 'X (Twitter)',
      'instagram.com': 'Instagram',
      'linkedin.com': 'LinkedIn',
      'reddit.com': 'Reddit',
      'github.com': 'GitHub',
      'stackoverflow.com': 'Stack Overflow',
      'medium.com': 'Medium',
      'netflix.com': 'Netflix',
      'twitch.tv': 'Twitch',
      'discord.com': 'Discord',
      'slack.com': 'Slack',
      'zoom.us': 'Zoom',
      'gmail.com': 'Gmail',
      'outlook.com': 'Outlook',
      'amazon.com': 'Amazon',
      'ebay.com': 'eBay',
      'wikipedia.org': 'Wikipedia',
      'news.ycombinator.com': 'Hacker News'
    };

    return siteNames[domain] || this.capitalizeFirstLetter(domain.replace(/\.(com|org|net|edu|gov)$/, ''));
  }

  capitalizeFirstLetter(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
  }

  formatTime(minutes) {
    if (minutes < 60) {
      return `${minutes}m`;
    }
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => new SimplePopupManager());
} else {
  new SimplePopupManager();
}