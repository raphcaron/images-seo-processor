import { Queue } from './queue.js';

export const queue = new Queue();

export const state = {
  watcherActive: false,
  isProcessing: false,
  currentFile: null,
  processed: 0,
  errors: 0,
  logs: [],
};

const MAX_LOGS = 300;

export const processingFiles = new Set();
export const doneFiles = new Set();

const LEVEL_PREFIX = {
  info: 'ℹ',
  success: '✓',
  error: '✗',
  warn: '⚠',
};

export function addLog(level, message) {
  const entry = {
    time: new Date().toISOString(),
    level,
    message,
  };
  state.logs.push(entry);
  if (state.logs.length > MAX_LOGS) {
    state.logs = state.logs.slice(-MAX_LOGS);
  }
  const prefix = LEVEL_PREFIX[level] || '·';
  console.log(` ${prefix} ${message}`);
}
