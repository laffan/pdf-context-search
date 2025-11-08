import { searchQueriesContainer, incrementQueryCount } from '../../shared/data/state';
import { getColorForQuery } from '../../shared/data/color-utils';

export function addSearchQueryItem(queryType: 'parallel' | 'filter' = 'parallel') {
  const container = searchQueriesContainer;
  const index = incrementQueryCount();

  // Count existing queries to determine color index
  const existingQueries = container.querySelectorAll('.search-query-item');
  const parallelCount = Array.from(existingQueries).filter(
    (item) => (item as HTMLElement).dataset.queryType === 'parallel'
  ).length;

  // Get color from palette based on query type and count
  const defaultColor = getColorForQuery(parallelCount, queryType);

  const queryItem = document.createElement('div');
  queryItem.className = queryType === 'filter' ? 'search-query-item filter-type' : 'search-query-item';
  queryItem.dataset.index = String(index);
  queryItem.dataset.queryType = queryType;
  queryItem.dataset.color = defaultColor;

  const placeholder = queryType === 'parallel' ? 'Enter search term...' : 'Enter filter term...';

  queryItem.innerHTML = `
    <div style="display: flex; gap: 8px; align-items: center;">
      <input
        type="text"
        class="search-query-input"
        placeholder="${placeholder}"
        data-index="${index}"
      />
      <div class="color-picker-container">
        <div class="color-picker" data-index="${index}" style="background-color: ${defaultColor};" title="Click to change highlight color"></div>
        <input type="color" class="color-input" data-index="${index}" value="${defaultColor}" />
      </div>
    </div>
    <div style="display: flex; justify-content: space-between; align-items: center;">
      <label class="inline-checkbox">
        <input type="checkbox" class="use-regex-checkbox" data-index="${index}" />
        Use Regex
      </label>
      <button type="button" class="remove-query-btn" data-index="${index}">×</button>
    </div>
  `;

  container.appendChild(queryItem);

  // Add event listener to remove button (only show for non-first items)
  const removeBtn = queryItem.querySelector('.remove-query-btn') as HTMLButtonElement;
  if (index === 0) {
    removeBtn.style.display = 'none';
  } else {
    removeBtn.addEventListener('click', () => removeSearchQueryItem(index));
  }

  // Add color picker event listener
  const colorPicker = queryItem.querySelector('.color-picker') as HTMLElement;
  const colorInput = queryItem.querySelector('.color-input') as HTMLInputElement;

  colorPicker.addEventListener('click', () => {
    colorInput.click();
  });

  colorInput.addEventListener('input', (e) => {
    const color = (e.target as HTMLInputElement).value;
    colorPicker.style.backgroundColor = color;
    queryItem.dataset.color = color;
  });
}

export function removeSearchQueryItem(index: number) {
  const queryItem = searchQueriesContainer.querySelector(`[data-index="${index}"]`);
  if (queryItem) {
    queryItem.remove();
  }
}
