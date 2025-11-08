export interface ZoteroMetadata {
  citekey: string;
  title: string | null;
  year: string | null;
  authors: string | null;
  zotero_link: string;
  pdf_attachment_key: string | null;
}

export interface SearchMatch {
  file_path: string;
  file_name: string;
  page_number: number;
  context_before: string;
  matched_text: string;
  context_after: string;
  zotero_link: string | null;
  zotero_metadata: ZoteroMetadata | null;
}

export interface QueryItem {
  query: string;
  use_regex: boolean;
  query_type: string; // "parallel" or "filter"
  color: string; // hex color for highlighting
}

export interface SearchParams {
  queries: QueryItem[];
  directory: string;
  context_words: number;
  zotero_path: string | null;
}

export interface SearchHistoryItem {
  queries: QueryItem[];
  timestamp: number;
}

export interface PinnedResult {
  queries: QueryItem[];
  matches: SearchMatch[];
  timestamp: number;
}

export interface Note {
  id: string;
  text: string;
  filePath: string;
  fileName: string;
  pageNumber: number;
  title?: string;  // Zotero title or file name
  authors?: string;
  year?: number;
  citeKey?: string;
  zoteroLink?: string;
  selectionBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface NoteGroup {
  filePath: string;
  title: string;
  authors?: string;
  year?: number;
  citeKey?: string;
  zoteroLink?: string;
  notes: Note[];
}
