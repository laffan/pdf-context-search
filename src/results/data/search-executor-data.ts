import { invoke } from "@tauri-apps/api/core";
import type { SearchMatch, SearchParams } from '../../shared/data/types';
import { getAllQueries } from '../../search/data/search-queries-data';
import { saveSearchToHistory } from '../../search/data/search-history-data';
import {
  directoryPath,
  zoteroMode,
  zoteroPath,
  searchBtn,
  resultsContainer,
  setCurrentResults,
  perPdfSearchQueries
} from '../../shared/data/state';
import { showStatus } from '../../shared/ui/status-message';

export async function performSearch(event: Event, renderResultsCallback: (results: SearchMatch[]) => void) {
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
    setCurrentResults(results);

    // Note: We don't update pinned results here anymore
    // The pinned results keep their original matches
    // Current search results will be shown alongside them in the UI

    renderResultsCallback(results);
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
