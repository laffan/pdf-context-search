import { open } from "@tauri-apps/plugin-dialog";
import { directoryPath, zoteroPath, zoteroMode, zoteroFolderGroup } from '../../shared/data/state';
import { showStatus } from '../../shared/ui/status-message';

export async function browseDirectory() {
  try {
    const selected = await open({
      directory: true,
      multiple: false,
      title: 'Select PDF Directory',
    });

    if (selected && typeof selected === 'string') {
      directoryPath.textContent = selected;
      directoryPath.title = selected; // Show full path on hover
      // Persist the directory selection
      localStorage.setItem('pdfSearchDirectory', selected);
    }
  } catch (error) {
    showStatus(`Failed to select directory: ${error}`, 'error');
  }
}

export async function browseZoteroDirectory() {
  try {
    const selected = await open({
      directory: true,
      multiple: false,
      title: 'Select Zotero Data Directory',
    });

    if (selected && typeof selected === 'string') {
      zoteroPath.textContent = selected;
      zoteroPath.title = selected; // Show full path on hover
      // Persist the zotero directory selection
      localStorage.setItem('pdfSearchZoteroPath', selected);
    }
  } catch (error) {
    showStatus(`Failed to select Zotero directory: ${error}`, 'error');
  }
}

export function toggleZoteroFolder() {
  if (zoteroMode.checked) {
    zoteroFolderGroup.style.display = 'block';
  } else {
    zoteroFolderGroup.style.display = 'none';
  }
}
