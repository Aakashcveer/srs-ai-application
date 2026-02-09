import yaml from "js-yaml";
import rawConfig from "./chat-config.yaml?raw";

const parsed = yaml.load(rawConfig);

export const CHAT_CONFIG = {
  IDLE_TIMEOUT_MS: parsed.chat.idle_timeout_ms,
  MAX_SESSION_MS: parsed.chat.max_session_ms,
  WARNING_BEFORE_MS: parsed.chat.warning_before_ms,
  REQUEST_TIMEOUT_MS: parsed.chat.backend_timeout_ms,
};
