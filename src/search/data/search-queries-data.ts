import type { QueryItem } from '../../shared/data/types';
import { searchQueriesContainer } from '../../shared/data/state';

export function getAllQueries(): QueryItem[] {
  const queryItems = searchQueriesContainer.querySelectorAll('.search-query-item') as NodeListOf<HTMLElement>;
  const queries: QueryItem[] = [];

  queryItems.forEach(queryItem => {
    const input = queryItem.querySelector('.search-query-input') as HTMLInputElement;
    const query = input.value.trim();

    if (query) {
      const regexCheckbox = queryItem.querySelector('.use-regex-checkbox') as HTMLInputElement;
      const queryType = queryItem.dataset.queryType || 'parallel';
      const color = queryItem.dataset.color || '#ffff00';

      queries.push({
        query,
        use_regex: regexCheckbox.checked,
        query_type: queryType,
        color: color
      });
    }
  });

  return queries;
}
