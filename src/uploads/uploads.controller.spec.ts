import { describe, expect, it } from 'vitest';
import { detectImageExtension } from './uploads.controller.js';

describe('detectImageExtension', () => {
  it('recognises real JPEG, PNG and WebP signatures', () => {
    expect(detectImageExtension(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('.jpg');
    expect(
      detectImageExtension(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])),
    ).toBe('.png');
    expect(detectImageExtension(Buffer.from('RIFF0000WEBP', 'ascii'))).toBe('.webp');
  });

  it('rejects content that only claims to be an image', () => {
    expect(detectImageExtension(Buffer.from('<html><script>alert(1)</script>'))).toBeNull();
    expect(detectImageExtension(Buffer.alloc(0))).toBeNull();
  });
});
