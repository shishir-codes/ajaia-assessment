// Demo data. Users are inserted on every cold start (ON CONFLICT DO NOTHING); the two demo
// documents are inserted only once per database (guarded by the meta key "seeded").

export const SEED_USERS = [
  { id: 'u_alice', email: 'alice@example.com', name: 'Alice Johnson' },
  { id: 'u_bob', email: 'bob@example.com', name: 'Bob Smith' },
  { id: 'u_carol', email: 'carol@example.com', name: 'Carol Lee' },
];

export const WELCOME_DOC = {
  title: 'Welcome to Ajaia Docs',
  content: [
    '<h1>Welcome to Ajaia Docs</h1>',
    '<p>Ajaia Docs is a lightweight document editor. This document belongs to <strong>Alice Johnson</strong> and is shared with <em>Bob Smith</em>, who can edit it.</p>',
    '<h2>Try it in two minutes</h2>',
    '<ol>',
    '<li><p>Type anywhere on this page. Your changes save about a second after you stop typing, or press <strong>Ctrl+S</strong>.</p></li>',
    '<li><p>Use the toolbar for <strong>bold</strong>, <em>italic</em>, <u>underline</u>, headings and lists.</p></li>',
    '<li><p>Go back to the document list and press <strong>Import file</strong> to turn a .txt, .md or .docx file (up to 2 MB) into a new document.</p></li>',
    '<li><p>Press <strong>Share</strong> to give someone access by email, as a viewer or an editor.</p></li>',
    '<li><p>Use <strong>Switch user</strong> to sign in as Bob or Carol and see what they can do.</p></li>',
    '</ol>',
    '<h3>Who can do what</h3>',
    '<ul>',
    '<li><p><strong>Owner:</strong> edit, rename, share, change roles, remove access and delete.</p></li>',
    '<li><p><strong>Editor:</strong> edit the text and the title.</p></li>',
    '<li><p><strong>Viewer:</strong> read only.</p></li>',
    '</ul>',
    '<p><em>Tip:</em> open this document as Alice and as Bob in two browsers. If both of you save at the same time, the second save is stopped and you can choose to load the latest version or keep your own.</p>',
  ].join(''),
};

export const NOTES_DOC = {
  title: 'Team meeting notes',
  content: [
    '<h1>Team meeting notes</h1>',
    '<p><strong>Attendees:</strong> Bob Smith, Alice Johnson</p>',
    '<h2>Agenda</h2>',
    '<ul>',
    '<li><p>Launch checklist</p></li>',
    '<li><p>Customer feedback from the beta</p></li>',
    '</ul>',
    '<h2>Action items</h2>',
    '<ol>',
    '<li><p>Bob: draft the release notes.</p></li>',
    '<li><p>Alice: review the onboarding copy.</p></li>',
    '</ol>',
    '<p><em>Bob owns these notes. Alice can read them but cannot edit them.</em></p>',
  ].join(''),
};
