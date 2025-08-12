class SimplePopupManager {
  timerId = null;
  async getPastSessionInfo(domain) {
    // Get today's session history and find the most recent session for this domain
    const today = new Date().toDateString();
    const result = await chrome.storage.local.get(['sessionHistory']);
    const sessionHistory = (result.sessionHistory && result.sessionHistory[today]) ? result.sessionHistory[today] : [];
    let pastMinutes = 0;
    let pastTitle = null;
    sessionHistory.forEach(session => {
      if (session.domain === domain) {
        pastMinutes += Math.round(session.duration / 1000 / 60);
        if (!pastTitle && session.title) {
          pastTitle = session.title;
        }
      }
    });
    if (pastTitle == "napbabpdghpbnpknamdcapnclgohebnm") {
      pastTitle = "What's Going ON Here?";
    }
    return { pastMinutes, pastTitle };
  }
  constructor() {
    this.activeTabDomain = null;
    this.activeTabTime = 0;
    this.init();
  }

  async init() {
    try {
      await this.loadCurrentSessionData();
      this.setupEventListeners();
      this.startLiveUpdate();
    } catch (error) {
      console.error('Popup initialization error:', error);
      this.showNoActivity();
    }
  }

  startLiveUpdate() {
    // Clear any previous timer
    if (this.timerId) {
      clearInterval(this.timerId);
    }
    this.timerId = setInterval(() => {
      this.loadCurrentSessionData();
    }, 1000);
  }

  setupEventListeners() {
    // Open Overview button
    document.getElementById('openOverview')?.addEventListener('click', () => {
      this.openOverviewWindow();
    });

    // Reset session button
    document.getElementById('resetSession')?.addEventListener('click', async () => {
      await this.resetTodayData();
    });
  }

  async loadCurrentSessionData() {
    try {
      // Get current active tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.url) {
        this.showNoActivity();
        return;
      }
      this.activeTabDomain = this.extractDomain(tab.url);

      // Ask background for current active session info
      chrome.runtime.sendMessage({ action: "getActiveSessionInfo" }, (response) => {
        console.log('Popup received getActiveSessionInfo response:', response);
        if (response && response.domain && response.domain === this.activeTabDomain && response.startTime) {
          // Only use startTime for session time tracking
          const sessionTimeSeconds = Math.floor((Date.now() - response.startTime) / 1000);
          const pageTitle = response.title || null;
          console.log('Active session detected. Calculated seconds:', sessionTimeSeconds, 'Title:', pageTitle);
          this.activeTabTime = sessionTimeSeconds;
          this.activeTabTitle = pageTitle;
          this.displayCurrentSession(tab);
        } else {
          // No active session info available
          this.activeTabTime = 0;
          this.activeTabTitle = null;
          this.displayCurrentSession(tab);
        }
      });

    } catch (error) {
      console.error('Error loading current session:', error);
      this.showNoActivity();
    }
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

  displayCurrentSession(tab) {
    const currentSessionDiv = document.getElementById('currentSession');
    const siteName = this.getSiteName(this.activeTabDomain);
    const displayTitle = this.activeTabTitle || siteName;

    if (this.activeTabTime > 0) {
      currentSessionDiv.innerHTML = `
        <div class="session-icon">🌐</div>
        <div class="session-site">${displayTitle}</div>
        <div class="session-domain">${this.activeTabDomain}</div>
        <div class="session-time">${this.formatTimeWithSeconds(this.activeTabTime)}</div>
        <div class="session-label">Session Time</div>
      `;
    } else {
      currentSessionDiv.innerHTML = `
        <div class="session-icon">🆕</div>
        <div class="session-site">${displayTitle}</div>
        <div class="session-domain">${this.activeTabDomain}</div>
        <div class="session-time">0m 0s</div>
        <div class="session-label">New Session</div>
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
      const sessionKey = `timeTracking_${today}`;
      
      // Remove today's data
      await chrome.storage.local.remove([sessionKey]);
      
      // Reload the popup data
      await this.loadCurrentSessionData();
      
      console.log('Today\'s session data has been reset');
    } catch (error) {
      console.error('Error resetting session data:', error);
    }
  }

  extractDomain(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.replace(/^www\./, '');
    } catch (error) {
      return url;
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