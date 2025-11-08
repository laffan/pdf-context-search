# Technical Documentation

This document provides a comprehensive technical overview of the PDF Context Search application architecture, organized by the codebase structure.

## Architecture Overview

The application follows a modular architecture with clear separation between:

- **Backend (Rust/Tauri)**: PDF processing, text extraction, search execution, Zotero database queries
- **Frontend (TypeScript)**: UI rendering, state management, user interactions
- **IPC Layer**: Tauri commands bridge frontend and backend via async message passing

### Technology Stack

**Backend:**
- Tauri 2.0 (Rust-based desktop framework)
- lopdf (PDF text extraction)
- rayon (parallel processing)
- walkdir (recursive directory traversal)
- regex (pattern matching)
- rusqlite (Zotero database queries)

**Frontend:**
- TypeScript (type-safe development)
- PDF.js (client-side PDF rendering with highlighting)
- Vite (build tool and dev server)
- Native CSS with CSS variables (no framework dependencies)

## Frontend Structure

The frontend follows a modular pattern organized by feature domains, each split into **UI** (user interface) and **Data** (business logic) layers.

### Module Organization

```
src/
├── search/          # Search input and configuration
│   ├── ui/          # Search form, directory browser, dropdowns
│   └── data/        # Search history, query management
├── results/         # Search results display
│   ├── ui/          # Results rendering, PDF viewer, export
│   └── data/        # Search execution, pinned results
├── notes/           # Note-taking functionality
│   ├── ui/          # Notes sidebar, rendering
│   └── data/        # Notes persistence
└── shared/          # Cross-cutting utilities
    ├── ui/          # HTML utilities, status messages, Zotero actions
    └── data/        # Types, state, constants, utilities
```

---

## Search Module

Handles user input for search queries, directory selection, and search configuration.

### Search UI Layer (`src/search/ui/`)

**`search-form-ui.ts`**
- Manages dynamic search query items (add/remove query fields)
- Creates query input elements with regex toggles, color pickers, and query type selectors
- Supports multiple query types: "parallel" (independent searches) and "filter" (refine previous results)
- Each query has an associated color for multi-term highlighting
- Pattern: Event delegation for dynamically added query items

**`directory-browser-ui.ts`**
- Integrates with Tauri's dialog plugin for native folder selection
- Persists selected directories to `localStorage` for session continuity
- Manages Zotero mode toggle and Zotero data directory selection
- Pattern: Async/await for Tauri IPC calls

**`search-dropdown-ui.ts`**
- Renders search history dropdown below active query input
- Shows recent searches with timestamp formatting
- Allows quick re-use of previous queries
- Pattern: Absolute positioning with dynamic show/hide

### Search Data Layer (`src/search/data/`)

**`search-queries-data.ts`**
- Extracts query data from DOM form elements
- Builds `SearchParams` objects for backend consumption
- Validates query inputs (non-empty, valid regex patterns)
- Pattern: Data transformation layer between UI and IPC

**`search-history-data.ts`**
- Persists search history to `localStorage` (last 10 searches)
- Stores queries with timestamps for chronological ordering
- Provides retrieval and formatting utilities
- Pattern: localStorage as simple persistence layer

---

## Results Module

Handles search execution, result rendering, PDF display, and result persistence.

### Results Data Layer (`src/results/data/`)

**`search-executor-data.ts`**
- Invokes Tauri command `search_pdf_files` with search parameters
- Handles search errors and displays status messages
- Merges current search results with pinned results for display
- Updates global `currentResults` state
- Pattern: Async orchestration of IPC, state updates, and UI callbacks

**`pinned-results-data.ts`**
- Manages pinned results persistence via `localStorage`
- Each pinned result stores: file path, original queries, matches, and timestamp
- Loads pinned results on app initialization
- Pattern: Map-based in-memory cache with localStorage sync

### Results UI Layer (`src/results/ui/`)

**`results-renderer-ui.ts`**
- Main results rendering engine
- Groups results by file path (one card per PDF)
- Renders result headers with metadata:
  - File name or Zotero title
  - Zotero authors/year (if available)
  - Pin/unpin button
  - Match count with accordion toggle
  - Cover page toggle
  - Zotero citation copy and open buttons
- Lazy-loads match details (PDF pages) when accordion expands
- Supports multi-column layout (1/2/3 columns) with CSS Grid
- Pattern: Template-based HTML generation with event delegation

**Key Rendering Functions:**
- `renderResults()`: Main entry point, orchestrates header and match rendering
- `renderResultHeader()`: Builds file/metadata header with action buttons
- `renderMatches()`: Lazy-loads and renders individual match cards
- `toggleAccordion()`: Expands/collapses match lists with smooth animations

**`pdf-viewer-ui.ts`**
- Integrates PDF.js for client-side PDF rendering
- Loads PDF bytes from backend via `read_pdf_file` Tauri command
- Renders specific pages with highlighted search terms
- Highlights multiple queries with different colors
- Handles page rendering lifecycle (canvas creation, cleanup)
- Pattern: Canvas-based rendering with PDF.js document API

**Key Functions:**
- `renderPdfPage()`: Renders a single PDF page with highlighted terms
- `highlightTextOnCanvas()`: Draws colored rectangles over matching text
- `getTextPosition()`: Maps text content to canvas coordinates using PDF.js text layer

**`results-export-ui.ts`**
- Exports search results to Markdown format
- Builds structured Markdown with file headers, match details, and context
- Copies to clipboard using Clipboard API
- Pattern: Template-based text generation

---

## Notes Module

Provides note-taking functionality tied to PDF pages and search results.

### Notes Data Layer (`src/notes/data/`)

**`notes-data.ts`**
- Manages note creation, editing, deletion
- Persists notes to `localStorage` with unique IDs
- Associates notes with PDF file paths and page numbers
- Stores optional Zotero metadata (title, authors, year, citekey)
- Exports notes to Markdown format
- Pattern: CRUD operations with localStorage persistence

**Note Data Structure:**
```typescript
interface Note {
  id: string;              // Unique identifier
  text: string;            // Note content
  filePath: string;        // Associated PDF path
  fileName: string;        // Display name
  pageNumber: number;      // PDF page reference
  title?: string;          // Zotero title or filename
  authors?: string;        // Zotero authors
  year?: number;           // Zotero year
  citeKey?: string;        // Zotero citation key
  zoteroLink?: string;     // Zotero link
  selectionBox?: {         // Optional selection coordinates
    x: number;
    y: number;
    width: number;
    height: number;
  };
}
```

### Notes UI Layer (`src/notes/ui/`)

**`notes-sidebar-ui.ts`**
- Toggles notes sidebar visibility
- Persists sidebar state to `localStorage`
- Pattern: CSS class-based show/hide with transition animations

**`notes-renderer-ui.ts`**
- Renders notes grouped by file path
- Displays note text with metadata (title, authors, page number)
- Provides edit and delete actions per note
- Updates UI reactively when notes change
- Pattern: Grouped list rendering with inline editing

---

## Shared Module

Cross-cutting utilities and shared data structures used across all modules.

### Shared Data Layer (`src/shared/data/`)

**`types.ts`**
- Defines all TypeScript interfaces used throughout the application
- Core types: `SearchMatch`, `QueryItem`, `SearchParams`, `PinnedResult`, `Note`, `ZoteroMetadata`
- Pattern: Centralized type definitions for consistency

**`state.ts`**
- Global application state management
- Exports mutable state: `currentResults`, `pinnedResults`, `notes`, `perPdfSearchQueries`
- Exports DOM element references (initialized on DOMContentLoaded)
- Provides setter functions for immutable-like updates
- Pattern: Module-level singleton state with controlled mutations

**`constants.ts`**
- Application-wide constants (e.g., context word limits, default colors)
- Pattern: Single source of truth for magic numbers

**`pdf-text-utils.ts`**
- Text processing utilities for PDF search
- Handles multi-word search (strips spaces from queries and text)
- Pattern: Pure functions for text transformation

**`color-utils.ts`**
- Color generation utilities for multi-query highlighting
- Provides distinct colors for query differentiation
- Pattern: Deterministic color assignment

### Shared UI Layer (`src/shared/ui/`)

**`html-utils.ts`**
- HTML escaping and sanitization utilities
- Safe string interpolation for user-generated content
- Pattern: Security-focused utility functions

**`status-message.ts`**
- Displays temporary status messages to users
- Auto-hides after timeout
- Pattern: Imperative UI updates with side effects

**`zotero-actions.ts`**
- Handles Zotero-specific UI actions
- Citation copy to clipboard with formatted markdown
- Opens PDFs in Zotero client using `zotero://` protocol URLs
- Pattern: Integration with external application via URL schemes

---

## Backend Structure

The Rust backend provides high-performance PDF processing and search capabilities.

### `src-tauri/src/lib.rs`

**Tauri Commands (IPC Interface):**

```rust
#[tauri::command]
fn search_pdf_files(params: SearchParams) -> Result<Vec<SearchMatch>, String>
```
- Searches all PDFs in a directory
- Parallelizes search across files using Rayon
- Returns matches with context and Zotero metadata

```rust
#[tauri::command]
fn search_single_pdf_file(params: SearchParams) -> Result<Vec<SearchMatch>, String>
```
- Searches a single PDF file
- Used for per-PDF search refinement

```rust
#[tauri::command]
fn export_results_to_markdown(matches: Vec<SearchMatch>, output_path: String) -> Result<(), String>
```
- Exports results to Markdown file on disk

```rust
#[tauri::command]
fn read_pdf_file(file_path: String) -> Result<Vec<u8>, String>
```
- Reads raw PDF bytes for frontend rendering with PDF.js
- Bypasses CORS restrictions by serving files through Tauri

**Pattern:** Tauri commands as async RPC endpoints with serialization/deserialization

### `src-tauri/src/pdf_search.rs`

**Core Search Engine:**

**`find_pdf_files(directory: &Path)`**
- Recursively walks directory tree
- Filters files by `.pdf` extension
- Uses `walkdir` crate with symlink following

**`build_zotero_map(zotero_path: &Path)`**
- Queries Zotero SQLite database for bibliographic metadata
- Creates temporary database copy to avoid file locking conflicts
- Joins across multiple tables: `items`, `itemAttachments`, `itemData`, `itemCreators`, `creators`
- Extracts: title, year, authors, citation keys (via Better BibTeX)
- Returns `HashMap<filename, ZoteroMetadata>` for O(1) lookups

**`search_pdfs(params: SearchParams)`**
- Main search orchestration function
- Loads Zotero metadata (if enabled)
- Finds all PDF files in directory
- Parallelizes search across files using Rayon's `.par_iter()`
- Flattens results into single vector

**`search_pdf(file_path: &Path, queries: &[QueryItem], context_words: usize, zotero_map: Option<&HashMap<...>>)`**
- Opens PDF with `lopdf` crate
- Extracts text per page
- Searches each page with query items
- Supports:
  - Multi-word queries (strips spaces from text and query)
  - Regex and literal search modes
  - Query types: "parallel" (independent) or "filter" (sequential refinement)
- Builds matches with context (N words before/after)
- Attaches Zotero metadata when available

**`export_to_markdown(matches: &[SearchMatch])`**
- Formats search results as Markdown
- Groups by file with metadata headers
- Pattern: Template-based string building

**Pattern:** Functional composition with iterator chains, parallel processing with Rayon

---

## Application Initialization and Data Flow

### Initialization Sequence (`src/main.ts`)

1. **DOMContentLoaded Event**
2. Initialize DOM element references (`initializeDomElements()`)
3. Load persisted state from `localStorage`:
   - Pinned results
   - Notes
   - Directory paths
   - Zotero mode
   - Column layout preference
4. Render pinned results (if any)
5. Attach event listeners to UI elements
6. Configure PDF.js worker

### Search Flow

1. **User Input:** User enters queries, selects directory, configures options
2. **Form Submission:** `search-form-ui` validates and extracts query data
3. **Search Execution:** `search-executor-data` calls `search_pdf_files` Tauri command
4. **Backend Processing:**
   - Find PDF files recursively
   - Load Zotero metadata (if enabled)
   - Search PDFs in parallel with Rayon
   - Build matches with context
5. **Result Rendering:** `results-renderer-ui` renders grouped results
6. **State Update:** Update `currentResults`, merge with pinned results
7. **History Persistence:** Save queries to search history

### Result Interaction Flow

1. **Pin Result:** User clicks pin button
   - `pinned-results-data` saves to `localStorage`
   - `results-renderer-ui` re-renders with pinned indicator
2. **Expand Matches:** User clicks match count
   - `results-renderer-ui` lazy-loads match details
   - `pdf-viewer-ui` renders PDF pages with highlights
3. **View Cover:** User clicks cover toggle
   - `pdf-viewer-ui` renders page 1 of PDF
4. **Copy Citation:** User clicks citation button (Zotero mode)
   - `zotero-actions` formats citation and copies to clipboard
5. **Open in Zotero:** User clicks Zotero button
   - `zotero-actions` opens `zotero://open-pdf` URL

### Note-Taking Flow

1. **Create Note:** User creates note from result or manually
2. **Persist Note:** `notes-data` saves to `localStorage`
3. **Render Notes:** `notes-renderer-ui` groups and displays notes
4. **Edit/Delete:** User modifies or removes note
5. **Export Notes:** `notes-data` formats notes as Markdown

---

## Development Patterns and Conventions

### Module Structure Pattern

Each feature module follows a consistent structure:

```
module-name/
├── ui/          # User interface components
│   ├── *-ui.ts  # UI rendering and event handling
└── data/        # Business logic and data management
    ├── *-data.ts # State management, persistence, API calls
```

**Benefits:**
- Clear separation of concerns (UI vs. logic)
- Predictable file locations
- Easy to navigate and extend

### Naming Conventions

- **UI Files:** `*-ui.ts` (e.g., `search-form-ui.ts`)
- **Data Files:** `*-data.ts` (e.g., `search-executor-data.ts`)
- **Shared Files:** Descriptive names (e.g., `types.ts`, `state.ts`)
- **Functions:** camelCase, descriptive verbs (e.g., `renderResults`, `performSearch`)
- **Types/Interfaces:** PascalCase (e.g., `SearchMatch`, `QueryItem`)

### State Management Pattern

- **Global State:** Exported from `src/shared/data/state.ts`
- **Local State:** DOM state and component-specific variables
- **Persistence:** `localStorage` for user preferences and data
- **Mutations:** Controlled via setter functions or direct mutations in data layer

### IPC Communication Pattern

1. Frontend calls Tauri command via `invoke()`
2. Backend processes request and returns serialized result
3. Frontend updates state and re-renders UI
4. Pattern: Async/await with error handling

### Event Handling Pattern

- **Direct Listeners:** Attached in `main.ts` for top-level elements
- **Event Delegation:** Used for dynamically added elements (query items, result cards)
- **Pattern:** Centralized listener attachment on initialization

### Rendering Pattern

- **Template Strings:** HTML generated with template literals
- **Event Delegation:** Click handlers on parent containers
- **Lazy Loading:** Defer expensive rendering until user interaction
- **Pattern:** Imperative DOM manipulation with `innerHTML` and event delegation

### Error Handling Pattern

- **Backend:** Return `Result<T, String>` for all Tauri commands
- **Frontend:** Try/catch blocks with user-friendly status messages
- **Pattern:** Fail gracefully, display errors to user

---

## Performance Optimizations

### Backend
- **Parallel PDF Processing:** Rayon parallelizes search across files
- **Temporary Database Copies:** Avoids file locking with Zotero
- **Efficient Text Extraction:** lopdf streams text extraction

### Frontend
- **Lazy Loading:** Match details render only when accordion expands
- **Canvas Rendering:** PDF.js renders pages on-demand, not all at once
- **Result Grouping:** One card per file reduces DOM size
- **LocalStorage Caching:** Persists pinned results and notes

### Memory Management
- **PDF.js Cleanup:** Dispose of PDF documents after rendering
- **Temp File Cleanup:** Backend cleans up temporary Zotero database copies

---

## Data Persistence

### LocalStorage Schema

**Keys:**
- `pdfSearchDirectory`: Last selected PDF directory
- `pdfSearchZoteroPath`: Last selected Zotero data directory
- `pdfSearchZoteroMode`: Zotero mode toggle state
- `pdfSearchColumnLayout`: Result column layout preference (1/2/3)
- `pdfSearchHistory`: JSON array of recent searches
- `pdfPinnedResults`: JSON map of pinned results by file path
- `pdfNotes`: JSON array of all notes
- `notesSidebarOpen`: Notes sidebar visibility state

**Pattern:** Prefix keys with `pdfSearch` or `pdf` for namespacing

---

## UI/UX Features

### Result Pinning
- Pin button in each result header
- Pinned results persist across searches
- Shows original search query that matched
- Highlights both original and current search terms

### Multi-Query Highlighting
- Each query assigned a unique color
- Color picker per query input
- PDF.js highlights with distinct colors
- Supports overlapping highlights

### Accordion Interaction
- Click match count to expand/collapse
- Smooth `max-height` transitions
- Lazy-loads PDF pages on first expansion

### Sticky Headers
- File headers remain visible during scroll
- Box-shadow indicates "stuck" state
- Improves navigation in long result lists

### Zotero Integration
- Displays bibliographic metadata (title, authors, year)
- Copy citation to clipboard: `[@citekey](zotero://link)`
- Open PDF in Zotero at specific page: `zotero://open-pdf/library/items/{key}?page={num}`

### Column Layout
- Toggle between 1, 2, or 3 column layouts for match cards
- Preference persisted to `localStorage`
- CSS Grid-based responsive layout

---

## Key Technologies Deep Dive

### PDF.js Integration
- **Worker Setup:** Configured in `main.ts` to use bundled worker (no CDN dependency)
- **Document Loading:** `pdfjsLib.getDocument()` loads PDF from byte array
- **Page Rendering:** Canvas-based rendering with text layer extraction
- **Highlighting:** Custom canvas rectangles drawn over text positions

### Tauri IPC
- **Command Definition:** `#[tauri::command]` macro in Rust
- **Handler Registration:** `invoke_handler!` in `lib.rs`
- **Frontend Invocation:** `invoke('command_name', { params })` from TypeScript
- **Serialization:** Automatic JSON serialization via Serde

### Zotero Database Queries
- **Database:** SQLite database at `zotero.sqlite`
- **Better BibTeX:** Optional `better-bibtex.sqlite` for citation keys
- **Temp Copies:** Avoids file locking by copying databases to temp directory
- **Queries:** Complex joins across `items`, `itemAttachments`, `itemData`, `itemCreators`

---

## Build and Development

### Development Mode
```bash
npm run tauri dev
```
- Vite dev server with hot module replacement
- Tauri hot reload for Rust changes
- Opens native window with DevTools

### Production Build
```bash
npm run tauri build
```
- Optimized Vite bundle (minified, tree-shaken)
- Rust release build with optimizations
- Platform-specific installers in `src-tauri/target/release/bundle/`

### Type Safety
- TypeScript strict mode enabled
- Shared types between Rust (Serde) and TypeScript
- Type-safe Tauri command invocations

---

## Testing and Debugging

### Frontend Debugging
- Browser DevTools available in development mode
- Console logging for state inspection
- TypeScript type checking catches errors at compile time

### Backend Debugging
- Rust compiler error messages
- `println!` debugging in Tauri commands
- Cargo test framework available (not currently used)

---

## Future Architectural Considerations

While this section describes what exists today, future developers should be aware of these architectural foundations:

- **Modular Structure:** Adding new features should follow the `module/ui` and `module/data` pattern
- **State Management:** Consider more sophisticated state management if complexity grows
- **Type Synchronization:** Keep Rust and TypeScript types in sync manually (no automatic generation)
- **Performance:** Lazy loading and parallelization patterns are in place for scalability
- **Persistence:** LocalStorage is simple but has size limits; consider IndexedDB for larger datasets
