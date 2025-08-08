class OverviewManager {
  constructor() {
    this.elements = {
      // Settings elements
      sitesTextarea: document.getElementById("monitoredSites"),
      saveBtn: document.getElementById("saveSettings"),
      resetBtn: document.getElementById("resetSettings"),
      resetSessionBtn: document.getElementById("resetSession"),
      status: document.getElementById("statusMessage"),
      
      // UI elements
      toggleSettingsBtn: document.getElementById("toggleSettings"),
      settingsPanel: document.getElementById("settingsPanel"),
      
      // Stats elements
      todayTotal: document.getElementById("todayTotal"),
      sitesVisited: document.getElementById("sitesVisited"),
      
      // Chart elements
      pieChart: document.getElementById("pieChart"),
      pieChartPlaceholder: document.getElementById("pieChartPlaceholder"),
      blockSchedule: document.getElementById("blockSchedule"),
      schedulePlaceholder: document.getElementById("schedulePlaceholder")
    };

    this.pieChartInstance = null;
    this.init();
  }

  init() {
    this.loadSettings();
    this.loadTimeData();
    this.attachEventListeners();
  }

  loadSettings() {
    chrome.storage.sync.get(['allowedSites'], (result) => {
      if (result.allowedSites && Array.isArray(result.allowedSites)) {
        this.elements.sitesTextarea.value = result.allowedSites.join('\n');
      }
    });
  }

  loadTimeData() {
    // Get session history for both charts and stats - this ensures consistency
    chrome.runtime.sendMessage({ action: "getSessionHistory" }, (response) => {
      if (response && response.sessionHistory) {
        const today = new Date().toDateString();
        const todaySessions = response.sessionHistory[today] || [];
        
        // Calculate aggregated data from sessions for consistency
        const aggregatedData = this.calculateAggregatedTimeFromSessions(todaySessions);
        
        this.displayStatsOverview(aggregatedData, todaySessions.length > 0);
        this.createPieChart(aggregatedData);
        this.createBlockSchedule(response.sessionHistory);
      } else {
        // No session history, show empty state
        this.displayStatsOverview({}, false);
        this.elements.pieChartPlaceholder.innerHTML = '<div style="color: #94a3b8;">No data for today yet</div>';
        this.elements.schedulePlaceholder.innerHTML = '<div style="color: #94a3b8;">No activity recorded today</div>';
      }
    });
  }

  calculateAggregatedTimeFromSessions(sessions) {
    const aggregated = {};
    
    // First consolidate sessions to avoid double counting
    const consolidatedSessions = this.consolidateSessions(sessions);
    
    consolidatedSessions.forEach(session => {
      if (!aggregated[session.domain]) {
        aggregated[session.domain] = 0;
      }
      aggregated[session.domain] += session.duration;
    });
    
    console.log('Aggregated time data:', aggregated); // Debug log
    return aggregated;
  }

  attachEventListeners() {
    // Settings panel toggle
    this.elements.toggleSettingsBtn.addEventListener("click", () => {
      this.toggleSettingsPanel();
    });
    
    // Settings save/reset
    this.elements.saveBtn.addEventListener("click", () => this.saveSettings());
    this.elements.resetBtn.addEventListener("click", () => this.resetSettings());
    this.elements.resetSessionBtn.addEventListener("click", () => this.resetTodaysSession());
    
    // Auto-resize textarea
    this.elements.sitesTextarea.addEventListener("input", () => {
      this.autoResizeTextarea(this.elements.sitesTextarea);
    });
  }

  toggleSettingsPanel() {
    this.elements.settingsPanel.classList.toggle('active');
    const isActive = this.elements.settingsPanel.classList.contains('active');
    this.elements.toggleSettingsBtn.textContent = isActive ? 'Close Settings' : 'Settings';
  }

  displayStatsOverview(aggregatedData, hasData) {
    if (!hasData) {
      this.elements.todayTotal.textContent = "0m";
      this.elements.sitesVisited.textContent = "0";
      return;
    }
    
    let totalTime = 0;
    const sitesCount = Object.keys(aggregatedData).length;
    
    for (const domain in aggregatedData) {
      totalTime += aggregatedData[domain];
    }
    
    this.elements.todayTotal.textContent = this.formatTime(totalTime);
    this.elements.sitesVisited.textContent = sitesCount;
  }

  createPieChart(aggregatedData) {
    if (Object.keys(aggregatedData).length === 0) {
      this.elements.pieChartPlaceholder.innerHTML = '<div style="color: #94a3b8;">No data for today yet</div>';
      return;
    }

    // Prepare data for pie chart with better precision
    const sortedData = Object.entries(aggregatedData)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 8); // Top 8 sites

    console.log('Pie chart data before processing:', sortedData); // Debug log

    const labels = sortedData.map(([domain]) => this.getSiteName(domain));
    const data = sortedData.map(([,time]) => {
      const minutes = time / 60000; // Convert to minutes with decimal precision
      return Math.max(0.1, Math.round(minutes * 10) / 10); // Minimum 0.1 min, round to 1 decimal
    });
    
    console.log('Pie chart labels:', labels);
    console.log('Pie chart data (minutes):', data); // Debug log
    
    const colors = [
      '#667eea', '#764ba2', '#f093fb', '#f5576c',
      '#4facfe', '#00f2fe', '#43e97b', '#38f9d7'
    ];

    // Hide placeholder and show chart
    this.elements.pieChartPlaceholder.style.display = 'none';
    this.elements.pieChart.style.display = 'block';

    // Create chart using Chart.js (we'll load it dynamically)
    this.loadChartJS(() => {
      const ctx = this.elements.pieChart.getContext('2d');
      
      if (this.pieChartInstance) {
        this.pieChartInstance.destroy();
      }
      
      this.pieChartInstance = new Chart(ctx, {
        type: 'pie',
        data: {
          labels: labels,
          datasets: [{
            data: data,
            backgroundColor: colors,
            borderWidth: 2,
            borderColor: '#ffffff'
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'bottom',
              labels: {
                padding: 20,
                usePointStyle: true,
                font: {
                  size: 12
                }
              }
            },
            tooltip: {
              callbacks: {
                label: function(context) {
                  const label = context.label || '';
                  const value = context.parsed || 0;
                  return `${label}: ${value} min`;
                }
              }
            }
          }
        }
      });
    });
  }

  getSiteName(domain) {
    // Map common domains to their display names
    const siteNames = {
      'google.com': 'Google',
      'youtube.com': 'YouTube',
      'facebook.com': 'Facebook',
      'twitter.com': 'Twitter',
      'instagram.com': 'Instagram',
      'linkedin.com': 'LinkedIn',
      'reddit.com': 'Reddit',
      'github.com': 'GitHub',
      'stackoverflow.com': 'Stack Overflow',
      'wikipedia.org': 'Wikipedia',
      'amazon.com': 'Amazon',
      'netflix.com': 'Netflix',
      'spotify.com': 'Spotify',
      'discord.com': 'Discord',
      'slack.com': 'Slack',
      'zoom.us': 'Zoom',
      'docs.google.com': 'Google Docs',
      'drive.google.com': 'Google Drive',
      'gmail.com': 'Gmail',
      'outlook.com': 'Outlook',
      'teams.microsoft.com': 'Microsoft Teams',
      'office.com': 'Microsoft Office',
      'notion.so': 'Notion',
      'figma.com': 'Figma',
      'trello.com': 'Trello',
      'asana.com': 'Asana',
      'gemini.google.com': 'Gemini',
      'chatgpt.com': 'ChatGPT',
      'claude.ai': 'Claude'
    };

    // Return mapped name or capitalize first letter of domain
    return siteNames[domain] || domain.charAt(0).toUpperCase() + domain.slice(1);
  }

  createBlockSchedule(sessionHistory) {
    const today = new Date().toDateString();
    const todaySessions = sessionHistory[today] || [];
    
    if (todaySessions.length === 0) {
      this.elements.schedulePlaceholder.innerHTML = '<div style="color: #94a3b8;">No activity recorded today</div>';
      return;
    }

    // Hide placeholder and show schedule
    this.elements.schedulePlaceholder.style.display = 'none';
    this.elements.blockSchedule.style.display = 'block';

    // Create timeline visualization
    const container = this.elements.blockSchedule;
    container.innerHTML = '';
    
    // Sort sessions by start time
    const sortedSessions = todaySessions.sort((a, b) => a.startTime - b.startTime);
    
    // Consolidate consecutive sessions from the same domain
    const consolidatedSessions = this.consolidateSessions(sortedSessions);
    
    // Group consolidated sessions by hour
    const hourlyGroups = {};
    consolidatedSessions.forEach(session => {
      const hour = new Date(session.startTime).getHours();
      if (!hourlyGroups[hour]) {
        hourlyGroups[hour] = [];
      }
      hourlyGroups[hour].push(session);
    });

    // Create timeline blocks
    const timelineContainer = document.createElement('div');
    timelineContainer.style.cssText = `
      height: 300px;
      overflow-y: auto;
      padding: 16px;
    `;

    Object.keys(hourlyGroups).sort((a, b) => parseInt(a) - parseInt(b)).forEach(hour => {
      const hourBlock = document.createElement('div');
      hourBlock.style.cssText = `
        margin-bottom: 16px;
        border-left: 3px solid #667eea;
        padding-left: 12px;
      `;

      const hourLabel = document.createElement('div');
      hourLabel.textContent = `${hour.padStart(2, '0')}:00`;
      hourLabel.style.cssText = `
        font-weight: 600;
        color: #374151;
        margin-bottom: 8px;
        font-size: 14px;
      `;
      hourBlock.appendChild(hourLabel);

      hourlyGroups[hour].forEach(session => {
        const sessionBlock = document.createElement('div');
        const startTime = new Date(session.startTime);
        const duration = Math.round(session.duration / 60000); // Convert to minutes
        
        sessionBlock.style.cssText = `
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 6px;
          padding: 8px 12px;
          margin-bottom: 4px;
          font-size: 12px;
        `;
        
        sessionBlock.innerHTML = `
          <div style="font-weight: 500; color: #374151;">${this.getSiteName(session.domain)}</div>
          <div style="color: #6b7280;">
            ${startTime.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})} • ${duration} min
          </div>
        `;
        
        hourBlock.appendChild(sessionBlock);
      });

      timelineContainer.appendChild(hourBlock);
    });

    container.appendChild(timelineContainer);
  }

  consolidateSessions(sessions) {
    if (sessions.length === 0) return [];

    // Sort sessions by start time first
    const sortedSessions = [...sessions].sort((a, b) => a.startTime - b.startTime);
    
    const consolidated = [];
    let currentSession = { ...sortedSessions[0] };

    console.log('Original sessions:', sortedSessions.length);
    console.log('First session:', currentSession);

    for (let i = 1; i < sortedSessions.length; i++) {
      const session = sortedSessions[i];
      const timeBetween = session.startTime - currentSession.endTime;
      
      console.log(`Comparing ${session.domain} (${new Date(session.startTime).toLocaleTimeString()}) with ${currentSession.domain} (${new Date(currentSession.endTime).toLocaleTimeString()}), gap: ${Math.round(timeBetween/1000)}s`);
      
      // If same domain and gap is less than 5 minutes (300000ms), merge them
      if (session.domain === currentSession.domain && timeBetween <= 300000) {
        // Extend the current session
        currentSession.endTime = session.endTime;
        currentSession.duration = currentSession.endTime - currentSession.startTime;
        console.log(`Merged session, new duration: ${Math.round(currentSession.duration/60000)}min`);
      } else {
        // Different domain or gap too large, start new session
        consolidated.push(currentSession);
        currentSession = { ...session };
        console.log(`Added session: ${currentSession.domain}, ${Math.round(currentSession.duration/60000)}min`);
      }
    }
    
    // Don't forget the last session
    consolidated.push(currentSession);
    console.log(`Final consolidated sessions:`, consolidated.length);
    
    return consolidated;
  }

  loadChartJS(callback) {
    if (window.Chart) {
      callback();
      return;
    }

    const script = document.createElement('script');
    script.src = 'chart.js';
    script.onload = callback;
    document.head.appendChild(script);
  }

  formatTime(milliseconds) {
    const hours = Math.floor(milliseconds / (1000 * 60 * 60));
    const minutes = Math.floor((milliseconds % (1000 * 60 * 60)) / (1000 * 60));
    
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else {
      return `${minutes}m`;
    }
  }

  autoResizeTextarea(textarea) {
    textarea.style.height = "auto";
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + "px";
  }

  validateSettings() {
    const sites = this.getSitesFromTextarea();
    const errors = [];

    if (sites.length === 0) {
      errors.push("Please add at least one website to track");
    }

    sites.forEach(site => {
      if (!this.isValidDomain(site)) {
        errors.push(`"${site}" is not a valid domain name`);
      }
    });

    return errors;
  }

  isValidDomain(domain) {
    const domainRegex = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9](?:\.[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9])*$/;
    return domainRegex.test(domain) && domain.length <= 253;
  }

  getSitesFromTextarea() {
    return this.elements.sitesTextarea.value
      .split('\n')
      .map(site => site.trim().toLowerCase())
      .filter(site => site.length > 0)
      .filter((site, index, arr) => arr.indexOf(site) === index); // Remove duplicates
  }

  showStatus(message, type = 'success') {
    const status = this.elements.status;
    status.textContent = message;
    status.className = `status-message status-${type}`;
    status.style.display = 'block';
    setTimeout(() => {
      status.style.display = 'none';
    }, 3000);
  }

  saveSettings() {
    try {
      const errors = this.validateSettings();
      if (errors.length > 0) {
        this.showStatus(errors[0], 'error');
        return;
      }

      const sites = this.getSitesFromTextarea();
      
      this.elements.saveBtn.disabled = true;
      this.elements.saveBtn.textContent = 'Saving...';
      
      const syncSettings = {
        allowedSites: sites
      };

      chrome.storage.sync.set(syncSettings, () => {
        if (chrome.runtime.lastError) {
          this.showStatus('Failed to save settings: ' + chrome.runtime.lastError.message, 'error');
          this.resetSaveButton();
          return;
        }

        this.showStatus('Settings saved successfully!');
        this.resetSaveButton();
      });

    } catch (error) {
      console.error('Error saving settings:', error);
      this.showStatus('An unexpected error occurred', 'error');
      this.resetSaveButton();
    }
  }

  resetSaveButton() {
    this.elements.saveBtn.disabled = false;
    this.elements.saveBtn.textContent = 'Save Settings';
  }

  resetTodaysSession() {
    if (!confirm('Reset today\'s browsing session data?\n\nThis will clear:\n• All time tracking for today\n• Today\'s session history\n• Charts and stats will reset to 0\n\nThis action cannot be undone.')) {
      return;
    }

    const today = new Date().toDateString();
    
    // Get current data and remove only today's entries
    chrome.storage.local.get(['timeTracking', 'sessionHistory'], (result) => {
      const timeTracking = result.timeTracking || {};
      const sessionHistory = result.sessionHistory || {};
      
      // Remove today's data
      delete timeTracking[today];
      delete sessionHistory[today];
      
      // Save the updated data
      chrome.storage.local.set({ 
        timeTracking: timeTracking,
        sessionHistory: sessionHistory 
      }, () => {
        if (chrome.runtime.lastError) {
          this.showStatus('Failed to reset session data', 'error');
          return;
        }
        
        this.showStatus('Today\'s session data has been reset');
        
        // Refresh the charts and stats
        this.loadTimeData();
      });
    });
  }

  resetSettings() {
    if (!confirm('Are you sure you want to reset all settings? This will:\n\n• Clear all monitored sites\n• Clear all time tracking data')) {
      return;
    }

    chrome.storage.sync.clear(() => {
      chrome.storage.local.clear(() => {
        this.elements.sitesTextarea.value = '';
        
        this.showStatus('All settings and data have been reset');
        
        // Refresh the charts and stats
        this.loadTimeData();
      });
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new OverviewManager();
});
