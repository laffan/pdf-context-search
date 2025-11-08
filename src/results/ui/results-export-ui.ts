import type { SearchMatch } from '../../shared/data/types';
import { currentResults } from '../../shared/data/state';
import { showStatus } from '../../shared/ui/status-message';

export async function copyResults() {
  if (currentResults.length === 0) {
    showStatus('No results to copy', 'error');
    return;
  }

  try {
    // Group results by file
    const fileGroups = new Map<string, SearchMatch[]>();
    currentResults.forEach(match => {
      if (!fileGroups.has(match.file_path)) {
        fileGroups.set(match.file_path, []);
      }
      fileGroups.get(match.file_path)!.push(match);
    });

    // Build markdown output
    let markdown = '';
    fileGroups.forEach((matches) => {
      const firstMatch = matches[0];
      const metadata = firstMatch.zotero_metadata;

      if (metadata) {
        // Citation link
        markdown += `[@${metadata.citekey}](${metadata.zotero_link})\n`;
        // Title
        markdown += `${metadata.title || firstMatch.file_name}\n`;
        // Authors
        if (metadata.authors) {
          markdown += `${metadata.authors}\n`;
        }
        markdown += '---\n';

        // Get unique pages and sort them
        const pages = Array.from(new Set(matches.map(m => m.page_number))).sort((a, b) => a - b);

        // Page links
        pages.forEach(pageNum => {
          if (metadata.pdf_attachment_key) {
            const zoteroUrl = `zotero://open-pdf/library/items/${metadata.pdf_attachment_key}?page=${pageNum}`;
            markdown += `- [Page ${pageNum}](${zoteroUrl})\n`;
          } else {
            markdown += `- Page ${pageNum}\n`;
          }
        });
      } else {
        // No metadata, just show filename
        markdown += `${firstMatch.file_name}\n`;
        markdown += '---\n';

        const pages = Array.from(new Set(matches.map(m => m.page_number))).sort((a, b) => a - b);
        pages.forEach(pageNum => {
          markdown += `- Page ${pageNum}\n`;
        });
      }

      markdown += '\n===================\n\n';
    });

    // Copy to clipboard
    await navigator.clipboard.writeText(markdown);
    showStatus('Results copied to clipboard!', 'success');
  } catch (error) {
    showStatus(`Copy failed: ${error}`, 'error');
  }
}
