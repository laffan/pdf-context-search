import { getSearchHistory, clearSearchHistory } from '../data/search-history-data';
import { searchQueriesContainer, incrementQueryCount } from '../../shared/data/state';
import { escapeHtml } from '../../shared/ui/html-utils';
import { removeSearchQueryItem } from './search-form-ui';

export function renderSearchDropdown() {
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

      item.queries.forEach((queryItem, index) => {
        const newIndex = incrementQueryCount();
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

export function hideSearchDropdown() {
  const dropdown = document.getElementById('search-dropdown');
  if (dropdown) {
    dropdown.remove();
  }
}
