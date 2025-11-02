# PDF Search GUI

A modern desktop application built with Tauri v2 for searching text across multiple PDF files with a beautiful user interface.

## Features

- **Modern UI**: Clean sidebar + main panel layout with dark mode support
- **Fast Search**: Rust-powered backend with parallel PDF processing
- **Visual Results**: Grouped results by file with sticky headers and accordion expansion
- **Multi-Word Search**: Search for phrases across PDFs where spaces are stripped
- **PDF Page Preview**: Renders actual PDF pages with search terms highlighted (using PDF.js)
- **Cover Page Display**: Toggle to view the first page of any PDF with one click
- **Context Display**: Configurable words before/after matches (when page preview is off)
- **Directory Picker**: Native file browser for selecting PDF directories
- **Export**: Save results to Markdown format
- **Zotero Integration**: In Zotero mode, extracts and displays:
  - Title, year, and authors from Zotero database
  - Copy-to-clipboard citation formatting: `[@citekey](zotero://link)`
  - Direct Zotero item links that open in your Zotero client
- **Search Options**:
  - Case-sensitive search
  - Regex pattern matching
  - Adjustable context words (10-500)
  - Show Pages toggle (renders pages with highlights)
  - Optional Zotero database integration

## Tech Stack

### Backend
- **Tauri 2.0**: Rust-based desktop framework
- **lopdf**: Fast PDF text extraction
- **rayon**: Parallel processing
- **walkdir**: Recursive directory traversal
- **regex**: Pattern matching

### Frontend
- **TypeScript**: Type-safe JavaScript
- **PDF.js**: Mozilla's PDF rendering library (no native dependencies!)
- **Vite**: Fast build tool
- **Native CSS**: Custom styling with CSS variables

## Project Structure

```
pdf-search-gui/
├── src-tauri/           # Rust backend
│   ├── src/
│   │   ├── lib.rs       # Tauri commands
│   │   └── pdf_search.rs # PDF search logic (copied from CLI tool)
│   └── Cargo.toml       # Rust dependencies
├── src/                 # Frontend
│   ├── main.ts          # TypeScript logic
│   └── styles.css       # UI styling
├── index.html           # App shell
└── package.json         # Node dependencies
```

## Installation & Running

### Prerequisites

- Node.js (v16+)
- Rust toolchain
- Platform-specific requirements:
  - **macOS**: Xcode Command Line Tools
  - **Linux**: webkit2gtk
  - **Windows**: WebView2

### Development Mode

```bash
# Install dependencies
npm install

# Run in development mode (with hot reload)
npm run tauri dev
```

### Build for Production

```bash
# Build optimized binary
npm run tauri build
```

The compiled app will be in `src-tauri/target/release/bundle/`.

## Usage

1. **Enter Search Query**: Type the text or regex pattern to search for (multi-word searches supported)
2. **Select Directory**: Click "Browse" to choose a folder containing PDFs
3. **Configure Options** (optional):
   - Adjust context words (default: 100)
   - Enable case-sensitive search
   - Enable regex mode for pattern matching
   - Enable "Show Pages" to render PDF pages with highlighted matches
   - Enable Zotero mode and select your Zotero data directory for enhanced metadata
4. **Search**: Click the "Search" button
5. **View Results**:
   - Results appear grouped by file with sticky headers
   - Click "Matches (N)" to expand/collapse match details (lazy-loads pages if needed)
   - Click "📖 Cover" to toggle display of the PDF's first page
   - In Zotero mode, click "📋 Citation" to copy formatted citation to clipboard
   - Click "🔗 Zotero Link" to open the item in your Zotero client
6. **Export** (optional): Click "Export to Markdown" to save results

## How It Works

### Search Flow

1. User enters query and selects directory in the sidebar
2. Frontend calls Rust backend via Tauri's IPC
3. Backend:
   - Recursively finds all PDF files
   - Extracts text from each page
   - Searches in parallel using Rayon
   - Returns matches with context
4. Frontend renders results grouped by file
5. User can export results to Markdown

### Code Organization

The PDF search logic from the CLI tool has been **copied** into this project:
- `src-tauri/src/pdf_search.rs` - Contains all search functions
- Self-contained: No dependencies on the CLI tool's location
- Optimized for GUI use with serializable types

### Tauri Commands

```rust
// Search PDFs and return matches
search_pdf_files(params: SearchParams) -> Vec<SearchMatch>

// Export results to Markdown file
export_results_to_markdown(matches: Vec<SearchMatch>, output_path: String)

// Read raw PDF file bytes
read_pdf_file(file_path: String) -> Vec<u8>
```

## Recent Improvements (Latest Session)

### UI/UX Enhancements
- **Sticky Headers**: File headers remain visible at top during scrolling for easy reference
- **Accordion Results**: Match lists collapse/expand on demand with smooth animations
- **Lazy Loading**: Pages only render when accordion is expanded, improving initial responsiveness
- **Full-Width Layout**: Removed unnecessary header bar to maximize result viewing area
- **Cover Page Toggle**: Single-click access to first page preview without loading all matches

### Search Improvements
- **Multi-Word Search Support**: Searches work across PDFs where spaces are stripped from text
  - Query "collective memory" will match "collectivememory" in PDFs
  - Highlighting still works correctly with original text
- **Smart Highlighting**: Empty query no longer highlights entire pages (e.g., when viewing cover)

### Zotero Mode Enhancements
- **Rich Bibliographic Display**: Headers now show:
  - Article/book title (from Zotero database)
  - Publication year
  - Author(s) list in italics
- **One-Click Citations**: "Citation" button copies formatted markdown citation to clipboard
  - Format: `[@citekey](zotero://link)`
  - Instant visual feedback with "✓ Copied" confirmation
- **Direct Zotero Integration**: Links open items directly in your Zotero client via `zotero://` protocol

### Technical Improvements
- **Database Queries**: Backend now queries Zotero SQLite for:
  - itemData and itemDataValues tables for title/year
  - itemCreators and creators tables for author information
  - Efficient joins with items and itemAttachments
- **Performance**: Conditional rendering only includes cover container when "Show Pages" is enabled

## Styling

The UI features:
- **Responsive layout**: Sidebar (320px) + flexible main panel (full width)
- **Color scheme**: Modern blue/gray palette with semantic colors
- **Dark mode**: Automatic via `prefers-color-scheme`
- **Custom CSS variables**: Easy theme customization
- **Sticky Headers**: File headers with smooth box-shadow stay at top during scroll
- **Accordion Animations**: `max-height` transitions for smooth expand/collapse
- **Button Variants**: Icon buttons with hover states and opacity feedback
- **Zotero Headers**: Specialized layout for title, year/authors, and action buttons

## Performance

- **Parallel processing**: Multiple PDFs searched simultaneously
- **Rust backend**: Native speed (same as CLI tool)
- **Typical performance**: 100 PDFs (~20 pages) in 2-5 seconds

## Differences from CLI Tool

| Feature | CLI | GUI |
|---------|-----|-----|
| Interface | Terminal commands | Visual UI |
| Directory selection | Path argument | File browser |
| Results display | Terminal output | Grouped cards |
| Export | Command flag | Button click |
| Configuration | JSON file | Form inputs |

## Recent Completions

- [x] Multi-word phrase searching
- [x] Accordion-style result expansion
- [x] Sticky file headers
- [x] Cover page preview with toggle
- [x] Zotero metadata extraction (title, year, authors)
- [x] Copy-to-clipboard citation formatting
- [x] Direct Zotero client integration
- [x] Lazy-loading of PDF previews
- [x] Smart highlighting (no highlight on empty query)
- [x] Full-width result layout

## Future Enhancements

Potential additions:
- [ ] Search history
- [ ] Saved search presets
- [ ] Progress bar for long searches
- [ ] Filter/sort results by date, author, or match count
- [ ] OCR support for scanned PDFs
- [ ] Batch export to different formats (BibTeX, RIS, etc.)
- [ ] Advanced search operators (AND, OR, NOT)
- [ ] Custom highlighting colors
- [ ] Result annotations/notes

## Troubleshooting

### Build Errors

**"cargo not found"**: Ensure Rust is installed and in PATH
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env
```

**"webkit2gtk not found" (Linux)**: Install webkit2gtk
```bash
# Ubuntu/Debian
sudo apt-get install libwebkit2gtk-4.0-dev

# Fedora
sudo dnf install webkit2gtk3-devel
```

**Note**: ~~Earlier versions required `pdfium` to be installed~~. This is no longer needed - we now use **PDF.js** for rendering, which works out-of-the-box with no native dependencies!

### Runtime Issues

**"No PDFs found"**: Ensure the selected directory contains PDF files (searches recursively)

**"Search failed"**: Check that PDFs are readable (not encrypted or corrupted)

## License

MIT

## Credits

Built using the PDF search engine from the companion CLI tool, packaged in a modern desktop UI with Tauri.
