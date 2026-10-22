import { useEffect, useRef } from 'react';
import { CloseIcon } from './Icons.jsx';

// Native <dialog> shown with showModal(): the browser traps focus, closes it on Escape and
// makes the rest of the page inert. Clicking the dimmed backdrop also closes it.
export default function Modal({ title, titleId, onClose, children, footer, size = 'md', busy = false }) {
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
      // Put focus on the safest choice (for example Cancel) when the dialog asks for it.
      dialog.querySelector('[data-autofocus]')?.focus();
    }
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  function handleCancel(event) {
    // Escape: let us decide (do not close in the middle of a request).
    event.preventDefault();
    if (!busy) closeRef.current?.();
  }

  function handleClick(event) {
    if (event.target === ref.current && !busy) closeRef.current?.();
  }

  return (
    <dialog ref={ref} className={`modal modal-${size}`} aria-labelledby={titleId} onCancel={handleCancel} onClick={handleClick}>
      <div className="modal-inner">
        <div className="modal-head">
          <h2 id={titleId} className="modal-title">
            {title}
          </h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={() => !busy && onClose?.()}>
            <CloseIcon />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </dialog>
  );
}
