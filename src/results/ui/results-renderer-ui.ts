import { invoke } from "@tauri-apps/api/core";
import type { SearchMatch, QueryItem, SearchParams } from '../../shared/data/types';
import {
  currentResults,
  pinnedResults,
  resultsContainer,
  resultsCount,
  exportLink,
  perPdfSearchQueries,
  zoteroMode,
  zoteroPath
} from '../../shared/data/state';
import { getAllQueries } from '../../search/data/search-queries-data';
import { togglePinResult } from '../data/pinned-results-data';
import { loadPageImage, toggleCoverPage } from './pdf-viewer-ui';
import { copyCitation, openInZotero } from '../../shared/ui/zotero-actions';
import { escapeHtml } from '../../shared/ui/html-utils';
import { getColorForQuery } from '../../shared/data/color-utils';

export function renderFileGroup(filePath: string, fileMatches: SearchMatch[], isPinned: boolean, originalQueries?: QueryItem[], currentMatchCount?: number, originalMatchCount?: number, originalMatches?: SearchMatch[], currentMatches?: SearchMatch[]): string {
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
              <input type="checkbox" id="query-filter-original-${fileId}-${i}" data-query-type="original" data-query="${escapeHtml(q.query)}" data-color="${q.color}" checked />
              <label for="query-filter-original-${fileId}-${i}">
                <span class="query-color-indicator" style="background-color: ${q.color};"></span>
                ${escapeHtml(q.query)} - ${queryMatchCount}
              </label>
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
                <input type="checkbox" id="query-filter-current-${fileId}-${i}" data-query-type="current" data-query="${escapeHtml(q.query)}" data-color="${q.color}" checked />
                <label for="query-filter-current-${fileId}-${i}">
                  <span class="query-color-indicator" style="background-color: ${q.color};"></span>
                  ${escapeHtml(q.query)} - ${queryMatchCount}
                </label>
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

export function renderResults(matches: SearchMatch[]) {
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
  // Convert to array and sort by match count, then by title/filename
  const pinnedArray = Array.from(pinnedResults.entries());
  pinnedArray.sort((a, b) => {
    const [, pinnedDataA] = a;
    const [, pinnedDataB] = b;

    // Get match counts
    const countA = pinnedDataA.matches.length;
    const countB = pinnedDataB.matches.length;

    // First sort by match count (descending)
    if (countA !== countB) {
      return countB - countA;
    }

    // Then sort by title (Zotero) or filename
    const titleA = pinnedDataA.matches[0]?.zotero_metadata?.title || pinnedDataA.matches[0]?.file_name || '';
    const titleB = pinnedDataB.matches[0]?.zotero_metadata?.title || pinnedDataB.matches[0]?.file_name || '';
    return titleA.toLowerCase().localeCompare(titleB.toLowerCase());
  });

  pinnedArray.forEach(([filePath, pinnedData]) => {
    // Get current matches for this file
    const currentMatchesForFile = fileGroups.get(filePath) || [];
    const currentMatchCount = currentMatchesForFile.length;
    const originalMatchCount = pinnedData.matches.length;

    // Merge matches by page number to avoid duplicates - but keep track of which are which
    const pageMap = new Map<number, SearchMatch>();
    pinnedData.matches.forEach(m => pageMap.set(m.page_number, m));
    currentMatchesForFile.forEach(m => pageMap.set(m.page_number, m));

    const combinedMatches = Array.from(pageMap.values()).sort((a, b) => a.page_number - b.page_number);

    // Pass combined matches for display, but separate counts and arrays for filters
    html += renderFileGroup(filePath, combinedMatches, true, pinnedData.queries, currentMatchCount, originalMatchCount, pinnedData.matches, currentMatchesForFile);
  });

  // Render current results (excluding already pinned files)
  // Convert to array and sort by match count, then by title/filename
  const fileGroupsArray = Array.from(fileGroups.entries()).filter(([filePath]) => !pinnedResults.has(filePath));
  fileGroupsArray.sort((a, b) => {
    const [, matchesA] = a;
    const [, matchesB] = b;

    // First sort by match count (descending)
    if (matchesA.length !== matchesB.length) {
      return matchesB.length - matchesA.length;
    }

    // Then sort by title (Zotero) or filename
    const titleA = matchesA[0]?.zotero_metadata?.title || matchesA[0]?.file_name || '';
    const titleB = matchesB[0]?.zotero_metadata?.title || matchesB[0]?.file_name || '';
    return titleA.toLowerCase().localeCompare(titleB.toLowerCase());
  });

  fileGroupsArray.forEach(([filePath, fileMatches]) => {
    html += renderFileGroup(filePath, fileMatches, false);
  });

  resultsContainer.innerHTML = html;

  // Apply saved column layout to all result-matches
  const savedColumnLayout = localStorage.getItem('pdfSearchColumnLayout') || '1';
  document.querySelectorAll('.result-matches').forEach(matchesEl => {
    matchesEl.classList.add(`columns-${savedColumnLayout}`);
  });

  // Set up event listeners for pin buttons
  document.querySelectorAll('.pin-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const filePath = (btn as HTMLButtonElement).dataset.filepath;
      if (filePath) {
        togglePinResult(filePath, renderResults);
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
                // Find a match from this file to pass metadata
                const fileMatch = currentResults.find(m => m.file_path === foundFilePath && m.page_number === pageNumber) ||
                                  Array.from(pinnedResults.values()).flatMap(p => p.matches).find(m => m.file_path === foundFilePath && m.page_number === pageNumber);
                loadPageImage(foundFilePath, pageNumber, queriesToUse, fileMatch)
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
  // Remove any existing listeners by cloning and replacing elements to avoid duplicates
  document.querySelectorAll('.result-matches-search-input').forEach(input => {
    const newInput = input.cloneNode(true) as HTMLInputElement;
    input.parentNode?.replaceChild(newInput, input);

    newInput.addEventListener('keydown', async (e: Event) => {
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

            // Count existing query filters in this PDF's filter bar to determine the next color
            const existingFilterCheckboxes = filterBar.querySelectorAll('.result-matches-query-filter input[type="checkbox"]');
            const nextColorIndex = existingFilterCheckboxes.length;
            const customQueryColor = getColorForQuery(nextColorIndex, 'parallel');

            // Create checkbox immediately with "Searching..." label
            const filtersContainer = filterBar.querySelector('.result-matches-query-filters');
            const checkboxId = `query-filter-custom-${fileId}-${Date.now()}`;
            let filterDiv: HTMLDivElement | null = null;

            if (filtersContainer) {
              filterDiv = document.createElement('div');
              filterDiv.className = 'result-matches-query-filter custom-query';
              filterDiv.innerHTML = `
                <input type="checkbox" id="${checkboxId}" data-query-type="custom" data-query="${escapeHtml(searchQuery)}" data-color="${customQueryColor}" checked />
                <label for="${checkboxId}">
                  <span class="query-color-indicator" style="background-color: ${customQueryColor};"></span>
                  ${escapeHtml(searchQuery)} - Searching...
                </label>
              `;
              filtersContainer.appendChild(filterDiv);

              // Force browser to render the "Searching..." text before starting the search
              // This ensures the user sees the immediate feedback
              void filterDiv.offsetHeight;
            }

            // Clear input immediately
            inputElement.value = '';

            // Give the browser time to paint the "Searching..." text before starting the search
            // This ensures the user sees immediate feedback even on fast searches
            await new Promise(resolve => setTimeout(resolve, 0));

            // Search for this specific query to get match count
            try {
              const customQueryParams: SearchParams = {
                queries: [{
                  query: searchQuery,
                  use_regex: false,
                  query_type: 'parallel',
                  color: customQueryColor
                }],
                directory: filePath,
                context_words: 100,
                zotero_path: zoteroMode.checked ? (zoteroPath.textContent || '').trim() || null : null,
              };

              const customResults = await invoke<SearchMatch[]>('search_single_pdf_file', { params: customQueryParams });
              const matchCount = customResults.length;

              // Update the checkbox label with actual match count
              if (filterDiv) {
                const label = filterDiv.querySelector('label');
                if (label) {
                  label.innerHTML = `
                    <span class="query-color-indicator" style="background-color: ${customQueryColor};"></span>
                    ${escapeHtml(searchQuery)} - ${matchCount} <a href="#" class="remove-custom-query" data-checkbox-id="${checkboxId}">(Remove)</a>
                  `;

                  // Add remove link event listener
                  const removeLink = label.querySelector('.remove-custom-query');
                  removeLink?.addEventListener('click', (e) => {
                    e.preventDefault();
                    filterDiv?.remove();
                    // Trigger checkbox change to re-render
                    const changeEvent = new Event('change', { bubbles: true });
                    filterBar.dispatchEvent(changeEvent);
                  });
                }
              }

              // Now get all checked queries and render with them
              const checkedQueries: QueryItem[] = [];
              filterBar.querySelectorAll('input[type="checkbox"]:checked').forEach(cb => {
                const checkbox = cb as HTMLInputElement;
                const query = checkbox.dataset.query;
                const color = checkbox.dataset.color || '#ffff00'; // Fallback to yellow if no color
                if (query) {
                  checkedQueries.push({
                    query: query,
                    use_regex: false,
                    query_type: 'parallel',
                    color: color
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
                const pageGroupsLocal = new Map<number, SearchMatch[]>();
                mergedResults.forEach(match => {
                  if (!pageGroupsLocal.has(match.page_number)) {
                    pageGroupsLocal.set(match.page_number, []);
                  }
                  pageGroupsLocal.get(match.page_number)!.push(match);
                });

                // Use all checked queries for highlighting
                const combinedQueries = checkedQueries;

                pageGroupsLocal.forEach((pageMatches, pageNumber) => {
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
                    // Find a match from this file to pass metadata
                    const fileMatch = mergedResults.find(m => m.page_number === pageNumber);
                    loadPageImage(filePath, pageNumber, combinedQueries, fileMatch)
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
          const checkbox = cb as HTMLInputElement;
          const query = checkbox.dataset.query;
          const color = checkbox.dataset.color || '#ffff00'; // Fallback to yellow if no color
          if (query) {
            checkedQueries.push({
              query: query,
              use_regex: false,
              query_type: 'parallel',
              color: color
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
              // Find a match from this file to pass metadata
              const fileMatch = currentResults.find(m => m.file_path === filePath && m.page_number === pageNumber) ||
                                Array.from(pinnedResults.values()).flatMap(p => p.matches).find(m => m.file_path === filePath && m.page_number === pageNumber);
              loadPageImage(filePath, pageNumber, checkedQueries, fileMatch)
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
