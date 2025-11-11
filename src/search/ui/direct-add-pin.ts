import { invoke } from '@tauri-apps/api/core';
import { pinnedResults, zoteroMode, zoteroPath } from '../../shared/data/state';
import type { SearchMatch, SearchParams } from '../../shared/data/types';
import { showStatus } from '../../shared/ui/status-message';
import { savePinnedResults } from '../../results/data/pinned-results-data';
import { renderResults } from '../../results/ui/results-renderer-ui';

/**
 * Pin a PDF directly without running a search
 * This creates an empty search result with just the first page
 */
export async function pinPdfDirectly(filePath: string) {
  try {
    // Create a dummy query to get the first page of the PDF
    // We use an empty regex that will match something minimal
    const params: SearchParams = {
      queries: [{
        query: '.',  // Match any character (minimal match)
        use_regex: true,
        query_type: 'parallel',
        color: '#ffff00'
      }],
      directory: filePath,  // For single PDF, directory is the file path
      context_words: 0,
      zotero_path: zoteroMode.checked && zoteroPath.textContent !== 'Select Zotero data directory...'
        ? zoteroPath.textContent
        : null
    };

    // Get matches from the PDF (at least one to establish the file)
    const matches = await invoke<SearchMatch[]>('search_single_pdf_file', { params });

    if (matches.length === 0) {
      showStatus('PDF appears to be empty or unreadable', 'error');
      return;
    }

    // Take only the first match to pin the document
    const firstMatch = matches[0];

    // Check if already pinned
    if (pinnedResults.has(firstMatch.file_path)) {
      showStatus('PDF is already pinned', 'info');
      return;
    }

    // Pin the result with an empty query (indicating direct add)
    pinnedResults.set(firstMatch.file_path, {
      queries: [], // Empty queries to indicate direct add
      matches: [firstMatch], // Store first match for metadata
      timestamp: Date.now()
    });

    savePinnedResults();

    // Re-render results to show the newly pinned PDF
    renderResults([]);

    showStatus(`Pinned: ${firstMatch.file_name}`, 'success');
  } catch (error) {
    console.error('Failed to pin PDF:', error);
    showStatus(`Failed to pin PDF: ${error}`, 'error');
  }
}
