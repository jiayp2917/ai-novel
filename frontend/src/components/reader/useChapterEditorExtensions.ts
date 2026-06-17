/** 构建章节编辑器的 CodeMirror 扩展（批注高亮、搜索标记与交互回调）。 */
import { markdown } from '@codemirror/lang-markdown';
import { Compartment, EditorState, RangeSetBuilder, type Extension } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
  keymap,
} from '@codemirror/view';
import { useMemo } from 'react';
import type { Annotation, SelectionRange } from '../../types';
import { codePointToUtf16Offset, utf16ToCodePointOffset } from '../../utils';

export type ChapterEditorSearch = {
  query: string;
  index: number;
};

export type ChapterEditorContextMenuEvent = {
  x: number;
  y: number;
  selection: SelectionRange | null;
};

export type ChapterEditorCallbacks = {
  onTextChange: (text: string) => void;
  onSelectionChange: (selection: SelectionRange | null) => void;
  onContextMenu: (event: ChapterEditorContextMenuEvent) => void;
};

export type ChapterEditorCompartments = {
  readOnly: Compartment;
  editable: Compartment;
  annotations: Compartment;
  search: Compartment;
};

export type ChapterEditorExtensionInput = {
  editable: boolean;
  search: ChapterEditorSearch;
  annotations: Annotation[];
  selectedAnnotationId: number | null;
  callbacks: ChapterEditorCallbacks;
  compartments: ChapterEditorCompartments;
};

function rangeFromEditorSelection(
  text: string,
  fromUtf16: number,
  toUtf16: number,
): SelectionRange | null {
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

export function buildAnnotationPlugin(
  annotations: Annotation[],
  selectedAnnotationId: number | null,
): Extension {
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
    { decorations: (plugin) => plugin.decorations },
  );
}

export function findSearchMatches(
  text: string,
  searchQuery: string,
): Array<{ from: number; to: number }> {
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

export function buildSearchPlugin(searchQuery: string, searchIndex: number): Extension {
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
            Decoration.mark({
              class:
                index === searchIndex
                  ? 'cm-search-match cm-search-match--active'
                  : 'cm-search-match',
            }),
          );
        });
        return builder.finish();
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}

export function useChapterEditorExtensions(input: ChapterEditorExtensionInput): Extension[] {
  const { editable, search, annotations, selectedAnnotationId, callbacks, compartments } = input;
  const callbacksRef = useMemo(() => ({ current: callbacks }), [
    callbacks.onTextChange,
    callbacks.onSelectionChange,
    callbacks.onContextMenu,
  ]);

  return useMemo<Extension[]>(
    () => [
      markdown(),
      EditorView.lineWrapping,
      compartments.readOnly.of(EditorState.readOnly.of(!editable)),
      compartments.editable.of(EditorView.editable.of(true)),
      keymap.of([]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          callbacksRef.current.onTextChange(update.state.doc.toString());
        }
        if (update.selectionSet) {
          const range = update.state.selection.main;
          callbacksRef.current.onSelectionChange(
            rangeFromEditorSelection(update.state.doc.toString(), range.from, range.to),
          );
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
            selection:
              rangeFromEditorSelection(text, range.from, range.to) ??
              rangeFromVisibleSelection(text),
          });
          return true;
        },
      }),
      compartments.annotations.of(buildAnnotationPlugin(annotations, selectedAnnotationId)),
      compartments.search.of(buildSearchPlugin(search.query, search.index)),
    ],
    [
      editable,
      search.query,
      search.index,
      annotations,
      selectedAnnotationId,
      compartments.readOnly,
      compartments.editable,
      compartments.annotations,
      compartments.search,
    ],
  );
}
