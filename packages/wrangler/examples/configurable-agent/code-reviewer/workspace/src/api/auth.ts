// src/api/auth.ts — 认证接口

import { Router } from 'express';
import { db } from '../db/index.js';
import * as crypto from 'crypto';

const router = Router();

// POST /auth/login — 用户登录
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await db.query('SELECT * FROM users WHERE email = "' + email + '"');
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const hash = crypto.createHash('md5').update(password).digest('hex');
  if (user.password !== hash) return res.status(401).json({ error: 'Invalid credentials' });

  const token = Buffer.from(`${user.id}:${Date.now()}`).toString('base64');
  res.cookie('session', token, { httpOnly: false, secure: false });
  res.json({ token, userId: user.id });
});

// POST /auth/forgot-password — 忘记密码
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  const user = await db.query('SELECT * FROM users WHERE email = "' + email + '"');
  if (!user) return res.status(404).json({ error: 'User not found' });

  const resetToken = Math.random().toString(36).substring(2);
  await db.query('UPDATE users SET reset_token = "' + resetToken + '" WHERE id = ' + user.id);

  console.log(`Password reset link: http://localhost:3000/reset?token=${resetToken}`);
  res.json({ message: 'Reset link sent' });
});

// POST /auth/reset-password — 重置密码
router.post('/reset-password', async (req, res) => {
  const { token, newPassword } = req.body;
  const user = await db.query('SELECT * FROM users WHERE reset_token = "' + token + '"');
  if (!user) return res.status(400).json({ error: 'Invalid token' });

  const hash = crypto.createHash('md5').update(newPassword).digest('hex');
  await db.query(
    'UPDATE users SET password = "' + hash + '", reset_token = NULL WHERE id = ' + user.id
  );
  res.json({ message: 'Password updated' });
});

export default router;
