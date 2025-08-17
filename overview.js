class OverviewManager {
  constructor() {
    this.elements = {
      // Settings elements
      sitesTextarea: document.getElementById("monitoredSites"),
  // saveBtn and resetBtn removed
      resetSessionBtn: document.getElementById("resetSession"),
      status: document.getElementById("statusMessage"),
      
      // UI elements
      toggleSettingsBtn: document.getElementById("toggleSettings"),
      settingsPanel: document.getElementById("settingsPanel"),
      overviewContent: document.getElementById("overviewContent"),
      settingsContent: document.getElementById("settingsContent"),
      
      // Date selector elements
      dateDisplay: document.getElementById("dateDisplay"),
      datePicker: document.getElementById("datePicker"),
      prevDayBtn: document.getElementById("prevDay"),
      nextDayBtn: document.getElementById("nextDay"),
      
      // Stats elements
      todayTotal: document.getElementById("todayTotal"),
      sitesVisited: document.getElementById("sitesVisited"),
      totalLabel: document.getElementById("totalLabel"),
      
      // Blocking elements
      newBlockedSite: document.getElementById("newBlockedSite"),
      addBlockedSiteBtn: document.getElementById("addBlockedSite"),
      blockedSitesList: document.getElementById("blockedSitesList"),
      emptyState: document.getElementById("emptyState"),
      redirectUrl: document.getElementById("redirectUrl"),
      blockingPassword: document.getElementById("blockingPassword"),
      savePasswordBtn: document.getElementById("savePassword"),
      
      // Schedule elements
      addScheduleRuleBtn: document.getElementById("addScheduleRule"),
      scheduleRulesList: document.getElementById("scheduleRulesList"),
      scheduleEmptyState: document.getElementById("scheduleEmptyState"),
      
      // Chart elements
      pieChart: document.getElementById("pieChart"),
      pieChartPlaceholder: document.getElementById("pieChartPlaceholder"),
      blockSchedule: document.getElementById("blockSchedule"),
      schedulePlaceholder: document.getElementById("schedulePlaceholder")
    };

    this.pieChartInstance = null;
    this.selectedDate = new Date();
    this.blockedSites = []; // Initialize blocked sites array
    this.scheduleRules = []; // Initialize schedule rules array
    this.init();
  }

  init() {
    this.loadSettings();
    this.loadBlockingSettings();
    this.loadScheduleSettings();
    this.initializeDateSelector();
    this.loadTimeData();
    this.attachEventListeners();
  }

  loadSettings() {
    chrome.storage.sync.get(['allowedSites'], (result) => {
      if (result.allowedSites && Array.isArray(result.allowedSites) && this.elements.sitesTextarea) {
        this.elements.sitesTextarea.value = result.allowedSites.join('\n');
      }
    });
  }

  loadBlockingSettings() {
    chrome.storage.sync.get(['blockedSitesList', 'redirectUrl', 'blockingPassword'], (result) => {
      // Load blocked sites list
      this.blockedSites = result.blockedSitesList || [];
      this.renderBlockedSitesList();
      
      // Load redirect URL
      this.elements.redirectUrl.value = result.redirectUrl || '';
      
      // Load password (show placeholder if set)
      if (result.blockingPassword) {
        this.elements.blockingPassword.placeholder = 'Password is set - enter to change';
        this.updatePasswordProtectionUI(true);
      } else {
        this.updatePasswordProtectionUI(false);
      }
    });
    
    // Hide blocking status on load
    this.showBlockingStatus('', '');
  }

  renderBlockedSitesList() {
    const listContainer = this.elements.blockedSitesList;
    const emptyState = this.elements.emptyState;
    
    // Clear existing items except empty state
    const items = listContainer.querySelectorAll('.blocked-site-item');
    items.forEach(item => item.remove());
    
    if (this.blockedSites.length === 0) {
      emptyState.style.display = 'block';
    } else {
      emptyState.style.display = 'none';
      
      this.blockedSites.forEach((siteData, index) => {
        const item = this.createBlockedSiteItem(siteData, index);
        listContainer.appendChild(item);
      });
    }
  }

  createBlockedSiteItem(siteData, index) {
    const item = document.createElement('div');
    item.className = 'blocked-site-item';
    
    const isActive = siteData.enabled !== false; // Default to true if not specified
    
    item.innerHTML = `
      <div class="blocked-site-info">
        <div class="blocked-site-domain">${siteData.domain}</div>
        <div class="blocked-site-status ${isActive ? 'active' : 'inactive'}">
          ${isActive ? 'Blocked' : 'Inactive'}
        </div>
      </div>
      <div class="blocked-site-actions">
        <button class="toggle-block-btn ${isActive ? '' : 'inactive'}" data-index="${index}">
          ${isActive ? 'Disable' : 'Enable'}
        </button>
        <button class="remove-site-btn" data-index="${index}">×</button>
      </div>
    `;
    
    // Add event listeners
    const toggleBtn = item.querySelector('.toggle-block-btn');
    const removeBtn = item.querySelector('.remove-site-btn');
    
    toggleBtn.addEventListener('click', async () => await this.toggleSiteBlocking(index));
    removeBtn.addEventListener('click', async () => await this.removeSite(index));
    
    return item;
  }

  initializeDateSelector() {
    // Set initial date picker value
    this.elements.datePicker.value = this.formatDateForInput(this.selectedDate);
    this.updateDateDisplay();
    this.updateNavigationButtons();
  }

  updateDateDisplay() {
    const today = new Date();
    const selectedDateStr = this.selectedDate.toDateString();
    const todayStr = today.toDateString();
    
    if (selectedDateStr === todayStr) {
      this.elements.dateDisplay.textContent = 'Today';
    } else {
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      
      if (selectedDateStr === yesterday.toDateString()) {
        this.elements.dateDisplay.textContent = 'Yesterday';
      } else {
        this.elements.dateDisplay.textContent = this.selectedDate.toLocaleDateString('en-US', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        });
      }
    }
  }

  updateNavigationButtons() {
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    // Disable next button if selected date is today or later
    this.elements.nextDayBtn.disabled = this.selectedDate >= today;
  }

  formatDateForInput(date) {
    // Format as yyyy-mm-dd in local time
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  navigateDate(direction) {
    const newDate = new Date(this.selectedDate);
    newDate.setDate(newDate.getDate() + direction);
    
    // Don't allow future dates beyond today
    const today = new Date();
    if (newDate > today) {
      return;
    }
    
    this.selectedDate = newDate;
    this.elements.datePicker.value = this.formatDateForInput(this.selectedDate);
    this.updateDateDisplay();
    this.updateNavigationButtons();
    this.loadTimeData();
  }

  loadTimeData() {
    // Get event log for processing events into sessions
    chrome.runtime.sendMessage({ action: "getEventLog" }, (response) => {
      if (response && response.eventLog) {
        const selectedDateStr = this.selectedDate.toDateString();
        const dayEvents = response.eventLog[selectedDateStr] || [];
        
        // Process events into sessions
        const processedSessions = this.processEventsIntoSessions(dayEvents);
        
        // Calculate aggregated data from processed sessions
        const aggregatedData = this.calculateAggregatedTimeFromSessions(processedSessions);
        
        this.lastProcessedSessions = processedSessions;
        this.displayStatsOverview(aggregatedData, processedSessions.length > 0);
        this.createPieChart(aggregatedData);
        this.createBlockSchedule(processedSessions);
      } else {
        // No event log, show empty state
        this.displayStatsOverview({}, false);
        this.elements.pieChartPlaceholder.innerHTML = '<div style="color: #94a3b8;">No data for this date</div>';
        this.elements.schedulePlaceholder.innerHTML = '<div style="color: #94a3b8;">No activity recorded for this date</div>';
      }
    });
  }

  processEventsIntoSessions(events) {
    if (events.length === 0) return [];

    // Sort events by timestamp
    const sortedEvents = [...events].sort((a, b) => a.timestamp - b.timestamp);
    const sessions = [];
    let currentTabSession = null;
    let browserBlurTime = null;

    let lastEventTimestamp = null;
    for (const event of sortedEvents) {
      lastEventTimestamp = event.timestamp;
      switch (event.type) {
        case 'browser_startup':
          // Add as a point event (no duration)
          sessions.push({
            domain: 'browser-startup',
            title: 'Browser Opened',
            startTime: event.timestamp,
            endTime: event.timestamp,
            duration: 0
          });
          break;
        case 'browser_closed':
          // Add as a point event (no duration)
          sessions.push({
            domain: 'browser-closed',
            title: 'Browser Closed',
            startTime: event.timestamp,
            endTime: event.timestamp,
            duration: 0
          });
          break;
        case 'device_sleep_inferred':
          // Add as a point event (no duration)
          sessions.push({
            domain: 'device-sleep',
            title: 'Device Sleep (Inferred)',
            startTime: event.timestamp,
            endTime: event.timestamp,
            duration: 0
          });
          break;
        case 'device_wakeup_inferred':
          // Add as a point event (no duration)
          sessions.push({
            domain: 'device-wakeup',
            title: 'Device Wakeup (Inferred)',
            startTime: event.timestamp,
            endTime: event.timestamp,
            duration: 0
          });
          break;
        case 'extended_inactivity':
          // Add as a point event (no duration)
          sessions.push({
            domain: 'extended-inactivity',
            title: 'Extended Inactivity',
            startTime: event.timestamp,
            endTime: event.timestamp,
            duration: 0
          });
          break;
        case 'tab_activated':
          // If we have a browser blur time but see tab activation, 
          // it means browser_focus was missed - end the away session
          if (browserBlurTime) {
            const awayDuration = event.timestamp - browserBlurTime;
            if (awayDuration > 1000 && awayDuration < 12 * 60 * 60 * 1000) { // Cap at 12 hours
              sessions.push({
                domain: 'away-from-chrome',
                title: 'Away from Chrome',
                startTime: browserBlurTime,
                endTime: event.timestamp,
                duration: awayDuration
              });
            } else {
            }
            browserBlurTime = null;
          }

          // End current tab session if exists
          if (currentTabSession) {
            currentTabSession.endTime = event.timestamp;
            currentTabSession.duration = currentTabSession.endTime - currentTabSession.startTime;
            sessions.push(currentTabSession);
          }
          
          // Start new tab session
          currentTabSession = {
            domain: event.domain,
            title: event.title,
            startTime: event.timestamp,
            endTime: null,
            duration: 0
          };
          break;

        case 'tab_deactivated':
        case 'tab_closed':
          // End current tab session if it matches the event domain
          if (currentTabSession && currentTabSession.domain === event.domain) {
            currentTabSession.endTime = event.timestamp;
            currentTabSession.duration = currentTabSession.endTime - currentTabSession.startTime;
            sessions.push(currentTabSession);
            currentTabSession = null;
          }
          break;

        case 'browser_blur':
          // End current tab session first
          if (currentTabSession) {
            currentTabSession.endTime = event.timestamp;
            currentTabSession.duration = currentTabSession.endTime - currentTabSession.startTime;
            sessions.push(currentTabSession);
            currentTabSession = null;
          }
          
          // Start tracking "away from Chrome" time only if not already tracking
          if (!browserBlurTime) {
            browserBlurTime = event.timestamp;
          } else {
          }
          break;

        case 'browser_focus':
          // End "away from Chrome" session if exists
          if (browserBlurTime) {
            const awayDuration = event.timestamp - browserBlurTime;
            if (awayDuration > 1000) { // Only track if away for more than 1 second
              sessions.push({
                domain: 'away-from-chrome',
                title: 'Away from Chrome',
                startTime: browserBlurTime,
                endTime: event.timestamp,
                duration: awayDuration
              });
            }
            browserBlurTime = null;
          }
          break;

        case 'page_hidden':
          // Page became hidden - treat like browser blur but only if it matches current tab
          if (currentTabSession && currentTabSession.domain === event.domain) {
            currentTabSession.endTime = event.timestamp;
            currentTabSession.duration = currentTabSession.endTime - currentTabSession.startTime;
            sessions.push(currentTabSession);
            currentTabSession = null;
          }
          
          // Start tracking "away from Chrome" time
          if (!browserBlurTime) {
            browserBlurTime = event.timestamp;
          }
          break;

        case 'page_visible':
          // Page became visible - treat like browser focus
          if (browserBlurTime) {
            const awayDuration = event.timestamp - browserBlurTime;
            if (awayDuration > 1000) {
              sessions.push({
                domain: 'away-from-chrome',
                title: 'Away from Chrome',
                startTime: browserBlurTime,
                endTime: event.timestamp,
                duration: awayDuration
              });
            }
            browserBlurTime = null;
          }
          
          // Restart tracking for this page if it's the same domain
          if (event.domain && !currentTabSession) {
            currentTabSession = {
              domain: event.domain,
              title: event.title,
              startTime: event.timestamp,
              endTime: null,
              duration: 0
            };
          }
          break;
      }
    }

    // Handle any ongoing session (if last event was activation and browser is still active)
    if (currentTabSession) {
      currentTabSession.endTime = Date.now();
      currentTabSession.duration = currentTabSession.endTime - currentTabSession.startTime;
      sessions.push(currentTabSession);
    }

    // Handle ongoing "away from Chrome" session
    if (browserBlurTime) {
      const awayDuration = Date.now() - browserBlurTime;
      if (awayDuration > 1000) {
        sessions.push({
          domain: 'away-from-chrome',
          title: 'Away from Chrome',
          startTime: browserBlurTime,
          endTime: Date.now(),
          duration: awayDuration
        });
      }
    }

    return sessions.filter(session =>
      session.duration > 1000 ||
      session.domain === 'browser-startup' ||
      session.domain === 'browser-closed' ||
      session.domain === 'device-sleep' ||
      session.domain === 'device-wakeup' ||
      session.domain === 'extended-inactivity'
    ); // Filter out very short sessions, but always include browser open/close events and device state events
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
    
    return aggregated;
  }

  attachEventListeners() {
    // Settings panel toggle
    this.elements.toggleSettingsBtn.addEventListener("click", () => {
      this.toggleSettingsPanel();
    });
    
    // Date navigation
    this.elements.prevDayBtn.addEventListener("click", () => {
      this.navigateDate(-1);
    });
    
    this.elements.nextDayBtn.addEventListener("click", () => {
      this.navigateDate(1);
    });
    
    this.elements.datePicker.addEventListener("change", (e) => {
      const selectedDate = new Date(e.target.value + 'T12:00:00'); // Add time to avoid timezone issues
      const today = new Date();
      // Zero out time for both dates for comparison
      const selectedDateOnly = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate());
      const todayOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      // Don't allow future dates (date only)
      if (selectedDateOnly > todayOnly) {
        this.elements.datePicker.value = this.formatDateForInput(this.selectedDate);
        return;
      }
      this.selectedDate = selectedDate;
      this.updateDateDisplay();
      this.updateNavigationButtons();
      this.loadTimeData();
    });
    
  // Removed Save/Reset Settings button event listeners
    this.elements.resetSessionBtn.addEventListener("click", () => this.resetTodaysSession());
    
    // Blocking settings
    this.elements.addBlockedSiteBtn.addEventListener("click", () => this.addBlockedSite());
    this.elements.newBlockedSite.addEventListener("keypress", (e) => {
      if (e.key === 'Enter') {
        this.addBlockedSite();
      }
    });
    this.elements.redirectUrl.addEventListener("change", () => this.saveRedirectUrl());
    
    // Password settings
    this.elements.savePasswordBtn.addEventListener("click", async () => await this.saveBlockingPassword());
    this.elements.blockingPassword.addEventListener("keypress", async (e) => {
      if (e.key === 'Enter') {
        await this.saveBlockingPassword();
      }
    });
    
    // Schedule settings
    this.elements.addScheduleRuleBtn.addEventListener("click", () => this.addScheduleRule());
    
    // Auto-resize textareas
    if (this.elements.sitesTextarea) {
      this.elements.sitesTextarea.addEventListener("input", () => {
        this.autoResizeTextarea(this.elements.sitesTextarea);
      });
    }
  }

  toggleSettingsPanel() {
    const isSettingsVisible = this.elements.settingsContent.style.display === 'block';
    
    if (isSettingsVisible) {
      // Show overview, hide settings
      this.elements.overviewContent.style.display = 'block';
      this.elements.settingsContent.style.display = 'none';
      this.elements.toggleSettingsBtn.textContent = 'Settings';
    } else {
      // Hide overview, show settings
      this.elements.overviewContent.style.display = 'none';
      this.elements.settingsContent.style.display = 'block';
      this.elements.toggleSettingsBtn.textContent = 'Close Settings';
    }
  }

  displayStatsOverview(aggregatedData, hasData) {
    // Update label based on selected date
    const today = new Date();
    const isToday = this.selectedDate.toDateString() === today.toDateString();
    this.elements.totalLabel.textContent = isToday ? "Today's Total" : "Total Time";
    
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
      const today = new Date();
      const isToday = this.selectedDate.toDateString() === today.toDateString();
      const emptyMessage = isToday ? 'No data for today yet' : 'No data for this date';
      this.elements.pieChartPlaceholder.innerHTML = `<div style="color: #94a3b8;">${emptyMessage}</div>`;
      this.elements.pieChartPlaceholder.style.display = 'block';
      this.elements.pieChart.style.display = 'none';
      return;
    }

    // Use processed sessions for domain aggregation
    let processedSessions = [];
    if (this.lastProcessedSessions) {
      processedSessions = this.lastProcessedSessions;
    }

    // Aggregate time by domain only
    const domainMap = {};
    processedSessions.forEach(session => {
      const domain = session.domain;
      if (!domainMap[domain]) {
        domainMap[domain] = { time: 0, domain: domain };
      }
      domainMap[domain].time += session.duration;
    });

    // Sort and pick top 8
    const sortedData = Object.values(domainMap)
      .sort((a, b) => b.time - a.time)
      .slice(0, 8);

    const labels = sortedData.map(item => {
      let name = this.getSiteName(item.domain);
      if (item.domain === "napbabpdghpbnpknamdcapnclgohebnm") {
        name = "What's Going ON Here?";
      }
      return name;
    });
    const data = sortedData.map(item => {
      const minutes = item.time / 60000;
      return Math.max(0.1, Math.round(minutes * 10) / 10);
    });

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
    // Map common domains and special cases to their display names
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
      'claude.ai': 'Claude',
      // Special cases
      'away-from-chrome': 'Away From Chrome',
      'chrome-tab-unknown': 'Chrome Tab (unknown)',
      'chrome://newtab': 'New Tab (Chrome)',
      'browser-startup': 'Browser Opened',
      'browser-closed': 'Browser Closed',
      'device-sleep': 'Device Sleep (Inferred)',
      'device-wakeup': 'Device Wakeup (Inferred)',
      'extended-inactivity': 'Extended Inactivity'
    };
    return siteNames[domain] || domain;
  }

  createBlockSchedule(processedSessions) {
    if (processedSessions.length === 0) {
      const today = new Date();
      const isToday = this.selectedDate.toDateString() === today.toDateString();
      const emptyMessage = isToday ? 'No activity recorded today' : 'No activity recorded for this date';
      this.elements.schedulePlaceholder.innerHTML = `<div style="color: #94a3b8;">${emptyMessage}</div>`;
      this.elements.schedulePlaceholder.style.display = 'block';
      this.elements.blockSchedule.style.display = 'none';
      return;
    }

    // Hide placeholder and show schedule
    this.elements.schedulePlaceholder.style.display = 'none';
    this.elements.blockSchedule.style.display = 'block';

    // Create timeline visualization
    const container = this.elements.blockSchedule;
    container.innerHTML = '';
    
    // Sort sessions by start time
    const sortedSessions = processedSessions.sort((a, b) => a.startTime - b.startTime);
    
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
        let displayName = this.getSiteName(session.domain);
        if (session.domain === "napbabpdghpbnpknamdcapnclgohebnm") {
          displayName = "What's Going ON Here?";
        }
        sessionBlock.style.cssText = `
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 6px;
          padding: 8px 12px;
          margin-bottom: 4px;
          font-size: 12px;
        `;
        if (session.domain === 'browser-startup' || session.domain === 'browser-closed' || 
            session.domain === 'device-sleep' || session.domain === 'device-wakeup' || 
            session.domain === 'extended-inactivity') {
          sessionBlock.innerHTML = `
            <div style="font-weight: 500; color: #374151;">${displayName}</div>
            <div style="color: #6b7280;">
              ${startTime.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
            </div>
          `;
        } else {
          const totalSeconds = Math.round(session.duration / 1000);
          const minutes = Math.floor(totalSeconds / 60);
          const seconds = totalSeconds % 60;
          const durationStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
          sessionBlock.innerHTML = `
            <div style="font-weight: 500; color: #374151;">${displayName}</div>
            <div style="color: #6b7280;">
              ${startTime.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})} • ${durationStr}
            </div>
          `;
        }
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

    for (let i = 1; i < sortedSessions.length; i++) {
      const session = sortedSessions[i];
      const timeBetween = session.startTime - currentSession.endTime;
      
      // If same domain and gap is less than 5 minutes (300000ms), merge them
      if (session.domain === currentSession.domain && timeBetween <= 300000) {
        // Extend the current session
        currentSession.endTime = session.endTime;
        currentSession.duration = currentSession.endTime - currentSession.startTime;
      } else {
        // Different domain or gap too large, start new session
        consolidated.push(currentSession);
        currentSession = { ...session };
      }
    }
    
    // Don't forget the last session
    consolidated.push(currentSession);
    
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
    if (!domain || typeof domain !== 'string') {
      return false;
    }
    
    // Basic length and character checks
    if (domain.length === 0 || domain.length > 253) {
      return false;
    }
    
    // Cannot start or end with dot, dash, or have consecutive dots
    if (domain.startsWith('.') || domain.endsWith('.') || 
        domain.startsWith('-') || domain.endsWith('-') ||
        domain.includes('..')) {
      return false;
    }
    
    // Must contain at least one dot (for TLD)
    if (!domain.includes('.')) {
      return false;
    }
    
    // Split into parts and validate each
    const parts = domain.split('.');
    if (parts.length < 2) {
      return false;
    }
    
    // Validate each part
    for (const part of parts) {
      if (part.length === 0 || part.length > 63) {
        return false;
      }
      
      // Each part must start and end with alphanumeric
      if (!/^[a-zA-Z0-9]/.test(part) || !/[a-zA-Z0-9]$/.test(part)) {
        return false;
      }
      
      // Each part can only contain alphanumeric and hyphens
      if (!/^[a-zA-Z0-9-]+$/.test(part)) {
        return false;
      }
    }
    
    // TLD (last part) should be at least 2 characters and only letters
    const tld = parts[parts.length - 1];
    if (tld.length < 2 || !/^[a-zA-Z]+$/.test(tld)) {
      return false;
    }
    
    // Additional checks for common invalid patterns
    if (domain.includes('localhost') || 
        domain.match(/^\d+\.\d+\.\d+\.\d+$/) || // IP address
        domain.includes(' ')) {
      return false;
    }
    
    return true;
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

  showBlockingStatus(message, type = '') {
    const el = document.getElementById('blockingStatusMessage');
    if (!el) return;
    el.textContent = message;
    el.style.display = message ? 'block' : 'none';
    el.style.color = type === 'error' ? '#dc2626' : '#667eea';
  }



  addBlockedSite() {
    const rawDomain = this.elements.newBlockedSite.value.trim();
    
    if (!rawDomain) {
      this.showStatus('Please enter a domain name', 'error');
      return;
    }
    
    // Normalize the domain (remove protocol, www, trailing slashes)
    const normalizedDomain = this.normalizeDomain(rawDomain);
    
    if (!normalizedDomain) {
      this.showStatus('Please enter a valid domain name', 'error');
      return;
    }
    
    if (!this.isValidDomain(normalizedDomain)) {
      this.showStatus(`"${normalizedDomain}" is not a valid domain name`, 'error');
      return;
    }
    
    // Check if already exists (including www variations)
    if (this.isDomainAlreadyBlocked(normalizedDomain)) {
      this.showStatus(`"${normalizedDomain}" is already in your blocked list`, 'error');
      return;
    }
    
    // Add to list
    this.blockedSites.push({
      domain: normalizedDomain,
      enabled: true,
      addedAt: Date.now()
    });
    
    // Clear input
    this.elements.newBlockedSite.value = '';
    
    // Save and update
    this.saveBlockedSitesList();
  }

  normalizeDomain(domain) {
    try {
      // Remove protocol if present
      let normalized = domain.replace(/^https?:\/\//, '');
      
      // Remove www prefix if present
      normalized = normalized.replace(/^www\./, '');
      
      // Remove trailing slash and path
      normalized = normalized.split('/')[0];
      
      // Remove port if present
      normalized = normalized.split(':')[0];
      
      // Convert to lowercase
      normalized = normalized.toLowerCase().trim();
      
      return normalized || null;
    } catch (error) {
      return null;
    }
  }

  isDomainAlreadyBlocked(domain) {
    const normalizedInput = this.normalizeDomain(domain);
    
    return this.blockedSites.some(site => {
      const normalizedExisting = this.normalizeDomain(site.domain);
      return normalizedExisting === normalizedInput;
    });
  }

  async toggleSiteBlocking(index) {
    if (index >= 0 && index < this.blockedSites.length) {
      const site = this.blockedSites[index];
      // If we're trying to disable blocking (unblock), check password
      if (site.enabled) {
        const authorized = await this.checkPassword();
        if (!authorized) {
          return; // Password check failed, don't allow unblocking
        }
      }
      
      this.blockedSites[index].enabled = !this.blockedSites[index].enabled;
      this.saveBlockedSitesList();
    }
  }

  async removeSite(index) {
    if (index >= 0 && index < this.blockedSites.length) {
      const domain = this.blockedSites[index].domain;
      
      // Check password before allowing removal
      const authorized = await this.checkPassword();
      if (!authorized) {
        return; // Password check failed, don't allow removal
      }
      
      if (confirm(`Remove "${domain}" from blocked sites?`)) {
        this.blockedSites.splice(index, 1);
        this.saveBlockedSitesList();
      }
    }
  }

  saveRedirectUrl() {
    let redirectUrl = this.elements.redirectUrl.value.trim();
    // If user entered a URL without protocol, prepend https://
    if (redirectUrl && !/^https?:\/\//i.test(redirectUrl)) {
      redirectUrl = 'https://' + redirectUrl;
    }

    if (redirectUrl && !this.isValidUrl(redirectUrl)) {
      this.showStatus("Redirect URL is not valid", 'error');
      return;
    }

    chrome.storage.sync.set({ redirectUrl: redirectUrl }, () => {
      if (chrome.runtime.lastError) {
        this.showStatus('Failed to save redirect URL: ' + chrome.runtime.lastError.message, 'error');
        return;
      }
      this.updateBlockingRules();
    });
  }

  async saveBlockingPassword() {
    const newPassword = this.elements.blockingPassword.value.trim();
    
    // Check if password protection is currently enabled
    const currentPasswordSet = await this.isPasswordSet();
    
    if (currentPasswordSet) {
      // Verify current password before allowing changes
      const authorized = await this.checkPassword();
      if (!authorized) {
        this.elements.blockingPassword.value = ''; // Clear the input
        return; // Password verification failed
      }
    }
    
    if (newPassword === '') {
      // Remove password protection
      chrome.storage.sync.remove('blockingPassword', () => {
        if (chrome.runtime.lastError) {
          this.showStatus('Failed to remove password: ' + chrome.runtime.lastError.message, 'error');
          return;
        }
        this.elements.blockingPassword.placeholder = 'Enter password to protect blocking settings';
        this.elements.blockingPassword.value = '';
        this.updatePasswordProtectionUI(false);
        this.showStatus('Password protection disabled');
      });
    } else {
      // Set new password protection
      chrome.storage.sync.set({ blockingPassword: newPassword }, () => {
        if (chrome.runtime.lastError) {
          this.showStatus('Failed to save password: ' + chrome.runtime.lastError.message, 'error');
          return;
        }
        this.elements.blockingPassword.placeholder = 'Password is set - enter to change';
        this.elements.blockingPassword.value = '';
        this.updatePasswordProtectionUI(true);
        this.showStatus(currentPasswordSet ? 'Password updated successfully' : 'Password protection enabled');
      });
    }
  }

  updatePasswordProtectionUI(isProtected) {
    const blockingSection = document.getElementById('blockingSection');
    if (!blockingSection) return;
    const sectionTitle = blockingSection.querySelector('.section-title');
    if (!sectionTitle) return;

    if (isProtected) {
      if (!sectionTitle.querySelector('.lock-icon')) {
        const lockIcon = document.createElement('span');
        lockIcon.className = 'lock-icon';
        lockIcon.textContent = '🔒';
        lockIcon.style.marginLeft = '8px';
        lockIcon.title = 'Password protected';
        sectionTitle.appendChild(lockIcon);
      }
    } else {
      const lockIcon = sectionTitle.querySelector('.lock-icon');
      if (lockIcon) {
        lockIcon.remove();
      }
    }
  }

  async isPasswordSet() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(['blockingPassword'], (result) => {
        resolve(!!result.blockingPassword);
      });
    });
  }

  async checkPassword() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(['blockingPassword'], (result) => {
        if (!result.blockingPassword) {
          resolve(true); // No password set, allow action
          return;
        }
        
        const enteredPassword = prompt('Enter password to modify blocking settings:');
        if (enteredPassword === null) {
          resolve(false); // User cancelled
          return;
        }
        
        if (enteredPassword === result.blockingPassword) {
          resolve(true); // Correct password
        } else {
          alert('Incorrect password!');
          resolve(false); // Wrong password
        }
      });
    });
  }

  saveBlockedSitesList() {
    chrome.storage.sync.set({ blockedSitesList: this.blockedSites }, () => {
      if (chrome.runtime.lastError) {
        this.showStatus('Failed to save blocked sites: ' + chrome.runtime.lastError.message, 'error');
        return;
      }
      
      this.renderBlockedSitesList();
      this.updateBlockingRules();
      this.showStatus('Blocked sites updated successfully!');
    });
  }

  updateBlockingRules() {
    this.showBlockingStatus('Updating blocking rules...', '');
    
    // Get enabled sites only
    const enabledSites = this.blockedSites
      .filter(site => site.enabled !== false)
      .map(site => site.domain);
    
    const redirectUrl = this.elements.redirectUrl.value.trim();
    
    const blockingSettings = {
      blockedSites: enabledSites,
      redirectUrl: redirectUrl || ''
    };
    
    console.log('Sending blocking rules update:', blockingSettings);
    
    // Try with a shorter timeout
    const messageTimeout = setTimeout(() => {
      console.log('Message timeout - trying alternative approach');
      this.updateBlockingRulesAlternative(blockingSettings);
    }, 3000);
    
    chrome.runtime.sendMessage({
      action: 'updateBlockingRules',
      settings: blockingSettings
    }, (response) => {
      clearTimeout(messageTimeout);
      console.log('Blocking rules response:', response);
      
      if (chrome.runtime.lastError) {
        console.error('Runtime error:', chrome.runtime.lastError);
        this.updateBlockingRulesAlternative(blockingSettings);
        return;
      }
      
      if (response && response.success) {
        this.showBlockingStatus('Blocking rules are active!', '');
      } else {
        const errorMsg = response && response.error ? 
          `Error: ${response.error}` : 
          'Settings saved, but blocking rules may not be active yet';
        this.showBlockingStatus(errorMsg, 'error');
        console.error('Blocking rules update failed:', response);
      }
    });
  }

  updateBlockingRulesAlternative(blockingSettings) {
    // Fallback: Just save settings and show a message
    console.log('Using alternative blocking rules update');
    chrome.storage.sync.set({
      pendingBlockingUpdate: blockingSettings,
      blockingUpdateTimestamp: Date.now()
    }, () => {
      if (chrome.runtime.lastError) {
        this.showBlockingStatus('Failed to save blocking settings', 'error');
      } else {
        this.showBlockingStatus('Settings saved. Reload extension if blocking doesn\'t work.', '');
        // Trigger a page reload of the background script
        chrome.runtime.reload && chrome.runtime.reload();
      }
    });
  }


  // Schedule management methods
  loadScheduleSettings() {
    chrome.storage.sync.get(['blockingScheduleRules'], (result) => {
      this.scheduleRules = result.blockingScheduleRules || [];
      this.renderScheduleRulesList();
    });
  }

  addScheduleRule() {
    const newRule = {
      id: Date.now(),
      name: `Schedule Rule ${this.scheduleRules.length + 1}`,
      days: [], // 0=Sunday, 1=Monday, etc.
      startTime: '09:00',
      endTime: '17:00',
      websites: []
    };

    this.scheduleRules.push(newRule);
    this.renderScheduleRulesList();
    this.saveScheduleRules();
  }

  async removeScheduleRule(ruleId) {
    console.log('Removing schedule rule:', ruleId);
    
    // Check password before allowing removal
    const authorized = await this.checkPassword();
    if (!authorized) {
      return; // Password check failed, don't allow removal
    }
    
    console.log('Before removal:', this.scheduleRules.length, 'rules');
    this.scheduleRules = this.scheduleRules.filter(rule => rule.id !== ruleId);
    console.log('After removal:', this.scheduleRules.length, 'rules');
    this.renderScheduleRulesList();
    this.saveScheduleRules();
  }

  updateScheduleRule(ruleId, updates) {
    const rule = this.scheduleRules.find(r => r.id === ruleId);
    if (rule) {
      Object.assign(rule, updates);
      // Re-render to update time displays if time changed
      if (updates.startTime || updates.endTime) {
        this.renderScheduleRulesList();
      }
      this.saveScheduleRules();
    }
  }

  saveScheduleRules() {
    chrome.storage.sync.set({ blockingScheduleRules: this.scheduleRules }, () => {
      if (chrome.runtime.lastError) {
        this.showStatus('Failed to save schedule rules: ' + chrome.runtime.lastError.message, 'error');
        return;
      }
      this.updateBlockingRules(); // Update blocking with new schedule
    });
  }

  renderScheduleRulesList() {
    const container = this.elements.scheduleRulesList;
    const emptyState = this.elements.scheduleEmptyState;

    if (this.scheduleRules.length === 0) {
      emptyState.style.display = 'block';
      container.innerHTML = '';
      container.appendChild(emptyState);
      return;
    }

    emptyState.style.display = 'none';
    container.innerHTML = '';

    this.scheduleRules.forEach(rule => {
      const ruleElement = this.createScheduleRuleElement(rule);
      container.appendChild(ruleElement);
    });
  }

  createScheduleRuleElement(rule) {
    const ruleDiv = document.createElement('div');
    ruleDiv.className = 'schedule-rule-item';
    ruleDiv.dataset.ruleId = rule.id;
    
    // Convert 24-hour time to 12-hour format for display
    const formatTimeForDisplay = (time24) => {
      const [hours, minutes] = time24.split(':');
      const hour12 = ((parseInt(hours) + 11) % 12) + 1;
      const ampm = parseInt(hours) >= 12 ? 'PM' : 'AM';
      return `${hour12}:${minutes} ${ampm}`;
    };
    
    ruleDiv.innerHTML = `
      <div class="schedule-rule-header">
        <input type="text" class="schedule-rule-title" value="${rule.name}" 
               placeholder="Rule name">
        <button class="remove-schedule-btn" 
                title="Delete this schedule rule">
          X
        </button>
      </div>
      
      <div class="schedule-rule-controls">
        <div class="time-range-section">
          <label style="font-size: 12px; font-weight: 600; color: #374151; display: block; margin-bottom: 6px;">Time Range</label>
          <div class="time-inputs">
            <div class="time-input-group">
              <input type="time" class="time-input start-time" value="${rule.startTime}" 
                     title="${formatTimeForDisplay(rule.startTime)}">
              <span class="time-display">${formatTimeForDisplay(rule.startTime)}</span>
            </div>
            <span style="color: #6b7280; padding: 0 8px;">to</span>
            <div class="time-input-group">
              <input type="time" class="time-input end-time" value="${rule.endTime}" 
                     title="${formatTimeForDisplay(rule.endTime)}">
              <span class="time-display">${formatTimeForDisplay(rule.endTime)}</span>
            </div>
          </div>
        </div>
        
        <div class="days-section">
          <label style="font-size: 12px; font-weight: 600; color: #374151; display: block; margin-bottom: 6px;">Days of Week</label>
          <div class="days-selector">
            ${this.createDayButtons(rule)}
          </div>
        </div>
      </div>
      
      <div class="websites-selector">
        <label style="font-size: 12px; font-weight: 600; color: #374151; display: block; margin-bottom: 6px;">Apply to Websites</label>
        <div class="websites-checkboxes">
          ${this.createWebsiteCheckboxes(rule)}
        </div>
      </div>
    `;

    // Add event listeners after creating the element
    this.attachScheduleRuleEventListeners(ruleDiv, rule);

    return ruleDiv;
  }

  createDayButtons(rule) {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return days.map((day, index) => {
      const isActive = rule.days.includes(index);
      return `
        <button class="day-btn ${isActive ? 'active' : ''}" data-day-index="${index}">
          ${day}
        </button>
      `;
    }).join('');
  }

  createWebsiteCheckboxes(rule) {
    if (this.blockedSites.length === 0) {
      return '<span style="color: #6b7280; font-style: italic;">No blocked websites available</span>';
    }

    return this.blockedSites.map(site => {
      const isSelected = rule.websites.includes(site.domain);
      return `
        <label class="website-checkbox ${isSelected ? 'selected' : ''}" data-domain="${site.domain}">
          <input type="checkbox" ${isSelected ? 'checked' : ''}>
          ${site.domain}
        </label>
      `;
    }).join('');
  }

  attachScheduleRuleEventListeners(ruleDiv, rule) {
    const ruleId = rule.id;
    
    // Title input event listener
    const titleInput = ruleDiv.querySelector('.schedule-rule-title');
    titleInput.addEventListener('change', (e) => {
      this.updateScheduleRule(ruleId, { name: e.target.value });
    });
    
    // Delete button event listener
    const deleteBtn = ruleDiv.querySelector('.remove-schedule-btn');
    deleteBtn.addEventListener('click', async () => {
      await this.removeScheduleRule(ruleId);
    });
    
    // Time input event listeners
    const startTimeInput = ruleDiv.querySelector('.start-time');
    startTimeInput.addEventListener('change', (e) => {
      this.updateScheduleRule(ruleId, { startTime: e.target.value });
    });
    
    const endTimeInput = ruleDiv.querySelector('.end-time');
    endTimeInput.addEventListener('change', (e) => {
      this.updateScheduleRule(ruleId, { endTime: e.target.value });
    });
    
    // Day button event listeners
    const dayButtons = ruleDiv.querySelectorAll('.day-btn');
    dayButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const dayIndex = parseInt(btn.dataset.dayIndex);
        this.toggleRuleDay(ruleId, dayIndex);
      });
    });
    
    // Website checkbox event listeners
    const websiteCheckboxes = ruleDiv.querySelectorAll('.website-checkbox');
    websiteCheckboxes.forEach(checkbox => {
      checkbox.addEventListener('click', (e) => {
        e.preventDefault(); // Prevent default checkbox behavior
        const domain = checkbox.dataset.domain;
        this.toggleRuleWebsite(ruleId, domain);
      });
    });
  }

  toggleRuleDay(ruleId, dayIndex) {
    console.log('Toggling day:', ruleId, dayIndex);
    const rule = this.scheduleRules.find(r => r.id === ruleId);
    if (rule) {
      const dayIndex_num = parseInt(dayIndex);
      if (rule.days.includes(dayIndex_num)) {
        rule.days = rule.days.filter(d => d !== dayIndex_num);
      } else {
        rule.days.push(dayIndex_num);
      }
      console.log('Updated rule days:', rule.days);
      this.renderScheduleRulesList();
      this.saveScheduleRules();
    }
  }

  toggleRuleWebsite(ruleId, domain) {
    console.log('Toggling website:', ruleId, domain);
    const rule = this.scheduleRules.find(r => r.id === ruleId);
    if (rule) {
      if (rule.websites.includes(domain)) {
        rule.websites = rule.websites.filter(w => w !== domain);
      } else {
        rule.websites.push(domain);
      }
      console.log('Updated rule websites:', rule.websites);
      this.renderScheduleRulesList();
      this.saveScheduleRules();
    }
  }

  isValidUrl(string) {
    try {
      new URL(string);
      return true;
    } catch (_) {
      return false;
    }
  }

  resetTodaysSession() {
    if (!confirm('Reset ALL browsing session data?\n\nThis will clear:\n• All event tracking for all days\n• All activity logs\n• Charts and stats will reset to 0\n\nThis action cannot be undone.')) {
      return;
    }

    // Clear all time tracking and event log data
    chrome.storage.local.set({ timeTracking: {}, eventLog: {} }, () => {
      if (chrome.runtime.lastError) {
        this.showStatus('Failed to reset session data', 'error');
        return;
      }
      this.showStatus('All session data has been reset');
      this.loadTimeData();
    });
  }


}

document.addEventListener('DOMContentLoaded', () => {
  window.overviewManager = new OverviewManager();
});
