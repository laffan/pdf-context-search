// Extract text from a selection box on a PDF page
export function extractTextFromSelection(textContent: any, selectionBox: { x: number; y: number; width: number; height: number }, viewport: any): string {
  const selectedItems: string[] = [];

  for (const item of textContent.items) {
    if ('str' in item && item.str.trim()) {
      const tx = item.transform;

      // Calculate text bounding box
      const fontHeight = Math.sqrt(tx[2] * tx[2] + tx[3] * tx[3]);
      const left = tx[4];
      const bottom = tx[5];
      const right = left + item.width;
      const top = bottom + fontHeight;

      // Convert to viewport coordinates
      const [x1, y1] = viewport.convertToViewportPoint(left, bottom);
      const [x2, y2] = viewport.convertToViewportPoint(right, top);

      const itemBox = {
        x: Math.min(x1, x2),
        y: Math.min(y1, y2),
        width: Math.abs(x2 - x1),
        height: Math.abs(y2 - y1)
      };

      // Check if this text item overlaps with the selection
      if (boxesOverlap(selectionBox, itemBox)) {
        selectedItems.push(item.str);
      }
    }
  }

  return removeLineBreakHyphens(selectedItems.join(' '));
}

// Remove hyphens that occur at line breaks (word wrapping)
function removeLineBreakHyphens(text: string): string {
  // Remove hyphen followed by space (hyphen at end of line)
  // Pattern: word- word -> wordword
  return text.replace(/(\w)-\s+(\w)/g, '$1$2');
}

// Check if two boxes overlap
export function boxesOverlap(box1: { x: number; y: number; width: number; height: number }, box2: { x: number; y: number; width: number; height: number }): boolean {
  return !(box1.x + box1.width < box2.x ||
           box2.x + box2.width < box1.x ||
           box1.y + box1.height < box2.y ||
           box2.y + box2.height < box1.y);
}
