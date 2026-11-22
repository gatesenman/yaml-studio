import type { EditorView } from '@codemirror/view'

/**
 * Module-level handle to the live CodeMirror view, so the compact aligned pane
 * (mode B) can mirror the editor's scroll position without prop drilling.
 */
export const editorViewRef: { current: EditorView | null } = { current: null }
