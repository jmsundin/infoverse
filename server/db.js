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
    
    await query(`
      CREATE TABLE IF NOT EXISTS rate_limits (
        id SERIAL PRIMARY KEY,
        ip VARCHAR(255),
        user_id INTEGER REFERENCES users(id),
        count INTEGER DEFAULT 0,
        window_start TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    // Attempt to migrate existing table if it lacks user_id or correct PK
    try {
        await query(`ALTER TABLE rate_limits ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id)`);
        // We catch errors here because dropping constraint might fail if it doesn't exist by that name or other reasons
        // But in a simple setup, this helps transition from IP-PK to ID-PK
        try {
            await query(`ALTER TABLE rate_limits DROP CONSTRAINT IF EXISTS rate_limits_pkey`);
        } catch (e) {
            // Ignore if constraint doesn't exist or name is different
        }
        await query(`ALTER TABLE rate_limits ADD COLUMN IF NOT EXISTS id SERIAL PRIMARY KEY`);
    } catch (e) {
        console.log('Schema migration notice:', e.message);
    }

    console.log('Database initialized: users & rate_limits tables created/verified');
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
