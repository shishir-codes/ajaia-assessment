// Product copy and client side limits in one place. The server enforces the same limits;
// the browser checks them first so people get a clear message without a round trip.
export const APP = {
  name: 'Ajaia Docs',
  autosaveDelayMs: 1000,
  titleMaxLength: 200,
  contentMaxChars: 500000,
  import: {
    maxBytes: 2 * 1024 * 1024,
    maxLabel: '2 MB',
    extensions: ['.txt', '.md', '.markdown', '.docx'],
    accept:
      '.txt,.md,.markdown,.docx,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
};

export const ROLE_LABEL = { owner: 'Owner', editor: 'Can edit', viewer: 'Can view' };
