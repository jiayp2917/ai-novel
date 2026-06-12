import { describe, expect, it } from 'vitest';
import ts from 'typescript';

const visibleAttributeNames = ['aria-label', 'title', 'placeholder', 'alt'];
const sourceModules = import.meta.glob('../**/*.tsx', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;
const allowedEnglishOnly = new Set([
  'AI',
  'API',
  'JSON',
  'HTTP',
  'SSE',
  'Agnes AI',
  'CodeMirror',
  'Markdown',
  'provider',
  'payload',
  'trace',
  'token',
  'role',
  'provider/model',
  'base_url',
  'api_key_env',
  'max_tokens',
]);

describe('visible frontend copy language', () => {
  it('keeps ordinary user-facing text Chinese-first', () => {
    const violations = Object.entries(sourceModules).flatMap(([path, content]) => visibleCopyViolations(path, content));

    expect(violations).toEqual([]);
  });
});

function visibleCopyViolations(path: string, content: string): string[] {
  if (path.includes('/__tests__/') || path.includes('/test/')) {
    return [];
  }
  const rel = path.replace(/^\.\.\//, '');
  const sourceFile = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const violations: string[] = [];

  visitVisibleNodes(sourceFile, (value, location) => {
    if (isEnglishOnlyUserCopy(value)) {
      violations.push(`${rel}: ${location} "${value}"`);
    }
  });

  return violations;
}

function visitVisibleNodes(node: ts.Node, onVisibleCopy: (value: string, location: string) => void): void {
  if (ts.isJsxText(node)) {
    onVisibleCopy(normalizeVisibleCopy(node.getText()), 'JSX text');
  }

  if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name) && visibleAttributeNames.includes(node.name.text)) {
    const initializer = node.initializer;
    if (initializer && ts.isStringLiteral(initializer)) {
      onVisibleCopy(normalizeVisibleCopy(initializer.text), node.name.text);
    }
    if (
      initializer &&
      ts.isJsxExpression(initializer) &&
      initializer.expression &&
      ts.isNoSubstitutionTemplateLiteral(initializer.expression)
    ) {
      onVisibleCopy(normalizeVisibleCopy(initializer.expression.text), node.name.text);
    }
  }

  ts.forEachChild(node, (child) => visitVisibleNodes(child, onVisibleCopy));
}

function normalizeVisibleCopy(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function isEnglishOnlyUserCopy(value: string): boolean {
  if (!value || /[\u3400-\u9fff]/.test(value)) {
    return false;
  }
  if (!/[A-Za-z]{2,}/.test(value)) {
    return false;
  }
  if (allowedEnglishOnly.has(value.replace(/[：:\s]+$/g, ''))) {
    return false;
  }
  if (/^[-_./\\:A-Za-z0-9{}()[\]\s]+$/.test(value) && /[/\\_.{}()[\]:]/.test(value)) {
    return false;
  }
  return true;
}
