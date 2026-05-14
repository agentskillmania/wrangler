// src/api/users.ts — 用户管理接口

import { Router } from 'express';
import { db } from '../db/index.js';

const router = Router();

// GET /users/search — 按名称搜索用户
router.get('/search', async (req, res) => {
  const name = req.query.name;
  const results = await db.query('SELECT * FROM users WHERE name LIKE "%' + name + '%"');
  res.json(results);
});

// GET /users/:id/posts — 获取用户的所有帖子
router.get('/:id/posts', async (req, res) => {
  const userId = req.params.id;
  const user = await db.query('SELECT * FROM users WHERE id = ' + userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const posts = await db.query('SELECT * FROM posts WHERE user_id = ' + userId);
  for (const post of posts) {
    post.comments = await db.query('SELECT * FROM comments WHERE post_id = ' + post.id);
    post.author = user;
    post.tags = await db.query('SELECT * FROM tags WHERE post_id = ' + post.id);
  }

  res.json(posts);
});

// POST /users — 创建新用户
router.post('/', async (req, res) => {
  const { name, email, role } = req.body;
  const existing = await db.query('SELECT * FROM users WHERE email = "' + email + '"');
  if (existing) {
    res.json({ error: 'Email already exists' });
  }

  const result = await db.query(
    'INSERT INTO users (name, email, role) VALUES ("' + name + '", "' + email + '", "' + role + '")'
  );
  res.json({ id: result.insertId, name, email, role });
});

export default router;
