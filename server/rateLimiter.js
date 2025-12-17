const db = require('./db');

// Rate Limit Middleware
const rateLimiter = async (req, res, next) => {
    // 1. Identify User
    const userId = req.isAuthenticated() ? req.user.id : null;

    // Unlimited access for admin/specific user
    if (req.isAuthenticated() && req.user.isAdmin) {
        return next();
    }

    // 2. Identify IP
    // Handling proxies (Vercel, Nginx, etc.)
    const rawIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const ip = Array.isArray(rawIp) ? rawIp[0] : (rawIp ? rawIp.split(',')[0].trim() : 'unknown');
    
    const LIMIT = 10;
    const WINDOW_HOURS = 5;
    const WINDOW_MS = WINDOW_HOURS * 60 * 60 * 1000;

    try {
        let record;
        const now = new Date();

        // Query based on auth status
        if (userId) {
            const result = await db.query('SELECT * FROM rate_limits WHERE user_id = $1', [userId]);
            record = result.rows[0];
        } else {
            const result = await db.query('SELECT * FROM rate_limits WHERE ip = $1 AND user_id IS NULL', [ip]);
            record = result.rows[0];
        }

        if (!record) {
            // New visitor
            if (userId) {
                await db.query('INSERT INTO rate_limits (user_id, ip, count, window_start) VALUES ($1, $2, 1, $3)', [userId, ip, now]);
            } else {
                await db.query('INSERT INTO rate_limits (ip, count, window_start) VALUES ($1, 1, $2)', [ip, now]);
            }
            return next();
        }

        const windowStart = new Date(record.window_start);
        const timeDiff = now - windowStart;

        if (timeDiff > WINDOW_MS) {
            // Window expired, reset
            if (userId) {
                await db.query('UPDATE rate_limits SET count = 1, window_start = $1 WHERE user_id = $2', [now, userId]);
            } else {
                await db.query('UPDATE rate_limits SET count = 1, window_start = $1 WHERE ip = $2 AND user_id IS NULL', [now, ip]);
            }
            return next();
        } else {
            // Within window
            if (record.count < LIMIT) {
                if (userId) {
                    await db.query('UPDATE rate_limits SET count = count + 1 WHERE user_id = $1', [userId]);
                } else {
                    await db.query('UPDATE rate_limits SET count = count + 1 WHERE ip = $1 AND user_id IS NULL', [ip]);
                }
                return next();
            } else {
                // Limit exceeded
                return res.status(429).json({ 
                    message: 'Free limit reached. Please signup or wait for the window to reset.',
                    code: 'LIMIT_REACHED'
                });
            }
        }
    } catch (err) {
        console.error('Rate limit error:', err);
        // Fail open
        next(); 
    }
};

module.exports = rateLimiter;

