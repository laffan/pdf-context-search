import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
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
                <button class="btn-icon copy-citation-btn" data-citekey="${escapeHtml(zoteroMetadata.citekey)}" data-link="${escapeHtml(zoteroMetadata.zotero_link)}">📋 Citation</button>
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
        ${showPages.checked ? `<div class="cover-page-container" id="cover-${fileId}" style="display: none;"></div>` : ''}
        <div class="result-matches" id="matches-${fileId}">
    `;

    if (!showPages.checked) {
      // Show text context for each match
      fileMatches.forEach((match) => {
        const pageHeader = zoteroMetadata && zoteroMetadata.pdf_attachment_key
          ? `<a href="#" class="page-link" data-attachment-key="${escapeHtml(zoteroMetadata.pdf_attachment_key)}" data-page="${match.page_number}">Page ${match.page_number}</a>`
          : `Page ${match.page_number}`;
        html += `
          <div class="result-match">
            <div class="result-match-header">${pageHeader}</div>
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
    }

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
          // Opening - load pages if needed
          matchesContainer.classList.add('open');
          arrow.classList.add('open');

          // Load pages if "Show Pages" is enabled
          if (showPages.checked) {
            const query = searchQuery.value.trim();
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
                    loadPageImage(filePath, pageNumber, query)
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
          }
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
  const coverContainer = document.getElementById(`cover-${fileId}`);

  if (!coverContainer) return;

  const isVisible = coverContainer.style.display !== 'none';

  if (isVisible) {
    // Hide the cover
    coverContainer.style.display = 'none';
    button.style.opacity = '0.7';
  } else {
    // Show the cover
    coverContainer.style.display = 'flex';

    // Check if already loaded
    if (!coverContainer.querySelector('canvas') && !coverContainer.querySelector('img')) {
      coverContainer.innerHTML = '<div class="loading">Loading cover page...</div>';

      try {
        const canvas = await loadPageImage(filePath, 1, '');
        coverContainer.innerHTML = '';
        coverContainer.appendChild(canvas);
      } catch {
        coverContainer.innerHTML = '<div class="page-preview-error">Failed to load cover page</div>';
      }
    }

    button.style.opacity = '1';
  }
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
    // Skip highlighting if search query is empty (e.g., for cover pages)
    if (searchQuery.trim().length > 0) {
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
    fileGroups.forEach((matches, filePath) => {
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
  exportBtn.addEventListener("click", copyResults);

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
