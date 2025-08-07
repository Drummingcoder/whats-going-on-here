
class CountdownLock {
  constructor() {
    this.timerDuration = 5;
    this.allowedSites = [];
    this.password = null;
    this.timerInterval = null;
    this.endTime = null;
    this.isLocked = false;
    this.isTimerActive = false;
    
    this.init();
  }

  async init() {
    try {
      const settings = await this.getSettings();
      this.allowedSites = settings.allowedSites || [];
      this.timerDuration = settings.timerDuration || 5;

      if (!this.shouldMonitorSite()) {
        return;
      }

      await this.initializePassword();
      
      await this.checkLockStatus();
      
      if (!this.isLocked) {
        await this.checkTimerStatus();
      }
    } catch (error) {
      console.error('CountdownLock initialization error:', error);
    }
  }

  getSettings() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: "getSettings" }, (response) => {
        resolve(response || {});
      });
    });
  }

  shouldMonitorSite() {
    const currentDomain = window.location.hostname;
    return this.allowedSites.some(domain => 
      currentDomain.includes(domain.toLowerCase()) || 
      domain.toLowerCase().includes(currentDomain)
    );
  }

  async initializePassword() {
    return new Promise((resolve) => {
      chrome.storage.local.get("userPassword", (result) => {
        if (!result.userPassword) {
          const pw = prompt("Set your unlock password for this extension:");
          if (pw && pw.trim()) {
            chrome.storage.local.set({ userPassword: pw.trim() }, () => {
              this.password = pw.trim();
              resolve();
            });
          } else {
            console.warn('No password set, extension will not work');
            resolve();
          }
        } else {
          this.password = result.userPassword;
          resolve();
        }
      });
    });
  }

  async checkLockStatus() {
    return new Promise((resolve) => {
      chrome.storage.local.get("lockEndTime", (result) => {
        const lockEndTime = parseInt(result.lockEndTime);
        if (lockEndTime && Date.now() < lockEndTime) {
          this.endTime = lockEndTime;
          this.showLockScreen();
          this.isLocked = true;
        }
        resolve();
      });
    });
  }

  async checkTimerStatus() {
    return new Promise((resolve) => {
      chrome.storage.local.get(["timerEndTime", "lastTimerDuration", "timerActive"], (result) => {
        const timerEndTime = parseInt(result.timerEndTime);
        const lastDuration = result.lastTimerDuration;
        const timerActive = result.timerActive;
        if (timerActive && timerEndTime && Date.now() < timerEndTime && lastDuration === this.timerDuration) {
          this.endTime = timerEndTime;
          this.isTimerActive = true;
          this.createTimerDisplay();
          this.startTimerDisplay();
        } else if (timerActive && timerEndTime && Date.now() >= timerEndTime) {
          this.lockSite();
        } else {
          this.showTimerControls();
        }
        resolve();
      });
    });
  }

  createTimerDisplay() {
    const existingTimer = document.getElementById("countdown-timer");
    if (existingTimer) {
      existingTimer.remove();
    }

    const timer = document.createElement('div');
    timer.id = "countdown-timer";
    timer.className = "countdown-lock-timer";
    
    timer.addEventListener('click', () => {
      if (this.isTimerActive) {
        this.showStopTimerDialog();
      }
    });
    
    timer.style.cursor = 'pointer';
    timer.title = 'Click to stop timer';
    
    document.body.appendChild(timer);
    return timer;
  }

  showTimerControls() {
    const existingControls = document.getElementById("timer-controls");
    if (existingControls) {
      existingControls.remove();
    }

    const controls = document.createElement('div');
    controls.id = "timer-controls";
    controls.className = "countdown-lock-controls";
    controls.innerHTML = `
      <div class="timer-control-content">
        <span>⏰ Start ${this.timerDuration} min timer?</span>
        <button id="start-timer-btn" class="control-btn start-btn">Start</button>
        <button id="dismiss-controls-btn" class="control-btn dismiss-btn">×</button>
      </div>
    `;
    
    document.body.appendChild(controls);

    document.getElementById("start-timer-btn").addEventListener('click', () => {
      controls.remove();
      this.startTimer();
    });

    document.getElementById("dismiss-controls-btn").addEventListener('click', () => {
      controls.remove();
    });

    setTimeout(() => {
      if (document.getElementById("timer-controls")) {
        controls.remove();
      }
    }, 10000);
  }

  startTimer() {
    if (!this.password) {
      return;
    }

    const endTime = Date.now() + (this.timerDuration * 60 * 1000);
    
    chrome.storage.local.set({ 
      timerEndTime: endTime,
      lastTimerDuration: this.timerDuration,
      timerActive: true
    }, () => {
      this.endTime = endTime;
      this.isTimerActive = true;
      
      this.createTimerDisplay();
      this.startTimerDisplay();
    });
  }

  startTimerDisplay() {
    const timerEl = document.getElementById("countdown-timer");
    if (!timerEl) return;

    this.updateTimer(timerEl);
    
    this.timerInterval = setInterval(() => {
      this.updateTimer(timerEl);
    }, 1000);
  }

  updateTimer(timerEl) {
    if (!timerEl || !this.endTime) return;

    const remaining = Math.max(0, this.endTime - Date.now());
    const minutes = Math.floor(remaining / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);
    
    timerEl.textContent = `⏳ ${minutes}:${seconds.toString().padStart(2, "0")}`;
    
    if (remaining <= 0) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
      timerEl.remove();
      this.lockSite();
    }
  }

  showStopTimerDialog() {
    const existingDialog = document.getElementById("stop-timer-dialog");
    if (existingDialog) return;

    const dialog = document.createElement('div');
    dialog.id = "stop-timer-dialog";
    dialog.className = "countdown-lock-overlay";
    
    dialog.innerHTML = `
      <div class="countdown-lock-box small">
        <h3>⏹️ Stop Timer</h3>
        <p>Enter your password to stop the current timer:</p>
        <div class="input-group">
          <input type="password" id="stop-timer-input" placeholder="Enter password..." />
          <button id="stop-timer-btn">Stop</button>
        </div>
        <button id="cancel-stop-btn" class="cancel-btn">Cancel</button>
        <p id="stop-error-message" class="error-message" style="display:none;">Incorrect password!</p>
      </div>
    `;
    
    document.body.appendChild(dialog);

    const stopInput = document.getElementById("stop-timer-input");
    const stopBtn = document.getElementById("stop-timer-btn");
    const cancelBtn = document.getElementById("cancel-stop-btn");
    const errorMsg = document.getElementById("stop-error-message");

    const attemptStop = () => {
      chrome.storage.local.get("userPassword", (result) => {
        const inputPassword = stopInput.value.trim();
        if (inputPassword === result.userPassword) {
          this.stopTimer();
          dialog.remove();
        } else {
          errorMsg.style.display = "block";
          stopInput.value = "";
          stopInput.focus();
          setTimeout(() => {
            errorMsg.style.display = "none";
          }, 3000);
        }
      });
    };

    stopBtn.addEventListener("click", attemptStop);
    stopInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") attemptStop();
    });
    
    cancelBtn.addEventListener("click", () => {
      dialog.remove();
    });

    stopInput.focus();
  }

  stopTimer() {
    chrome.storage.local.remove(["timerEndTime", "lastTimerDuration", "timerActive"], () => {
      if (this.timerInterval) {
        clearInterval(this.timerInterval);
        this.timerInterval = null;
      }

      const timerEl = document.getElementById("countdown-timer");
      if (timerEl) {
        timerEl.remove();
      }

      this.isTimerActive = false;
      this.endTime = null;

      this.showTimerControls();
    });
  }

  lockSite() {
    const lockEndTime = Date.now() + (this.timerDuration * 60 * 1000);
    chrome.storage.local.set({ 
      lockEndTime: lockEndTime,
      timerEndTime: null,
      timerActive: false
    }, () => {
      this.endTime = lockEndTime;
      this.isLocked = true;
      this.isTimerActive = false;
      this.showLockScreen();
    });
  }

  showLockScreen() {
    const existingLock = document.getElementById("lock-overlay");
    if (existingLock) {
      existingLock.remove();
    }

    const overlay = document.createElement('div');
    overlay.id = "lock-overlay";
    overlay.className = "countdown-lock-overlay";
    
    overlay.innerHTML = `
      <div class="countdown-lock-box">
        <h2>🔒 Site Locked</h2>
        <p>Time's up! Enter your password to continue:</p>
        <div class="input-group">
          <input type="password" id="unlock-input" placeholder="Enter password..." />
          <button id="unlock-btn">Unlock</button>
        </div>
        <p id="error-message" class="error-message" style="display:none;">Incorrect password!</p>
        
        <div class="unlock-options">
          <h4>After unlocking:</h4>
          <div class="option-group">
            <label class="radio-option">
              <input type="radio" name="unlock-action" value="start-timer" checked>
              <span>Start new ${this.timerDuration} min timer</span>
            </label>
            <label class="radio-option">
              <input type="radio" name="unlock-action" value="no-timer">
              <span>Browse freely (no timer)</span>
            </label>
          </div>
        </div>
        
        <div id="lock-timer" class="lock-timer"></div>
      </div>
    `;
    
    document.body.appendChild(overlay);

    const unlockBtn = document.getElementById("unlock-btn");
    const unlockInput = document.getElementById("unlock-input");
    const errorMsg = document.getElementById("error-message");

    const attemptUnlock = () => {
      chrome.storage.local.get("userPassword", (result) => {
        const inputPassword = unlockInput.value.trim();
        if (inputPassword === result.userPassword) {
          const selectedAction = document.querySelector('input[name="unlock-action"]:checked').value;
          this.unlockSite(selectedAction === 'start-timer');
        } else {
          errorMsg.style.display = "block";
          unlockInput.value = "";
          unlockInput.focus();
          setTimeout(() => {
            errorMsg.style.display = "none";
          }, 3000);
        }
      });
    };

    unlockBtn.addEventListener("click", attemptUnlock);
    unlockInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        attemptUnlock();
      }
    });

    unlockInput.focus();

    this.updateLockTimer();
    this.lockTimerInterval = setInterval(() => {
      this.updateLockTimer();
    }, 1000);
  }

  updateLockTimer() {
    const lockTimerEl = document.getElementById("lock-timer");
    if (!lockTimerEl || !this.endTime) return;

    const remaining = Math.max(0, this.endTime - Date.now());
    const minutes = Math.floor(remaining / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);
    
    if (remaining > 0) {
      lockTimerEl.textContent = `Lock expires in: ${minutes}:${seconds.toString().padStart(2, "0")}`;
    } else {
      lockTimerEl.textContent = "Lock expired - you can unlock anytime";
      clearInterval(this.lockTimerInterval);
    }
  }

  unlockSite(startNewTimer = true) {
    chrome.storage.local.remove(["lockEndTime", "timerEndTime", "lastTimerDuration", "timerActive"], () => {
      const lockOverlay = document.getElementById("lock-overlay");
      if (lockOverlay) {
        lockOverlay.remove();
      }

      if (this.timerInterval) {
        clearInterval(this.timerInterval);
        this.timerInterval = null;
      }
      if (this.lockTimerInterval) {
        clearInterval(this.lockTimerInterval);
        this.lockTimerInterval = null;
      }

      this.isLocked = false;
      this.isTimerActive = false;
      this.endTime = null;

      if (startNewTimer) {
        this.startTimer();
      } else {
        this.showTimerControls();
      }
    });
  }

  destroy() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
    }
    if (this.lockTimerInterval) {
      clearInterval(this.lockTimerInterval);
    }

    const timer = document.getElementById("countdown-timer");
    const overlay = document.getElementById("lock-overlay");
    const controls = document.getElementById("timer-controls");
    const dialog = document.getElementById("stop-timer-dialog");
    
    if (timer) timer.remove();
    if (overlay) overlay.remove();
    if (controls) controls.remove();
    if (dialog) dialog.remove();
  }
}

let countdownLock = null;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    countdownLock = new CountdownLock();
  });
} else {
  countdownLock = new CountdownLock();
}

window.addEventListener('beforeunload', () => {
  if (countdownLock) {
    countdownLock.destroy();
  }
});

let lastUrl = location.href;
new MutationObserver(() => {
  const url = location.href;
  if (url !== lastUrl) {
    lastUrl = url;
    if (countdownLock) {
      countdownLock.destroy();
    }
    setTimeout(() => {
      countdownLock = new CountdownLock();
    }, 1000);
  }
}).observe(document, { subtree: true, childList: true });