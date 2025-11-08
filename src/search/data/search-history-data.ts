import type { SearchHistoryItem, QueryItem } from '../../shared/data/types';
import { MAX_SEARCH_HISTORY } from '../../shared/data/constants';

export function getSearchHistory(): SearchHistoryItem[] {
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

export function saveSearchToHistory(queries: QueryItem[]) {
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

export function clearSearchHistory() {
  localStorage.removeItem('pdfSearchHistory');
}
