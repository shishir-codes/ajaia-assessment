import Placeholder from '@tiptap/extension-placeholder';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useCallback, useEffect, useRef, useState } from 'react';
import { APP } from '../config.js';
import { api } from '../lib/api.js';
import { flushPending, setPendingFlush, UNSAVED_PROMPT } from '../lib/pending.js';
import { navigate } from '../lib/router.js';
import { AlertIcon, BackIcon, CheckIcon, DocIcon, EyeIcon, ShareIcon, TrashIcon } from './Icons.jsx';
import Modal from './Modal.jsx';
import ShareDialog from './ShareDialog.jsx';
import Toolbar from './Toolbar.jsx';

// Same rule as the server sanitizer: links may only use http, https or mailto.
const SAFE_LINK = /^(https?:\/\/|mailto:)/i;

const STATUS_TEXT = {
  saved: 'Saved',
  unsaved: 'Unsaved changes',
  saving: 'Saving...',
  retrying: 'Could not save, retrying',
  error: 'Could not save',
  conflict: 'Not saved',
};

function docMeta(doc) {
  const { content, ...rest } = doc || {};
  return rest;
}

export default function EditorPage({ id, user, onNotify }) {
  const [load, setLoad] = useState({ status: 'loading', doc: null, error: '' });

  const fetchDoc = useCallback(
    async (signal) => {
      setLoad({ status: 'loading', doc: null, error: '' });
      try {
        const data = await api.getDocument(id, { signal });
        setLoad({ status: 'ready', doc: data.document, error: '' });
      } catch (err) {
        if (signal?.aborted) return;
        if (err.status === 404 || err.status === 400) setLoad({ status: 'missing', doc: null, error: '' });
        else setLoad({ status: 'error', doc: null, error: err.message });
      }
    },
    [id],
  );

  useEffect(() => {
    const controller = new AbortController();
    fetchDoc(controller.signal);
    return () => controller.abort();
  }, [fetchDoc]);

  if (load.status === 'loading') return <EditorSkeleton />;
  if (load.status === 'missing') {
    return (
      <Notice
        title="Document not found"
        text="It may have been deleted, or it has not been shared with you."
        action={
          <a className="btn btn-primary" href="#/">
            Back to documents
          </a>
        }
      />
    );
  }
  if (load.status === 'error') {
    return (
      <Notice
        title="Could not open this document"
        text={load.error}
        tone="error"
        action={
          <>
            <button type="button" className="btn btn-primary" onClick={() => fetchDoc()}>
              Try again
            </button>
            <a className="btn btn-secondary" href="#/">
              Back to documents
            </a>
          </>
        }
      />
    );
  }
  return <DocumentWorkspace key={load.doc.id} initialDoc={load.doc} user={user} onNotify={onNotify} />;
}

function Notice({ title, text, action, tone }) {
  useEffect(() => {
    document.title = `${title} - ${APP.name}`;
  }, [title]);
  return (
    <div className="workspace workspace-center">
      <div className={`state notice-card${tone === 'error' ? ' state-error' : ''}`} role={tone === 'error' ? 'alert' : undefined}>
        <h1 className="state-title">{title}</h1>
        <p className="state-text">{text}</p>
        <div className="state-actions">{action}</div>
      </div>
    </div>
  );
}

function EditorSkeleton() {
  return (
    <div className="editor-page" aria-busy="true" aria-label="Loading document">
      <div className="docbar">
        <span className="skeleton skeleton-title" />
      </div>
      <div className="workspace">
        <div className="page">
          <div className="skeleton-lines">
            <span className="skeleton skeleton-heading" />
            <span className="skeleton" />
            <span className="skeleton" />
            <span className="skeleton skeleton-short" />
          </div>
        </div>
      </div>
    </div>
  );
}

function SaveStatus({ status, detail, onRetry }) {
  const failed = status === 'retrying' || status === 'error';
  return (
    <span className={`save-status save-${status}`}>
      <span role="status" aria-live="polite" className="save-status-text" title={detail || undefined}>
        {status === 'saved' ? <CheckIcon className="icon-xs" /> : null}
        {status === 'saving' ? <span className="spinner" aria-hidden="true" /> : null}
        {failed || status === 'conflict' ? <AlertIcon className="icon-xs" /> : null}
        {STATUS_TEXT[status] || ''}
      </span>
      {failed ? (
        <button type="button" className="link-btn" onClick={onRetry}>
          Retry now
        </button>
      ) : null}
    </span>
  );
}

function DocumentWorkspace({ initialDoc, user, onNotify }) {
  const docId = initialDoc.id;
  const [meta, setMeta] = useState(() => docMeta(initialDoc));
  const [role, setRole] = useState(initialDoc.role);
  const [titleDraft, setTitleDraft] = useState(initialDoc.title);
  const [status, setStatus] = useState('saved');
  const [statusDetail, setStatusDetail] = useState('');
  const [conflict, setConflict] = useState(null); // { latest } after a 409
  const [conflictBusy, setConflictBusy] = useState(false);
  const [conflictError, setConflictError] = useState('');
  const [blocked, setBlocked] = useState(''); // message after a 403 or 404 while saving
  const [rateLimited, setRateLimited] = useState(false); // the last save got 429 and will be retried
  const [dialog, setDialog] = useState(''); // 'share' | 'delete' | ''
  const [deleteState, setDeleteState] = useState({ busy: false, error: '' });

  const canEdit = (role === 'owner' || role === 'editor') && !blocked;
  const isOwner = role === 'owner' && !blocked;

  // Save machinery lives in refs so timers, key handlers and the leave handler never see stale values.
  const versionRef = useRef(initialDoc.version);
  const editSeqRef = useRef(0); // bumps on every local content change
  const savedSeqRef = useRef(0); // the edit number that is safely on the server
  const pendingTitleRef = useRef(null); // a committed title that is not saved yet
  const inFlightRef = useRef(null);
  const againRef = useRef(false);
  const timerRef = useRef(0);
  const retryTimerRef = useRef(0);
  const retryCountRef = useRef(0);
  const lastFailedRef = useRef(false);
  const conflictRef = useRef(false);
  const blockedRef = useRef(false);
  const canEditRef = useRef(canEdit);
  canEditRef.current = canEdit;
  const mountedRef = useRef(true);
  const metaRef = useRef(meta);
  metaRef.current = meta;
  const editorRef = useRef(null);
  const handlersRef = useRef({});
  const skipBlurCommitRef = useRef(false);
  const titleRef = useRef(null);
  const shareBtnRef = useRef(null);
  const deleteBtnRef = useRef(null);

  const editor = useEditor({
    extensions: [
      // StarterKit 3 already includes Underline, Link, lists and undo/redo: do not register them again.
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: {
          openOnClick: initialDoc.role === 'viewer',
          autolink: true,
          linkOnPaste: true,
          defaultProtocol: 'https',
          isAllowedUri: (url, ctx) => SAFE_LINK.test(url) && ctx.defaultValidate(url),
        },
      }),
      Placeholder.configure({ placeholder: 'Start writing here...' }),
    ],
    content: initialDoc.content || '',
    editable: initialDoc.role !== 'viewer',
    // A brand new, empty document puts the cursor on the page so people can start typing.
    autofocus: initialDoc.role !== 'viewer' && !String(initialDoc.content || '').replace(/<[^>]*>/g, '').trim() ? 'start' : false,
    editorProps: {
      attributes: {
        class: 'doc-content',
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': 'Document text',
      },
    },
    onUpdate: () => handlersRef.current.onChange?.(),
  });
  editorRef.current = editor;

  const hasUnsaved = () => editSeqRef.current !== savedSeqRef.current || pendingTitleRef.current !== null;

  function scheduleSave(delay) {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void handlersRef.current.flush(), delay);
  }

  function handleSaveError(err, patch) {
    lastFailedRef.current = true;
    if (!mountedRef.current) return;
    setRateLimited(err.status === 429);
    if (err.status === 409) {
      conflictRef.current = true;
      clearTimeout(retryTimerRef.current);
      setConflict({ latest: err.body?.document || null });
      setConflictError('');
      setStatus('conflict');
      setStatusDetail('');
      return;
    }
    if (err.status === 403 || err.status === 404) {
      blockedRef.current = true;
      clearTimeout(retryTimerRef.current);
      setBlocked(
        err.status === 403
          ? 'You can no longer edit this document (your access may have changed to view only), so your latest changes were not saved. Copy anything you want to keep, then go back to your documents.'
          : 'This document was deleted or your access was removed, so your latest changes were not saved. Copy anything you want to keep, then go back to your documents.',
      );
      if (err.status === 403) setRole('viewer');
      setStatus('error');
      return;
    }
    if (err.status === 401) {
      setStatus('error');
      setStatusDetail(err.message);
      return;
    }
    if (err.status >= 400 && err.status < 500 && err.status !== 408 && err.status !== 429) {
      // The server rejected this save (for example too large). Retrying the same thing would fail again.
      let droppedTitle = false;
      if (err.status === 400 && patch.title !== undefined && pendingTitleRef.current === patch.title) {
        pendingTitleRef.current = null;
        setTitleDraft(metaRef.current.title);
        droppedTitle = true;
      }
      setStatus('error');
      setStatusDetail(err.message);
      if (droppedTitle && patch.content !== undefined) scheduleSave(0);
      return;
    }
    // Network problem, server error or demo rate limit: keep the changes and try again with a growing
    // delay (for a 429, no sooner than the server's Retry-After).
    retryCountRef.current += 1;
    let delay = Math.min(30000, 2000 * 2 ** Math.min(retryCountRef.current - 1, 4));
    const retryAfter = Number(err.body?.retryAfter);
    if (err.status === 429 && Number.isFinite(retryAfter) && retryAfter > 0) delay = Math.max(delay, Math.min(retryAfter, 60) * 1000);
    setStatus('retrying');
    setStatusDetail(err.message);
    clearTimeout(retryTimerRef.current);
    retryTimerRef.current = setTimeout(() => void handlersRef.current.flush(), delay);
  }

  // Sends every unsaved change in one PATCH. Only one save runs at a time; a request made while
  // one is running is remembered and sent right after, with the new version number.
  function flush() {
    clearTimeout(timerRef.current);
    if (inFlightRef.current) {
      againRef.current = true;
      return inFlightRef.current;
    }
    if (conflictRef.current || blockedRef.current || !canEditRef.current) return Promise.resolve();
    const seq = editSeqRef.current;
    const contentDirty = seq !== savedSeqRef.current;
    const title = pendingTitleRef.current;
    if (!contentDirty && title === null) {
      if (mountedRef.current) {
        setStatus('saved');
        setStatusDetail('');
      }
      return Promise.resolve();
    }
    const patch = { baseVersion: versionRef.current };
    if (contentDirty) {
      const ed = editorRef.current;
      if (!ed || ed.isDestroyed) return Promise.resolve();
      const html = ed.getHTML();
      if (html.length > APP.contentMaxChars) {
        lastFailedRef.current = true;
        setStatus('error');
        setStatusDetail(
          `This document is too long to save. The limit is ${APP.contentMaxChars.toLocaleString()} characters including formatting, so please remove some content.`,
        );
        return Promise.resolve();
      }
      patch.content = html;
    }
    if (title !== null) patch.title = title;

    if (mountedRef.current) setStatus('saving');
    const run = (async () => {
      try {
        const data = await api.updateDocument(docId, patch);
        const saved = data.document;
        if (saved && Number.isInteger(saved.version)) versionRef.current = saved.version;
        if (patch.content !== undefined) savedSeqRef.current = seq;
        if (title !== null && pendingTitleRef.current === title) pendingTitleRef.current = null;
        retryCountRef.current = 0;
        lastFailedRef.current = false;
        clearTimeout(retryTimerRef.current);
        if (!mountedRef.current) return;
        if (saved) setMeta((m) => ({ ...m, ...docMeta(saved) }));
        setRateLimited(false);
        setStatusDetail('');
        setStatus(hasUnsaved() ? 'unsaved' : 'saved');
      } catch (err) {
        handleSaveError(err, patch);
      } finally {
        inFlightRef.current = null;
        if (againRef.current) {
          againRef.current = false;
          if (mountedRef.current) void handlersRef.current.flush();
        }
      }
    })();
    inFlightRef.current = run;
    return run;
  }

  // Used by the back link and Switch user: wait until everything that can be saved is saved.
  async function saveEverything() {
    clearTimeout(timerRef.current);
    for (let i = 0; i < 5; i += 1) {
      if (inFlightRef.current) {
        await inFlightRef.current;
        continue;
      }
      if (!hasUnsaved() || conflictRef.current || blockedRef.current || !canEditRef.current) return;
      await flush();
      if (lastFailedRef.current) return;
    }
  }

  function onLocalChange() {
    if (!canEditRef.current) return;
    editSeqRef.current += 1;
    setStatus((s) => (s === 'saved' || s === 'saving' ? 'unsaved' : s));
    if (!conflictRef.current && !blockedRef.current) scheduleSave(APP.autosaveDelayMs);
  }

  function commitTitle() {
    if (!canEditRef.current) return;
    let next = titleDraft.replace(/\s+/g, ' ').trim();
    if (!next) next = 'Untitled document';
    next = next.slice(0, APP.titleMaxLength);
    if (next !== titleDraft) setTitleDraft(next);
    const current = pendingTitleRef.current ?? metaRef.current.title;
    if (next === current) return;
    pendingTitleRef.current = next;
    setStatus((s) => (s === 'saved' ? 'unsaved' : s));
    void flush();
  }

  handlersRef.current = { onChange: onLocalChange, flush, saveEverything, commitTitle };

  // Lock the editor when access is lost (403 or 404 while saving) or for viewers.
  useEffect(() => {
    if (editor && !editor.isDestroyed && editor.isEditable !== canEdit) editor.setEditable(canEdit, false);
  }, [editor, canEdit]);

  useEffect(() => {
    document.title = `${meta.title || 'Untitled document'} - ${APP.name}`;
  }, [meta.title]);

  // Ctrl+S (Cmd+S on a Mac) saves now, from the editor or the title field.
  useEffect(() => {
    function onKeyDown(event) {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (!canEditRef.current) return;
        if (document.activeElement === titleRef.current) handlersRef.current.commitTitle();
        void handlersRef.current.flush();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Warn before closing the tab with unsaved work, and let Switch user wait for a save.
  useEffect(() => {
    function onBeforeUnload(event) {
      if (hasUnsaved() || inFlightRef.current) {
        event.preventDefault();
        event.returnValue = '';
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    const unregister = setPendingFlush(async () => {
      await handlersRef.current.saveEverything();
      return !hasUnsaved();
    });
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      unregister();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Leaving the page another way (browser Back): send what is left in one last save.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearTimeout(timerRef.current);
      clearTimeout(retryTimerRef.current);
      let html = null;
      try {
        const ed = editorRef.current;
        if (ed && !ed.isDestroyed) html = ed.getHTML();
      } catch {
        html = null;
      }
      const seq = editSeqRef.current;
      const sendLast = () => {
        if (conflictRef.current || blockedRef.current || !canEditRef.current) return;
        const patch = { baseVersion: versionRef.current };
        if (seq !== savedSeqRef.current && html !== null) patch.content = html;
        if (pendingTitleRef.current !== null) patch.title = pendingTitleRef.current;
        if (patch.content === undefined && patch.title === undefined) return;
        api.updateDocument(docId, patch).catch(() => {});
      };
      if (inFlightRef.current) inFlightRef.current.then(sendLast, sendLast);
      else sendLast();
    };
  }, [docId]);

  async function goBack(event) {
    event.preventDefault();
    const saved = await flushPending();
    if (!saved && !window.confirm(UNSAVED_PROMPT)) return;
    navigate('#/');
  }

  function onTitleKeyDown(event) {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (editor && !editor.isDestroyed) {
        // Move focus now (TipTap's focus command waits a frame), so the next key typed lands on the
        // page and not in the title. Leaving the title saves it.
        editor.view.focus();
        editor.commands.focus('start');
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      skipBlurCommitRef.current = true;
      setTitleDraft(pendingTitleRef.current ?? metaRef.current.title);
      event.currentTarget.blur();
    }
  }

  function onTitleBlur() {
    if (skipBlurCommitRef.current) {
      skipBlurCommitRef.current = false;
      return;
    }
    commitTitle();
  }

  async function resolveConflict(choice) {
    if (conflictBusy) return;
    setConflictBusy(true);
    setConflictError('');
    try {
      let latest = conflict?.latest || null;
      if (choice === 'load' || !latest || !Number.isInteger(latest.version)) {
        const data = await api.getDocument(docId);
        latest = data.document;
      }
      versionRef.current = latest.version;
      conflictRef.current = false;
      if (choice === 'load') {
        clearTimeout(timerRef.current);
        editorRef.current?.commands.setContent(latest.content || '', { emitUpdate: false });
        savedSeqRef.current = editSeqRef.current;
        pendingTitleRef.current = null;
        setTitleDraft(latest.title);
        setMeta((m) => ({ ...m, ...docMeta(latest) }));
        setConflict(null);
        setStatus('saved');
        setStatusDetail('');
      } else {
        // Keep mine: the unsaved edits stay marked as unsaved, so this save sends them on top of
        // the latest version (only the parts this person changed: content, title or both).
        setMeta((m) => ({ ...m, ...docMeta(latest) }));
        setConflict(null);
        await flush();
      }
    } catch (err) {
      conflictRef.current = true;
      setConflictError(err.message);
    } finally {
      setConflictBusy(false);
    }
  }

  function closeDialog() {
    const which = dialog;
    setDialog('');
    setDeleteState({ busy: false, error: '' });
    requestAnimationFrame(() => (which === 'share' ? shareBtnRef : deleteBtnRef).current?.focus());
  }

  async function confirmDelete() {
    if (deleteState.busy) return;
    setDeleteState({ busy: true, error: '' });
    blockedRef.current = true; // no autosave while the delete is in flight
    clearTimeout(timerRef.current);
    clearTimeout(retryTimerRef.current);
    try {
      await api.deleteDocument(docId);
      onNotify?.(`Deleted "${metaRef.current.title}".`);
      navigate('#/');
    } catch (err) {
      blockedRef.current = false;
      if (hasUnsaved()) scheduleSave(0);
      setDeleteState({ busy: false, error: err.message });
    }
  }

  const sharedNote = role !== 'owner' && meta.ownerName ? `Shared by ${meta.ownerName}` : '';
  const latest = conflict?.latest;
  const conflictWho = latest?.updatedByName
    ? latest.updatedByName === user.name
      ? 'You saved a newer version in another tab or window'
      : `${latest.updatedByName} saved a newer version`
    : 'Someone saved a newer version';

  return (
    <div className="editor-page">
      <div className="editor-top">
        <div className="docbar">
          <a className="back-link" href="#/" onClick={goBack} aria-label="Back to documents" title="Back to documents">
            <BackIcon />
          </a>
          <DocIcon className="docbar-icon" />
          <div className="docbar-main">
            {canEdit ? (
              <>
                <h1 className="sr-only">{meta.title}</h1>
                <input
                  ref={titleRef}
                  className="title-input"
                  value={titleDraft}
                  maxLength={APP.titleMaxLength}
                  aria-label="Document title"
                  spellCheck="true"
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onBlur={onTitleBlur}
                  onKeyDown={onTitleKeyDown}
                />
              </>
            ) : (
              <h1 className="title-static">{meta.title}</h1>
            )}
            <div className="docbar-meta">
              {role === 'viewer' ? (
                <span className="badge badge-viewer">
                  <EyeIcon className="icon-xs" />
                  View only
                </span>
              ) : null}
              {role === 'editor' && !blocked ? <span className="badge badge-editor">Can edit</span> : null}
              {sharedNote ? <span className="docbar-note">{sharedNote}</span> : null}
              {/* Last, so the badge and note do not shift sideways while the status text changes. */}
              {canEdit ? (
                <SaveStatus
                  status={status}
                  detail={statusDetail}
                  onRetry={() => {
                    clearTimeout(retryTimerRef.current);
                    void flush();
                  }}
                />
              ) : null}
            </div>
          </div>
          {isOwner ? (
            <div className="docbar-actions">
              <button ref={shareBtnRef} type="button" className="btn btn-primary" onClick={() => setDialog('share')} aria-label="Share">
                <ShareIcon />
                <span className="hide-sm">Share</span>
              </button>
              <button
                ref={deleteBtnRef}
                type="button"
                className="btn btn-ghost btn-danger-text"
                onClick={() => setDialog('delete')}
                aria-label="Delete document"
                title="Delete document"
              >
                <TrashIcon />
                <span className="hide-sm">Delete</span>
              </button>
            </div>
          ) : null}
        </div>

        {canEdit ? (
          <div className="toolbar-wrap">
            <Toolbar editor={editor} />
          </div>
        ) : null}

        {status === 'error' && statusDetail && canEdit ? (
          <div className="banner banner-error" role="alert">
            <AlertIcon />
            <p className="banner-text">{statusDetail}</p>
          </div>
        ) : null}

        {status === 'retrying' && rateLimited && canEdit ? (
          <div className="banner banner-warning" role="status">
            <AlertIcon />
            <p className="banner-text">{statusDetail} Your changes are kept and will be saved automatically.</p>
          </div>
        ) : null}

        {conflict ? (
          <div className="banner banner-warning" role="alert">
            <AlertIcon />
            <div className="banner-text">
              <p className="banner-title">{conflictWho} while you were editing.</p>
              <p>
                Your latest changes are not saved yet. Load latest shows their version and discards your unsaved changes. Keep
                mine saves your version over theirs.
              </p>
              {conflictError ? (
                <p className="field-error" role="alert">
                  {conflictError}
                </p>
              ) : null}
            </div>
            <div className="banner-actions">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => resolveConflict('load')} disabled={conflictBusy}>
                Load latest
              </button>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => resolveConflict('keep')} disabled={conflictBusy}>
                Keep mine
              </button>
            </div>
          </div>
        ) : null}

        {blocked ? (
          <div className="banner banner-error" role="alert">
            <AlertIcon />
            <p className="banner-text">{blocked}</p>
          </div>
        ) : null}
      </div>

      <div className="workspace">
        <div className={`page${canEdit ? '' : ' page-readonly'}`}>
          <EditorContent editor={editor} />
        </div>
      </div>

      {dialog === 'share' ? <ShareDialog doc={meta} currentUser={user} onClose={closeDialog} /> : null}

      {dialog === 'delete' ? (
        <Modal
          title="Delete this document?"
          titleId="delete-title"
          size="sm"
          busy={deleteState.busy}
          onClose={closeDialog}
          footer={
            <>
              <button type="button" className="btn btn-secondary" onClick={closeDialog} disabled={deleteState.busy} data-autofocus>
                Cancel
              </button>
              <button type="button" className="btn btn-danger" onClick={confirmDelete} disabled={deleteState.busy}>
                {deleteState.busy ? 'Deleting...' : 'Delete'}
              </button>
            </>
          }
        >
          <p>
            "{meta.title}" will be deleted for you and for everyone it is shared with. This cannot be undone.
          </p>
          {deleteState.error ? (
            <p className="field-error" role="alert">
              <AlertIcon className="icon-sm" />
              <span>{deleteState.error}</span>
            </p>
          ) : null}
        </Modal>
      ) : null}
    </div>
  );
}
