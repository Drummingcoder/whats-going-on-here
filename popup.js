class ExtensionManager {
  constructor() {
    this.elements = {
      // Settings elements
      sitesTextarea: document.getElementById("monitoredSites"),
      durationInput: document.getElementById("timerDuration"),
      saveBtn: document.getElementById("saveSettings"),
      resetBtn: document.getElementById("resetSettings"),
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
    chrome.storage.sync.get(['allowedSites', 'timerDuration'], (result) => {
      if (result.allowedSites && Array.isArray(result.allowedSites)) {
        this.elements.sitesTextarea.value = result.allowedSites.join('\n');
      }
      if (result.timerDuration) {
        this.elements.durationInput.value = result.timerDuration;
      }
    });
  }

  loadTimeData() {
    // Get time tracking data
    chrome.runtime.sendMessage({ action: "getTimeData" }, (response) => {
      if (response && response.timeData) {
        this.displayStatsOverview(response.timeData);
        this.createPieChart(response.timeData);
      }
    });
    
    // Get session history for block schedule
    chrome.runtime.sendMessage({ action: "getSessionHistory" }, (response) => {
      if (response && response.sessionHistory) {
        this.createBlockSchedule(response.sessionHistory);
      }
    });
  }

  attachEventListeners() {
    // Settings panel toggle
    this.elements.toggleSettingsBtn.addEventListener("click", () => {
      this.toggleSettingsPanel();
    });
    
    // Settings save/reset
    this.elements.saveBtn.addEventListener("click", () => this.saveSettings());
    this.elements.resetBtn.addEventListener("click", () => this.resetSettings());
    
    // Keyboard shortcuts
    this.elements.durationInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") this.saveSettings();
    });

    this.elements.sitesTextarea.addEventListener("input", () => {
      this.autoResizeTextarea(this.elements.sitesTextarea);
    });
  }

  toggleSettingsPanel() {
    this.elements.settingsPanel.classList.toggle('active');
    const isActive = this.elements.settingsPanel.classList.contains('active');
    this.elements.toggleSettingsBtn.textContent = isActive ? 'Close Settings' : 'Settings';
  }

  displayStatsOverview(timeData) {
    const today = new Date().toDateString();
    const todayData = timeData[today] || {};
    
    let totalTime = 0;
    const sitesCount = Object.keys(todayData).length;
    
    for (const domain in todayData) {
      totalTime += todayData[domain];
    }
    
    this.elements.todayTotal.textContent = this.formatTime(totalTime);
    this.elements.sitesVisited.textContent = sitesCount;
  }

  createPieChart(timeData) {
    const today = new Date().toDateString();
    const todayData = timeData[today] || {};
    
    if (Object.keys(todayData).length === 0) {
      this.elements.pieChartPlaceholder.innerHTML = '<div style="color: #94a3b8;">No data for today yet</div>';
      return;
    }

    // Prepare data for pie chart
    const sortedData = Object.entries(todayData)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 8); // Top 8 sites

    const labels = sortedData.map(([domain]) => domain);
    const data = sortedData.map(([,time]) => Math.round(time / 60000)); // Convert to minutes
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
    
    // Group sessions by hour
    const hourlyGroups = {};
    sortedSessions.forEach(session => {
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
          <div style="font-weight: 500; color: #374151;">${session.domain}</div>
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

  loadChartJS(callback) {
    if (window.Chart) {
      callback();
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/chart.js';
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
    const duration = parseInt(this.elements.durationInput.value);

    const errors = [];

    if (sites.length === 0) {
      errors.push("Please add at least one website to monitor");
    }

    sites.forEach(site => {
      if (!this.isValidDomain(site)) {
        errors.push(`"${site}" is not a valid domain name`);
      }
    });

    if (!duration || duration < 1 || duration > 480) {
      errors.push("Timer duration must be between 1 and 480 minutes");
    }

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
      const duration = parseInt(this.elements.durationInput.value);
      
      this.elements.saveBtn.disabled = true;
      this.elements.saveBtn.textContent = 'Saving...';
      
      const syncSettings = {
        allowedSites: sites,
        timerDuration: duration
      };

      chrome.storage.sync.set(syncSettings, () => {
        if (chrome.runtime.lastError) {
          this.showStatus('Failed to save settings: ' + chrome.runtime.lastError.message, 'error');
          this.resetSaveButton();
          return;
        }

        // Clear any existing timers when settings change
        chrome.storage.local.remove(["timerEndTime", "lastTimerDuration"], () => {
          this.showStatus('Settings saved successfully!');
          this.resetSaveButton();
        });
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

  resetSettings() {
    if (!confirm('Are you sure you want to reset all settings? This will:\n\n• Clear all monitored sites\n• Reset timer to 5 minutes\n• Clear any active timers\n• Clear all time tracking data')) {
      return;
    }

    chrome.storage.sync.clear(() => {
      chrome.storage.local.clear(() => {
        this.elements.sitesTextarea.value = '';
        this.elements.durationInput.value = '5';
        
        this.showStatus('All settings and data have been reset');
        
        // Refresh the charts and stats
        this.loadTimeData();
      });
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new ExtensionManager();
});