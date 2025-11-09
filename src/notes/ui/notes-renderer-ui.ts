import { notes, notesList } from '../../shared/data/state';
import { groupNotesBySource, saveNotes, deleteNote, copyNoteText } from '../data/notes-data';
import { escapeHtml } from '../../shared/ui/html-utils';

export function renderNotesList(scrollToNoteId?: string) {
  if (notes.length === 0) {
    notesList.innerHTML = `
      <div class="notes-empty-state">
        <p>No notes yet</p>
        <p class="notes-hint">Drag to select text from PDF pages to create notes</p>
      </div>
    `;
    return;
  }

  const groups = groupNotesBySource();

  notesList.innerHTML = groups.map(group => {
    const groupId = group.filePath.replace(/[^a-zA-Z0-9]/g, '_');
    let groupHtml = `
      <div class="note-group">
        <div class="note-group-header" data-group-id="${groupId}">
          <span class="note-group-toggle">▼</span>
          <div class="note-group-title">
            <strong>${escapeHtml(group.title)}</strong>
          </div>
        </div>
        <div class="note-group-items" data-group-id="${groupId}">`;

    group.notes.forEach(note => {
      groupHtml += `
        <div class="note-item" data-note-id="${note.id}">
          <div class="note-page">Page ${note.pageNumber}</div>
          <div class="note-text" contenteditable="true" data-note-id="${note.id}">${escapeHtml(note.text)}</div>
          <div class="note-actions">
            <button class="note-action-btn copy-note-btn" title="Copy" data-note-id="${note.id}">📋</button>
            <button class="note-action-btn delete-note-btn" title="Delete" data-note-id="${note.id}">🗑️</button>
          </div>
        </div>`;
    });

    groupHtml += `
        </div>
      </div>`;

    return groupHtml;
  }).join('');

  // Add event listeners for editable text
  notesList.querySelectorAll('.note-text[contenteditable]').forEach(el => {
    el.addEventListener('blur', (e) => {
      const id = (e.currentTarget as HTMLElement).dataset.noteId!;
      const note = notes.find(n => n.id === id);
      if (note) {
        const newText = (e.currentTarget as HTMLElement).textContent || '';
        if (newText.trim().length >= 3) {
          note.text = newText.trim();
          saveNotes();
        } else {
          // Restore original text if too short
          (e.currentTarget as HTMLElement).textContent = note.text;
        }
      }
    });

    // Prevent newlines in contenteditable
    el.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') {
        e.preventDefault();
        (e.currentTarget as HTMLElement).blur();
      }
    });
  });

  // Add event listeners to note action buttons
  notesList.querySelectorAll('.copy-note-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = (e.currentTarget as HTMLElement).dataset.noteId!;
      const note = notes.find(n => n.id === id);
      if (note) copyNoteText(note);
    });
  });

  notesList.querySelectorAll('.delete-note-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = (e.currentTarget as HTMLElement).dataset.noteId!;
      if (confirm('Delete this note?')) {
        deleteNote(id, renderNotesList);
      }
    });
  });

  // Add event listeners for accordion toggles
  notesList.querySelectorAll('.note-group-header').forEach(header => {
    header.addEventListener('click', (e) => {
      const groupId = (e.currentTarget as HTMLElement).dataset.groupId!;
      const items = notesList.querySelector(`.note-group-items[data-group-id="${groupId}"]`) as HTMLElement;
      const toggle = header.querySelector('.note-group-toggle') as HTMLElement;

      if (items && toggle) {
        const isCollapsed = items.classList.contains('collapsed');
        if (isCollapsed) {
          items.classList.remove('collapsed');
          toggle.textContent = '▼';
        } else {
          items.classList.add('collapsed');
          toggle.textContent = '▶';
        }
      }
    });
  });

  // Scroll to the new note if specified
  if (scrollToNoteId) {
    setTimeout(() => {
      const noteElement = notesList.querySelector(`[data-note-id="${scrollToNoteId}"]`);
      if (noteElement) {
        noteElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 100);
  }
}
