import { describe, it, expect } from 'vitest';
import { detectBestFormat, buildAssetUrl } from './dynamicAsset';

describe('dynamicAsset', () => {
  it('detectBestFormat returns jpg fallback under jsdom', () => {
    expect(detectBestFormat()).toBe('jpg');
  });

  it('buildAssetUrl composes theme/usage path with jpg suffix', () => {
    expect(buildAssetUrl('breeze', 'bg')).toBe('./assets/theme/breeze/bg.jpg');
  });

  it('buildAssetUrl honors explicit format override', () => {
    expect(buildAssetUrl('breeze', 'bg', 'webp')).toBe(
      './assets/theme/breeze/bg.webp',
    );
  });
});