import { invoke } from "@tauri-apps/api/core";
import { showStatus } from './status-message';

export function copyCitation(citekey: string, link: string, button: HTMLButtonElement) {
  const citation = `[@${citekey}](${link})`;

  navigator.clipboard.writeText(citation).then(() => {
    // Show success feedback
    const originalText = button.textContent;
    button.textContent = '✓ Copied';
    button.style.opacity = '0.7';

    setTimeout(() => {
      button.textContent = originalText;
      button.style.opacity = '1';
    }, 2000);
  }).catch(() => {
    showStatus('Failed to copy citation to clipboard', 'error');
  });
}

export async function openInZotero(attachmentKey: string, pageNumber: number, element: HTMLButtonElement | HTMLAnchorElement) {
  // Generate the zotero:// URL for opening the PDF at a specific page
  const zoteroUrl = `zotero://open-pdf/library/items/${attachmentKey}?page=${pageNumber}`;

  try {
    // Use the opener plugin via invoke
    await invoke('plugin:opener|open_url', { url: zoteroUrl });

    // Show success feedback
    const originalText = element.textContent;
    element.textContent = '✓ Opened';
    element.style.opacity = '0.7';

    setTimeout(() => {
      element.textContent = originalText;
      element.style.opacity = '1';
    }, 2000);
  } catch (error) {
    showStatus(`Failed to open in Zotero: ${error}`, 'error');
  }
}
