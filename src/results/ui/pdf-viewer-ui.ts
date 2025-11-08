import { invoke } from "@tauri-apps/api/core";
import * as pdfjsLib from 'pdfjs-dist';
import type { QueryItem, SearchMatch } from '../../shared/data/types';
import { extractTextFromSelection } from '../../shared/data/pdf-text-utils';
import { createNote } from '../../notes/data/notes-data';
import { renderNotesList } from '../../notes/ui/notes-renderer-ui';

export async function loadPageImage(filePath: string, pageNumber: number, queries: QueryItem[], match?: SearchMatch): Promise<HTMLElement> {
  try {
    // Read the PDF file from the backend (bypasses CORS issues)
    const pdfBytes = await invoke<number[]>('read_pdf_file', { filePath });

    // Convert to Uint8Array for PDF.js
    const pdfData = new Uint8Array(pdfBytes);

    // Load the PDF document from the byte array
    const loadingTask = pdfjsLib.getDocument({ data: pdfData });
    const pdf = await loadingTask.promise;

    // Get the specific page
    const page = await pdf.getPage(pageNumber);

    // Set up canvas
    const scale = 1.5; // Adjust for quality
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d')!;
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    // Render the page
    const renderContext = {
      canvasContext: context,
      viewport: viewport,
      canvas: canvas
    };

    await page.render(renderContext).promise;

    // Get text content for highlighting and text selection
    const textContent = await page.getTextContent();

    // Highlight each search term with its respective color
    if (queries.length > 0) {
      for (const queryItem of queries) {
        const searchQuery = queryItem.query;
        if (searchQuery.trim().length > 0) {
          // Convert hex color to rgba with transparency
          const hexColor = queryItem.color;
          const r = parseInt(hexColor.slice(1, 3), 16);
          const g = parseInt(hexColor.slice(3, 5), 16);
          const b = parseInt(hexColor.slice(5, 7), 16);
          context.fillStyle = `rgba(${r}, ${g}, ${b}, 0.4)`;

          const searchLower = searchQuery.toLowerCase();

          for (const item of textContent.items) {
            if ('str' in item) {
              const itemText = item.str;
              const itemTextLower = itemText.toLowerCase();

              // Find all occurrences of the search term in this text item
              let matchIndex = 0;
              while ((matchIndex = itemTextLower.indexOf(searchLower, matchIndex)) !== -1) {
                // Get the transform matrix [a, b, c, d, e, f]
                const tx = item.transform;

                // Calculate the bounding box in PDF coordinates
                const fontHeight = Math.sqrt(tx[2] * tx[2] + tx[3] * tx[3]); // Scale in Y direction
                const totalWidth = item.width;
                const textLength = itemText.length;

                // Estimate character width (simple approximation)
                const charWidth = textLength > 0 ? totalWidth / textLength : 0;

                // Calculate the start position and width of just the matched text
                const matchLength = searchQuery.length;
                const matchStartOffset = matchIndex * charWidth;
                const matchWidth = matchLength * charWidth;

                // Convert PDF coordinates to viewport coordinates
                const left = tx[4] + matchStartOffset;
                const bottom = tx[5];
                const right = left + matchWidth;
                const top = bottom + fontHeight;

                // Transform to viewport space
                const [x1, y1] = viewport.convertToViewportPoint(left, bottom);
                const [x2, y2] = viewport.convertToViewportPoint(right, top);

                // Draw the highlight rectangle for just the matched portion
                const rectX = Math.min(x1, x2);
                const rectY = Math.min(y1, y2);
                const rectWidth = Math.abs(x2 - x1);
                const rectHeight = Math.abs(y2 - y1);

                context.fillRect(rectX, rectY, rectWidth, rectHeight);

                // Move to next potential match
                matchIndex += searchQuery.length;
              }
            }
          }
        }
      }
    }

    // Create a container for the canvas with text selection capability
    const container = document.createElement('div');
    container.style.position = 'relative';
    container.style.display = 'block';
    container.style.cursor = 'crosshair';
    container.appendChild(canvas);

    // Add text selection functionality
    let isSelecting = false;
    let startX = 0;
    let startY = 0;
    let selectionOverlay: HTMLDivElement | null = null;

    container.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return; // Only left click

      isSelecting = true;
      const rect = container.getBoundingClientRect();
      startX = e.clientX - rect.left;
      startY = e.clientY - rect.top;

      // Create selection overlay
      selectionOverlay = document.createElement('div');
      selectionOverlay.className = 'selection-overlay';
      selectionOverlay.style.left = `${startX}px`;
      selectionOverlay.style.top = `${startY}px`;
      selectionOverlay.style.width = '0px';
      selectionOverlay.style.height = '0px';
      container.appendChild(selectionOverlay);

      e.preventDefault();
    });

    container.addEventListener('mousemove', (e) => {
      if (!isSelecting || !selectionOverlay) return;

      const rect = container.getBoundingClientRect();
      const currentX = e.clientX - rect.left;
      const currentY = e.clientY - rect.top;

      const left = Math.min(startX, currentX);
      const top = Math.min(startY, currentY);
      const width = Math.abs(currentX - startX);
      const height = Math.abs(currentY - startY);

      selectionOverlay.style.left = `${left}px`;
      selectionOverlay.style.top = `${top}px`;
      selectionOverlay.style.width = `${width}px`;
      selectionOverlay.style.height = `${height}px`;
    });

    container.addEventListener('mouseup', (e) => {
      if (!isSelecting) return;

      isSelecting = false;

      const rect = container.getBoundingClientRect();
      const endX = e.clientX - rect.left;
      const endY = e.clientY - rect.top;

      // Calculate the scale factor between displayed size and canvas intrinsic size
      // In multi-column layouts, CSS scales the canvas down, so we need to scale coordinates up
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;

      // Calculate selection box in canvas coordinates (not display coordinates)
      const selectionBox = {
        x: Math.min(startX, endX) * scaleX,
        y: Math.min(startY, endY) * scaleY,
        width: Math.abs(endX - startX) * scaleX,
        height: Math.abs(endY - startY) * scaleY
      };

      // Remove selection overlay
      if (selectionOverlay) {
        selectionOverlay.remove();
        selectionOverlay = null;
      }

      // Only process if selection has meaningful size
      if (selectionBox.width > 5 && selectionBox.height > 5) {
        // Extract text from selection
        const selectedText = extractTextFromSelection(textContent, selectionBox, viewport);

        if (selectedText && selectedText.trim().length >= 3) {
          // Get metadata for the note
          const fileName = filePath.split('/').pop() || filePath;
          const zoteroMetadata = match?.zotero_metadata || null;

          // Create note
          createNote(selectedText, filePath, fileName, pageNumber, zoteroMetadata, selectionBox, renderNotesList);
        }
      }
    });

    // Cancel selection if mouse leaves
    container.addEventListener('mouseleave', () => {
      if (isSelecting && selectionOverlay) {
        selectionOverlay.remove();
        selectionOverlay = null;
        isSelecting = false;
      }
    });

    return container;
  } catch (error) {
    console.error(`Failed to render page ${pageNumber}:`, error);
    throw error;
  }
}

export async function toggleCoverPage(filePath: string, button: HTMLButtonElement) {
  const fileId = filePath.replace(/[^a-zA-Z0-9]/g, '_');
  let coverContainer = document.getElementById(`cover-overlay-${fileId}`);

  // If overlay doesn't exist, create it
  if (!coverContainer) {
    coverContainer = document.createElement('div');
    coverContainer.id = `cover-overlay-${fileId}`;
    coverContainer.className = 'cover-page-container';
    document.body.appendChild(coverContainer);

    // Add close button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'cover-page-close';
    closeBtn.textContent = '×';
    closeBtn.onclick = () => {
      coverContainer!.classList.remove('visible');
      button.style.opacity = '0.7';
    };
    coverContainer.appendChild(closeBtn);

    // Click on overlay background to close
    coverContainer.addEventListener('click', (e) => {
      if (e.target === coverContainer) {
        coverContainer!.classList.remove('visible');
        button.style.opacity = '0.7';
      }
    });
  }

  const isVisible = coverContainer.classList.contains('visible');

  if (isVisible) {
    // Hide the overlay
    coverContainer.classList.remove('visible');
    button.style.opacity = '0.7';
  } else {
    // Show the overlay
    coverContainer.classList.add('visible');
    button.style.opacity = '1';

    // Check if already loaded
    if (!coverContainer.querySelector('canvas') && !coverContainer.querySelector('img')) {
      // Create wrapper for content
      const wrapper = document.createElement('div');
      wrapper.className = 'cover-page-wrapper';
      wrapper.innerHTML = '<div class="loading">Loading cover page...</div>';

      // Insert after close button
      coverContainer.appendChild(wrapper);

      try {
        const element = await loadPageImage(filePath, 1, [], undefined);
        wrapper.innerHTML = '';
        wrapper.appendChild(element);
      } catch {
        wrapper.innerHTML = '<div class="page-preview-error">Failed to load cover page</div>';
      }
    }
  }
}
