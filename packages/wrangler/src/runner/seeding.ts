/**
 * @fileoverview 会话入口状态的播种门面（R2P-107，对齐 Rust
 * wrangler/src/seeding.rs）。
 *
 * daemon 的对话入口（新会话 / resume 续聊 / crew）把消息文本与附件
 * 合成 user 消息 content。这组活是 harness 语义（多模态 wire 形态是
 * 产品契约），收在这里，daemon 不经手内核的状态构造函数。
 */

import type { ImageContent, MultimodalContent, TextContent } from '@agentskillmania/llm-client';

/**
 * 请求附件（多模态输入）的 wire 形态。当前仅支持图片；url 可为
 * `data:` base64 或 `file:<相对路径>` 引用——后者锚定会话目录（图片
 * 先落盘、存档只存引用），发 LLM 请求前由内核物化为内联 base64。
 *
 * 与 Rust 的分歧：http(s) URL 不受支持（TS 侧 pi-ai 适配器仅能发送
 * data URL 形态的图片）——传入即 400，客户端应内联为 data:。
 * `detail` 字段接受但忽略（pi-ai 形态无对应位）。
 */
export interface ChatAttachment {
  kind: 'image';
  url: string;
  detail?: string;
}

const DATA_URL_RE = /^data:([^;,]+);base64,(.+)$/;

/** 附件解析错误 —— 调用方（路由）映射为 400。 */
export class AttachmentParseError extends Error {}

/**
 * 把消息文本 + 附件合成 user 消息 content。
 *
 * 无附件时保持纯文本（wire 形态不变）；有附件时合成多模态 parts：
 * 文本（非空时）在前，图片按序在后。`file:` 引用原样保留（存档只存
 * 引用）；`data:` URL 解析为内联 base64。
 *
 * @throws {AttachmentParseError} 附件形态非法（非 data:/file: 前缀、
 *   data URL 不带 base64 段、空引用路径）
 */
export function buildUserContent(
  message: string,
  attachments: ChatAttachment[]
): MultimodalContent {
  if (attachments.length === 0) return message;

  const parts: (TextContent | ImageContent)[] = [];
  if (message.length > 0) {
    parts.push({ type: 'text', text: message });
  }
  for (const attachment of attachments) {
    parts.push(imagePartFromUrl(attachment));
  }
  return parts;
}

function imagePartFromUrl(attachment: ChatAttachment): ImageContent {
  const { url } = attachment;
  if (url.startsWith('file:')) {
    if (url.length === 'file:'.length) {
      throw new AttachmentParseError("image attachment 'file:' reference has an empty path");
    }
    return { type: 'image', ref: url };
  }
  const dataUrl = DATA_URL_RE.exec(url);
  if (dataUrl) {
    return { type: 'image', data: dataUrl[2], mimeType: dataUrl[1] };
  }
  if (/^https?:\/\//.test(url)) {
    throw new AttachmentParseError(
      'image attachment http(s) URLs are not supported; inline the image as a data: URL'
    );
  }
  throw new AttachmentParseError(
    `image attachment url must be a data: or file: URL (got: ${url.slice(0, 32)})`
  );
}
