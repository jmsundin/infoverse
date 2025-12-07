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
        storage_path TEXT,
        is_paid BOOLEAN DEFAULT FALSE
      );
    `);

    // Add is_paid column if not exists
    try {
        await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_paid BOOLEAN DEFAULT FALSE`);
    } catch (e) {
        // Ignore if exists
    }
    
    await query(`
      CREATE TABLE IF NOT EXISTS rate_limits (
        id SERIAL PRIMARY KEY,
        ip VARCHAR(255),
        user_id INTEGER REFERENCES users(id),
        count INTEGER DEFAULT 0,
        window_start TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    // Nodes Table
    await query(`
      CREATE TABLE IF NOT EXISTS nodes (
        id UUID PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        type VARCHAR(50),
        x FLOAT,
        y FLOAT,
        width FLOAT,
        height FLOAT,
        content TEXT,
        messages JSONB,
        link TEXT,
        color VARCHAR(50),
        parent_id TEXT,
        summary TEXT,
        auto_expand_depth INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Edges Table
    await query(`
      CREATE TABLE IF NOT EXISTS edges (
        id UUID PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        source TEXT,
        target TEXT,
        label TEXT,
        parent_id TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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

    // Session table for connect-pg-simple
    await query(`
      CREATE TABLE IF NOT EXISTS "session" (
        "sid" varchar NOT NULL COLLATE "default",
        "sess" json NOT NULL,
        "expire" timestamp(6) NOT NULL
      )
      WITH (OIDS=FALSE);
    `);
    
    // Add primary key if not exists (catch error if it does)
    try {
      await query(`ALTER TABLE "session" ADD CONSTRAINT "session_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE`);
    } catch (e) {
      // Constraint likely already exists
    }
    
    await query(`CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire")`);

    console.log('Database initialized: users, rate_limits & session tables created/verified');
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
