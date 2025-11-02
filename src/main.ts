import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import * as pdfjsLib from 'pdfjs-dist';
// Import the worker as a URL - Vite will bundle it
// @ts-expect-error Vite handles ?url imports
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// Set up PDF.js worker - use local worker file instead of CDN
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

interface SearchMatch {
  file_path: string;
  file_name: string;
  page_number: number;
  context_before: string;
  matched_text: string;
  context_after: string;
  zotero_link: string | null;
}

interface SearchParams {
  query: string;
  directory: string;
  context_words: number;
  case_sensitive: boolean;
  use_regex: boolean;
  zotero_path: string | null;
}

let currentResults: SearchMatch[] = [];

// DOM Elements
let searchForm: HTMLFormElement;
let searchQuery: HTMLInputElement;
let directoryPath: HTMLInputElement;
let browseBtn: HTMLButtonElement;
let caseSensitive: HTMLInputElement;
let useRegex: HTMLInputElement;
let showPages: HTMLInputElement;
let zoteroMode: HTMLInputElement;
let zoteroPath: HTMLInputElement;
let browseZoteroBtn: HTMLButtonElement;
let zoteroFolderGroup: HTMLElement;
let searchBtn: HTMLButtonElement;
let exportBtn: HTMLButtonElement;
let statusMessage: HTMLElement;
let resultsCount: HTMLElement;
let resultsContainer: HTMLElement;

function showStatus(message: string, type: 'info' | 'error' | 'success') {
  statusMessage.textContent = message;
  statusMessage.className = type;
  setTimeout(() => {
    statusMessage.className = '';
    statusMessage.textContent = '';
  }, 5000);
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
    const zoteroLink = fileMatches[0].zotero_link;

    html += `
      <div class="result-file">
        <div class="result-file-header">
          <h3>${fileName}</h3>
          <div class="result-file-path">${filePath}</div>
          ${zoteroLink ? `<div class="zotero-link"><a href="${escapeHtml(zoteroLink)}"">📚 ${escapeHtml(zoteroLink)}</a></div>` : ''}
        </div>
        <div class="result-matches">
    `;

    if (!showPages.checked) {
      // Show text context for each match
      fileMatches.forEach((match) => {
        html += `
          <div class="result-match">
            <div class="result-match-header">Page ${match.page_number}</div>
            <div class="result-match-context">
              ...${escapeHtml(match.context_before)}
              <span class="match-highlight">${escapeHtml(match.matched_text)}</span>
              ${escapeHtml(match.context_after)}...
            </div>
          </div>
        `;
      });
    } else {
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
        const pageId = `page-${filePath.replace(/[^a-zA-Z0-9]/g, '_')}-${pageNumber}`;
        html += `
          <div class="result-match">
            <div class="result-match-header">Page ${pageNumber} (${pageMatches.length} ${pageMatches.length === 1 ? 'match' : 'matches'})</div>
            <div class="page-preview" id="${pageId}">
              <div class="page-preview-loading">Loading page preview...</div>
            </div>
          </div>
        `;
      });
    }

    html += `
        </div>
      </div>
    `;
  });

  resultsContainer.innerHTML = html;

  // Load page images if "Show Pages" is enabled
  if (showPages.checked) {
    const query = searchQuery.value.trim();

    fileGroups.forEach((fileMatches, filePath) => {
      // Group by page
      const pageGroups = new Map<number, SearchMatch[]>();
      fileMatches.forEach(match => {
        if (!pageGroups.has(match.page_number)) {
          pageGroups.set(match.page_number, []);
        }
        pageGroups.get(match.page_number)!.push(match);
      });

      // Load each unique page once
      pageGroups.forEach((_pageMatches, pageNumber) => {
        const pageId = `page-${filePath.replace(/[^a-zA-Z0-9]/g, '_')}-${pageNumber}`;

        loadPageImage(filePath, pageNumber, query)
          .then(canvas => {
            const element = document.getElementById(pageId);
            if (element) {
              element.innerHTML = '';
              element.appendChild(canvas);
            }
          })
          .catch(() => {
            const element = document.getElementById(pageId);
            if (element) {
              element.innerHTML = `<div class="page-preview-error">Failed to load page preview</div>`;
            }
          });
      });
    });
  }
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

async function loadPageImage(filePath: string, pageNumber: number, searchQuery: string): Promise<HTMLCanvasElement> {
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

    // Highlight search terms (draw rectangles over matches)
    context.fillStyle = 'rgba(255, 255, 0, 0.4)'; // Yellow highlight
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

    return canvas;
  } catch (error) {
    console.error(`Failed to render page ${pageNumber}:`, error);
    throw error;
  }
}

async function performSearch(event: Event) {
  event.preventDefault();

  const query = searchQuery.value.trim();
  const directory = directoryPath.value.trim();

  if (!query || !directory) {
    showStatus('Please enter a search query and select a directory', 'error');
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
      query,
      directory,
      context_words: 100, // Default context words (not user-configurable)
      case_sensitive: caseSensitive.checked,
      use_regex: useRegex.checked,
      zotero_path: zoteroMode.checked ? zoteroPath.value.trim() || null : null,
    };

    const results = await invoke<SearchMatch[]>('search_pdf_files', { params });
    currentResults = results;

    renderResults(results);
    showStatus(`Found ${results.length} ${results.length === 1 ? 'match' : 'matches'}`, 'success');
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

async function exportResults() {
  if (currentResults.length === 0) {
    showStatus('No results to export', 'error');
    return;
  }

  try {
    const filePath = await save({
      title: 'Save Results',
      defaultPath: 'search-results.md',
      filters: [{
        name: 'Markdown',
        extensions: ['md']
      }]
    });

    if (filePath) {
      await invoke('export_results_to_markdown', {
        matches: currentResults,
        outputPath: filePath
      });
      showStatus('Results exported successfully!', 'success');
    }
  } catch (error) {
    showStatus(`Export failed: ${error}`, 'error');
  }
}

// Initialize app
window.addEventListener("DOMContentLoaded", () => {
  // Get DOM elements
  searchForm = document.querySelector("#search-form")!;
  searchQuery = document.querySelector("#search-query")!;
  directoryPath = document.querySelector("#directory-path")!;
  browseBtn = document.querySelector("#browse-btn")!;
  caseSensitive = document.querySelector("#case-sensitive")!;
  useRegex = document.querySelector("#use-regex")!;
  showPages = document.querySelector("#show-pages")!;
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

  const savedCaseSensitive = localStorage.getItem('pdfSearchCaseSensitive');
  if (savedCaseSensitive !== null) {
    caseSensitive.checked = savedCaseSensitive === 'true';
  }

  const savedUseRegex = localStorage.getItem('pdfSearchUseRegex');
  if (savedUseRegex !== null) {
    useRegex.checked = savedUseRegex === 'true';
  }

  const savedShowPages = localStorage.getItem('pdfSearchShowPages');
  if (savedShowPages !== null) {
    showPages.checked = savedShowPages === 'true';
  }

  const savedZoteroMode = localStorage.getItem('pdfSearchZoteroMode');
  if (savedZoteroMode !== null) {
    zoteroMode.checked = savedZoteroMode === 'true';
    toggleZoteroFolder();
  }

  // Add event listeners
  searchForm.addEventListener("submit", performSearch);
  browseBtn.addEventListener("click", browseDirectory);
  browseZoteroBtn.addEventListener("click", browseZoteroDirectory);
  exportBtn.addEventListener("click", exportResults);

  // Persist settings when they change
  caseSensitive.addEventListener("change", () => {
    localStorage.setItem('pdfSearchCaseSensitive', String(caseSensitive.checked));
  });

  useRegex.addEventListener("change", () => {
    localStorage.setItem('pdfSearchUseRegex', String(useRegex.checked));
  });

  showPages.addEventListener("change", () => {
    localStorage.setItem('pdfSearchShowPages', String(showPages.checked));
  });

  zoteroMode.addEventListener("change", () => {
    localStorage.setItem('pdfSearchZoteroMode', String(zoteroMode.checked));
    toggleZoteroFolder();
  });
});
