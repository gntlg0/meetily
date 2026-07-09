/**
 * Constants shared by the browser upload form and the server upload handler.
 * Kept out of storage.ts because that module is `server-only`.
 */
export const ALLOWED_EXTENSIONS = [
  '.m4a', '.mp3', '.wav', '.mp4', '.aac', '.caf',
  '.ogg', '.opus', '.flac', '.webm', '.amr', '.3gp', '.m4b',
];

export const MAX_UPLOAD_BYTES = 500 * 1024 * 1024; // 500 MB
