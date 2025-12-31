require('dotenv').config();
const express = require('express');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const session = require('express-session');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const yaml = require('js-yaml');
const { exec } = require('child_process');
const db = require('./db');
const { generateEmbedding } = require('./gemini-ai');

const app = express();
const PORT = process.env.PORT || 3001;

// Stripe Init
let stripe;
try {
    if (process.env.STRIPE_SECRET_KEY) {
        stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    } else {
        console.warn('Warning: STRIPE_SECRET_KEY not found. Billing features will be disabled.');
    }
} catch (e) {
    console.error('Failed to initialize Stripe:', e.message);
}

// Webhook Endpoint - Must be defined BEFORE express.json()
app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    if (!stripe) {
        return res.status(503).send('Billing service unavailable');
    }
    const sig = req.headers['stripe-signature'];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    } catch (err) {
        console.error(`Webhook Error: ${err.message}`);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle the event
    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        
        // Fulfill the purchase...
        if (session.client_reference_id) {
             try {
                await db.query(
                    'UPDATE users SET is_paid = TRUE, stripe_customer_id = $1, stripe_subscription_id = $2 WHERE id = $3', 
                    [session.customer, session.subscription, session.client_reference_id]
                );
                console.log(`User ${session.client_reference_id} upgraded to paid.`);
             } catch (e) {
                console.error('Error updating user payment status:', e);
             }
        }
    }

    // Return a 200 response to acknowledge receipt of the event
    res.send();
});

// Cleanup Task
const runCleanupTask = async () => {
    try {
        const result = await db.query(`
            DELETE FROM deleted_items 
            WHERE deleted_at < NOW() - INTERVAL '30 days'
        `);
        if (result.rowCount > 0) {
            console.log(`Cleanup complete: Removed ${result.rowCount} old items from trash.`);
        }
    } catch (e) {
        // Ignore table not found if init hasn't finished (though we wait for init)
        // console.error('Cleanup task failed:', e);
    }
};

// Initialize Database
db.initDb().then(() => {
    runCleanupTask();
    // Run daily
    setInterval(runCleanupTask, 24 * 60 * 60 * 1000);
}).catch(err => console.error('DB Init Failed:', err));

// Passport Config
passport.use(new LocalStrategy(async (username, password, done) => {
    try {
        const result = await db.query('SELECT * FROM users WHERE username = $1', [username]);
        if (!result || !result.rows) {
             console.error('Database query failed or returned no rows property');
             return done(null, false, { message: 'System error' });
        }
        const user = result.rows[0];

        if (!user) {
            return done(null, false, { message: 'Incorrect username.' });
        }
        
        const isMatch = await bcrypt.compare(password, user.password);
        if (isMatch) {
            user.storagePath = user.storage_path;
            user.isAdmin = user.is_admin;
            user.isPaid = user.is_paid || user.is_admin;
            return done(null, user);
        } else {
            return done(null, false, { message: 'Incorrect password.' });
        }
    } catch (err) {
        console.error('Passport Local Strategy Error:', err);
        return done(err);
    }
}));

passport.serializeUser((user, done) => {
    done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
    try {
        const result = await db.query('SELECT * FROM users WHERE id = $1', [id]);
        const user = result.rows[0];
        if (user) {
            user.storagePath = user.storage_path;
            user.isAdmin = user.is_admin;
            user.isPaid = user.is_paid || user.is_admin;
            done(null, user);
        } else {
            // User not found in DB (maybe deleted), treat as logged out
            done(null, false);
        }
    } catch (err) {
        console.error('Deserialize error (possibly DB connection):', err);
        // If DB is down, we can't authenticate, so treat as logged out or error.
        // Returning done(null, false) clears the session which is safer than crashing.
        done(null, false);
    }
});

// Middleware
const allowedOrigins = [
  'http://localhost:3000',
  'https://infoverse.ai',
  'https://www.infoverse.ai',
  'https://app.infoverse.ai'
];

if (process.env.CORS_ORIGIN) {
    // Add env var origins, trimming whitespace
    const envOrigins = process.env.CORS_ORIGIN.split(',').map(o => o.trim());
    allowedOrigins.push(...envOrigins);
}

// Helper to check if origin is allowed
const isOriginAllowed = (origin) => {
    if (!origin) return true;
    if (allowedOrigins.indexOf(origin) !== -1 || allowedOrigins.includes('*')) return true;
    
    // Allow local network IPs for development
    // Matches http://10.x.x.x, http://192.168.x.x, http://172.16-31.x.x
    const localIpRegex = /^http:\/\/(localhost|127\.0\.0\.1|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3})(:\d+)?$/;
    if (localIpRegex.test(origin)) return true;

    return false;
};

app.use(cors({
    origin: (origin, callback) => {
        if (isOriginAllowed(origin)) {
            callback(null, true);
        } else {
            console.log('Blocked by CORS:', origin);
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// Handle OPTIONS preflight for all routes
app.options('*', cors({
    origin: (origin, callback) => {
        if (isOriginAllowed(origin)) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// Fallback: Manually handle OPTIONS if middleware fails/skipped (Vercel specific)
app.use((req, res, next) => {
  if (req.method === 'OPTIONS') {
    const origin = req.headers.origin;
    if (isOriginAllowed(origin)) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.header('Access-Control-Allow-Credentials', 'true');
      return res.sendStatus(200);
    }
  }
  next();
});

app.use(express.json({ limit: '50mb' })); // Increase limit for large updates
app.use(express.urlencoded({ extended: false }));

// Trust Proxy for Vercel/Production
app.set('trust proxy', 1);

const PgSession = require('connect-pg-simple')(session);

app.use(session({
    store: new PgSession({
        pool: db.pool,
        tableName: 'session',
        createTableIfMissing: true
    }),
    secret: process.env.SESSION_SECRET || 'infoverse-secret-key', // In production, use env var
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: process.env.NODE_ENV === 'production', // Set true if using https
        httpOnly: true,
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax', // 'none' for cross-site (needs secure: true), 'lax' for local
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        domain: process.env.COOKIE_DOMAIN || undefined // e.g. '.infoverse.ai' to share across subdomains
    } 
}));
app.use(passport.initialize());
app.use(passport.session());

// Gemini Routes
app.use('/api/gemini', require('./geminiRoutes'));
// Hugging Face Routes
app.use('/api/huggingface', require('./huggingfaceRoutes'));

// Helper to ensure directory exists
const ensureDir = (dirPath) => {
    if (dirPath && typeof dirPath === 'string' && !fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
};

// Helper to open directory picker
const openDirectoryPicker = (res) => {
    // Detect OS
    const platform = process.platform;
    
    if (platform === 'linux') {
        // Try zenity first, then kdialog
        exec('zenity --file-selection --directory', (error, stdout, stderr) => {
            if (error) {
                // Exit code 1 usually means user cancelled
                if (error.code === 1) {
                    return res.json({ path: null, cancelled: true });
                }
                
                // Fallback to kdialog if zenity failed (likely not installed or other error)
                exec('kdialog --getexistingdirectory', (kError, kStdout, kStderr) => {
                    if (kError) {
                        if (kError.code === 1) {
                            return res.json({ path: null, cancelled: true });
                        }
                        console.error('Picker failed:', kError);
                        return res.status(500).json({ 
                            message: 'Could not open directory picker. Please install "zenity" or "kdialog" on your system.',
                            code: 'MISSING_TOOL'
                        });
                    }
                    res.json({ path: kStdout.trim() });
                });
                return;
            }
            res.json({ path: stdout.trim() });
        });
    } else if (platform === 'darwin') {
        // macOS via AppleScript
        const script = 'tell application "System Events" to return POSIX path of (choose folder)';
        exec(`osascript -e '${script}'`, (error, stdout, stderr) => {
            if (error) {
                // User cancelled usually throws an error in AppleScript "User canceled."
                if (stderr.includes('User canceled')) {
                    return res.json({ path: null, cancelled: true });
                }
                return res.status(500).json({ message: 'Picker failed' });
            }
            res.json({ path: stdout.trim() });
        });
    } else if (platform === 'win32') {
        // Windows via PowerShell
        const psScript = `
            Add-Type -AssemblyName System.Windows.Forms
            $folder = New-Object System.Windows.Forms.FolderBrowserDialog
            $result = $folder.ShowDialog()
            if ($result -eq 'OK') {
                $folder.SelectedPath
            } else {
                Write-Host "CANCELLED"
            }
        `;
        exec(`powershell -command "${psScript}"`, (error, stdout, stderr) => {
            if (error) return res.status(500).json({ message: 'Picker failed' });
            const result = stdout.trim();
            if (result === 'CANCELLED') {
                return res.json({ path: null, cancelled: true });
            }
            res.json({ path: result });
        });
    } else {
        res.status(500).json({ message: 'Unsupported platform' });
    }
};

// Routes
app.post('/api/auth/signup', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ message: 'Username and password required' });
    }

    try {
        // Check if user exists
        const userCheck = await db.query('SELECT * FROM users WHERE username = $1', [username]);
        if (userCheck.rows.length > 0) {
            return res.status(409).json({ message: 'Username already exists' });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Insert user
        const result = await db.query(
            'INSERT INTO users (username, password, storage_path) VALUES ($1, $2, $3) RETURNING *',
            [username, hashedPassword, '']
        );
        
        const newUser = result.rows[0];
        newUser.storagePath = newUser.storage_path;
        
        // Auto login after signup
        req.login(newUser, (err) => {
            if (err) return res.status(500).json({ message: 'Login failed after signup' });
            // New users are not admins by default
            return res.json({ user: { id: newUser.id.toString(), username: newUser.username, email: newUser.email, storagePath: newUser.storagePath, isPaid: newUser.is_paid, isAdmin: false } });
        });

    } catch (err) {
        console.error('Signup error:', err);
        res.status(500).json({ message: 'Error creating user' });
    }
});

app.get('/api/system/pick-path', (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: 'Unauthorized' });
    openDirectoryPicker(res);
});

app.post('/api/user/settings', async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: 'Unauthorized' });

    const { storagePath } = req.body;
    
    try {
        if (storagePath) {
            ensureDir(storagePath);
        }
        
        const result = await db.query(
            'UPDATE users SET storage_path = $1 WHERE id = $2 RETURNING *',
            [storagePath, req.user.id]
        );
        
        const updatedUser = result.rows[0];
        updatedUser.storagePath = updatedUser.storage_path;
        
        // Update session user
        req.login(updatedUser, (err) => {
            if (err) return res.status(500).json({ message: 'Failed to update session' });
            res.json({ user: { id: updatedUser.id.toString(), username: updatedUser.username, email: updatedUser.email, storagePath: updatedUser.storagePath, isPaid: updatedUser.is_paid || updatedUser.is_admin, isAdmin: updatedUser.is_admin } });
        });

    } catch (err) {
        console.error('Settings update failed:', err);
        return res.status(400).json({ message: 'Invalid storage path or permission denied' });
    }
});

app.post('/api/auth/login', (req, res, next) => {
    passport.authenticate('local', (err, user, info) => {
        if (err) return next(err);
        if (!user) return res.status(401).json({ message: info.message });
        req.login(user, (err) => {
            if (err) return next(err);
            return res.json({ user: { id: user.id.toString(), username: user.username, email: user.email, storagePath: user.storagePath, isPaid: user.isPaid, isAdmin: user.isAdmin } });
        });
    })(req, res, next);
});

app.post('/api/auth/logout', (req, res) => {
    req.logout((err) => {
        if (err) return res.status(500).json({ message: 'Logout failed' });
        res.json({ message: 'Logged out' });
    });
});

// Profile Update Endpoint
app.put('/api/user/profile', async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: 'Unauthorized' });

    const { username, email, currentPassword, newPassword } = req.body;
    
    if (!currentPassword) {
        return res.status(400).json({ message: 'Current password is required' });
    }

    try {
        // 1. Verify current password
        const userResult = await db.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
        const user = userResult.rows[0];
        
        const isMatch = await bcrypt.compare(currentPassword, user.password);
        if (!isMatch) {
            return res.status(403).json({ message: 'Incorrect password' });
        }

        // 2. Prepare updates
        let updateQuery = 'UPDATE users SET ';
        const values = [];
        let paramCount = 1;

        if (username && username !== user.username) {
            // Check availability
            const check = await db.query('SELECT 1 FROM users WHERE username = $1 AND id != $2', [username, req.user.id]);
            if (check.rows.length > 0) return res.status(409).json({ message: 'Username taken' });
            
            updateQuery += `username = $${paramCount}, `;
            values.push(username);
            paramCount++;
        }

        if (email && email !== user.email) {
             // Check availability
            const check = await db.query('SELECT 1 FROM users WHERE email = $1 AND id != $2', [email, req.user.id]);
            if (check.rows.length > 0) return res.status(409).json({ message: 'Email taken' });

            updateQuery += `email = $${paramCount}, `;
            values.push(email);
            paramCount++;
        }

        if (newPassword) {
            const hashedPassword = await bcrypt.hash(newPassword, 10);
            updateQuery += `password = $${paramCount}, `;
            values.push(hashedPassword);
            paramCount++;
        }

        // If nothing to update
        if (values.length === 0) {
            return res.json({ user: { username: user.username, email: user.email, isPaid: user.is_paid } });
        }

        // Finalize query
        updateQuery = updateQuery.slice(0, -2); // Remove trailing comma
        updateQuery += ` WHERE id = $${paramCount} RETURNING id, username, email, is_paid, storage_path, is_admin`;
        values.push(req.user.id);

        const result = await db.query(updateQuery, values);
        const updatedUser = result.rows[0];

        // Update session
        req.login(updatedUser, (err) => {
            if (err) console.error('Session update error', err);
            // We don't fail the request if session update fails, just log it. 
            // Client will refresh or re-auth if needed.
            return res.json({ 
                message: 'Profile updated',
                user: { 
                    id: updatedUser.id.toString(), 
                    username: updatedUser.username, 
                    email: updatedUser.email,
                    isPaid: updatedUser.is_paid || updatedUser.is_admin,
                    isAdmin: updatedUser.is_admin,
                    storagePath: updatedUser.storage_path
                } 
            });
        });

    } catch (e) {
        console.error('Profile update error:', e);
        res.status(500).json({ message: 'Error updating profile' });
    }
});

app.get('/api/auth/check', (req, res) => {
    if (req.isAuthenticated()) {
        res.json({ 
            isAuthenticated: true, 
            user: { 
                id: req.user.id.toString(), 
                username: req.user.username, 
                email: req.user.email, // Include email in check
                storagePath: req.user.storagePath, 
                isPaid: req.user.isPaid,
                isAdmin: req.user.isAdmin
            } 
        });
    } else {
        res.json({ isAuthenticated: false });
    }
});

// --- Graph Storage API ---

// Helper to parse Markdown Node
const parseMarkdownNode = (filePath) => {
    const fileContent = fs.readFileSync(filePath, 'utf8');
    
    // Simple split for frontmatter
    const parts = fileContent.split(/^---$/m);
    // parts[0] is empty (before first ---), parts[1] is frontmatter, parts[2] is content
    
    if (parts.length < 3) {
        // Fallback or invalid format
        return null;
    }
    
    try {
        const metadata = yaml.load(parts[1]);
        const content = parts.slice(2).join('---').trim(); // Rejoin rest in case content has ---
        
        return {
            ...metadata,
            content: metadata.content || content // Prefer metadata content if exists, else body
        };
    } catch (e) {
        console.error('Error parsing node:', filePath, e);
        return null;
    }
};

app.get('/api/graph', async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: 'Unauthorized' });

    // Cloud Storage Mode (Default for everyone now, limited for free)
    // We only fallback to local if explicitly requested or legacy?
    // User requirement says: "automatically store up to 100 nodes in the cloud database"
    // So we prefer Cloud unless user specifically set a storagePath for local (legacy/expert)
    
    // Check if user has explicit local path set AND not paid (maybe they prefer local?)
    // But request implies we want to move to cloud-first.
    // Let's assume Cloud is primary if no local path, OR if paid.
    // Actually, let's make Cloud available to everyone.
    // If they have a local path, maybe we serve that? 
    // Complexity: User might have data in both.
    // Simplified: Authenticated users use Cloud. Local file system picker is for "Export/Import" or "Local Mode" (client-side only?)
    // The previous code had "Legacy Local-on-Server Mode". We should probably deprecate or keep as fallback.
    
    // Strategy: Spatial query if viewport provided, otherwise load all (or limit).
    try {
        const { minX, minY, maxX, maxY } = req.query;
        let nodesResult;
        let edgesResult;

        if (minX && minY && maxX && maxY) {
            // Spatial Query
            const query = `
                SELECT * FROM nodes 
                WHERE user_id = $1 
                AND geom && ST_MakeEnvelope($2, $3, $4, $5)
                LIMIT 2000;
            `;
            nodesResult = await db.query(query, [
                req.user.id, 
                parseFloat(minX), 
                parseFloat(minY), 
                parseFloat(maxX), 
                parseFloat(maxY)
            ]);

            if (nodesResult.rows.length > 0) {
                const nodeIds = nodesResult.rows.map(n => n.id);
                const edgesQuery = `
                    SELECT * FROM edges 
                    WHERE user_id = $1 
                    AND (source = ANY($2) OR target = ANY($2))
                `;
                edgesResult = await db.query(edgesQuery, [req.user.id, nodeIds]);
            } else {
                edgesResult = { rows: [] };
            }
        } else {
            // Load All
            nodesResult = await db.query('SELECT * FROM nodes WHERE user_id = $1', [req.user.id]);
            edgesResult = await db.query('SELECT * FROM edges WHERE user_id = $1', [req.user.id]);
        }
        
        // Always return array even if empty
        const nodes = nodesResult.rows.map(n => ({
            id: n.id,
            type: n.type,
            x: n.x,
            y: n.y,
            width: n.width,
            height: n.height,
            content: n.content,
            messages: n.messages,
            link: n.link,
            color: n.color,
            parentId: n.parent_id,
            summary: n.summary,
            autoExpandDepth: n.auto_expand_depth,
            aliases: n.aliases
        }));

        const edges = edgesResult.rows.map(e => ({
            id: e.id,
            source: e.source,
            target: e.target,
            label: e.label,
            parentId: e.parent_id
        }));

        return res.json({ nodes, edges });

    } catch (e) {
        console.error('Error fetching cloud graph:', e);
        // Fallthrough to local check?
    }
    
    // Legacy Local-on-Server Mode (Self-hosted)
    const { storagePath } = req.user;
    if (storagePath && fs.existsSync(storagePath)) {
        try {
            const files = fs.readdirSync(storagePath);
            const nodes = [];
            let edges = [];

            files.forEach(file => {
                const fullPath = path.join(storagePath, file);
                if (file === '_edges.json') {
                    try {
                        const edgesData = fs.readFileSync(fullPath, 'utf8');
                        edges = JSON.parse(edgesData);
                    } catch (e) {
                        console.error('Error reading edges:', e);
                    }
                } else if (file.endsWith('.md')) {
                    const node = parseMarkdownNode(fullPath);
                    if (node) nodes.push(node);
                }
            });

            return res.json({ nodes, edges });
        } catch (e) {
            console.error('Error reading graph:', e);
        }
    }

    // Default empty
    res.json({ nodes: [], edges: [] });
});

// Format: YYYY-MM-DD-HH-mm-ss-SSS
const getTimestamp = () => {
    const now = new Date();
    const pad = (n, width = 2) => n.toString().padStart(width, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}-${pad(now.getMilliseconds(), 3)}`;
};

// Helper to sanitize filenames
const sanitizeFilename = (name) => {
    return name.replace(/[^a-z0-9\-_]/gi, '_').replace(/_{2,}/g, '_').substring(0, 50);
};

app.post('/api/nodes', async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: 'Unauthorized' });
    
    const node = req.body;
    if (!node || !node.id) return res.status(400).json({ message: 'Invalid node data' });

    // Cloud Storage for All Authenticated Users
    // Logic: 
    // - Paid: Unlimited
    // - Free: 100 Nodes Limit
    
    try {
        // If user is free, check usage first
        if (!req.user.isPaid) {
            const countResult = await db.query('SELECT COUNT(*) FROM nodes WHERE user_id = $1', [req.user.id]);
            const count = parseInt(countResult.rows[0].count, 10);
            
            // Check if user is updating an existing node or creating a new one
            // We can check if ID exists, or rely on client intent. 
            // For safety, let's check if the node exists to allow updates even at limit
            const existsResult = await db.query('SELECT 1 FROM nodes WHERE id = $1 AND user_id = $2', [node.id, req.user.id]);
            const exists = existsResult.rows.length > 0;

            if (!exists && count >= 100) {
                return res.status(403).json({ 
                    message: 'Free storage limit reached (100 nodes). Upgrade to save more.',
                    code: 'STORAGE_LIMIT'
                });
            }
        }

        // Generate Embedding
        // Combine content, aliases, and summary for rich semantic representation
        const aliases = node.aliases || [];
        const embeddingText = [
            node.content,
            aliases.join(' '),
            node.summary
        ].filter(Boolean).join(' ');

        let embedding = null;
        if (embeddingText) {
            embedding = await generateEmbedding(embeddingText);
        }

        // Upsert node
        const query = `
            INSERT INTO nodes (id, user_id, type, x, y, width, height, content, messages, link, color, parent_id, summary, auto_expand_depth, aliases, embedding, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW())
            ON CONFLICT (id) DO UPDATE SET
            type = EXCLUDED.type,
            x = EXCLUDED.x,
            y = EXCLUDED.y,
            width = EXCLUDED.width,
            height = EXCLUDED.height,
            content = EXCLUDED.content,
            messages = EXCLUDED.messages,
            link = EXCLUDED.link,
            color = EXCLUDED.color,
            parent_id = EXCLUDED.parent_id,
            summary = EXCLUDED.summary,
            auto_expand_depth = EXCLUDED.auto_expand_depth,
            aliases = EXCLUDED.aliases,
            embedding = EXCLUDED.embedding,
            updated_at = NOW();
        `;
        const values = [
            node.id, 
            req.user.id, 
            node.type, 
            node.x, 
            node.y, 
            node.width, 
            node.height, 
            node.content, 
            JSON.stringify(node.messages || []), 
            node.link, 
            node.color, 
            node.parentId, 
            node.summary, 
            node.autoExpandDepth,
            JSON.stringify(node.aliases || []),
            embedding ? JSON.stringify(embedding) : null
        ];
        
        await db.query(query, values);
        
        // Return current count so client can show notifications
        let currentCount = 0;
        if (!req.user.isPaid) {
             const countResult = await db.query('SELECT COUNT(*) FROM nodes WHERE user_id = $1', [req.user.id]);
             currentCount = parseInt(countResult.rows[0].count, 10);
        }
        
        return res.json({ success: true, count: currentCount });
        
    } catch (e) {
        console.error('Error saving node to cloud:', e);
        return res.status(500).json({ message: 'Error saving node' });
    }
});

app.post('/api/nodes/batch', async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: 'Unauthorized' });

    const nodes = req.body;
    if (!Array.isArray(nodes)) {
        return res.status(400).json({ message: 'Nodes must be an array' });
    }

    if (nodes.length > 2000) {
        return res.status(400).json({ message: 'Too many nodes in one request' });
    }

    try {
        for (const node of nodes) {
            if (!node || !node.id) continue;

            const skipEmbedding = !!node.skipEmbedding;

            let embedding = null;
            if (!skipEmbedding) {
                // Generate Embedding only when requested
                const aliases = node.aliases || [];
                const embeddingText = [
                    node.content,
                    aliases.join(' '),
                    node.summary
                ].filter(Boolean).join(' ');

                if (embeddingText) {
                    embedding = await generateEmbedding(embeddingText);
                }
            }

            const query = `
                INSERT INTO nodes (id, user_id, type, x, y, width, height, content, messages, link, color, parent_id, summary, auto_expand_depth, aliases, embedding, updated_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW())
                ON CONFLICT (id) DO UPDATE SET
                type = EXCLUDED.type,
                x = EXCLUDED.x,
                y = EXCLUDED.y,
                width = EXCLUDED.width,
                height = EXCLUDED.height,
                content = EXCLUDED.content,
                messages = EXCLUDED.messages,
                link = EXCLUDED.link,
                color = EXCLUDED.color,
                parent_id = EXCLUDED.parent_id,
                summary = EXCLUDED.summary,
                auto_expand_depth = EXCLUDED.auto_expand_depth,
                aliases = EXCLUDED.aliases,
                embedding = COALESCE(EXCLUDED.embedding, nodes.embedding),
                updated_at = NOW();
            `;

            const values = [
                node.id,
                req.user.id,
                node.type,
                node.x,
                node.y,
                node.width,
                node.height,
                node.content,
                JSON.stringify(node.messages || []),
                node.link,
                node.color,
                node.parentId,
                node.summary,
                node.autoExpandDepth,
                JSON.stringify(node.aliases || []),
                embedding ? JSON.stringify(embedding) : null
            ];

            await db.query(query, values);
        }

        return res.json({ success: true });
    } catch (e) {
        console.error('Error saving nodes batch:', e);
        return res.status(500).json({ message: 'Error saving nodes batch' });
    }
});

app.delete('/api/nodes/:id', async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: 'Unauthorized' });
    
    const nodeId = req.params.id;

    // Cloud Soft Delete (Move to deleted_items)
    try {
        // 1. Fetch Node
        const nodeResult = await db.query('SELECT * FROM nodes WHERE id = $1 AND user_id = $2', [nodeId, req.user.id]);
        
        if (nodeResult.rows.length > 0) {
            const node = nodeResult.rows[0];
            
            // 2. Archive Node
            await db.query(
                'INSERT INTO deleted_items (user_id, original_id, item_type, content) VALUES ($1, $2, $3, $4)',
                [req.user.id, nodeId, 'node', JSON.stringify(node)]
            );

            // 3. Archive & Delete Connected Edges
            const edgesResult = await db.query('SELECT * FROM edges WHERE (source = $1 OR target = $1) AND user_id = $2', [nodeId, req.user.id]);
            for (const edge of edgesResult.rows) {
                 await db.query(
                    'INSERT INTO deleted_items (user_id, original_id, item_type, content) VALUES ($1, $2, $3, $4)',
                    [req.user.id, edge.id, 'edge', JSON.stringify(edge)]
                );
            }
            await db.query('DELETE FROM edges WHERE (source = $1 OR target = $1) AND user_id = $2', [nodeId, req.user.id]);

            // 4. Delete Node
            await db.query('DELETE FROM nodes WHERE id = $1 AND user_id = $2', [nodeId, req.user.id]);
            
            return res.json({ success: true });
        }
    } catch (e) {
        console.error('Error deleting cloud node:', e);
        // Continue to check local
    }
    
    const { storagePath } = req.user;
    
    if (storagePath && typeof storagePath === 'string') {
        try {
            // We need to find the file by ID now since the name is dynamic
            const files = fs.readdirSync(storagePath);
            let deleted = false;
            
            for (const file of files) {
                if (!file.endsWith('.md')) continue;
                const fullPath = path.join(storagePath, file);
                try {
                    const content = fs.readFileSync(fullPath, 'utf8');
                    if (content.includes(`id: "${nodeId}"`) || content.includes(`id: ${nodeId}`)) {
                        fs.unlinkSync(fullPath);
                        deleted = true;
                        break;
                    }
                } catch (err) { continue; }
            }
            
            if (deleted) {
                return res.json({ success: true });
            }
        } catch (e) {
            console.error('Error deleting node:', e);
        }
    }
    
    return res.json({ success: true, message: 'Node not found or already deleted' });
});

app.post('/api/edges', async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: 'Unauthorized' });
    
    const edges = req.body;
    if (!Array.isArray(edges)) return res.status(400).json({ message: 'Edges must be an array' });

    // Cloud Save (Default)
    try {
        // Transaction-like replacement strategy:
        // Since we receive the FULL list of edges usually, we might want to sync carefully.
        // But simple approach: Delete all for user (or sync efficiently) and re-insert?
        // "Sync" is safer.
        // Let's iterate and Upsert.
        
        // Note: This can be slow if many edges. Better to do bulk insert.
        // For MVP, loop is fine.
        
        for (const edge of edges) {
            const query = `
                INSERT INTO edges (id, user_id, source, target, label, parent_id, created_at)
                VALUES ($1, $2, $3, $4, $5, $6, NOW())
                ON CONFLICT (id) DO UPDATE SET
                source = EXCLUDED.source,
                target = EXCLUDED.target,
                label = EXCLUDED.label,
                parent_id = EXCLUDED.parent_id;
            `;
            const values = [edge.id, req.user.id, edge.source, edge.target, edge.label, edge.parentId];
            await db.query(query, values);
        }
        
        // Also save to local if configured (Sync both? Or just fallback?)
        // Let's sync to local if path exists as backup/legacy support
        const { storagePath } = req.user;
        if (storagePath && typeof storagePath === 'string') {
            try {
                ensureDir(storagePath);
                const filePath = path.join(storagePath, '_edges.json');
                fs.writeFileSync(filePath, JSON.stringify(edges, null, 2));
            } catch (e) {
                // Ignore local save error if cloud succeeded
            }
        }

        return res.json({ success: true });
    } catch (e) {
        console.error('Error saving cloud edges:', e);
        return res.status(500).json({ message: 'Error saving edges' });
    }
});

// Semantic Search Endpoint
app.get('/api/search/semantic', async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: 'Unauthorized' });

    const { q } = req.query;
    if (!q || !q.trim()) return res.json({ results: [] });

    try {
        const embedding = await generateEmbedding(q);
        if (!embedding) return res.json({ results: [] });

        // Vector Search using Cosine Distance (<=>)
        // 1 - distance gives us a similarity score (approx)
        const query = `
            SELECT id, content, summary, 1 - (embedding <=> $1) as similarity
            FROM nodes
            WHERE user_id = $2 AND embedding IS NOT NULL
            ORDER BY embedding <=> $1 ASC
            LIMIT 10;
        `;
        
        const result = await db.query(query, [JSON.stringify(embedding), req.user.id]);
        res.json({ results: result.rows });
    } catch (e) {
        console.error('Semantic search failed:', e);
        res.status(500).json({ message: 'Search failed' });
    }
});

// Backfill Embeddings Endpoint (Utility)
app.post('/api/admin/backfill-embeddings', async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: 'Unauthorized' });
    
    // In a multi-user real app, this should be an admin-only route or run as a script.
    // Here we let the user backfill their own nodes.
    
    try {
        const nodesResult = await db.query('SELECT * FROM nodes WHERE user_id = $1 AND embedding IS NULL', [req.user.id]);
        const nodes = nodesResult.rows;
        
        console.log(`Backfilling ${nodes.length} nodes for user ${req.user.username}`);
        
        let successCount = 0;
        
        for (const node of nodes) {
            const aliases = node.aliases || [];
            const embeddingText = [
                node.content,
                aliases.join(' '),
                node.summary
            ].filter(Boolean).join(' ');

            if (embeddingText) {
                const embedding = await generateEmbedding(embeddingText);
                if (embedding) {
                    await db.query('UPDATE nodes SET embedding = $1 WHERE id = $2', [JSON.stringify(embedding), node.id]);
                    successCount++;
                }
            }
            // Rate limit protection / niceness
            await new Promise(r => setTimeout(r, 100));
        }
        
        res.json({ message: `Backfilled ${successCount} of ${nodes.length} nodes.` });
        
    } catch (e) {
        console.error('Backfill failed:', e);
        res.status(500).json({ message: 'Backfill failed' });
    }
});

// --- Billing API ---

app.post('/api/billing/checkout', async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: 'Unauthorized' });
    
    if (!stripe) {
        return res.status(503).json({ message: 'Billing service unavailable (Server Config Error)' });
    }

    if (!process.env.STRIPE_PRICE_ID) {
        return res.status(500).json({ message: 'Stripe configuration missing (Price ID)' });
    }

    try {
        const frontendUrl = process.env.FRONTEND_URL || req.headers.origin || 'http://localhost:3000';
        
        const session = await stripe.checkout.sessions.create({
            line_items: [
                {
                    price: process.env.STRIPE_PRICE_ID,
                    quantity: 1,
                },
            ],
            mode: 'subscription',
            success_url: `${frontendUrl}/profile?success=true`,
            cancel_url: `${frontendUrl}/profile?canceled=true`,
            client_reference_id: req.user.id.toString(),
            customer_email: req.user.email,
        });

        res.json({ url: session.url });
    } catch (e) {
        console.error('Stripe checkout error:', e);
        res.status(500).json({ message: 'Error creating checkout session' });
    }
});

app.post('/api/billing/portal', async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: 'Unauthorized' });

    if (!stripe) {
        return res.status(503).json({ message: 'Billing service unavailable' });
    }

    try {
        // Get user stripe ID
        const result = await db.query('SELECT stripe_customer_id FROM users WHERE id = $1', [req.user.id]);
        const customerId = result.rows[0]?.stripe_customer_id;

        if (!customerId) {
            return res.status(400).json({ message: 'No subscription found' });
        }

        const frontendUrl = process.env.FRONTEND_URL || req.headers.origin || 'http://localhost:3000';

        const session = await stripe.billingPortal.sessions.create({
            customer: customerId,
            return_url: `${frontendUrl}/profile`,
        });

        res.json({ url: session.url });
    } catch (e) {
        console.error('Stripe portal error:', e);
        res.status(500).json({ message: 'Error creating portal session' });
    }
});

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Server running on http://localhost:${PORT}`);
    });
}

module.exports = app;
