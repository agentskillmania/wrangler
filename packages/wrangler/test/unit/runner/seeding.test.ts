/**
 * @fileoverview 播种门面单测（R2P-107，对齐 Rust wrangler/src/seeding.rs 的
 * build_user_content 契约 + TS 侧分歧点）。
 *
 * - 无附件 → 纯文本 wire 形态不变（字符串恒等）
 * - 有附件 → parts：非空文本在前、图片按序在后
 * - data: URL → 解析为内联 base64 + mime
 * - file: 引用 → 原样保留（存档只存引用，物化在内核 calling-llm）
 * - http(s) → 400（TS 侧 pi-ai 适配器仅发 data URL——与 Rust 的分歧点）
 * - 其他前缀 / 空 file: 引用 → AttachmentParseError
 */

import { describe, it, expect } from 'vitest';

import {
  buildUserContent,
  AttachmentParseError,
  type ChatAttachment,
} from '../../../src/runner/seeding.js';

const image = (url: string): ChatAttachment => ({ kind: 'image', url });

describe('buildUserContent', () => {
  it('keeps plain text wire form when no attachments', () => {
    expect(buildUserContent('hello', [])).toBe('hello');
    expect(buildUserContent('', [])).toBe('');
  });

  it('builds parts: text first, images in order', () => {
    const content = buildUserContent('看这两张图', [
      image('file:a.png'),
      image('data:image/jpeg;base64,QUJD'),
    ]);
    expect(content).toEqual([
      { type: 'text', text: '看这两张图' },
      { type: 'image', ref: 'file:a.png' },
      { type: 'image', data: 'QUJD', mimeType: 'image/jpeg' },
    ]);
  });

  it('pure-image message: no text part, image parts only', () => {
    const content = buildUserContent('', [image('file:a.png')]);
    expect(content).toEqual([{ type: 'image', ref: 'file:a.png' }]);
  });

  it('parses data: URLs into inline base64 + mime', () => {
    const content = buildUserContent('', [image('data:image/png;base64,QUJD')]);
    expect(content).toEqual([{ type: 'image', data: 'QUJD', mimeType: 'image/png' }]);
  });

  it('keeps file: references verbatim (archive stores the ref)', () => {
    const content = buildUserContent('', [image('file:media/img-2.jpg')]);
    expect(content).toEqual([{ type: 'image', ref: 'file:media/img-2.jpg' }]);
  });

  it('rejects http(s) URLs (pi-ai adapter only sends data URLs)', () => {
    expect(() => buildUserContent('', [image('https://example.com/a.png')])).toThrow(
      AttachmentParseError
    );
    expect(() => buildUserContent('', [image('http://example.com/a.png')])).toThrow(
      /not supported/
    );
  });

  it('rejects other prefixes and empty file: refs', () => {
    expect(() => buildUserContent('', [image('/etc/passwd')])).toThrow(AttachmentParseError);
    expect(() => buildUserContent('', [image('file:')])).toThrow(/empty path/);
  });

  it('detail field is accepted and ignored', () => {
    const content = buildUserContent('', [{ kind: 'image', url: 'file:a.png', detail: 'high' }]);
    expect(content).toEqual([{ type: 'image', ref: 'file:a.png' }]);
  });
});
