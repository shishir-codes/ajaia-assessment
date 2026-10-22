import { useCallback, useEffect, useRef, useState } from 'react';
import { APP, ROLE_LABEL } from '../config.js';
import { api } from '../lib/api.js';
import { fullDate, timeAgo } from '../lib/format.js';
import { readFileAsBase64, validateImportFile } from '../lib/importFile.js';
import { docHref, navigate } from '../lib/router.js';
import { AlertIcon, CloseIcon, DocIcon, EmptyPagesArt, PlusIcon, UploadIcon } from './Icons.jsx';

export function RoleBadge({ role }) {
  return <span className={`badge badge-${role}`}>{ROLE_LABEL[role] || role}</span>;
}

function DocRow({ doc, shared, user }) {
  const editedBy = doc.updatedByName ? (doc.updatedByName === user.name ? 'you' : doc.updatedByName) : '';
  return (
    <li>
      <a className="doc-row" href={docHref(doc.id)}>
        <DocIcon className="doc-row-icon" />
        <span className="doc-thumb" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        <span className="doc-row-main">
          <span className="doc-row-title">{doc.title || 'Untitled document'}</span>
          <span className="doc-row-meta">
            {shared ? <span>Owner: {doc.ownerName}</span> : null}
            <span title={fullDate(doc.updatedAt)}>
              Edited <time dateTime={doc.updatedAt}>{timeAgo(doc.updatedAt)}</time>
              {editedBy ? ` by ${editedBy}` : ''}
            </span>
          </span>
        </span>
        <RoleBadge role={doc.role} />
      </a>
    </li>
  );
}

function DocSection({ id, title, docs, shared, user, emptyTitle, emptyText }) {
  return (
    <section className="doc-section" aria-labelledby={id}>
      <h2 id={id} className="section-title">
        {title}
        <span className="section-count">{docs.length}</span>
      </h2>
      {docs.length === 0 ? (
        <div className="state state-empty">
          <EmptyPagesArt />
          <p className="state-title">{emptyTitle}</p>
          <p className="state-text">{emptyText}</p>
        </div>
      ) : (
        <ul className="doc-list">
          {docs.map((doc) => (
            <DocRow key={doc.id} doc={doc} shared={shared} user={user} />
          ))}
        </ul>
      )}
    </section>
  );
}

function SkeletonSection({ title }) {
  return (
    <section className="doc-section" aria-busy="true">
      <h2 className="section-title">{title}</h2>
      <ul className="doc-list" aria-label={`Loading ${title.toLowerCase()}`}>
        {[0, 1, 2].map((i) => (
          <li key={i} className="doc-row doc-row-skeleton">
            <span className="skeleton skeleton-icon" />
            <span className="skeleton-lines">
              <span className="skeleton" />
              <span className="skeleton skeleton-short" />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function Home({ user, flash, onDismissFlash }) {
  const [list, setList] = useState({ status: 'loading', owned: [], shared: [], error: '' });
  const [busy, setBusy] = useState(''); // 'create' | 'import' | ''
  const [actionError, setActionError] = useState('');
  const fileRef = useRef(null);
  const busyRef = useRef('');

  const load = useCallback(async (signal) => {
    setList((l) => ({ ...l, status: 'loading', error: '' }));
    try {
      const data = await api.listDocuments({ signal });
      setList({
        status: 'ready',
        owned: Array.isArray(data.owned) ? data.owned : [],
        shared: Array.isArray(data.shared) ? data.shared : [],
        error: '',
      });
    } catch (err) {
      if (signal?.aborted) return;
      setList({ status: 'error', owned: [], shared: [], error: err.message });
    }
  }, []);

  useEffect(() => {
    document.title = APP.name;
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  function start(kind) {
    if (busyRef.current) return false;
    busyRef.current = kind;
    setBusy(kind);
    setActionError('');
    return true;
  }

  function finish() {
    busyRef.current = '';
    setBusy('');
  }

  async function createDocument() {
    if (!start('create')) return;
    try {
      const data = await api.createDocument({ title: 'Untitled document' });
      navigate(docHref(data.document.id));
    } catch (err) {
      setActionError(err.message);
    } finally {
      finish();
    }
  }

  async function importChosenFile(event) {
    const input = event.target;
    const file = input.files?.[0];
    input.value = ''; // so choosing the same file again still triggers a change
    if (!file) return;
    const problem = validateImportFile(file);
    if (problem) {
      setActionError(problem);
      return;
    }
    if (!start('import')) return;
    try {
      const base64 = await readFileAsBase64(file);
      const data = await api.importFile(file.name, base64);
      navigate(docHref(data.document.id));
    } catch (err) {
      setActionError(err.message);
    } finally {
      finish();
    }
  }

  return (
    <div className="home">
      <div className="home-head">
        <div>
          <h1 className="home-title">Documents</h1>
          <p className="home-subtitle">Create a document, import a file, or open one that was shared with you.</p>
        </div>
        <div className="home-actions">
          <button type="button" className="btn btn-primary" onClick={createDocument} disabled={Boolean(busy)}>
            <PlusIcon />
            {busy === 'create' ? 'Creating...' : 'New document'}
          </button>
          <div className="import-group">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => fileRef.current?.click()}
              disabled={Boolean(busy)}
              aria-describedby="import-hint"
            >
              <UploadIcon />
              {busy === 'import' ? 'Importing...' : 'Import file'}
            </button>
            <span id="import-hint" className="hint">
              .txt, .md or .docx, up to {APP.import.maxLabel}
            </span>
            <input
              ref={fileRef}
              type="file"
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              accept={APP.import.accept}
              onChange={importChosenFile}
            />
          </div>
        </div>
      </div>

      {flash ? (
        <div className="alert alert-success" role="status">
          <span>{flash}</span>
          <button type="button" className="icon-btn icon-btn-sm" aria-label="Dismiss message" onClick={onDismissFlash}>
            <CloseIcon />
          </button>
        </div>
      ) : null}

      {actionError ? (
        <div className="alert alert-error" role="alert">
          <AlertIcon className="icon-sm" />
          <span>{actionError}</span>
          <button type="button" className="icon-btn icon-btn-sm" aria-label="Dismiss error" onClick={() => setActionError('')}>
            <CloseIcon />
          </button>
        </div>
      ) : null}

      {list.status === 'loading' ? (
        <>
          <SkeletonSection title="My documents" />
          <SkeletonSection title="Shared with me" />
        </>
      ) : null}

      {list.status === 'error' ? (
        <div className="state state-error" role="alert">
          <p className="state-title">Could not load your documents</p>
          <p className="state-text">{list.error}</p>
          <button type="button" className="btn btn-secondary" onClick={() => load()}>
            Try again
          </button>
        </div>
      ) : null}

      {list.status === 'ready' ? (
        <>
          <DocSection
            id="my-docs"
            title="My documents"
            docs={list.owned}
            user={user}
            emptyTitle="No documents yet"
            emptyText="Create a new document or import a .txt, .md or .docx file to get started."
          />
          <DocSection
            id="shared-docs"
            title="Shared with me"
            docs={list.shared}
            shared
            user={user}
            emptyTitle="Nothing shared with you yet"
            emptyText="When someone shares a document with you, it shows up here."
          />
        </>
      ) : null}
    </div>
  );
}
