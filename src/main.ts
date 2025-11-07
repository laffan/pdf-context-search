import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import * as pdfjsLib from 'pdfjs-dist';
// Import the worker as a URL - Vite will bundle it
// @ts-expect-error Vite handles ?url imports
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// Set up PDF.js worker - use local worker file instead of CDN
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

interface ZoteroMetadata {
  citekey: string;
  title: string | null;
  year: string | null;
  authors: string | null;
  zotero_link: string;
  pdf_attachment_key: string | null;
}

interface SearchMatch {
  file_path: string;
  file_name: string;
  page_number: number;
  context_before: string;
  matched_text: string;
  context_after: string;
  zotero_link: string | null;
  zotero_metadata: ZoteroMetadata | null;
}

interface QueryItem {
  query: string;
  use_regex: boolean;
  query_type: string; // "parallel" or "filter"
  color: string; // hex color for highlighting
}

interface SearchParams {
  queries: QueryItem[];
  directory: string;
  context_words: number;
  zotero_path: string | null;
}

interface SearchHistoryItem {
  queries: QueryItem[];
  timestamp: number;
}

let currentResults: SearchMatch[] = [];
const MAX_SEARCH_HISTORY = 10;

// DOM Elements
let searchForm: HTMLFormElement;
let searchQueriesContainer: HTMLElement;
let addSearchTermBtn: HTMLAnchorElement;
let addFilterTermBtn: HTMLAnchorElement;
let directoryPath: HTMLInputElement;
let browseBtn: HTMLButtonElement;
let zoteroMode: HTMLInputElement;
let zoteroPath: HTMLInputElement;
let browseZoteroBtn: HTMLButtonElement;
let zoteroFolderGroup: HTMLElement;
let searchBtn: HTMLButtonElement;
let exportBtn: HTMLButtonElement;
let statusMessage: HTMLElement;
let resultsCount: HTMLElement;
let resultsContainer: HTMLElement;

let queryCount = 1;

function showStatus(message: string, type: 'info' | 'error' | 'success') {
  statusMessage.textContent = message;
  statusMessage.className = type;
  setTimeout(() => {
    statusMessage.className = '';
    statusMessage.textContent = '';
  }, 5000);
}

function getSearchHistory(): SearchHistoryItem[] {
  const stored = localStorage.getItem('pdfSearchHistory');
  if (!stored) return [];
  try {
    const parsed = JSON.parse(stored);
    // Filter out old format entries (backward compatibility)
    return parsed.filter((item: any) => Array.isArray(item.queries));
  } catch {
    return [];
  }
}

function saveSearchToHistory(queries: QueryItem[]) {
  const history = getSearchHistory();

  // Serialize queries for comparison
  const queryStr = JSON.stringify(queries);

  // Remove existing entry with same queries (for uniqueness)
  const filtered = history.filter(item => JSON.stringify(item.queries) !== queryStr);

  // Add new entry at the beginning
  filtered.unshift({
    queries,
    timestamp: Date.now()
  });

  // Keep only last MAX_SEARCH_HISTORY items
  const trimmed = filtered.slice(0, MAX_SEARCH_HISTORY);

  localStorage.setItem('pdfSearchHistory', JSON.stringify(trimmed));
}

function clearSearchHistory() {
  localStorage.removeItem('pdfSearchHistory');
}

function addSearchQueryItem(queryType: 'parallel' | 'filter' = 'parallel') {
  const container = searchQueriesContainer;
  const index = queryCount++;

  // Default colors: yellow for parallel, green for filter
  const defaultColor = queryType === 'parallel' ? '#ffff00' : '#22c55e';

  const queryItem = document.createElement('div');
  queryItem.className = queryType === 'filter' ? 'search-query-item filter-type' : 'search-query-item';
  queryItem.dataset.index = String(index);
  queryItem.dataset.queryType = queryType;
  queryItem.dataset.color = defaultColor;

  const placeholder = queryType === 'parallel' ? 'Enter search term...' : 'Enter filter term...';

  queryItem.innerHTML = `
    <div style="display: flex; gap: 8px; align-items: center;">
      <input
        type="text"
        class="search-query-input"
        placeholder="${placeholder}"
        data-index="${index}"
      />
      <div class="color-picker-container">
        <div class="color-picker" data-index="${index}" style="background-color: ${defaultColor};" title="Click to change highlight color"></div>
        <input type="color" class="color-input" data-index="${index}" value="${defaultColor}" />
      </div>
    </div>
    <div style="display: flex; justify-content: space-between; align-items: center;">
      <label class="inline-checkbox">
        <input type="checkbox" class="use-regex-checkbox" data-index="${index}" />
        Use Regex
      </label>
      <button type="button" class="remove-query-btn" data-index="${index}">×</button>
    </div>
  `;

  container.appendChild(queryItem);

  // Add event listener to remove button (only show for non-first items)
  const removeBtn = queryItem.querySelector('.remove-query-btn') as HTMLButtonElement;
  if (index === 0) {
    removeBtn.style.display = 'none';
  } else {
    removeBtn.addEventListener('click', () => removeSearchQueryItem(index));
  }

  // Add color picker event listener
  const colorPicker = queryItem.querySelector('.color-picker') as HTMLElement;
  const colorInput = queryItem.querySelector('.color-input') as HTMLInputElement;

  colorPicker.addEventListener('click', () => {
    colorInput.click();
  });

  colorInput.addEventListener('input', (e) => {
    const color = (e.target as HTMLInputElement).value;
    colorPicker.style.backgroundColor = color;
    queryItem.dataset.color = color;
  });
}

function removeSearchQueryItem(index: number) {
  const queryItem = searchQueriesContainer.querySelector(`[data-index="${index}"]`);
  if (queryItem) {
    queryItem.remove();
  }
}

function getAllQueries(): QueryItem[] {
  const queryItems = searchQueriesContainer.querySelectorAll('.search-query-item') as NodeListOf<HTMLElement>;
  const queries: QueryItem[] = [];

  queryItems.forEach(queryItem => {
    const input = queryItem.querySelector('.search-query-input') as HTMLInputElement;
    const query = input.value.trim();

    if (query) {
      const regexCheckbox = queryItem.querySelector('.use-regex-checkbox') as HTMLInputElement;
      const queryType = queryItem.dataset.queryType || 'parallel';
      const color = queryItem.dataset.color || '#ffff00';

      queries.push({
        query,
        use_regex: regexCheckbox.checked,
        query_type: queryType,
        color: color
      });
    }
  });

  return queries;
}

async function browseDirectory() {
  try {
    const selected = await open({
      directory: true,
      multiple: false,
      title: 'Select PDF Directory',
    });

    if (selected && typeof selected === 'string') {
      directoryPath.value = selected;
      // Persist the directory selection
      localStorage.setItem('pdfSearchDirectory', selected);
    }
  } catch (error) {
    showStatus(`Failed to select directory: ${error}`, 'error');
  }
}

async function browseZoteroDirectory() {
  try {
    const selected = await open({
      directory: true,
      multiple: false,
      title: 'Select Zotero Data Directory',
    });

    if (selected && typeof selected === 'string') {
      zoteroPath.value = selected;
      // Persist the zotero directory selection
      localStorage.setItem('pdfSearchZoteroPath', selected);
    }
  } catch (error) {
    showStatus(`Failed to select Zotero directory: ${error}`, 'error');
  }
}

function toggleZoteroFolder() {
  if (zoteroMode.checked) {
    zoteroFolderGroup.style.display = 'block';
  } else {
    zoteroFolderGroup.style.display = 'none';
  }
}

function renderResults(matches: SearchMatch[]) {
  if (matches.length === 0) {
    resultsContainer.innerHTML = `
      <div class="empty-state">
        <p>No matches found</p>
      </div>
    `;
    resultsCount.textContent = '';
    exportBtn.disabled = true;
    return;
  }

  resultsCount.textContent = `${matches.length} ${matches.length === 1 ? 'match' : 'matches'}`;
  exportBtn.disabled = false;

  // Group matches by file
  const fileGroups = new Map<string, SearchMatch[]>();
  matches.forEach(match => {
    if (!fileGroups.has(match.file_path)) {
      fileGroups.set(match.file_path, []);
    }
    fileGroups.get(match.file_path)!.push(match);
  });

  // Render grouped results
  let html = '';
  fileGroups.forEach((fileMatches, filePath) => {
    const fileName = fileMatches[0].file_name;
    const fileId = filePath.replace(/[^a-zA-Z0-9]/g, '_');

    const firstMatch = fileMatches[0];
    const zoteroMetadata = firstMatch.zotero_metadata;

    // Debug: log zotero metadata
    if (zoteroMetadata) {
      console.log('Zotero metadata for', fileName, ':', zoteroMetadata);
    }

    html += `
      <div class="result-file">
        <div class="result-file-header">
          <div class="result-file-header-content">
            ${zoteroMetadata ? `
              <div class="zotero-header-title">
                <h3>${escapeHtml(zoteroMetadata.title || fileName)}</h3>
              </div>
              ${zoteroMetadata.year || zoteroMetadata.authors ? `
                <div class="zotero-authors-year">
                  ${zoteroMetadata.year ? escapeHtml(zoteroMetadata.year) : ''}
                  ${zoteroMetadata.authors ? `${zoteroMetadata.year ? ' - ' : ''}${escapeHtml(zoteroMetadata.authors)}` : ''}
                </div>
              ` : ''}
              <div class="result-file-header-buttons">
                <button class="btn-icon show-cover-btn" data-filepath="${escapeHtml(filePath)}">📖 Cover</button>
                <button class="btn-icon result-matches-toggle" data-fileid="${fileId}">
                  <span>Matches (${fileMatches.length})</span>
                  <span class="result-matches-toggle-arrow">▼</span>
                </button>
                <button class="btn-icon copy-citation-btn" data-citekey="${escapeHtml(zoteroMetadata.citekey)}" data-link="${escapeHtml(zoteroMetadata.zotero_link)}">📋 Copy Citekey Link</button>
                <button class="btn-icon open-zotero-btn" data-attachment-key="${escapeHtml(zoteroMetadata.pdf_attachment_key || '')}" data-page="${fileMatches[0].page_number}">📖 Zotero</button>
              </div>
            ` : `
              <div class="result-file-header-title">
                <h3>${fileName}</h3>
                <div class="result-file-header-buttons">
                  <button class="btn-icon show-cover-btn" data-filepath="${escapeHtml(filePath)}">📖 Cover</button>
                  <button class="btn-icon result-matches-toggle" data-fileid="${fileId}">
                    <span>Matches (${fileMatches.length})</span>
                    <span class="result-matches-toggle-arrow">▼</span>
                  </button>
                </div>
              </div>
              <div class="result-file-path">${filePath}</div>
            `}
          </div>
        </div>
        <div class="result-matches" id="matches-${fileId}">
    `;

    // Group matches by page within this file
    const pageGroups = new Map<number, SearchMatch[]>();
    fileMatches.forEach(match => {
      if (!pageGroups.has(match.page_number)) {
        pageGroups.set(match.page_number, []);
      }
      pageGroups.get(match.page_number)!.push(match);
    });

    // Render each page once with all its matches
    pageGroups.forEach((pageMatches, pageNumber) => {
      const pageId = `page-${fileId}-${pageNumber}`;
      const pageHeader = zoteroMetadata && zoteroMetadata.pdf_attachment_key
        ? `<a href="#" class="page-link" data-attachment-key="${escapeHtml(zoteroMetadata.pdf_attachment_key)}" data-page="${pageNumber}">Page ${pageNumber}</a> (${pageMatches.length} ${pageMatches.length === 1 ? 'match' : 'matches'})`
        : `Page ${pageNumber} (${pageMatches.length} ${pageMatches.length === 1 ? 'match' : 'matches'})`;
      html += `
        <div class="result-match">
          <div class="result-match-header">${pageHeader}</div>
          <div class="page-preview" id="${pageId}">
            <div class="page-preview-loading">Loading page preview...</div>
          </div>
        </div>
      `;
    });

    html += `
        </div>
      </div>
    `;
  });

  resultsContainer.innerHTML = html;

  // Set up event listeners for show cover buttons
  document.querySelectorAll('.show-cover-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const filePath = (btn as HTMLButtonElement).dataset.filepath;
      if (filePath) {
        toggleCoverPage(filePath, btn as HTMLButtonElement);
      }
    });
  });

  // Set up event listeners for copy citation buttons
  document.querySelectorAll('.copy-citation-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const citekey = (btn as HTMLButtonElement).dataset.citekey;
      const link = (btn as HTMLButtonElement).dataset.link;
      if (citekey && link) {
        copyCitation(citekey, link, btn as HTMLButtonElement);
      }
    });
  });

  // Set up event listeners for open zotero buttons
  document.querySelectorAll('.open-zotero-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const attachmentKey = (btn as HTMLButtonElement).dataset.attachmentKey;
      const page = (btn as HTMLButtonElement).dataset.page;
      if (attachmentKey) {
        openInZotero(attachmentKey, parseInt(page || '1'), btn as HTMLButtonElement);
      }
    });
  });

  // Set up event listeners for page links
  document.querySelectorAll('.page-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const attachmentKey = (link as HTMLAnchorElement).dataset.attachmentKey;
      const page = (link as HTMLAnchorElement).dataset.page;
      if (attachmentKey && page) {
        openInZotero(attachmentKey, parseInt(page), link as HTMLAnchorElement);
      }
    });
  });

  // Set up event listeners for accordion toggles
  document.querySelectorAll('.result-matches-toggle').forEach(toggle => {
    toggle.addEventListener('click', (e) => {
      e.preventDefault();
      const fileId = (toggle as HTMLElement).dataset.fileid;
      const matchesContainer = document.getElementById(`matches-${fileId}`);
      const arrow = toggle.querySelector('.result-matches-toggle-arrow');

      if (matchesContainer && arrow) {
        const isOpen = matchesContainer.classList.contains('open');

        if (!isOpen) {
          // Opening - load pages
          matchesContainer.classList.add('open');
          arrow.classList.add('open');

          // Load pages
          const queries = getAllQueries();
          const pageElements = matchesContainer.querySelectorAll('.page-preview');
          pageElements.forEach((pageElement) => {
            const pageId = pageElement.id;
            const match = pageId.match(/page-(.+)-(\d+)$/);
            if (match) {
              const filePathKey = match[1];
              const pageNumber = parseInt(match[2]);

              // Find the actual file path from fileGroups
              for (const [filePath] of fileGroups.entries()) {
                if (filePath.replace(/[^a-zA-Z0-9]/g, '_') === filePathKey) {
                  loadPageImage(filePath, pageNumber, queries)
                    .then(canvas => {
                      if (pageElement.querySelector('canvas') === null && pageElement.querySelector('img') === null) {
                        pageElement.innerHTML = '';
                        pageElement.appendChild(canvas);
                      }
                    })
                    .catch(() => {
                      pageElement.innerHTML = `<div class="page-preview-error">Failed to load page preview</div>`;
                    });
                  break;
                }
              }
            }
          });
        } else {
          // Closing
          matchesContainer.classList.remove('open');
          arrow.classList.remove('open');
        }
      }
    });
  });
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function copyCitation(citekey: string, link: string, button: HTMLButtonElement) {
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

async function openInZotero(attachmentKey: string, pageNumber: number, element: HTMLButtonElement | HTMLAnchorElement) {
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

async function toggleCoverPage(filePath: string, button: HTMLButtonElement) {
  const fileId = filePath.replace(/[^a-zA-Z0-9]/g, '_');
  let coverContainer = document.getElementById(`cover-overlay-${fileId}`);

  // If overlay doesn't exist, create it
  if (!coverContainer) {
    coverContainer = document.createElement('div');
    coverContainer.id = `cover-overlay-${fileId}`;
    coverContainer.className = 'cover-page-container';
    document.body.appendChild(coverContainer);

    // Add close button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'cover-page-close';
    closeBtn.textContent = '×';
    closeBtn.onclick = () => {
      coverContainer!.classList.remove('visible');
      button.style.opacity = '0.7';
    };
    coverContainer.appendChild(closeBtn);

    // Click on overlay background to close
    coverContainer.addEventListener('click', (e) => {
      if (e.target === coverContainer) {
        coverContainer!.classList.remove('visible');
        button.style.opacity = '0.7';
      }
    });
  }

  const isVisible = coverContainer.classList.contains('visible');

  if (isVisible) {
    // Hide the overlay
    coverContainer.classList.remove('visible');
    button.style.opacity = '0.7';
  } else {
    // Show the overlay
    coverContainer.classList.add('visible');
    button.style.opacity = '1';

    // Check if already loaded
    if (!coverContainer.querySelector('canvas') && !coverContainer.querySelector('img')) {
      // Create wrapper for content
      const wrapper = document.createElement('div');
      wrapper.className = 'cover-page-wrapper';
      wrapper.innerHTML = '<div class="loading">Loading cover page...</div>';

      // Insert after close button
      coverContainer.appendChild(wrapper);

      try {
        const canvas = await loadPageImage(filePath, 1, []);
        wrapper.innerHTML = '';
        wrapper.appendChild(canvas);
      } catch {
        wrapper.innerHTML = '<div class="page-preview-error">Failed to load cover page</div>';
      }
    }
  }
}

function renderSearchDropdown() {
  const history = getSearchHistory();
  let dropdown = document.getElementById('search-dropdown');

  // Remove existing dropdown if it exists
  if (dropdown) {
    dropdown.remove();
  }

  if (history.length === 0) {
    return; // Don't show dropdown if no history
  }

  // Create dropdown
  dropdown = document.createElement('div');
  dropdown.id = 'search-dropdown';
  dropdown.className = 'search-dropdown';

  // Stop propagation on the dropdown itself to prevent click-outside handler
  dropdown.addEventListener('click', (e) => {
    e.stopPropagation();
  });

  // Add history items
  history.forEach(item => {
    const itemDiv = document.createElement('div');
    itemDiv.className = 'search-dropdown-item';

    const querySpan = document.createElement('span');
    querySpan.className = 'search-dropdown-query';
    // Display first query or multiple queries
    querySpan.textContent = item.queries.map(q => q.query).join(' → ');
    itemDiv.appendChild(querySpan);

    const settingsSpan = document.createElement('span');
    settingsSpan.className = 'search-dropdown-settings';
    // Show regex badge if any query uses regex
    if (item.queries.some(q => q.use_regex)) {
      const regexBadge = document.createElement('span');
      regexBadge.className = 'search-setting-badge';
      regexBadge.textContent = '.*';
      regexBadge.title = 'Uses regex';
      settingsSpan.appendChild(regexBadge);
    }
    itemDiv.appendChild(settingsSpan);

    // Click handler to populate search
    itemDiv.addEventListener('click', (e) => {
      e.stopPropagation();
      // Clear existing query items and rebuild
      searchQueriesContainer.innerHTML = '';
      queryCount = 0;

      item.queries.forEach((queryItem, index) => {
        const newIndex = queryCount++;
        const queryType = queryItem.query_type || 'parallel';
        const color = queryItem.color || (queryType === 'parallel' ? '#ffff00' : '#22c55e');
        const placeholder = queryType === 'parallel' ? 'Enter search term...' : 'Enter filter term...';

        const queryItemEl = document.createElement('div');
        queryItemEl.className = queryType === 'filter' ? 'search-query-item filter-type' : 'search-query-item';
        queryItemEl.dataset.index = String(newIndex);
        queryItemEl.dataset.queryType = queryType;
        queryItemEl.dataset.color = color;

        queryItemEl.innerHTML = `
          <div style="display: flex; gap: 8px; align-items: center;">
            <input
              type="text"
              class="search-query-input"
              placeholder="${placeholder}"
              data-index="${newIndex}"
              value="${escapeHtml(queryItem.query)}"
            />
            <div class="color-picker-container">
              <div class="color-picker" data-index="${newIndex}" style="background-color: ${color};" title="Click to change highlight color"></div>
              <input type="color" class="color-input" data-index="${newIndex}" value="${color}" />
            </div>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <label class="inline-checkbox">
              <input type="checkbox" class="use-regex-checkbox" data-index="${newIndex}" ${queryItem.use_regex ? 'checked' : ''} />
              Use Regex
            </label>
            ${index > 0 ? `<button type="button" class="remove-query-btn" data-index="${newIndex}">×</button>` : ''}
          </div>
        `;

        searchQueriesContainer.appendChild(queryItemEl);

        // Add event listener to remove button if it exists
        if (index > 0) {
          const removeBtn = queryItemEl.querySelector('.remove-query-btn') as HTMLButtonElement;
          removeBtn.addEventListener('click', () => removeSearchQueryItem(newIndex));
        }

        // Add color picker event listeners
        const colorPicker = queryItemEl.querySelector('.color-picker') as HTMLElement;
        const colorInput = queryItemEl.querySelector('.color-input') as HTMLInputElement;

        colorPicker.addEventListener('click', () => {
          colorInput.click();
        });

        colorInput.addEventListener('input', (e) => {
          const newColor = (e.target as HTMLInputElement).value;
          colorPicker.style.backgroundColor = newColor;
          queryItemEl.dataset.color = newColor;
        });
      });

      hideSearchDropdown();
    });

    dropdown.appendChild(itemDiv);
  });

  // Add clear button
  const clearBtn = document.createElement('button');
  clearBtn.type = 'button'; // Important: prevent form submission
  clearBtn.className = 'search-dropdown-clear';
  clearBtn.textContent = 'Clear searches';
  clearBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    clearSearchHistory();
    hideSearchDropdown();
  });
  dropdown.appendChild(clearBtn);

  // Insert dropdown into the form group
  const formGroup = searchQueriesContainer.closest('.form-group');
  if (formGroup) {
    formGroup.appendChild(dropdown);
  }
}

function hideSearchDropdown() {
  const dropdown = document.getElementById('search-dropdown');
  if (dropdown) {
    dropdown.remove();
  }
}

async function loadPageImage(filePath: string, pageNumber: number, queries: QueryItem[]): Promise<HTMLCanvasElement> {
  try {
    // Read the PDF file from the backend (bypasses CORS issues)
    const pdfBytes = await invoke<number[]>('read_pdf_file', { filePath });

    // Convert to Uint8Array for PDF.js
    const pdfData = new Uint8Array(pdfBytes);

    // Load the PDF document from the byte array
    const loadingTask = pdfjsLib.getDocument({ data: pdfData });
    const pdf = await loadingTask.promise;

    // Get the specific page
    const page = await pdf.getPage(pageNumber);

    // Set up canvas
    const scale = 1.5; // Adjust for quality
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d')!;
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    // Render the page
    const renderContext = {
      canvasContext: context,
      viewport: viewport,
      canvas: canvas
    };

    await page.render(renderContext).promise;

    // Get text content for highlighting
    const textContent = await page.getTextContent();

    // Highlight each search term with its respective color
    if (queries.length > 0) {
      for (const queryItem of queries) {
        const searchQuery = queryItem.query;
        if (searchQuery.trim().length > 0) {
          // Convert hex color to rgba with transparency
          const hexColor = queryItem.color;
          const r = parseInt(hexColor.slice(1, 3), 16);
          const g = parseInt(hexColor.slice(3, 5), 16);
          const b = parseInt(hexColor.slice(5, 7), 16);
          context.fillStyle = `rgba(${r}, ${g}, ${b}, 0.4)`;

          const searchLower = searchQuery.toLowerCase();

          for (const item of textContent.items) {
            if ('str' in item && item.str.toLowerCase().includes(searchLower)) {
              // Get the transform matrix [a, b, c, d, e, f]
              const tx = item.transform;

              // Calculate the bounding box in PDF coordinates
              // The transform gives us position and scale
              const fontHeight = Math.sqrt(tx[2] * tx[2] + tx[3] * tx[3]); // Scale in Y direction
              const fontWidth = item.width;

              // Convert PDF coordinates to viewport coordinates
              const left = tx[4];
              const bottom = tx[5];
              const right = left + fontWidth;
              const top = bottom + fontHeight;

              // Transform to viewport space
              const [x1, y1] = viewport.convertToViewportPoint(left, bottom);
              const [x2, y2] = viewport.convertToViewportPoint(right, top);

              // Draw the highlight rectangle
              const rectX = Math.min(x1, x2);
              const rectY = Math.min(y1, y2);
              const rectWidth = Math.abs(x2 - x1);
              const rectHeight = Math.abs(y2 - y1);

              context.fillRect(rectX, rectY, rectWidth, rectHeight);
            }
          }
        }
      }
    }

    return canvas;
  } catch (error) {
    console.error(`Failed to render page ${pageNumber}:`, error);
    throw error;
  }
}

async function performSearch(event: Event) {
  event.preventDefault();

  const queries = getAllQueries();
  const directory = directoryPath.value.trim();

  if (queries.length === 0 || !directory) {
    showStatus('Please enter at least one search query and select a directory', 'error');
    return;
  }

  // Show loading state
  searchBtn.disabled = true;
  searchBtn.textContent = 'Searching...';
  resultsContainer.innerHTML = `
    <div class="loading">
      <p>Searching PDFs...</p>
    </div>
  `;
  showStatus('Searching PDFs...', 'info');

  try {
    const params: SearchParams = {
      queries,
      directory,
      context_words: 100, // Default context words (not user-configurable)
      zotero_path: zoteroMode.checked ? zoteroPath.value.trim() || null : null,
    };

    const results = await invoke<SearchMatch[]>('search_pdf_files', { params });
    currentResults = results;

    renderResults(results);
    showStatus(`Found ${results.length} ${results.length === 1 ? 'match' : 'matches'}`, 'success');

    // Save to search history
    saveSearchToHistory(queries);
  } catch (error) {
    showStatus(`Search failed: ${error}`, 'error');
    resultsContainer.innerHTML = `
      <div class="empty-state">
        <p>Search failed. Please try again.</p>
      </div>
    `;
  } finally {
    searchBtn.disabled = false;
    searchBtn.textContent = 'Search';
  }
}

async function copyResults() {
  if (currentResults.length === 0) {
    showStatus('No results to copy', 'error');
    return;
  }

  try {
    // Group results by file
    const fileGroups = new Map<string, SearchMatch[]>();
    currentResults.forEach(match => {
      if (!fileGroups.has(match.file_path)) {
        fileGroups.set(match.file_path, []);
      }
      fileGroups.get(match.file_path)!.push(match);
    });

    // Build markdown output
    let markdown = '';
    fileGroups.forEach((matches) => {
      const firstMatch = matches[0];
      const metadata = firstMatch.zotero_metadata;

      if (metadata) {
        // Citation link
        markdown += `[@${metadata.citekey}](${metadata.zotero_link})\n`;
        // Title
        markdown += `${metadata.title || firstMatch.file_name}\n`;
        // Authors
        if (metadata.authors) {
          markdown += `${metadata.authors}\n`;
        }
        markdown += '---\n';

        // Get unique pages and sort them
        const pages = Array.from(new Set(matches.map(m => m.page_number))).sort((a, b) => a - b);

        // Page links
        pages.forEach(pageNum => {
          if (metadata.pdf_attachment_key) {
            const zoteroUrl = `zotero://open-pdf/library/items/${metadata.pdf_attachment_key}?page=${pageNum}`;
            markdown += `- [Page ${pageNum}](${zoteroUrl})\n`;
          } else {
            markdown += `- Page ${pageNum}\n`;
          }
        });
      } else {
        // No metadata, just show filename
        markdown += `${firstMatch.file_name}\n`;
        markdown += '---\n';

        const pages = Array.from(new Set(matches.map(m => m.page_number))).sort((a, b) => a - b);
        pages.forEach(pageNum => {
          markdown += `- Page ${pageNum}\n`;
        });
      }

      markdown += '\n===================\n\n';
    });

    // Copy to clipboard
    await navigator.clipboard.writeText(markdown);
    showStatus('Results copied to clipboard!', 'success');
  } catch (error) {
    showStatus(`Copy failed: ${error}`, 'error');
  }
}

// Initialize app
window.addEventListener("DOMContentLoaded", () => {
  // Get DOM elements
  searchForm = document.querySelector("#search-form")!;
  searchQueriesContainer = document.querySelector("#search-queries-container")!;
  addSearchTermBtn = document.querySelector("#add-search-term")!;
  addFilterTermBtn = document.querySelector("#add-filter-term")!;
  directoryPath = document.querySelector("#directory-path")!;
  browseBtn = document.querySelector("#browse-btn")!;
  zoteroMode = document.querySelector("#zotero-mode")!;
  zoteroPath = document.querySelector("#zotero-path")!;
  browseZoteroBtn = document.querySelector("#browse-zotero-btn")!;
  zoteroFolderGroup = document.querySelector("#zotero-folder-group")!;
  searchBtn = document.querySelector("#search-btn")!;
  exportBtn = document.querySelector("#export-btn")!;
  statusMessage = document.querySelector("#status-message")!;
  resultsCount = document.querySelector("#results-count")!;
  resultsContainer = document.querySelector("#results-container")!;

  // Load persisted settings
  const savedDirectory = localStorage.getItem('pdfSearchDirectory');
  if (savedDirectory) {
    directoryPath.value = savedDirectory;
  }

  const savedZoteroPath = localStorage.getItem('pdfSearchZoteroPath');
  if (savedZoteroPath) {
    zoteroPath.value = savedZoteroPath;
  }

  const savedZoteroMode = localStorage.getItem('pdfSearchZoteroMode');
  if (savedZoteroMode !== null) {
    zoteroMode.checked = savedZoteroMode === 'true';
    toggleZoteroFolder();
  }

  // Set up initial color picker
  const initialColorPicker = document.querySelector('.color-picker[data-index="0"]') as HTMLElement;
  const initialColorInput = document.querySelector('.color-input[data-index="0"]') as HTMLInputElement;
  if (initialColorPicker && initialColorInput) {
    initialColorPicker.addEventListener('click', () => {
      initialColorInput.click();
    });
    initialColorInput.addEventListener('input', (e) => {
      const color = (e.target as HTMLInputElement).value;
      initialColorPicker.style.backgroundColor = color;
      const queryItem = initialColorPicker.closest('.search-query-item') as HTMLElement;
      if (queryItem) {
        queryItem.dataset.color = color;
      }
    });
  }

  // Add event listeners
  searchForm.addEventListener("submit", performSearch);
  browseBtn.addEventListener("click", browseDirectory);
  browseZoteroBtn.addEventListener("click", browseZoteroDirectory);
  exportBtn.addEventListener("click", copyResults);

  // Add search term button
  addSearchTermBtn.addEventListener("click", (e) => {
    e.preventDefault();
    addSearchQueryItem('parallel');
  });

  // Add filter term button
  addFilterTermBtn.addEventListener("click", (e) => {
    e.preventDefault();
    addSearchQueryItem('filter');
  });

  zoteroMode.addEventListener("change", () => {
    localStorage.setItem('pdfSearchZoteroMode', String(zoteroMode.checked));
    toggleZoteroFolder();
  });

  // Search dropdown event listeners
  searchQueriesContainer.addEventListener("focus", () => {
    renderSearchDropdown();
  }, true);

  searchQueriesContainer.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).classList.contains('search-query-input')) {
      renderSearchDropdown();
    }
  });

  // Hide dropdown when clicking outside
  document.addEventListener("click", (e) => {
    const dropdown = document.getElementById('search-dropdown');
    if (dropdown && !searchQueriesContainer.contains(e.target as Node) && !dropdown.contains(e.target as Node)) {
      hideSearchDropdown();
    }
  });
});
