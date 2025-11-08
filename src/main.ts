// ========== Tauri and PDF.js Imports ==========
import * as pdfjsLib from 'pdfjs-dist';
// Import the worker as a URL - Vite will bundle it
// @ts-expect-error Vite handles ?url imports
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// ========== Shared Imports ==========
import { initializeDomElements } from './shared/data/state';
import {
  searchForm,
  browseBtn,
  browseZoteroBtn,
  zoteroMode,
  exportLink,
  toggleNotesBtn,
  exportNotesBtn,
  clearNotesBtn,
  addSearchTermBtn,
  addFilterTermBtn,
  searchQueriesContainer,
  directoryPath,
  zoteroPath,
  notesSidebar,
  pinnedResults
} from './shared/data/state';

// ========== Search Imports ==========
import { addSearchQueryItem } from './search/ui/search-form-ui';
import { browseDirectory, browseZoteroDirectory, toggleZoteroFolder } from './search/ui/directory-browser-ui';
import { renderSearchDropdown, hideSearchDropdown } from './search/ui/search-dropdown-ui';

// ========== Results Imports ==========
import { performSearch } from './results/data/search-executor-data';
import { loadPinnedResults } from './results/data/pinned-results-data';
import { renderResults } from './results/ui/results-renderer-ui';
import { copyResults } from './results/ui/results-export-ui';

// ========== Notes Imports ==========
import { loadNotes, clearAllNotes, exportNotesToMarkdown } from './notes/data/notes-data';
import { toggleNotesSidebar } from './notes/ui/notes-sidebar-ui';
import { renderNotesList } from './notes/ui/notes-renderer-ui';

// ========== PDF.js Setup ==========
// Set up PDF.js worker - use local worker file instead of CDN
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

// ========== Application Initialization ==========
window.addEventListener("DOMContentLoaded", () => {
  // Initialize DOM elements
  initializeDomElements();

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

  // ========== Event Listeners ==========

  // Search form event listeners
  searchForm.addEventListener("submit", (e) => performSearch(e, renderResults));
  browseBtn.addEventListener("click", browseDirectory);
  browseZoteroBtn.addEventListener("click", browseZoteroDirectory);
  exportLink.addEventListener("click", (e) => {
    e.preventDefault();
    if (!exportLink.classList.contains('disabled')) {
      copyResults();
    }
  });

  // Notes sidebar event listeners
  toggleNotesBtn.addEventListener("click", (e) => {
    e.preventDefault();
    toggleNotesSidebar();
  });
  exportNotesBtn.addEventListener("click", exportNotesToMarkdown);
  clearNotesBtn.addEventListener("click", () => clearAllNotes(renderNotesList));

  // Restore notes sidebar state
  const notesSidebarOpen = localStorage.getItem('notesSidebarOpen');
  if (notesSidebarOpen === 'true') {
    notesSidebar.classList.remove('collapsed');
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

  // Render notes list initially
  renderNotesList();
});
