import { notesSidebar } from '../../shared/data/state';

export function toggleNotesSidebar() {
  notesSidebar.classList.toggle('collapsed');
  const isOpen = !notesSidebar.classList.contains('collapsed');

  // Save state to localStorage
  localStorage.setItem('notesSidebarOpen', String(isOpen));
}
