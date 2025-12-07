const { Pool } = require('pg');
require('dotenv').config();

const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;

// Determine SSL setting:
// 1. Explicitly enabled via DB_SSL=true
// 2. Production environment
// 3. Vercel Postgres URL (usually contains 'vercel-storage')
// 4. URL contains sslmode=require
const useSsl = 
  process.env.DB_SSL === 'true' ||
  process.env.NODE_ENV === 'production' || 
  (connectionString && (connectionString.includes('vercel-storage') || connectionString.includes('sslmode=require')));

const pool = new Pool({
  connectionString,
  ssl: useSsl ? { rejectUnauthorized: false } : false
});

const query = (text, params) => pool.query(text, params);

const initDb = async () => {
  if (!connectionString) {
    console.warn('No database connection string provided. Skipping DB initialization.');
    return;
  }
  
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        storage_path TEXT
      );
    `);
    console.log('Database initialized: users table created/verified');
  } catch (err) {
    console.error('Error initializing database:', err);
    // Don't exit process, might be temporary connection issue or valid in local dev without DB
  }
};

module.exports = {
  query,
  initDb,
  pool
};
