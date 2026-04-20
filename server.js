// Load .env manually so Claude Code's environment hook cannot intercept
// and silently drop variables like ANTHROPIC_API_KEY.
const fs = require('fs');
const path = require('path');
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (key) process.env[key] = val;
  }
}
const express = require('express');
const cookieParser = require('cookie-parser');

const webhookRoutes = require('./src/routes/webhooks');
const uploadRoutes = require('./src/routes/uploads');
const extractRoutes = require('./src/routes/extract');
const generateRoutes = require('./src/routes/generate');
const outputRoutes = require('./src/routes/outputs');
const intakeRoutes = require('./src/routes/intake');
const casesRoutes = require('./src/routes/cases');

const app = express();
const PORT = process.env.PORT || 3000;
const COOKIE_SECRET = process.env.COOKIE_SECRET || 'asc_fallback_secret';

// Signed cookie support
app.use(cookieParser(COOKIE_SECRET));

// Parse JSON bodies — but NOT for the Fireflies webhook route,
// which needs the raw body for HMAC signature verification.
app.use((req, res, next) => {
  if (req.path === '/webhooks/fireflies') {
    next();
  } else {
    express.json()(req, res, next);
  }
});

app.use(express.urlencoded({ extended: true }));

// ── Auth routes (public, no protection) ───────────────────────────────────
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/auth/login', (req, res) => {
  const { password } = req.body;
  if (password === process.env.PORTAL_PASSWORD) {
    res.cookie('asc_auth', 'consultant', {
      signed: true,
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in ms
      httpOnly: true,
      sameSite: 'lax'
    });
    return res.json({ success: true });
  }
  return res.status(401).json({ success: false, error: 'Invalid password' });
});

app.get('/auth/logout', (req, res) => {
  res.clearCookie('asc_auth');
  res.redirect('/login');
});

// ── Auth middleware ────────────────────────────────────────────────────────
// Protects all routes except /, /website/*, /pitch-deck/*, /login, and /auth/*
function requireAuth(req, res, next) {
  const publicPaths = ['/login', '/login.html', '/auth/login', '/auth/logout'];
  if (
    publicPaths.includes(req.path) ||
    req.path === '/' ||
    req.path.startsWith('/website/') ||
    req.path.startsWith('/pitch-deck/')
  ) {
    return next();
  }

  const signedCookie = req.signedCookies && req.signedCookies.asc_auth;
  const authHeader = req.headers.authorization;

  if (signedCookie === 'consultant' || authHeader === `Bearer ${process.env.PORTAL_PASSWORD}`) {
    return next();
  }

  // API requests get 401 instead of redirect
  if (req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'))) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  res.redirect('/login');
}

app.use(requireAuth);

// Root: marketing website for public visitors, dashboard for authenticated users
app.get('/', (req, res) => {
  const signedCookie = req.signedCookies && req.signedCookies.asc_auth;
  const authHeader = req.headers.authorization;
  if (signedCookie === 'consultant' || authHeader === `Bearer ${process.env.PORTAL_PASSWORD}`) {
    return res.redirect('/dashboard.html');
  }
  // Redirect to /website/ so express.static serves the file directly —
  // avoids any __dirname path resolution issues on Railway.
  res.redirect(301, '/website/');
});

app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.use('/webhooks', webhookRoutes);
app.use('/upload', uploadRoutes);
app.use('/extract', extractRoutes);
app.use('/generate', generateRoutes);
app.use('/outputs', outputRoutes);
app.use('/intake', intakeRoutes);
app.use('/cases', casesRoutes);

// Pitch deck download
app.get('/pitch-deck/download', (req, res) => {
  const deckPath = path.join(__dirname, 'public', 'pitch-deck', 'ASC_Pitch_Deck_v2.pptx');
  if (!fs.existsSync(deckPath)) {
    return res.status(404).json({ error: 'Pitch deck not found' });
  }
  res.download(deckPath, 'ASC_Pitch_Deck_v2.pptx');
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`ASC Workflow server running on http://localhost:${PORT}`);
});

module.exports = app;
