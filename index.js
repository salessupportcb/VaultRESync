// ============================================================
// Ray White Cairns Beaches — Dashboard Sync API
// Node.js / Express / PostgreSQL
// Deploy to Railway alongside your existing projects
// ============================================================

const express  = require('express');
const { Pool } = require('pg');
const cors     = require('cors');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');

const app = express();
app.use(express.json({ limit: '2mb' }));
// Allow requests from file:// (local HTML), Railway domain, and any origin
// file:// sends origin: null — we must explicitly allow it
app.use((req, res, next) => {
  const origin = req.headers.origin;
  // Allow null (file://), any https origin, or no origin (same-origin)
  res.header('Access-Control-Allow-Origin', origin || '*');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ── CONFIG ────────────────────────────────────────────────────────────────────
const PORT       = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL;
const JWT_SECRET   = process.env.JWT_SECRET || 'rw-dashboard-secret-change-me';

// Users — configured via DASHBOARD_USERS env var in Railway
// Just set the value to the JSON array — the code handles it safely
const DEFAULT_USERS = [
  { username: 'admin', password: 'rwcairns2026' },
];

function parseUsers() {
  const raw = process.env.DASHBOARD_USERS;
  if (!raw) return DEFAULT_USERS;
  try {
    // Strip any accidental KEY=value prefix Railway might inject
    const cleaned = raw.includes('=[') ? raw.slice(raw.indexOf('[')) : raw;
    return JSON.parse(cleaned);
  } catch(e) {
    console.error('DASHBOARD_USERS parse error — using defaults. Raw value:', raw.substring(0, 100));
    return DEFAULT_USERS;
  }
}
const USERS = parseUsers();
console.log('Loaded users:', USERS.map(u => u.username).join(', '));

// ── DATABASE ──────────────────────────────────────────────────────────────────
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dashboard_state (
      key   TEXT PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  console.log('Database ready');
}

// ── AUTH MIDDLEWARE ───────────────────────────────────────────────────────────
function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorised' });
  try {
    req.user = jwt.verify(auth.slice(7), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ── AUTH ROUTES ───────────────────────────────────────────────────────────────
// POST /auth/login  { username, password } → { token }
app.post('/auth/login', async (req, res) => {
  const { username, password } = req.body;
  const user = USERS.find(u => u.username === username);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  // Support both plaintext (for simplicity) and bcrypt hashed passwords
  const valid = user.password.startsWith('$2')
    ? await bcrypt.compare(password, user.password)
    : password === user.password;

  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, username });
});

// GET /auth/verify → 200 if token valid
app.get('/auth/verify', authMiddleware, (req, res) => {
  res.json({ ok: true, username: req.user.username });
});

// ── STATE ROUTES ──────────────────────────────────────────────────────────────
// All shared state is stored as key→value pairs in dashboard_state
// Keys used by the dashboard:
//   aucMeta         — auction type, venue, date, order, cardCollapsed per property
//   aucChecks       — checklist ticks per property
//   aucEventCats    — event categories (Bluewater 30 Jun etc.)
//   formRequests    — form 6 and contract requests
//   formChecks      — form checklist ticks
//   preLaunch       — manual pre-launch entries

// GET /state/:key → { key, value, updated_at }
app.get('/state/:key', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT key, value, updated_at FROM dashboard_state WHERE key = $1',
      [req.params.key]
    );
    if (!rows.length) return res.json({ key: req.params.key, value: null });
    res.json(rows[0]);
  } catch (err) {
    console.error('GET /state error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT /state/:key  { value: any } → { key, value, updated_at }
app.put('/state/:key', authMiddleware, async (req, res) => {
  try {
    const { value } = req.body;
    const { rows } = await pool.query(`
      INSERT INTO dashboard_state (key, value, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (key) DO UPDATE
        SET value = EXCLUDED.value, updated_at = NOW()
      RETURNING key, value, updated_at
    `, [req.params.key, JSON.stringify(value)]);
    res.json(rows[0]);
  } catch (err) {
    console.error('PUT /state error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /state → { keys: [{key, updated_at}] }  (list all keys + timestamps)
app.get('/state', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT key, updated_at FROM dashboard_state ORDER BY key'
    );
    res.json({ keys: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /snapshot → all state keys in one request (reduces round trips on load)
app.get('/snapshot', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT key, value, updated_at FROM dashboard_state');
    const snapshot = {};
    rows.forEach(r => { snapshot[r.key] = { value: r.value, updated_at: r.updated_at }; });
    res.json(snapshot);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /state/:key
app.delete('/state/:key', authMiddleware, async (req, res) => {
  try {
    await pool.query('DELETE FROM dashboard_state WHERE key = $1', [req.params.key]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── SERVE DASHBOARD HTML ─────────────────────────────────────────────────────
// Place RW_Dashboard_v2.html in the same folder as index.js
// Then access via https://vaultresync-production.up.railway.app/
const path = require('path');
const fs   = require('fs');
app.get('/', (req, res) => {
  // Try multiple possible filenames
  const candidates = [
    'RW_Dashboard_v2.html',
    'RW Dashboard v2.html',
    'dashboard.html',
    'index.html',
  ];
  for (const name of candidates) {
    const htmlPath = path.join(__dirname, name);
    if (fs.existsSync(htmlPath)) {
      console.log('Serving dashboard:', name);
      return res.sendFile(htmlPath);
    }
  }
  // List what files ARE in the directory to help diagnose
  const files = fs.readdirSync(__dirname).filter(f => f.endsWith('.html'));
  res.json({ 
    ok: true, 
    message: 'API running — no dashboard HTML found',
    htmlFilesFound: files,
    hint: 'Add RW_Dashboard_v2.html to the repo root'
  });
});

// ── HEALTH ────────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// ── START ─────────────────────────────────────────────────────────────────────
// Listen immediately so Railway healthcheck passes, then init DB
app.listen(PORT, () => {
  console.log(`Dashboard API running on port ${PORT}`);
  console.log(`DATABASE_URL set: ${!!DATABASE_URL}`);
  // Init DB after server is up
  initDb().catch(err => {
    console.error('DB init failed (will retry on next request):', err.message);
  });
});
