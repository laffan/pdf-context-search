import { invoke } from '@tauri-apps/api/core';
import { directAddInput, directAddResults, directoryPath, zoteroMode, zoteroPath } from '../../shared/data/state';
import type { PdfListItem, ListPdfsParams } from '../../shared/data/types';
import { escapeHtml } from '../../shared/ui/html-utils';
import { showStatus } from '../../shared/ui/status-message';
import { pinPdfDirectly } from './direct-add-pin';

let searchTimeout: number | null = null;
let currentResults: PdfListItem[] = [];

export function initializeDirectAdd() {
  // Add input event listener with debouncing
  directAddInput.addEventListener('input', () => {
    if (searchTimeout !== null) {
      clearTimeout(searchTimeout);
    }

    searchTimeout = window.setTimeout(() => {
      performDirectSearch();
    }, 300); // 300ms debounce
  });

  // Add event delegation for pin buttons
  directAddResults.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.classList.contains('direct-add-pin-btn')) {
      const filePath = target.dataset.filePath;
      if (filePath) {
        // Find the full PdfListItem from current results
        const item = currentResults.find(r => r.file_path === filePath);
        if (item) {
          pinPdfDirectly(item);
        }
      }
    }
  });
}

async function performDirectSearch() {
  const searchQuery = directAddInput.value.trim();
  const directory = directoryPath.textContent?.trim();

  // Clear results if search is empty
  if (!searchQuery) {
    directAddResults.classList.remove('has-results');
    directAddResults.innerHTML = '';
    return;
  }

  // Check if directory is selected
  if (!directory || directory === 'Select directory...') {
    directAddResults.classList.add('has-results');
    directAddResults.innerHTML = `
      <div class="direct-add-empty">Please select a directory first</div>
    `;
    return;
  }

  try {
    const params: ListPdfsParams = {
      directory: directory,
      search_query: searchQuery,
      zotero_path: zoteroMode.checked && zoteroPath.textContent !== 'Select Zotero data directory...'
        ? zoteroPath.textContent
        : null
    };

    const results = await invoke<PdfListItem[]>('list_pdf_files', { params });
    currentResults = results;
    renderDirectAddResults(results);
  } catch (error) {
    console.error('Failed to search PDFs:', error);
    showStatus(`Failed to search PDFs: ${error}`, 'error');
    directAddResults.classList.add('has-results');
    directAddResults.innerHTML = `
      <div class="direct-add-empty">Error searching PDFs</div>
    `;
  }
}

function renderDirectAddResults(results: PdfListItem[]) {
  if (results.length === 0) {
    directAddResults.classList.add('has-results');
    directAddResults.innerHTML = `
      <div class="direct-add-empty">No PDFs found</div>
    `;
    return;
  }

  // Limit to 50 results for performance
  const displayResults = results.slice(0, 50);

  const html = displayResults.map(item => {
    const displayName = item.zotero_metadata?.title || item.file_name;
    const metaInfo = buildMetaInfo(item);

    return `
      <div class="direct-add-result-item">
        <div class="direct-add-result-info">
          <div class="direct-add-result-name" title="${escapeHtml(displayName)}">
            ${escapeHtml(displayName)}
          </div>
          ${metaInfo ? `<div class="direct-add-result-meta">${metaInfo}</div>` : ''}
        </div>
        <button class="direct-add-pin-btn" data-file-path="${escapeHtml(item.file_path)}">
          Pin
        </button>
      </div>
    `;
  }).join('');

  directAddResults.classList.add('has-results');
  directAddResults.innerHTML = html;

  // Show message if there are more results
  if (results.length > 50) {
    const moreMessage = document.createElement('div');
    moreMessage.className = 'direct-add-empty';
    moreMessage.textContent = `Showing first 50 of ${results.length} results`;
    directAddResults.appendChild(moreMessage);
  }
}

function buildMetaInfo(item: PdfListItem): string {
  if (!item.zotero_metadata) {
    return '';
  }

  const parts: string[] = [];

  if (item.zotero_metadata.authors) {
    parts.push(escapeHtml(item.zotero_metadata.authors));
  }

  if (item.zotero_metadata.year) {
    parts.push(escapeHtml(item.zotero_metadata.year));
  }

  if (parts.length === 0 && item.file_name) {
    return escapeHtml(item.file_name);
  }

  return parts.join(' • ');
}
