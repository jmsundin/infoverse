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

const app = express();
const PORT = process.env.PORT || 3001;

// Initialize Database
db.initDb();

// Passport Config
passport.use(new LocalStrategy(async (username, password, done) => {
    try {
        const result = await db.query('SELECT * FROM users WHERE username = $1', [username]);
        const user = result.rows[0];

        if (!user) {
            return done(null, false, { message: 'Incorrect username.' });
        }
        
        const isMatch = await bcrypt.compare(password, user.password);
        if (isMatch) {
            user.storagePath = user.storage_path;
            return done(null, user);
        } else {
            return done(null, false, { message: 'Incorrect password.' });
        }
    } catch (err) {
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
app.use(cors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:3000', // Vite default port
    credentials: true
}));
app.use(express.json({ limit: '50mb' })); // Increase limit for large updates
app.use(express.urlencoded({ extended: false }));
app.use(session({
    secret: process.env.SESSION_SECRET || 'infoverse-secret-key', // In production, use env var
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: process.env.NODE_ENV === 'production', // Set true if using https
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    } 
}));
app.use(passport.initialize());
app.use(passport.session());

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
            return res.json({ user: { id: newUser.id.toString(), username: newUser.username, storagePath: newUser.storagePath } });
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
            res.json({ user: { id: updatedUser.id.toString(), username: updatedUser.username, storagePath: updatedUser.storagePath } });
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
            return res.json({ user: { id: user.id.toString(), username: user.username, storagePath: user.storagePath } });
        });
    })(req, res, next);
});

app.post('/api/auth/logout', (req, res) => {
    req.logout((err) => {
        if (err) return res.status(500).json({ message: 'Logout failed' });
        res.json({ message: 'Logged out' });
    });
});

app.get('/api/auth/check', (req, res) => {
    if (req.isAuthenticated()) {
        res.json({ isAuthenticated: true, user: { id: req.user.id.toString(), username: req.user.username, storagePath: req.user.storagePath } });
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

app.get('/api/graph', (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: 'Unauthorized' });
    
    const { storagePath } = req.user;
    if (!storagePath || !fs.existsSync(storagePath)) {
        return res.json({ nodes: [], edges: [] });
    }

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

        res.json({ nodes, edges });
    } catch (e) {
        console.error('Error reading graph:', e);
        res.status(500).json({ message: 'Error reading graph data' });
    }
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

app.post('/api/nodes', (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: 'Unauthorized' });
    
    const { storagePath } = req.user;
    const node = req.body;
    
    if (!node || !node.id) return res.status(400).json({ message: 'Invalid node data' });

    // Fix: Validate storagePath before using it
    if (!storagePath || typeof storagePath !== 'string') {
        console.log('Skipping save: No storage path configured for user');
        return res.json({ success: false, message: 'No storage path configured' });
    }

    try {
        ensureDir(storagePath);
        
        const contentTitle = node.content && node.content.trim() ? node.content : 'Untitled';
        const safeTitle = sanitizeFilename(contentTitle);
        const timestamp = getTimestamp();
        
        // Scan directory for existing file for this node ID to rename if necessary
        const files = fs.readdirSync(storagePath);
        let oldFilePath = null;
        
        for (const file of files) {
            if (!file.endsWith('.md')) continue;
            const fullPath = path.join(storagePath, file);
            try {
                // Read file to check ID
                const content = fs.readFileSync(fullPath, 'utf8');
                if (content.includes(`id: "${node.id}"`) || content.includes(`id: ${node.id}`)) {
                    oldFilePath = fullPath;
                    break;
                }
            } catch (err) { continue; }
        }

        // Generate new filename
        const newFileName = `${safeTitle}_${timestamp}.md`;
        const newFilePath = path.join(storagePath, newFileName);
        
        // If old file exists and name is different, delete it (rename)
        if (oldFilePath && oldFilePath !== newFilePath) {
            fs.unlinkSync(oldFilePath);
        }
        
        const metadata = { ...node };
        const frontmatter = yaml.dump(metadata);
        const fileContent = `---\n${frontmatter}---\n\n# ${node.content || 'Untitled'}\n\n${node.summary || ''}\n`;
        
        fs.writeFileSync(newFilePath, fileContent);
        res.json({ success: true, fileName: newFileName });

    } catch (e) {
        console.error('Error saving node:', e);
        res.status(500).json({ message: 'Error saving node' });
    }
});

app.delete('/api/nodes/:id', (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: 'Unauthorized' });
    
    const { storagePath } = req.user;
    const nodeId = req.params.id;
    
    if (!storagePath || typeof storagePath !== 'string') {
        return res.json({ success: false, message: 'No storage path configured' });
    }

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
            res.json({ success: true });
        } else {
            // If not found, maybe it was already deleted or never saved?
            res.json({ success: true, message: 'Node not found or already deleted' });
        }
    } catch (e) {
        console.error('Error deleting node:', e);
        res.status(500).json({ message: 'Error deleting node' });
    }
});

app.post('/api/edges', (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: 'Unauthorized' });
    
    const { storagePath } = req.user;
    const edges = req.body;
    
    if (!Array.isArray(edges)) return res.status(400).json({ message: 'Edges must be an array' });

    if (!storagePath || typeof storagePath !== 'string') {
        return res.json({ success: false, message: 'No storage path configured' });
    }

    try {
        ensureDir(storagePath);
        const filePath = path.join(storagePath, '_edges.json');
        fs.writeFileSync(filePath, JSON.stringify(edges, null, 2));
        res.json({ success: true });
    } catch (e) {
        console.error('Error saving edges:', e);
        res.status(500).json({ message: 'Error saving edges' });
    }
});

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Server running on http://localhost:${PORT}`);
    });
}

module.exports = app;
