class SettingsManager {
  constructor() {
    this.elements = {
      sitesTextarea: document.getElementById("sites"),
      durationInput: document.getElementById("duration"),
      passwordInput: document.getElementById("password"),
      saveBtn: document.getElementById("save"),
      resetBtn: document.getElementById("reset"),
      status: document.getElementById("status")
    };

    this.init();
  }

  init() {
    this.loadSettings();
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

    chrome.storage.local.get("userPassword", (result) => {
      if (result.userPassword) {
        this.elements.passwordInput.placeholder = "Password already set - enter new one to change";
      }
    });
  }

  attachEventListeners() {
    this.elements.saveBtn.addEventListener("click", () => this.saveSettings());
    this.elements.resetBtn.addEventListener("click", () => this.resetSettings());
    
    this.elements.durationInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") this.saveSettings();
    });
    
    this.elements.passwordInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") this.saveSettings();
    });

    this.elements.sitesTextarea.addEventListener("input", () => {
      this.autoResizeTextarea(this.elements.sitesTextarea);
    });
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
    status.className = `status ${type}`;
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
      const password = this.elements.passwordInput.value.trim();
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

        chrome.storage.local.remove(["timerEndTime", "lastTimerDuration"], () => {
          if (password) {
            chrome.storage.local.set({ userPassword: password }, () => {
              if (chrome.runtime.lastError) {
                this.showStatus('Settings saved, but failed to update password', 'error');
              } else {
                this.showStatus('Settings and password saved successfully!');
                this.elements.passwordInput.value = '';
                this.elements.passwordInput.placeholder = 'Password updated - enter new one to change';
              }
              this.resetSaveButton();
            });
          } else {
            this.showStatus('Settings saved successfully!');
            this.resetSaveButton();
          }
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
    if (!confirm('Are you sure you want to reset all settings? This will:\n\n• Clear all monitored sites\n• Reset timer to 5 minutes\n• Remove your password\n• Clear any active timers')) {
      return;
    }

    chrome.storage.sync.clear(() => {
      chrome.storage.local.clear(() => {
        this.elements.sitesTextarea.value = '';
        this.elements.durationInput.value = '5';
        this.elements.passwordInput.value = '';
        this.elements.passwordInput.placeholder = 'Enter new password (optional)';
        
        this.showStatus('All settings have been reset');
      });
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new SettingsManager();
});