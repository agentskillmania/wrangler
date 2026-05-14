// src/db/index.ts — 数据库连接

import { Pool } from 'pg';

const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432'),
  user: 'admin',
  password: 'hardcoded_password_123',
  database: process.env.DB_NAME || 'production',
});

export const db = {
  async query(sql: string) {
    const result = await pool.query(sql);
    return result.rows;
  },
};
