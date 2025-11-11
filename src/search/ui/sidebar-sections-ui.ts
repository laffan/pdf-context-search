/**
 * Handles collapsible sidebar sections
 */
export function initializeSidebarSections() {
  // Add click handlers to all section headers
  const sectionHeaders = document.querySelectorAll('.section-header');

  sectionHeaders.forEach(header => {
    header.addEventListener('click', () => {
      const sectionName = (header as HTMLElement).dataset.section;
      if (!sectionName) return;

      // Find the corresponding content section
      const content = document.querySelector(`[data-section-content="${sectionName}"]`);
      const arrow = header.querySelector('.section-header-arrow');

      if (!content || !arrow) return;

      // Toggle open class
      const isOpen = content.classList.contains('open');

      if (isOpen) {
        content.classList.remove('open');
        arrow.classList.remove('open');
      } else {
        content.classList.add('open');
        arrow.classList.add('open');
      }

      // Save state to localStorage
      localStorage.setItem(`sidebarSection_${sectionName}`, String(!isOpen));
    });
  });

  // Restore saved states from localStorage
  sectionHeaders.forEach(header => {
    const sectionName = (header as HTMLElement).dataset.section;
    if (!sectionName) return;

    const savedState = localStorage.getItem(`sidebarSection_${sectionName}`);

    // If there's a saved state and it's false (closed), close the section
    if (savedState === 'false') {
      const content = document.querySelector(`[data-section-content="${sectionName}"]`);
      const arrow = header.querySelector('.section-header-arrow');

      if (content && arrow) {
        content.classList.remove('open');
        arrow.classList.remove('open');
      }
    }
  });
}
