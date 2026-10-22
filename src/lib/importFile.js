// Browser side checks for "Import file". The server checks the same rules again.
import { APP } from '../config.js';
import { formatBytes } from './format.js';

export function fileExtension(name) {
  const dot = String(name || '').lastIndexOf('.');
  return dot >= 0 ? name.slice(dot).toLowerCase() : '';
}

// Returns '' when the file is fine, otherwise a message to show.
export function validateImportFile(file) {
  if (!file) return 'Choose a file to import.';
  const name = file.name || 'That file';
  const ext = fileExtension(file.name);
  if (ext === '.doc') return `"${name}" is an older Word file (.doc). Save it as .docx in Word, then import it again.`;
  if (!APP.import.extensions.includes(ext)) {
    return `"${name}" is not a supported file type. Choose a .txt, .md or .docx file.`;
  }
  if (file.size === 0) return `"${name}" is empty. Choose a file that has some text in it.`;
  if (file.size > APP.import.maxBytes) {
    return `"${name}" is over the ${APP.import.maxLabel} limit (${formatBytes(file.size)}). Choose a smaller file.`;
  }
  return '';
}

// Reads the file and returns its bytes as base64 (no "data:" prefix).
export function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      const comma = text.indexOf(',');
      resolve(comma >= 0 ? text.slice(comma + 1) : '');
    };
    reader.onerror = () => reject(new Error('We could not read that file from your device. Please try again.'));
    reader.readAsDataURL(file);
  });
}
