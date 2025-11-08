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

// Store per-PDF search queries (filePath -> query string)
const perPdfSearchQueries = new Map<string, string>();

// Store pinned results (filePath -> {queries, matches})
interface PinnedResult {
  queries: QueryItem[];
  matches: SearchMatch[];
  timestamp: number;
}
const pinnedResults = new Map<string, PinnedResult>();

// Notes feature
interface Note {
  id: string;
  text: string;
  filePath: string;
  fileName: string;
  pageNumber: number;
  timestamp: string;
  zoteroMetadata?: {
    title: string;
    authors: string;
    year?: number;
    citeKey?: string;
    zoteroLink?: string;
  };
  selectionBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

const notes: Note[] = [];

// DOM Elements
let searchForm: HTMLFormElement;
let searchQueriesContainer: HTMLElement;
let addSearchTermBtn: HTMLAnchorElement;
let addFilterTermBtn: HTMLAnchorElement;
let directoryPath: HTMLElement;
let browseBtn: HTMLButtonElement;
let zoteroMode: HTMLInputElement;
let zoteroPath: HTMLElement;
let browseZoteroBtn: HTMLButtonElement;
let zoteroFolderGroup: HTMLElement;
let searchBtn: HTMLButtonElement;
let exportLink: HTMLAnchorElement;
let statusMessage: HTMLElement;
let resultsCount: HTMLElement;
let resultsContainer: HTMLElement;
let toggleNotesBtn: HTMLButtonElement;
let notesSidebar: HTMLElement;
let notesList: HTMLElement;
let exportNotesBtn: HTMLButtonElement;
let clearNotesBtn: HTMLButtonElement;

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

function savePinnedResults() {
  const pinnedArray = Array.from(pinnedResults.entries()).map(([filePath, data]) => ({
    filePath,
    ...data
  }));
  localStorage.setItem('pdfPinnedResults', JSON.stringify(pinnedArray));
}

function loadPinnedResults() {
  const stored = localStorage.getItem('pdfPinnedResults');
  if (!stored) return;
  try {
    const pinnedArray = JSON.parse(stored);
    pinnedArray.forEach((item: any) => {
      // Only load pinned results that have matches
      if (item.matches && item.matches.length > 0) {
        pinnedResults.set(item.filePath, {
          queries: item.queries,
          matches: item.matches,
          timestamp: item.timestamp
        });
      }
    });
  } catch (error) {
    console.error('Failed to load pinned results:', error);
  }
}

function togglePinResult(filePath: string) {
  if (pinnedResults.has(filePath)) {
    // Unpin
    pinnedResults.delete(filePath);
  } else {
    // Pin - get all matches for this file
    const fileMatches = currentResults.filter(m => m.file_path === filePath);
    if (fileMatches.length > 0) {
      const currentQueries = getAllQueries();
      pinnedResults.set(filePath, {
        queries: currentQueries,
        matches: fileMatches,
        timestamp: Date.now()
      });
    }
  }
  savePinnedResults();
  // Re-render results to reflect pinned state
  renderResults(currentResults);
}

// ===== Notes Functions =====

function toggleNotesSidebar() {
  const isCollapsed = notesSidebar.classList.toggle('collapsed');
  toggleNotesBtn.classList.toggle('active');

  // Save state to localStorage
  localStorage.setItem('notesSidebarOpen', String(!isCollapsed));
}

function loadNotes() {
  const stored = localStorage.getItem('pdfSearchNotes');
  if (!stored) return;
  try {
    const loadedNotes = JSON.parse(stored);
    notes.length = 0; // Clear existing notes
    notes.push(...loadedNotes);
    renderNotesList();
  } catch (error) {
    console.error('Failed to load notes:', error);
  }
}

function saveNotes() {
  localStorage.setItem('pdfSearchNotes', JSON.stringify(notes));
}

function createNote(text: string, filePath: string, fileName: string, pageNumber: number, zoteroMetadata?: ZoteroMetadata | null, selectionBox?: { x: number; y: number; width: number; height: number }) {
  // Ensure text is at least 3 characters
  if (text.trim().length < 3) {
    return;
  }

  const note: Note = {
    id: crypto.randomUUID(),
    text: text.trim(),
    filePath,
    fileName,
    pageNumber,
    timestamp: new Date().toISOString(),
    selectionBox
  };

  // Add Zotero metadata if available
  if (zoteroMetadata) {
    note.zoteroMetadata = {
      title: zoteroMetadata.title || fileName,
      authors: zoteroMetadata.authors || '',
      year: zoteroMetadata.year ? parseInt(zoteroMetadata.year) : undefined,
      citeKey: zoteroMetadata.citekey,
      zoteroLink: zoteroMetadata.zotero_link
    };
  }

  notes.unshift(note); // Add to beginning (newest first)
  saveNotes();
  renderNotesList();

  // Show feedback
  showStatus('Note added successfully!', 'success');
}

function deleteNote(id: string) {
  const index = notes.findIndex(n => n.id === id);
  if (index !== -1) {
    notes.splice(index, 1);
    saveNotes();
    renderNotesList();
  }
}

function clearAllNotes() {
  if (notes.length === 0) return;

  if (confirm(`Are you sure you want to delete all ${notes.length} notes? This action cannot be undone.`)) {
    notes.length = 0;
    saveNotes();
    renderNotesList();
    showStatus('All notes cleared', 'info');
  }
}

function copyNoteText(text: string) {
  navigator.clipboard.writeText(text).then(() => {
    showStatus('Note copied to clipboard!', 'success');
  }).catch(err => {
    console.error('Failed to copy:', err);
    showStatus('Failed to copy note', 'error');
  });
}

function exportNotesToMarkdown() {
  if (notes.length === 0) {
    showStatus('No notes to export', 'info');
    return;
  }

  let markdown = '# Notes from PDF Search\n\n';

  notes.forEach((note, index) => {
    const title = note.zoteroMetadata?.title || note.fileName;
    const authors = note.zoteroMetadata?.authors;
    const year = note.zoteroMetadata?.year;

    markdown += `## ${title}`;
    if (authors || year) {
      markdown += ' (';
      if (authors) markdown += authors;
      if (authors && year) markdown += ', ';
      if (year) markdown += year;
      markdown += ')';
    }
    markdown += '\n\n';

    markdown += `**Page ${note.pageNumber}**\n\n`;
    markdown += `> "${note.text}"\n\n`;
    markdown += `*Added: ${formatTimestamp(note.timestamp)}*\n\n`;

    if (index < notes.length - 1) {
      markdown += '---\n\n';
    }
  });

  // Copy to clipboard
  navigator.clipboard.writeText(markdown).then(() => {
    showStatus(`Exported ${notes.length} notes to clipboard!`, 'success');
  }).catch(err => {
    console.error('Failed to export:', err);
    showStatus('Failed to export notes', 'error');
  });
}

function renderNotesList() {
  if (notes.length === 0) {
    notesList.innerHTML = `
      <div class="notes-empty-state">
        <p>No notes yet</p>
        <p class="notes-hint">Drag to select text from PDF pages to create notes</p>
      </div>
    `;
    return;
  }

  notesList.innerHTML = notes.map(note => {
    const title = note.zoteroMetadata?.title || note.fileName;
    const authors = note.zoteroMetadata?.authors;
    const year = note.zoteroMetadata?.year;

    let metaStr = '';
    if (authors) metaStr += `<em>${authors}</em>`;
    if (authors && year) metaStr += ', ';
    if (year) metaStr += year;
    if (metaStr) metaStr += ' • ';
    metaStr += `p. ${note.pageNumber}`;

    return `
      <div class="note-item" data-note-id="${note.id}">
        <div class="note-header">
          <span class="note-source"><strong>${escapeHtml(title)}</strong></span>
          <span class="note-meta">${metaStr}</span>
        </div>
        <div class="note-text">"${escapeHtml(note.text)}"</div>
        <div class="note-footer">
          <span class="note-timestamp">${formatTimestamp(note.timestamp)}</span>
          <div class="note-actions">
            <button class="note-action-btn copy-note-btn" title="Copy" data-note-id="${note.id}">📋</button>
            <button class="note-action-btn delete-note-btn" title="Delete" data-note-id="${note.id}">🗑️</button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Add event listeners to note action buttons
  notesList.querySelectorAll('.copy-note-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = (e.currentTarget as HTMLElement).dataset.noteId!;
      const note = notes.find(n => n.id === id);
      if (note) copyNoteText(note.text);
    });
  });

  notesList.querySelectorAll('.delete-note-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = (e.currentTarget as HTMLElement).dataset.noteId!;
      if (confirm('Delete this note?')) {
        deleteNote(id);
      }
    });
  });
}

function formatTimestamp(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins} min${diffMins > 1 ? 's' : ''} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;

  return date.toLocaleDateString();
}

// ===== End Notes Functions =====

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
      directoryPath.textContent = selected;
      directoryPath.title = selected; // Show full path on hover
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
      zoteroPath.textContent = selected;
      zoteroPath.title = selected; // Show full path on hover
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

function renderFileGroup(filePath: string, fileMatches: SearchMatch[], isPinned: boolean, originalQueries?: QueryItem[], currentMatchCount?: number, originalMatchCount?: number, originalMatches?: SearchMatch[], currentMatches?: SearchMatch[]): string {
  // Safety check: don't render if no matches
  if (!fileMatches || fileMatches.length === 0) {
    return '';
  }

  const fileName = fileMatches[0].file_name;
  const fileId = filePath.replace(/[^a-zA-Z0-9]/g, '_');
  const firstMatch = fileMatches[0];
  const zoteroMetadata = firstMatch.zotero_metadata;

  // Determine pin button state
  const pinButtonClass = isPinned ? 'pin-btn pinned' : 'pin-btn';
  const pinButtonIcon = '📍';
  const pinButtonTitle = isPinned ? 'Unpin this result' : 'Pin this result';

  // Calculate match count display
  let matchCountDisplay = '';
  if (isPinned && originalQueries) {
    // For pinned items, show original query with count
    const originalQueryStr = originalQueries.map(q => q.query).join(', ');
    const origCount = originalMatchCount !== undefined ? originalMatchCount : fileMatches.length;

    // Check if current queries are different from original queries
    const currentQueries = getAllQueries();
    const currentQueryStr = currentQueries.map(q => q.query).join(', ');
    const queriesAreDifferent = currentQueryStr !== originalQueryStr;

    if (currentMatchCount !== undefined && currentMatchCount > 0 && queriesAreDifferent) {
      // Show both original and current (only if they're different)
      matchCountDisplay = `${originalQueryStr} ${origCount} / ${currentQueryStr} ${currentMatchCount}`;
    } else {
      // Just original
      matchCountDisplay = `${originalQueryStr} ${origCount}`;
    }
  } else {
    // Not pinned, just show count
    matchCountDisplay = `${fileMatches.length}`;
  }

  // Add pinned header class if needed
  const headerClass = isPinned ? 'result-file-header pinned-header' : 'result-file-header';

  let html = `
    <div class="result-file ${isPinned ? 'pinned' : ''}">
      <div class="${headerClass}">
        <div class="result-file-header-content">
          <button class="${pinButtonClass}" data-filepath="${escapeHtml(filePath)}" title="${pinButtonTitle}">${pinButtonIcon}</button>
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
              <button class="btn-icon result-matches-toggle" data-fileid="${fileId}" data-pinned="${isPinned}">
                <span>✓ Matches (${matchCountDisplay})</span>
                <span class="result-matches-toggle-arrow">►</span>
              </button>
              <button class="btn-icon show-cover-btn" data-filepath="${escapeHtml(filePath)}">📖 Cover</button>
              <button class="btn-icon copy-citation-btn" data-citekey="${escapeHtml(zoteroMetadata.citekey)}" data-link="${escapeHtml(zoteroMetadata.zotero_link)}">📋 Copy Citekey Link</button>
              <button class="btn-icon open-zotero-btn" data-attachment-key="${escapeHtml(zoteroMetadata.pdf_attachment_key || '')}" data-page="${fileMatches[0].page_number}">📖 Zotero</button>
            </div>
          ` : `
            <div class="result-file-header-title">
              <h3>${fileName}</h3>
              <div class="result-file-header-buttons">
                <button class="btn-icon result-matches-toggle" data-fileid="${fileId}" data-pinned="${isPinned}">
                  <span>✓ Matches (${matchCountDisplay})</span>
                  <span class="result-matches-toggle-arrow">►</span>
                </button>
                <button class="btn-icon show-cover-btn" data-filepath="${escapeHtml(filePath)}">📖 Cover</button>
              </div>
            </div>
            <div class="result-file-path">${filePath}</div>
          `}
        </div>
      </div>
      <div class="result-matches-filter" id="filter-${fileId}" data-filepath="${escapeHtml(filePath)}">
        <input type="text" class="result-matches-search-input" placeholder="Search in this PDF..." data-filepath="${escapeHtml(filePath)}" data-fileid="${fileId}" />
        <div class="result-matches-query-filters">
          ${isPinned && originalQueries ? originalQueries.map((q, i) => {
            // For pinned results, count from the original matches array (not the combined one)
            const matchesToCount = originalMatches || fileMatches;
            const queryMatchCount = matchesToCount.filter(match => {
              const fullText = (match.context_before + match.matched_text + match.context_after).toLowerCase();
              return fullText.includes(q.query.toLowerCase());
            }).length;
            return `
            <div class="result-matches-query-filter">
              <input type="checkbox" id="query-filter-original-${fileId}-${i}" data-query-type="original" data-query="${escapeHtml(q.query)}" checked />
              <label for="query-filter-original-${fileId}-${i}">${escapeHtml(q.query)} - ${queryMatchCount}</label>
            </div>
          `;
          }).join('') : ''}
          ${(() => {
            const currentQueries = getAllQueries();
            const originalQueryStrs = originalQueries ? originalQueries.map(q => q.query) : [];
            // Only show current queries if they're different from original
            return currentQueries.filter(q => !originalQueryStrs.includes(q.query)).map((q, i) => {
              // For pinned results, count from the current matches array (not the combined one)
              const matchesToCount = currentMatches || fileMatches;
              const queryMatchCount = matchesToCount.filter(match => {
                const fullText = (match.context_before + match.matched_text + match.context_after).toLowerCase();
                return fullText.includes(q.query.toLowerCase());
              }).length;
              return `
              <div class="result-matches-query-filter">
                <input type="checkbox" id="query-filter-current-${fileId}-${i}" data-query-type="current" data-query="${escapeHtml(q.query)}" checked />
                <label for="query-filter-current-${fileId}-${i}">${escapeHtml(q.query)} - ${queryMatchCount}</label>
              </div>
            `;
            }).join('');
          })()}
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

  return html;
}

function renderResults(matches: SearchMatch[]) {
  // Always show pinned results, even if no new matches
  const hasPinnedResults = pinnedResults.size > 0;

  if (matches.length === 0 && !hasPinnedResults) {
    resultsContainer.innerHTML = `
      <div class="empty-state">
        <p>No matches found</p>
      </div>
    `;
    resultsCount.textContent = '';
    exportLink.classList.add('disabled');
    return;
  }

  const totalMatches = matches.length + Array.from(pinnedResults.values()).reduce((sum, p) => sum + p.matches.length, 0);
  resultsCount.textContent = `${totalMatches} ${totalMatches === 1 ? 'match' : 'matches'}`;
  exportLink.classList.remove('disabled');

  // Group current matches by file
  const fileGroups = new Map<string, SearchMatch[]>();
  matches.forEach(match => {
    if (!fileGroups.has(match.file_path)) {
      fileGroups.set(match.file_path, []);
    }
    fileGroups.get(match.file_path)!.push(match);
  });

  // Render grouped results - pinned first, then current results
  let html = '';

  // Render pinned results first - combine original pinned matches with current matches
  pinnedResults.forEach((pinnedData, filePath) => {
    // Get current matches for this file
    const currentMatches = fileGroups.get(filePath) || [];
    const currentMatchCount = currentMatches.length;
    const originalMatchCount = pinnedData.matches.length;

    // Merge matches by page number to avoid duplicates - but keep track of which are which
    const pageMap = new Map<number, SearchMatch>();
    pinnedData.matches.forEach(m => pageMap.set(m.page_number, m));
    currentMatches.forEach(m => pageMap.set(m.page_number, m));

    const combinedMatches = Array.from(pageMap.values()).sort((a, b) => a.page_number - b.page_number);

    // Pass combined matches for display, but separate counts and arrays for filters
    html += renderFileGroup(filePath, combinedMatches, true, pinnedData.queries, currentMatchCount, originalMatchCount, pinnedData.matches, currentMatches);
  });

  // Render current results (excluding already pinned files)
  fileGroups.forEach((fileMatches, filePath) => {
    if (!pinnedResults.has(filePath)) {
      html += renderFileGroup(filePath, fileMatches, false);
    }
  });

  resultsContainer.innerHTML = html;

  // Apply saved column layout to all result-matches
  const savedColumnLayout = localStorage.getItem('pdfSearchColumnLayout') || '1';
  document.querySelectorAll('.result-matches').forEach(matches => {
    matches.classList.add(`columns-${savedColumnLayout}`);
  });

  // Set up event listeners for pin buttons
  document.querySelectorAll('.pin-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const filePath = (btn as HTMLButtonElement).dataset.filepath;
      if (filePath) {
        togglePinResult(filePath);
      }
    });
  });

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
      const isPinned = (toggle as HTMLElement).dataset.pinned === 'true';
      const matchesContainer = document.getElementById(`matches-${fileId}`);
      const filterBar = document.getElementById(`filter-${fileId}`);
      const arrow = toggle.querySelector('.result-matches-toggle-arrow');

      if (matchesContainer && arrow) {
        const isOpen = matchesContainer.classList.contains('open');

        if (!isOpen) {
          // Opening - load pages
          matchesContainer.classList.add('open');
          arrow.classList.add('open');
          if (filterBar) {
            // Measure header height and set CSS variable for filter bar positioning
            const header = toggle.closest('.result-file-header');
            if (header) {
              const headerHeight = header.getBoundingClientRect().height;
              // Subtract 2px to account for border-bottom that moves from header to filter bar
              filterBar.style.setProperty('top', `${headerHeight - 2}px`);
            }
            filterBar.classList.add('visible');
          }

          // Determine which queries to use for highlighting
          let queriesToUse = getAllQueries();

          // If this is a pinned result, combine original queries with current queries
          if (isPinned) {
            const pageElements = matchesContainer.querySelectorAll('.page-preview');
            if (pageElements.length > 0) {
              const firstPageId = pageElements[0].id;
              const match = firstPageId.match(/page-(.+)-(\d+)$/);
              if (match) {
                const filePathKey = match[1];

                // Find the actual file path
                let actualFilePath: string | null = null;
                for (const [filePath] of fileGroups.entries()) {
                  if (filePath.replace(/[^a-zA-Z0-9]/g, '_') === filePathKey) {
                    actualFilePath = filePath;
                    break;
                  }
                }

                // Also check pinned results
                if (!actualFilePath) {
                  for (const [filePath] of pinnedResults.entries()) {
                    if (filePath.replace(/[^a-zA-Z0-9]/g, '_') === filePathKey) {
                      actualFilePath = filePath;
                      break;
                    }
                  }
                }

                // If we found the file path and it's pinned, combine queries
                if (actualFilePath && pinnedResults.has(actualFilePath)) {
                  const pinnedData = pinnedResults.get(actualFilePath)!;
                  const currentQueries = getAllQueries();

                  // Combine original and current queries, avoiding duplicates
                  const combinedQueriesMap = new Map<string, QueryItem>();
                  pinnedData.queries.forEach(q => {
                    combinedQueriesMap.set(q.query, q);
                  });
                  currentQueries.forEach(q => {
                    if (!combinedQueriesMap.has(q.query)) {
                      combinedQueriesMap.set(q.query, q);
                    }
                  });

                  queriesToUse = Array.from(combinedQueriesMap.values());
                }
              }
            }
          }

          // Load pages with appropriate queries
          const pageElements = matchesContainer.querySelectorAll('.page-preview');
          pageElements.forEach((pageElement) => {
            const pageId = pageElement.id;
            const match = pageId.match(/page-(.+)-(\d+)$/);
            if (match) {
              const filePathKey = match[1];
              const pageNumber = parseInt(match[2]);

              // Find the actual file path from fileGroups or pinnedResults
              let foundFilePath: string | null = null;
              for (const [filePath] of fileGroups.entries()) {
                if (filePath.replace(/[^a-zA-Z0-9]/g, '_') === filePathKey) {
                  foundFilePath = filePath;
                  break;
                }
              }

              if (!foundFilePath) {
                for (const [filePath] of pinnedResults.entries()) {
                  if (filePath.replace(/[^a-zA-Z0-9]/g, '_') === filePathKey) {
                    foundFilePath = filePath;
                    break;
                  }
                }
              }

              if (foundFilePath) {
                loadPageImage(foundFilePath, pageNumber, queriesToUse, undefined)
                  .then(element => {
                    if (pageElement.querySelector('canvas') === null && pageElement.querySelector('img') === null) {
                      pageElement.innerHTML = '';
                      pageElement.appendChild(element);
                    }
                  })
                  .catch(() => {
                    pageElement.innerHTML = `<div class="page-preview-error">Failed to load page preview</div>`;
                  });
              }
            }
          });
        } else {
          // Closing - clear per-PDF search
          matchesContainer.classList.remove('open');
          arrow.classList.remove('open');
          if (filterBar) {
            filterBar.classList.remove('visible');
          }

          // Clear the per-PDF search input and stored query
          const searchInput = filterBar?.querySelector('.result-matches-search-input') as HTMLInputElement;
          if (searchInput) {
            const filePath = searchInput.dataset.filepath;
            if (filePath) {
              perPdfSearchQueries.delete(filePath);
            }
            searchInput.value = '';
          }
        }
      }
    });
  });

  // Set up event listeners for per-PDF search inputs
  document.querySelectorAll('.result-matches-search-input').forEach(input => {
    input.addEventListener('keydown', async (e: Event) => {
      const keyEvent = e as KeyboardEvent;
      if (keyEvent.key === 'Enter') {
        e.preventDefault();
        const inputElement = e.target as HTMLInputElement;
        const filePath = inputElement.dataset.filepath;
        const fileId = inputElement.dataset.fileid;
        const searchQuery = inputElement.value.trim();

        if (filePath && fileId && searchQuery) {
          // Add checkbox to filter bar
          const filterBar = document.getElementById(`filter-${fileId}`);
          const matchesContainer = document.getElementById(`matches-${fileId}`);

          if (filterBar && matchesContainer) {
            // Show loading state
            matchesContainer.innerHTML = '<div class="page-preview-loading">Searching...</div>';

            // Search for this specific query to get match count
            try {
              const customQueryParams: SearchParams = {
                queries: [{
                  query: searchQuery,
                  use_regex: false,
                  query_type: 'parallel',
                  color: '#0080ff'
                }],
                directory: filePath,
                context_words: 100,
                zotero_path: zoteroMode.checked ? (zoteroPath.textContent || '').trim() || null : null,
              };

              const customResults = await invoke<SearchMatch[]>('search_single_pdf_file', { params: customQueryParams });
              const matchCount = customResults.length;

              // Create new checkbox with Remove link
              const filtersContainer = filterBar.querySelector('.result-matches-query-filters');
              if (filtersContainer) {
                const checkboxId = `query-filter-custom-${fileId}-${Date.now()}`;
                const filterDiv = document.createElement('div');
                filterDiv.className = 'result-matches-query-filter custom-query';
                filterDiv.innerHTML = `
                  <input type="checkbox" id="${checkboxId}" data-query-type="custom" data-query="${escapeHtml(searchQuery)}" checked />
                  <label for="${checkboxId}">${escapeHtml(searchQuery)} - ${matchCount} <a href="#" class="remove-custom-query" data-checkbox-id="${checkboxId}">(Remove)</a></label>
                `;
                filtersContainer.appendChild(filterDiv);

                // Add remove link event listener
                const removeLink = filterDiv.querySelector('.remove-custom-query');
                removeLink?.addEventListener('click', (e) => {
                  e.preventDefault();
                  filterDiv.remove();
                  // Trigger checkbox change to re-render
                  const changeEvent = new Event('change', { bubbles: true });
                  filterBar.dispatchEvent(changeEvent);
                });
              }

              // Clear input
              inputElement.value = '';

              // Now get all checked queries and render with them
              const checkedQueries: QueryItem[] = [];
              filterBar.querySelectorAll('input[type="checkbox"]:checked').forEach(cb => {
                const query = (cb as HTMLInputElement).dataset.query;
                if (query) {
                  checkedQueries.push({
                    query: query,
                    use_regex: false,
                    query_type: 'parallel',
                    color: '#0080ff'
                  });
                }
              });

              // Combine all results: original + current + custom
              const perPdfResults = customResults;

              // Combine results and remove duplicates by page number
              const pageSet = new Set<number>();
              const mergedResults: SearchMatch[] = [];

              // 1. Add results from current search
              const currentSearchResults = currentResults.filter(m => m.file_path === filePath);
              currentSearchResults.forEach(result => {
                if (!pageSet.has(result.page_number)) {
                  pageSet.add(result.page_number);
                  mergedResults.push(result);
                }
              });

              // 2. Add results from original pinned search (if this PDF is pinned)
              if (pinnedResults.has(filePath)) {
                const pinnedData = pinnedResults.get(filePath)!;
                pinnedData.matches.forEach(result => {
                  if (!pageSet.has(result.page_number)) {
                    pageSet.add(result.page_number);
                    mergedResults.push(result);
                  }
                });
              }

              // 3. Add per-PDF search results (for pages not already included)
              perPdfResults.forEach((result: SearchMatch) => {
                if (!pageSet.has(result.page_number)) {
                  pageSet.add(result.page_number);
                  mergedResults.push(result);
                }
              });

              // Sort by page number
              mergedResults.sort((a, b) => a.page_number - b.page_number);

              // Re-render this PDF's matches with the merged results
              if (matchesContainer && mergedResults.length > 0) {
                matchesContainer.innerHTML = '';

                // Group by page
                const pageGroups = new Map<number, SearchMatch[]>();
                mergedResults.forEach(match => {
                  if (!pageGroups.has(match.page_number)) {
                    pageGroups.set(match.page_number, []);
                  }
                  pageGroups.get(match.page_number)!.push(match);
                });

                // Use all checked queries for highlighting
                const combinedQueries = checkedQueries;

                pageGroups.forEach((pageMatches, pageNumber) => {
                  const pageId = `page-${fileId}-${pageNumber}`;
                  const firstMatch = pageMatches[0];
                  const zoteroMetadata = firstMatch.zotero_metadata;

                  const pageHeader = zoteroMetadata && zoteroMetadata.pdf_attachment_key
                    ? `<a href="#" class="page-link" data-attachment-key="${escapeHtml(zoteroMetadata.pdf_attachment_key)}" data-page="${pageNumber}">Page ${pageNumber}</a> (${pageMatches.length} ${pageMatches.length === 1 ? 'match' : 'matches'})`
                    : `Page ${pageNumber} (${pageMatches.length} ${pageMatches.length === 1 ? 'match' : 'matches'})`;

                  const matchDiv = document.createElement('div');
                  matchDiv.className = 'result-match';
                  matchDiv.innerHTML = `
                    <div class="result-match-header">${pageHeader}</div>
                    <div class="page-preview" id="${pageId}">
                      <div class="page-preview-loading">Loading page preview...</div>
                    </div>
                  `;

                  matchesContainer.appendChild(matchDiv);
                });

                // Re-setup page link event listeners
                matchesContainer.querySelectorAll('.page-link').forEach(link => {
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

                // Load all page images with combined queries
                const pageElements = matchesContainer.querySelectorAll('.page-preview');

                pageElements.forEach((pageElement) => {
                  const pageId = pageElement.id;
                  const match = pageId.match(/page-(.+)-(\d+)$/);
                  if (match) {
                    const pageNumber = parseInt(match[2]);
                    loadPageImage(filePath, pageNumber, combinedQueries, undefined)
                      .then(element => {
                        pageElement.innerHTML = '';
                        pageElement.appendChild(element);
                      })
                      .catch(() => {
                        pageElement.innerHTML = `<div class="page-preview-error">Failed to load page preview</div>`;
                      });
                  }
                });
              } else if (matchesContainer) {
                matchesContainer.innerHTML = '<div class="page-preview-loading">No matches found for this search term in the PDF.</div>';
              }
            } catch (error) {
              console.error('Custom query search failed:', error);
              if (matchesContainer) {
                matchesContainer.innerHTML = `<div class="page-preview-error">Search failed: ${error}</div>`;
              }
            }
          }
        }
      }
    });
  });

  // Set up resize listener to update filter bar positions
  window.addEventListener('resize', () => {
    document.querySelectorAll('.result-matches-filter.visible').forEach(filterBar => {
      const header = (filterBar as HTMLElement).previousElementSibling as HTMLElement;
      if (header && header.classList.contains('result-file-header')) {
        const headerHeight = header.getBoundingClientRect().height;
        // Subtract 2px to account for border-bottom that moves from header to filter bar
        (filterBar as HTMLElement).style.setProperty('top', `${headerHeight - 2}px`);
      }
    });
  });

  // Set up event listeners for query filter checkboxes
  document.querySelectorAll('.result-matches-query-filter input[type="checkbox"]').forEach(checkbox => {
    checkbox.addEventListener('change', (e) => {
      const target = e.target as HTMLInputElement;
      const fileId = target.id.match(/query-filter-(?:original|current|custom)-(.+?)-\d+/)?.[1];

      if (fileId) {
        // Get all checked queries for this file
        const filterBar = document.getElementById(`filter-${fileId}`);
        if (!filterBar) return;

        const filePath = filterBar.dataset.filepath;
        if (!filePath) return;

        const checkedQueries: QueryItem[] = [];
        filterBar.querySelectorAll('input[type="checkbox"]:checked').forEach(cb => {
          const query = (cb as HTMLInputElement).dataset.query;
          if (query) {
            checkedQueries.push({
              query: query,
              use_regex: false,
              query_type: 'parallel',
              color: '#ffff00'
            });
          }
        });

        // Re-render pages with only checked queries
        const matchesContainer = document.getElementById(`matches-${fileId}`);
        if (matchesContainer && matchesContainer.classList.contains('open')) {
          const pageElements = matchesContainer.querySelectorAll('.page-preview');
          pageElements.forEach((pageElement) => {
            const pageId = pageElement.id;
            const match = pageId.match(/page-(.+)-(\d+)$/);
            if (match) {
              const pageNumber = parseInt(match[2]);
              loadPageImage(filePath, pageNumber, checkedQueries, undefined)
                .then(element => {
                  pageElement.innerHTML = '';
                  pageElement.appendChild(element);
                })
                .catch(() => {
                  pageElement.innerHTML = `<div class="page-preview-error">Failed to load page preview</div>`;
                });
            }
          });
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
        const element = await loadPageImage(filePath, 1, [], undefined);
        wrapper.innerHTML = '';
        wrapper.appendChild(element);
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

async function loadPageImage(filePath: string, pageNumber: number, queries: QueryItem[], match?: SearchMatch): Promise<HTMLElement> {
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

    // Get text content for highlighting and text selection
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
            if ('str' in item) {
              const itemText = item.str;
              const itemTextLower = itemText.toLowerCase();

              // Find all occurrences of the search term in this text item
              let matchIndex = 0;
              while ((matchIndex = itemTextLower.indexOf(searchLower, matchIndex)) !== -1) {
                // Get the transform matrix [a, b, c, d, e, f]
                const tx = item.transform;

                // Calculate the bounding box in PDF coordinates
                const fontHeight = Math.sqrt(tx[2] * tx[2] + tx[3] * tx[3]); // Scale in Y direction
                const totalWidth = item.width;
                const textLength = itemText.length;

                // Estimate character width (simple approximation)
                const charWidth = textLength > 0 ? totalWidth / textLength : 0;

                // Calculate the start position and width of just the matched text
                const matchLength = searchQuery.length;
                const matchStartOffset = matchIndex * charWidth;
                const matchWidth = matchLength * charWidth;

                // Convert PDF coordinates to viewport coordinates
                const left = tx[4] + matchStartOffset;
                const bottom = tx[5];
                const right = left + matchWidth;
                const top = bottom + fontHeight;

                // Transform to viewport space
                const [x1, y1] = viewport.convertToViewportPoint(left, bottom);
                const [x2, y2] = viewport.convertToViewportPoint(right, top);

                // Draw the highlight rectangle for just the matched portion
                const rectX = Math.min(x1, x2);
                const rectY = Math.min(y1, y2);
                const rectWidth = Math.abs(x2 - x1);
                const rectHeight = Math.abs(y2 - y1);

                context.fillRect(rectX, rectY, rectWidth, rectHeight);

                // Move to next potential match
                matchIndex += searchQuery.length;
              }
            }
          }
        }
      }
    }

    // Create a container for the canvas with text selection capability
    const container = document.createElement('div');
    container.style.position = 'relative';
    container.style.display = 'block';
    container.style.width = `${canvas.width}px`;
    container.style.height = `${canvas.height}px`;
    container.style.cursor = 'crosshair';
    container.appendChild(canvas);

    // Add text selection functionality
    let isSelecting = false;
    let startX = 0;
    let startY = 0;
    let selectionOverlay: HTMLDivElement | null = null;

    container.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return; // Only left click

      isSelecting = true;
      const rect = container.getBoundingClientRect();
      startX = e.clientX - rect.left;
      startY = e.clientY - rect.top;

      // Create selection overlay
      selectionOverlay = document.createElement('div');
      selectionOverlay.className = 'selection-overlay';
      selectionOverlay.style.left = `${startX}px`;
      selectionOverlay.style.top = `${startY}px`;
      selectionOverlay.style.width = '0px';
      selectionOverlay.style.height = '0px';
      container.appendChild(selectionOverlay);

      e.preventDefault();
    });

    container.addEventListener('mousemove', (e) => {
      if (!isSelecting || !selectionOverlay) return;

      const rect = container.getBoundingClientRect();
      const currentX = e.clientX - rect.left;
      const currentY = e.clientY - rect.top;

      const left = Math.min(startX, currentX);
      const top = Math.min(startY, currentY);
      const width = Math.abs(currentX - startX);
      const height = Math.abs(currentY - startY);

      selectionOverlay.style.left = `${left}px`;
      selectionOverlay.style.top = `${top}px`;
      selectionOverlay.style.width = `${width}px`;
      selectionOverlay.style.height = `${height}px`;
    });

    container.addEventListener('mouseup', (e) => {
      if (!isSelecting) return;

      isSelecting = false;

      const rect = container.getBoundingClientRect();
      const endX = e.clientX - rect.left;
      const endY = e.clientY - rect.top;

      // Calculate selection box
      const selectionBox = {
        x: Math.min(startX, endX),
        y: Math.min(startY, endY),
        width: Math.abs(endX - startX),
        height: Math.abs(endY - startY)
      };

      // Remove selection overlay
      if (selectionOverlay) {
        selectionOverlay.remove();
        selectionOverlay = null;
      }

      // Only process if selection has meaningful size
      if (selectionBox.width > 5 && selectionBox.height > 5) {
        // Extract text from selection
        const selectedText = extractTextFromSelection(textContent, selectionBox, viewport);

        if (selectedText && selectedText.trim().length >= 3) {
          // Get metadata for the note
          const fileName = filePath.split('/').pop() || filePath;
          const zoteroMetadata = match?.zotero_metadata || null;

          // Create note
          createNote(selectedText, filePath, fileName, pageNumber, zoteroMetadata, selectionBox);
        }
      }
    });

    // Cancel selection if mouse leaves
    container.addEventListener('mouseleave', () => {
      if (isSelecting && selectionOverlay) {
        selectionOverlay.remove();
        selectionOverlay = null;
        isSelecting = false;
      }
    });

    return container;
  } catch (error) {
    console.error(`Failed to render page ${pageNumber}:`, error);
    throw error;
  }
}

// Extract text from a selection box on a PDF page
function extractTextFromSelection(textContent: any, selectionBox: { x: number; y: number; width: number; height: number }, viewport: any): string {
  const selectedItems: string[] = [];

  for (const item of textContent.items) {
    if ('str' in item && item.str.trim()) {
      const tx = item.transform;

      // Calculate text bounding box
      const fontHeight = Math.sqrt(tx[2] * tx[2] + tx[3] * tx[3]);
      const left = tx[4];
      const bottom = tx[5];
      const right = left + item.width;
      const top = bottom + fontHeight;

      // Convert to viewport coordinates
      const [x1, y1] = viewport.convertToViewportPoint(left, bottom);
      const [x2, y2] = viewport.convertToViewportPoint(right, top);

      const itemBox = {
        x: Math.min(x1, x2),
        y: Math.min(y1, y2),
        width: Math.abs(x2 - x1),
        height: Math.abs(y2 - y1)
      };

      // Check if this text item overlaps with the selection
      if (boxesOverlap(selectionBox, itemBox)) {
        selectedItems.push(item.str);
      }
    }
  }

  return selectedItems.join(' ');
}

// Check if two boxes overlap
function boxesOverlap(box1: { x: number; y: number; width: number; height: number }, box2: { x: number; y: number; width: number; height: number }): boolean {
  return !(box1.x + box1.width < box2.x ||
           box2.x + box2.width < box1.x ||
           box1.y + box1.height < box2.y ||
           box2.y + box2.height < box1.y);
}

async function performSearch(event: Event) {
  event.preventDefault();

  const queries = getAllQueries();
  const directory = (directoryPath.textContent || '').trim();

  if (queries.length === 0 || !directory) {
    showStatus('Please enter at least one search query and select a directory', 'error');
    return;
  }

  // Clear per-PDF search queries for new search
  perPdfSearchQueries.clear();

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
      zotero_path: zoteroMode.checked ? (zoteroPath.textContent || '').trim() || null : null,
    };

    const results = await invoke<SearchMatch[]>('search_pdf_files', { params });
    currentResults = results;

    // Note: We don't update pinned results here anymore
    // The pinned results keep their original matches
    // Current search results will be shown alongside them in the UI

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
  exportLink = document.querySelector("#export-link")!;
  statusMessage = document.querySelector("#status-message")!;
  resultsCount = document.querySelector("#results-count")!;
  resultsContainer = document.querySelector("#results-container")!;
  toggleNotesBtn = document.querySelector("#toggle-notes-btn")!;
  notesSidebar = document.querySelector(".notes-sidebar")!;
  notesList = document.querySelector("#notes-list")!;
  exportNotesBtn = document.querySelector("#export-notes-btn")!;
  clearNotesBtn = document.querySelector("#clear-notes-btn")!;

  // Load pinned results from localStorage
  loadPinnedResults();

  // Load notes from localStorage
  loadNotes();

  // Render pinned results if any exist
  if (pinnedResults.size > 0) {
    renderResults([]);
  }

  // Load persisted settings
  const savedDirectory = localStorage.getItem('pdfSearchDirectory');
  if (savedDirectory) {
    directoryPath.textContent = savedDirectory;
    directoryPath.title = savedDirectory;
  }

  const savedZoteroPath = localStorage.getItem('pdfSearchZoteroPath');
  if (savedZoteroPath) {
    zoteroPath.textContent = savedZoteroPath;
    zoteroPath.title = savedZoteroPath;
  }

  const savedZoteroMode = localStorage.getItem('pdfSearchZoteroMode');
  if (savedZoteroMode !== null) {
    zoteroMode.checked = savedZoteroMode === 'true';
    toggleZoteroFolder();
  }

  // Restore column layout preference
  const savedColumnLayout = localStorage.getItem('pdfSearchColumnLayout') || '1';
  // Set active state on the corresponding icon
  document.querySelectorAll('.column-icon').forEach(icon => {
    if ((icon as HTMLElement).dataset.columns === savedColumnLayout) {
      icon.classList.add('active');
    } else {
      icon.classList.remove('active');
    }
  });
  // Apply saved layout to any existing result-matches
  document.querySelectorAll('.result-matches').forEach(matches => {
    matches.classList.remove('columns-1', 'columns-2', 'columns-3');
    matches.classList.add(`columns-${savedColumnLayout}`);
  });

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
  exportLink.addEventListener("click", (e) => {
    e.preventDefault();
    if (!exportLink.classList.contains('disabled')) {
      copyResults();
    }
  });

  // Notes sidebar event listeners
  toggleNotesBtn.addEventListener("click", toggleNotesSidebar);
  exportNotesBtn.addEventListener("click", exportNotesToMarkdown);
  clearNotesBtn.addEventListener("click", clearAllNotes);

  // Restore notes sidebar state
  const notesSidebarOpen = localStorage.getItem('notesSidebarOpen');
  if (notesSidebarOpen === 'true') {
    notesSidebar.classList.remove('collapsed');
    toggleNotesBtn.classList.add('active');
  }

  // Column layout icons event handlers
  document.querySelectorAll('.column-icon').forEach(icon => {
    icon.addEventListener('click', () => {
      // Remove active class from all icons
      document.querySelectorAll('.column-icon').forEach(i => i.classList.remove('active'));
      // Add active class to clicked icon
      icon.classList.add('active');

      // Get the number of columns
      const columns = (icon as HTMLElement).dataset.columns || '1';

      // Update all result-matches with column layout class
      document.querySelectorAll('.result-matches').forEach(matches => {
        matches.classList.remove('columns-1', 'columns-2', 'columns-3');
        matches.classList.add(`columns-${columns}`);
      });

      // Save preference to localStorage
      localStorage.setItem('pdfSearchColumnLayout', columns);
    });
  });

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
