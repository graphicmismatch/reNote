import "./SearchPanel.css";

export interface SearchResultItem {
  id: string; // page id
  title: string;
  snippet: string;
}

export interface SearchPanelProps {
  query: string;
  results: SearchResultItem[]; // already fetched/filtered by the caller
  onQueryChange: (query: string) => void;
  onSelect: (id: string) => void;
}

/**
 * Always-visible search box + results list for a sidebar/panel. Unlike
 * CommandPalette this is not modal and does not own any keyboard navigation
 * — the caller decides what an empty query means (nothing shown vs. recent
 * pages), this component only renders the `results` it's given.
 */
export function SearchPanel({ query, results, onQueryChange, onSelect }: SearchPanelProps) {
  return (
    <div className="renote-search-panel">
      <input
        type="text"
        className="renote-search-panel-input"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        placeholder="Search…"
        aria-label="Search"
      />
      {query.length > 0 && results.length === 0 ? (
        <div className="renote-search-panel-empty">No results</div>
      ) : (
        <ul className="renote-search-panel-list">
          {results.map((result) => (
            <li
              key={result.id}
              role="button"
              tabIndex={0}
              className="renote-search-panel-result"
              onClick={() => onSelect(result.id)}
            >
              <div className="renote-search-panel-result-title">{result.title}</div>
              <div className="renote-search-panel-result-snippet">{result.snippet}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
