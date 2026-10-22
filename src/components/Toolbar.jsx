import { useEditorState } from '@tiptap/react';
import { BulletListIcon, NumberedListIcon, RedoIcon, UndoIcon } from './Icons.jsx';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
const MOD = isMac ? 'Cmd' : 'Ctrl';

function ToolButton({ label, shortcut, active, disabled, onClick, children, wide = false }) {
  return (
    <button
      type="button"
      className={`tb-btn${wide ? ' tb-btn-wide' : ''}`}
      aria-label={label}
      title={shortcut ? `${label} (${shortcut})` : label}
      aria-pressed={active === undefined ? undefined : Boolean(active)}
      disabled={disabled}
      // Keep the text selection in the editor when a button is clicked with the mouse.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export default function Toolbar({ editor }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      if (!e) return null;
      return {
        bold: e.isActive('bold'),
        italic: e.isActive('italic'),
        underline: e.isActive('underline'),
        h1: e.isActive('heading', { level: 1 }),
        h2: e.isActive('heading', { level: 2 }),
        h3: e.isActive('heading', { level: 3 }),
        paragraph: e.isActive('paragraph'),
        bulletList: e.isActive('bulletList'),
        orderedList: e.isActive('orderedList'),
        canUndo: e.can().undo(),
        canRedo: e.can().redo(),
      };
    },
  });

  if (!editor || !state) return null;
  const run = (fn) => () => fn(editor.chain().focus()).run();

  return (
    <div className="toolbar" role="toolbar" aria-label="Text formatting">
      <div className="tb-group">
        <ToolButton label="Undo" shortcut={`${MOD}+Z`} disabled={!state.canUndo} onClick={run((c) => c.undo())}>
          <UndoIcon />
        </ToolButton>
        <ToolButton label="Redo" shortcut={`${MOD}+Shift+Z`} disabled={!state.canRedo} onClick={run((c) => c.redo())}>
          <RedoIcon />
        </ToolButton>
      </div>
      <span className="tb-sep" aria-hidden="true" />
      <div className="tb-group">
        <ToolButton label="Normal text" shortcut={`${MOD}+Alt+0`} active={state.paragraph} wide onClick={run((c) => c.setParagraph())}>
          <span className="tb-text">Normal</span>
        </ToolButton>
        <ToolButton label="Heading 1" shortcut={`${MOD}+Alt+1`} active={state.h1} onClick={run((c) => c.toggleHeading({ level: 1 }))}>
          <span className="tb-text">H1</span>
        </ToolButton>
        <ToolButton label="Heading 2" shortcut={`${MOD}+Alt+2`} active={state.h2} onClick={run((c) => c.toggleHeading({ level: 2 }))}>
          <span className="tb-text">H2</span>
        </ToolButton>
        <ToolButton label="Heading 3" shortcut={`${MOD}+Alt+3`} active={state.h3} onClick={run((c) => c.toggleHeading({ level: 3 }))}>
          <span className="tb-text">H3</span>
        </ToolButton>
      </div>
      <span className="tb-sep" aria-hidden="true" />
      <div className="tb-group">
        <ToolButton label="Bold" shortcut={`${MOD}+B`} active={state.bold} onClick={run((c) => c.toggleBold())}>
          <span className="tb-text tb-bold">B</span>
        </ToolButton>
        <ToolButton label="Italic" shortcut={`${MOD}+I`} active={state.italic} onClick={run((c) => c.toggleItalic())}>
          <span className="tb-text tb-italic">I</span>
        </ToolButton>
        <ToolButton label="Underline" shortcut={`${MOD}+U`} active={state.underline} onClick={run((c) => c.toggleUnderline())}>
          <span className="tb-text tb-underline">U</span>
        </ToolButton>
      </div>
      <span className="tb-sep" aria-hidden="true" />
      <div className="tb-group">
        <ToolButton label="Bulleted list" shortcut={`${MOD}+Shift+8`} active={state.bulletList} onClick={run((c) => c.toggleBulletList())}>
          <BulletListIcon />
        </ToolButton>
        <ToolButton label="Numbered list" shortcut={`${MOD}+Shift+7`} active={state.orderedList} onClick={run((c) => c.toggleOrderedList())}>
          <NumberedListIcon />
        </ToolButton>
      </div>
    </div>
  );
}
