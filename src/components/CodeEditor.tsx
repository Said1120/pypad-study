import { useEffect, useRef } from 'react'
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { bracketMatching, defaultHighlightStyle, indentUnit, syntaxHighlighting } from '@codemirror/language'
import { python } from '@codemirror/lang-python'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { Compartment, EditorState } from '@codemirror/state'
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from '@codemirror/view'

interface CodeEditorProps {
  value: string
  onChange(value: string): void
  fontSize: number
  readOnly?: boolean
}

const readOnlyExtension = (readOnly: boolean) => [EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]

export function CodeEditor({ value, onChange, fontSize, readOnly = false }: CodeEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const readOnlyCompartment = useRef(new Compartment())
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    if (!hostRef.current) return
    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        drawSelection(),
        dropCursor(),
        EditorState.allowMultipleSelections.of(true),
        readOnlyCompartment.current.of(readOnlyExtension(readOnly)),
        indentUnit.of('    '),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        bracketMatching(),
        closeBrackets(),
        autocompletion(),
        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        python(),
        keymap.of([
          indentWithTab,
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
          ...completionKeymap,
        ]),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({ 'aria-label': 'Python 代码编辑器', spellcheck: 'false' }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChangeRef.current(update.state.doc.toString())
        }),
      ],
    })
    viewRef.current = new EditorView({ state, parent: hostRef.current })
    return () => {
      viewRef.current?.destroy()
      viewRef.current = null
    }
    // The controlled value is synchronized by the next effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const view = viewRef.current
    if (!view || view.state.doc.toString() === value) return
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } })
  }, [value])

  useEffect(() => {
    viewRef.current?.dispatch({ effects: readOnlyCompartment.current.reconfigure(readOnlyExtension(readOnly)) })
  }, [readOnly])

  return <div className="code-editor" ref={hostRef} style={{ '--editor-font-size': `${fontSize}px` } as React.CSSProperties} />
}
