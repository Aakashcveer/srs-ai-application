const KEY = "chat-session-state";

/**
 * Save chat session state
 * - activeSessionId
 * - lastActivityAt
 * - sessionStartedAt
 */
export const saveSessionState = (state) => {
  sessionStorage.setItem(KEY, JSON.stringify(state));
};

/**
 * Load chat session state
 */
export const loadSessionState = () => {
  try {
    return JSON.parse(sessionStorage.getItem(KEY));
  } catch {
    return null;
  }
};

/**
 * Clear chat session state
 * (used when idle / max session expires)
 */
export const clearSessionState = () => {
  sessionStorage.removeItem(KEY);
};
