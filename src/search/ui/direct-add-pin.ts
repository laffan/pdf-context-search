import { pinnedResults } from '../../shared/data/state';
import type { SearchMatch, PdfListItem } from '../../shared/data/types';
import { showStatus } from '../../shared/ui/status-message';
import { savePinnedResults } from '../../results/data/pinned-results-data';
import { renderResults } from '../../results/ui/results-renderer-ui';

/**
 * Pin a PDF directly without running a search
 * Constructs a SearchMatch from PdfListItem data instantly
 */
export function pinPdfDirectly(item: PdfListItem) {
  // Check if already pinned
  if (pinnedResults.has(item.file_path)) {
    showStatus('PDF is already pinned', 'info');
    return;
  }

  // Construct a SearchMatch directly from the PdfListItem data
  const searchMatch: SearchMatch = {
    file_path: item.file_path,
    file_name: item.file_name,
    page_number: 1, // Default to page 1
    context_before: '',
    matched_text: '',
    context_after: '',
    zotero_link: item.zotero_metadata?.zotero_link || null,
    zotero_metadata: item.zotero_metadata || null
  };

  // Pin the result with an empty query (indicating direct add)
  pinnedResults.set(item.file_path, {
    queries: [], // Empty queries to indicate direct add
    matches: [searchMatch],
    timestamp: Date.now()
  });

  savePinnedResults();

  // Re-render results to show the newly pinned PDF
  renderResults([]);

  showStatus(`Pinned: ${item.file_name}`, 'success');
}
