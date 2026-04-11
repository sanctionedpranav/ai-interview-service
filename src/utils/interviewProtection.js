/**
 * Interview Protection Utility (Frontend & Backend)
 * 
 * Protects the interview environment by:
 * 1. Preventing page refresh
 * 2. Blocking browser back/forward navigation
 * 3. Preventing copy-paste
 * 4. Disabling right-click context menu
 * 5. Detecting tab switching and monitoring
 * 
 * This utility can be used in the frontend to enforce interview integrity.
 * All suspicious events are logged to the backend via the /interview/cheating-event endpoint.
 */

/**
 * Initialize interview protection mechanisms
 * Call this function when the interview starts
 * 
 * @param {string} sessionId - The interview session ID
 * @param {object} config - Configuration options
 * @returns {Promise<void>}
 */
export async function initInterviewProtection(sessionId, config = {}) {
  const defaultConfig = {
    apiBaseUrl: config.apiBaseUrl || 'http://localhost:5005/interview',
    enableRefreshBlock: config.enableRefreshBlock !== false,
    enableBackForwardBlock: config.enableBackForwardBlock !== false,
    enableCopyPasteBlock: config.enableCopyPasteBlock !== false,
    enableRightClickBlock: config.enableRightClickBlock !== false,
    enableTabSwitchDetection: config.enableTabSwitchDetection !== false,
    enableDevToolsBlock: config.enableDevToolsBlock || false,
    autoTerminateOnMultipleEvents: config.autoTerminateonMultipleEvents || false,
    logToConsole: config.logToConsole !== false,
  };

  if (!sessionId) {
    throw new Error('sessionId is required for interview protection');
  }

  const protectionState = {
    sessionId,
    suspiciousEventCount: 0,
    tabSwitchCount: 0,
    lastTabSwitchTime: null,
    copyAttemptCount: 0,
    refreshAttemptCount: 0,
    rightClickCount: 0,
    tabsOpen: 1,
    isPageVisible: true,
  };

  // ── Initialize Protection Mechanisms ──────────────────────────────────────
  if (defaultConfig.enableRefreshBlock) {
    enableRefreshProtection(sessionId, protectionState, defaultConfig);
  }

  if (defaultConfig.enableBackForwardBlock) {
    enableBackForwardProtection(sessionId, protectionState, defaultConfig);
  }

  if (defaultConfig.enableCopyPasteBlock) {
    enableCopyPasteProtection(sessionId, protectionState, defaultConfig);
  }

  if (defaultConfig.enableRightClickBlock) {
    enableRightClickProtection(sessionId, protectionState, defaultConfig);
  }

  if (defaultConfig.enableTabSwitchDetection) {
    enableTabSwitchDetection(sessionId, protectionState, defaultConfig);
  }

  if (defaultConfig.enableDevToolsBlock) {
    enableDevToolsBlock(sessionId, protectionState, defaultConfig);
  }

  // Store protection state on window object for global access
  window.__interviewProtection = protectionState;

  if (defaultConfig.logToConsole) {
    console.log(`✅ Interview Protection Initialized for session: ${sessionId}`);
  }
}

/**
 * ── SCENARIO 1: Page Refresh Protection ──────────────────────────────────
 */
function enableRefreshProtection(sessionId, state, config) {
  // Method 1: Page beforeunload event
  window.addEventListener('beforeunload', (e) => {
    state.refreshAttemptCount++;
    logEvent(sessionId, 'PAGE_REFRESH_ATTEMPT', {
      attemptNumber: state.refreshAttemptCount,
      timestamp: new Date().toISOString(),
      url: window.location.href,
    }, config);

    // Show browser's native confirmation dialog
    e.preventDefault();
    e.returnValue = 'You are in the middle of an interview. Please complete the interview or quit. Refreshing will record a suspicious event.';
    return e.returnValue;
  });

  // Method 2: Keyboard shortcut blocking (F5, Ctrl+R, Cmd+R)
  document.addEventListener('keydown', (e) => {
    if (
      e.key === 'F5' ||
      (e.ctrlKey && e.key === 'r') ||
      (e.metaKey && e.key === 'r')
    ) {
      e.preventDefault();
      state.refreshAttemptCount++;
      logEvent(sessionId, 'REFRESH_HOTKEY_BLOCKED', {
        hotkey: e.key,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
      }, config);

      // Show toast or alert to user
      showNotification('⚠️ Page refresh is disabled during the interview. Complete or quit the interview.');
      return false;
    }
  });
}

/**
 * ── SCENARIO 2: Browser Back/Forward Protection ──────────────────────────
 */
function enableBackForwardProtection(sessionId, state, config) {
  // Push a history state to prevent back button
  window.history.pushState(null, '', window.location.href);

  window.addEventListener('popstate', (e) => {
    // Push state again to prevent going back
    window.history.pushState(null, '', window.location.href);

    logEvent(sessionId, 'BACK_BUTTON_ATTEMPT', {
      timestamp: new Date().toISOString(),
      url: window.location.href,
    }, config);

    showNotification('⚠️ You cannot navigate away from the interview. Please complete or quit.');
  });

  // Disable keyboard shortcuts for back navigation (Alt+Left, Backspace)
  document.addEventListener('keydown', (e) => {
    if (
      (e.altKey && e.key === 'ArrowLeft') ||
      (e.key === 'Backspace' && !isInputElement(e.target))
    ) {
      e.preventDefault();
      logEvent(sessionId, 'BACK_NAVIGATION_BLOCKED', {
        key: e.key,
        altKey: e.altKey,
      }, config);
      showNotification('⚠️ You cannot navigate away from the interview.');
      return false;
    }
  });
}

/**
 * ── SCENARIO 3: Copy-Paste Prevention ────────────────────────────────────
 */
function enableCopyPasteProtection(sessionId, state, config) {
  // Block copy command
  document.addEventListener('copy', (e) => {
    if (!isAllowedElement(e.target)) {
      e.preventDefault();
      state.copyAttemptCount++;
      logEvent(sessionId, 'COPY_ATTEMPT_BLOCKED', {
        attemptNumber: state.copyAttemptCount,
        targetElement: e.target.tagName,
      }, config);
      showNotification('❌ Copy is disabled during the interview.');
    }
  });

  // Block cut command
  document.addEventListener('cut', (e) => {
    if (!isAllowedElement(e.target)) {
      e.preventDefault();
      logEvent(sessionId, 'CUT_ATTEMPT_BLOCKED', {
        targetElement: e.target.tagName,
      }, config);
      showNotification('❌ Cut is disabled during the interview.');
    }
  });

  // Block paste command
  document.addEventListener('paste', (e) => {
    if (!isAllowedElement(e.target)) {
      e.preventDefault();
      logEvent(sessionId, 'PASTE_ATTEMPT_BLOCKED', {
        targetElement: e.target.tagName,
      }, config);
      showNotification('❌ Paste is disabled during the interview.');
    }
  });

  // Block Ctrl+C / Cmd+C
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
      if (!isAllowedElement(e.target)) {
        e.preventDefault();
        logEvent(sessionId, 'CTRL_C_BLOCKED', {}, config);
        return false;
      }
    }
  });
}

/**
 * ── SCENARIO 4: Right-Click Context Menu Disable ──────────────────────────
 */
function enableRightClickProtection(sessionId, state, config) {
  document.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    state.rightClickCount++;
    logEvent(sessionId, 'RIGHT_CLICK_BLOCKED', {
      attemptNumber: state.rightClickCount,
      targetElement: e.target.tagName,
      coordinates: { x: e.clientX, y: e.clientY },
    }, config);
    showNotification('❌ Right-click is disabled during the interview.');
    return false;
  });
}

/**
 * ── SCENARIO 5: Tab Switching Detection ──────────────────────────────────
 */
function enableTabSwitchDetection(sessionId, state, config) {
  // Detect page visibility change (tab switching)
  document.addEventListener('visibilitychange', () => {
    state.isPageVisible = !document.hidden;

    if (document.hidden) {
      // User switched away from this tab
      state.tabSwitchCount++;
      state.lastTabSwitchTime = new Date();
      logEvent(sessionId, 'TAB_SWITCH_AWAY', {
        switchNumber: state.tabSwitchCount,
        timestamp: new Date().toISOString(),
      }, config);
      showNotification('⚠️ You switched tabs! This is being recorded.', 'warning');
    } else {
      // User switched back to this tab
      logEvent(sessionId, 'TAB_SWITCH_BACK', {
        returnTime: new Date().toISOString(),
      }, config);
    }
  });

  // Detect window focus changes (alt+tab, cmd+tab)
  window.addEventListener('focus', () => {
    if (!state.isPageVisible) {
      state.tabSwitchCount++;
      logEvent(sessionId, 'WINDOW_FOCUS_REGAINED', {
        switchNumber: state.tabSwitchCount,
      }, config);
    }
  });

  window.addEventListener('blur', () => {
    logEvent(sessionId, 'WINDOW_FOCUS_LOST', {
      timestamp: new Date().toISOString(),
    }, config);
  });
}

/**
 * ── SCENARIO 6: DevTools Detection & Blocking (Optional) ──────────────────
 */
function enableDevToolsBlock(sessionId, state, config) {
  // Detect DevTools opening via keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (
      e.key === 'F12' ||
      (e.ctrlKey && e.shiftKey && e.key === 'I') ||
      (e.ctrlKey && e.shiftKey && e.key === 'J') ||
      (e.ctrlKey && e.shiftKey && e.key === 'C') ||
      (e.metaKey && e.altKey && e.key === 'I') ||
      (e.metaKey && e.altKey && e.key === 'U') ||
      (e.metaKey && e.altKey && e.key === 'J')
    ) {
      e.preventDefault();
      logEvent(sessionId, 'DEVTOOLS_ATTEMPT_BLOCKED', {
        key: e.key,
        combination: 'Ctrl+Shift+I or F12 or Cmd+Option+I',
      }, config);
      showNotification('❌ Developer tools are not allowed during the interview.', 'error');
      return false;
    }
  });

  // Detect DevTools opening via right-click inspect
  document.addEventListener('contextmenu', (e) => {
    logEvent(sessionId, 'DEVTOOLS_CONTEXT_MENU_BLOCKED', {}, config);
  });
}

/**
 * Log a suspicious event to the backend
 * @private
 */
async function logEvent(sessionId, eventType, metadata, config) {
  try {
    await fetch(`${config.apiBaseUrl}/cheating-event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        event: eventType,
        timestamp: new Date(),
        metadata,
      }),
    });
  } catch (err) {
    console.error('Failed to log event:', err);
  }
}

/**
 * Helper: Check if element is an allowed input field
 * @private
 */
function isAllowedElement(element) {
  if (!element) return false;
  const allowedTags = ['INPUT', 'TEXTAREA'];
  const allowedTypes = ['text', 'email', 'password', 'search', 'url', 'number', 'tel'];
  
  if (allowedTags.includes(element.tagName)) {
    return !allowedTypes.includes(element.type) || element.dataset.interviewAnswer === 'true';
  }
  return element.contentEditable === 'true' || element.dataset.interviewAnswer === 'true';
}

/**
 * Helper: Check if element is an input field
 * @private
 */
function isInputElement(element) {
  return element.tagName === 'INPUT' || element.tagName === 'TEXTAREA';
}

/**
 * Show notification to user
 * @private
 */
function showNotification(message, type = 'info') {
  // Simple implementation - can be replaced with toast library
  const notification = document.createElement('div');
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 12px 20px;
    background-color: ${type === 'error' ? '#ff6b6b' : type === 'warning' ? '#ffd43b' : '#4c6ef5'};
    color: white;
    border-radius: 6px;
    font-size: 14px;
    z-index: 9999;
    animation: slideIn 0.3s ease-out;
  `;
  notification.textContent = message;
  notification.className = `interview-protection-notification ${type}`;
  
  document.body.appendChild(notification);
  
  // Auto-remove after 3 seconds
  setTimeout(() => {
    notification.style.animation = 'slideOut 0.3s ease-out';
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

/**
 * Disable interview protection (useful when user quits/completes)
 * @param {string} reason - Reason for disabling protection
 */
export function disableInterviewProtection(reason = 'interview_completed') {
  if (window.__interviewProtection) {
    // Remove all event listeners by removing and re-adding elements
    document.removeEventListener('beforeunload', null);
    document.removeEventListener('keydown', null);
    document.removeEventListener('copy', null);
    document.removeEventListener('cut', null);
    document.removeEventListener('paste', null);
    document.removeEventListener('contextmenu', null);
    document.removeEventListener('visibilitychange', null);
    
    window.__interviewProtection = null;
    console.log(`✅ Interview protection disabled: ${reason}`);
  }
}

/**
 * Get current protection state (for monitoring/logging)
 */
export function getProtectionState() {
  return window.__interviewProtection || null;
}

/**
 * Get statistics of protection events
 */
export function getProtectionStats() {
  const state = window.__interviewProtection;
  if (!state) return null;

  return {
    totalSuspiciousEvents: state.suspiciousEventCount,
    tabSwitches: state.tabSwitchCount,
    copyAttempts: state.copyAttemptCount,
    refreshAttempts: state.refreshAttemptCount,
    rightClickAttempts: state.rightClickCount,
    isPageVisible: state.isPageVisible,
  };
}
