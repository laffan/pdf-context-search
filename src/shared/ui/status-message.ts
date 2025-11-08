import { statusMessage } from '../data/state';

export function showStatus(message: string, type: 'info' | 'error' | 'success') {
  statusMessage.textContent = message;
  statusMessage.className = type;
  setTimeout(() => {
    statusMessage.className = '';
    statusMessage.textContent = '';
  }, 5000);
}
