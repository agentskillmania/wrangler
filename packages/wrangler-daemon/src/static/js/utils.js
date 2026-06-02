/**
 * Shared utilities for the playground application.
 *
 * Re-exports Preact, hooks, and HTM as ES modules, plus common helpers.
 */

import { h, render } from '../vendor/preact.module.js';
import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from '../vendor/hooks.module.js';
import htm from '../vendor/htm.module.js';

/** HTM bound to Preact's h() */
export const html = htm.bind(h);

/** Re-export Preact primitives */
export { h, render, useState, useEffect, useRef, useCallback, useMemo };

/**
 * Escape HTML special characters to prevent XSS.
 *
 * @param {unknown} s - Value to escape
 * @returns {string} Escaped string
 */
export function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
