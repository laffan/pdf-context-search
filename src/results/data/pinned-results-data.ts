import { pinnedResults, currentResults } from '../../shared/data/state';
import { getAllQueries } from '../../search/data/search-queries-data';

export function savePinnedResults() {
  const pinnedArray = Array.from(pinnedResults.entries()).map(([filePath, data]) => ({
    filePath,
    ...data
  }));
  localStorage.setItem('pdfPinnedResults', JSON.stringify(pinnedArray));
}

export function loadPinnedResults() {
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

export function togglePinResult(filePath: string, renderResultsCallback: (results: any[]) => void) {
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
  renderResultsCallback(currentResults);
}
