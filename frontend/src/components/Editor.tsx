import { markdown } from '@codemirror/lang-markdown';
import { Compartment, EditorSelection, EditorState, RangeSetBuilder } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
  keymap,
} from '@codemirror/view';
import { useEffect, useLayoutEffect, useRef } from 'react';
import type { Annotation, ContextMenuState, SelectionRange } from '../types';
import { codePointToUtf16Offset, utf16ToCodePointOffset } from '../utils';

function rangeFromEditorSelection(text: string, fromUtf16: number, toUtf16: number): SelectionRange | null {
  if (toUtf16 <= fromUtf16) {
    return null;
  }
  return {
    fromUtf16,
    toUtf16,
    fromCodePoint: utf16ToCodePointOffset(text, fromUtf16),
    toCodePoint: utf16ToCodePointOffset(text, toUtf16),
    text: text.slice(fromUtf16, toUtf16),
  };
}

function rangeFromVisibleSelection(text: string): SelectionRange | null {
  const quote = document.getSelection()?.toString();
  if (!quote) {
    return null;
  }
  const fromUtf16 = text.indexOf(quote);
  if (fromUtf16 < 0 || text.indexOf(quote, fromUtf16 + quote.length) >= 0) {
    return null;
  }
  return rangeFromEditorSelection(text, fromUtf16, fromUtf16 + quote.length);
}

function buildAnnotationPlugin(annotations: Annotation[], selectedAnnotationId: number | null) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = this.build(view.state.doc.toString());
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = this.build(update.state.doc.toString());
        }
      }

      build(text: string) {
        const builder = new RangeSetBuilder<Decoration>();
        for (const annotation of annotations) {
          const from = codePointToUtf16Offset(text, annotation.range_start);
          const to = codePointToUtf16Offset(text, annotation.range_end);
          if (to <= from || from < 0 || to > text.length) {
            continue;
          }
          const className = [
            'cm-annotation',
            annotation.status === 'needs_relocate' ? 'cm-annotation--relocate' : '',
            annotation.id === selectedAnnotationId ? 'cm-annotation--selected' : '',
          ]
            .filter(Boolean)
            .join(' ');
          builder.add(from, to, Decoration.mark({ class: className }));
        }
        return builder.finish();
      }
    },
    {
      decorations: (plugin) => plugin.decorations,
    },
  );
}

function findSearchMatches(text: string, searchQuery: string): Array<{ from: number; to: number }> {
  const query = searchQuery.trim();
  const matches: Array<{ from: number; to: number }> = [];
  if (!query) {
    return matches;
  }
  let index = text.indexOf(query);
  while (index >= 0) {
    matches.push({ from: index, to: index + query.length });
    index = text.indexOf(query, index + Math.max(query.length, 1));
  }
  return matches;
}

function buildSearchPlugin(searchQuery: string, searchIndex: number) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = this.build(view.state.doc.toString());
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = this.build(update.state.doc.toString());
        }
      }

      build(text: string) {
        const builder = new RangeSetBuilder<Decoration>();
        const matches = findSearchMatches(text, searchQuery);
        matches.forEach((match, index) => {
          builder.add(
            match.from,
            match.to,
            Decoration.mark({ class: index === searchIndex ? 'cm-search-match cm-search-match--active' : 'cm-search-match' }),
          );
        });
        return builder.finish();
      }
    },
    {
      decorations: (plugin) => plugin.decorations,
    },
  );
}

type ChapterEditorProps = {
  content: { text: string } | undefined;
  documentKey: string;
  annotations: Annotation[];
  selectedAnnotationId: number | null;
  searchQuery?: string;
  searchIndex?: number;
  editable?: boolean;
  focusAtEndSignal?: number;
  onSelectionChange: (selection: SelectionRange | null) => void;
  onTextChange?: (text: string) => void;
  onContextMenu?: (menu: ContextMenuState) => void;
};

export function ChapterEditor({
  content,
  documentKey,
  annotations,
  selectedAnnotationId,
  searchQuery = '',
  searchIndex = 0,
  editable = false,
  focusAtEndSignal = 0,
  onSelectionChange,
  onTextChange,
  onContextMenu,
}: ChapterEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const annotationsCompartmentRef = useRef(new Compartment());
  const searchCompartmentRef = useRef(new Compartment());
  const readOnlyCompartmentRef = useRef(new Compartment());
  const editableCompartmentRef = useRef(new Compartment());
  const callbacksRef = useRef({ onSelectionChange, onTextChange, onContextMenu });
  const skippedSearchForFocusSignalRef = useRef(0);

  callbacksRef.current = { onSelectionChange, onTextChange, onContextMenu };

  useLayoutEffect(() => {
    if (!hostRef.current || !content) {
      return undefined;
    }

    const state = EditorState.create({
      doc: content.text,
      extensions: [
        markdown(),
        EditorView.lineWrapping,
        readOnlyCompartmentRef.current.of(EditorState.readOnly.of(!editable)),
        editableCompartmentRef.current.of(EditorView.editable.of(true)),
        keymap.of([]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            callbacksRef.current.onTextChange?.(update.state.doc.toString());
          }
          if (update.selectionSet) {
            const range = update.state.selection.main;
            callbacksRef.current.onSelectionChange(rangeFromEditorSelection(update.state.doc.toString(), range.from, range.to));
          }
        }),
        EditorView.domEventHandlers({
          contextmenu: (event, view) => {
            const handler = callbacksRef.current.onContextMenu;
            if (!handler) {
              return false;
            }
            event.preventDefault();
            const range = view.state.selection.main;
            const text = view.state.doc.toString();
            handler({
              x: event.clientX,
              y: event.clientY,
              selection: rangeFromEditorSelection(text, range.from, range.to) ?? rangeFromVisibleSelection(text),
            });
            return true;
          },
        }),
        annotationsCompartmentRef.current.of(buildAnnotationPlugin(annotations, selectedAnnotationId)),
        searchCompartmentRef.current.of(buildSearchPlugin(searchQuery, searchIndex)),
      ],
    });

    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [documentKey]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }
    if (content && view.state.doc.toString() !== content.text) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: content.text },
      });
    }
    view.dispatch({
      effects: [
        annotationsCompartmentRef.current.reconfigure(buildAnnotationPlugin(annotations, selectedAnnotationId)),
        searchCompartmentRef.current.reconfigure(buildSearchPlugin(searchQuery, searchIndex)),
        readOnlyCompartmentRef.current.reconfigure(EditorState.readOnly.of(!editable)),
        editableCompartmentRef.current.reconfigure(EditorView.editable.of(true)),
      ],
    });
  }, [annotations, content, editable, selectedAnnotationId, searchQuery, searchIndex]);

  useEffect(() => {
    if (!viewRef.current || !searchQuery.trim()) {
      return;
    }
    if (editable && focusAtEndSignal > 0 && skippedSearchForFocusSignalRef.current !== focusAtEndSignal) {
      skippedSearchForFocusSignalRef.current = focusAtEndSignal;
      return;
    }
    const view = viewRef.current;
    const matches = findSearchMatches(view.state.doc.toString(), searchQuery);
    if (matches.length === 0) {
      return;
    }
    const match = matches[((searchIndex % matches.length) + matches.length) % matches.length];
    view.dispatch({
      selection: EditorSelection.range(match.from, match.to),
      effects: EditorView.scrollIntoView(match.from, { y: 'center' }),
    });
  }, [documentKey, editable, focusAtEndSignal, searchQuery, searchIndex]);

  useEffect(() => {
    if (!content || selectedAnnotationId === null || !viewRef.current) {
      return;
    }
    const annotation = annotations.find((item) => item.id === selectedAnnotationId);
    if (!annotation || annotation.status === 'needs_relocate') {
      return;
    }
    const from = codePointToUtf16Offset(content.text, annotation.range_start);
    viewRef.current.dispatch({
      selection: EditorSelection.range(from, codePointToUtf16Offset(content.text, annotation.range_end)),
      effects: EditorView.scrollIntoView(from, { y: 'center' }),
    });
  }, [annotations, content, selectedAnnotationId]);

  useLayoutEffect(() => {
    if (!editable || !viewRef.current || focusAtEndSignal <= 0) {
      return;
    }
    const view = viewRef.current;
    const frame = window.requestAnimationFrame(() => {
      const end = view.state.doc.length;
      view.focus();
      view.dispatch({
        selection: EditorSelection.cursor(end),
        effects: EditorView.scrollIntoView(end, { y: 'end' }),
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [editable, focusAtEndSignal]);

  if (!content) {
    return (
      <div className="empty-reader">
        <strong>未选择文档</strong>
        <p>先扫描素材库，再从左侧选择设定、章纲或正文。</p>
      </div>
    );
  }

  return <div className="editor-host" ref={hostRef} />;
}
