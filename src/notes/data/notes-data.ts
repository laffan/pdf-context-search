import type { Note, NoteGroup, ZoteroMetadata } from '../../shared/data/types';
import { notes } from '../../shared/data/state';
import { showStatus } from '../../shared/ui/status-message';

export function loadNotes() {
  const stored = localStorage.getItem('pdfSearchNotes');
  if (!stored) return;
  try {
    const loadedNotes = JSON.parse(stored);
    notes.length = 0; // Clear existing notes
    notes.push(...loadedNotes);
  } catch (error) {
    console.error('Failed to load notes:', error);
  }
}

export function saveNotes() {
  localStorage.setItem('pdfSearchNotes', JSON.stringify(notes));
}

export function createNote(text: string, filePath: string, fileName: string, pageNumber: number, zoteroMetadata?: ZoteroMetadata | null, selectionBox?: { x: number; y: number; width: number; height: number }, renderNotesListCallback?: (noteId?: string) => void): string | undefined {
  // Ensure text is at least 3 characters
  if (text.trim().length < 3) {
    return undefined;
  }

  const note: Note = {
    id: crypto.randomUUID(),
    text: text.trim(),
    filePath,
    fileName,
    pageNumber,
    selectionBox
  };

  // Add Zotero metadata if available
  if (zoteroMetadata && zoteroMetadata.title && zoteroMetadata.title.trim()) {
    note.title = zoteroMetadata.title.trim();
    note.authors = zoteroMetadata.authors || undefined;
    note.year = zoteroMetadata.year ? parseInt(zoteroMetadata.year) : undefined;
    note.citeKey = zoteroMetadata.citekey;
    note.zoteroLink = zoteroMetadata.zotero_link;
  } else {
    note.title = fileName;
  }

  notes.push(note);
  saveNotes();
  if (renderNotesListCallback) {
    renderNotesListCallback(note.id);
  }

  // Show feedback
  showStatus('Note added successfully!', 'success');

  return note.id;
}

export function deleteNote(id: string, renderNotesListCallback?: () => void) {
  const index = notes.findIndex(n => n.id === id);
  if (index !== -1) {
    notes.splice(index, 1);
    saveNotes();
    if (renderNotesListCallback) {
      renderNotesListCallback();
    }
  }
}

export function clearAllNotes(renderNotesListCallback?: () => void) {
  if (notes.length === 0) return;

  if (confirm(`Are you sure you want to delete all ${notes.length} notes? This action cannot be undone.`)) {
    notes.length = 0;
    saveNotes();
    if (renderNotesListCallback) {
      renderNotesListCallback();
    }
    showStatus('All notes cleared', 'info');
  }
}

export function copyNoteText(note: Note) {
  let formattedText = '';

  // Add page number as markdown link if Zotero link is available
  if (note.zoteroLink) {
    const zoteroPageLink = `${note.zoteroLink}?page=${note.pageNumber}`;
    formattedText = `[Page ${note.pageNumber}](${zoteroPageLink})\n\n${note.text}`;
  } else {
    formattedText = `Page ${note.pageNumber}\n\n${note.text}`;
  }

  navigator.clipboard.writeText(formattedText).then(() => {
    showStatus('Note copied to clipboard!', 'success');
  }).catch(err => {
    console.error('Failed to copy:', err);
    showStatus('Failed to copy note', 'error');
  });
}

export function exportNotesToMarkdown() {
  if (notes.length === 0) {
    showStatus('No notes to export', 'info');
    return;
  }

  let markdown = '# Notes from PDF Search\n\n';

  const groups = groupNotesBySource();

  groups.forEach((group, groupIndex) => {
    markdown += `## ${group.title}\n\n`;

    // Add Zotero link if available
    if (group.zoteroLink) {
      markdown += `[View in Zotero](${group.zoteroLink})\n\n`;
    }

    group.notes.forEach((note) => {
      // Use markdown link if Zotero link is available
      if (note.zoteroLink) {
        const zoteroPageLink = `${note.zoteroLink}?page=${note.pageNumber}`;
        markdown += `**[Page ${note.pageNumber}](${zoteroPageLink})**\n\n`;
      } else {
        markdown += `**Page ${note.pageNumber}**\n\n`;
      }

      markdown += `> "${note.text}"\n\n`;
    });

    if (groupIndex < groups.length - 1) {
      markdown += '---\n\n';
    }
  });

  // Copy to clipboard
  navigator.clipboard.writeText(markdown).then(() => {
    showStatus(`Exported ${notes.length} notes to clipboard!`, 'success');
  }).catch(err => {
    console.error('Failed to export:', err);
    showStatus('Failed to export notes', 'error');
  });
}

export function groupNotesBySource(): NoteGroup[] {
  const groups = new Map<string, NoteGroup>();

  notes.forEach(note => {
    if (!groups.has(note.filePath)) {
      // Always prefer title over fileName for display
      const displayTitle = note.title || note.fileName;
      groups.set(note.filePath, {
        filePath: note.filePath,
        title: displayTitle,
        authors: note.authors,
        year: note.year,
        citeKey: note.citeKey,
        zoteroLink: note.zoteroLink,
        notes: []
      });
    }
    groups.get(note.filePath)!.notes.push(note);
  });

  // Convert to array and sort notes within each group by page number
  const groupArray = Array.from(groups.values());
  groupArray.forEach(group => {
    group.notes.sort((a, b) => a.pageNumber - b.pageNumber);
  });

  return groupArray;
}
