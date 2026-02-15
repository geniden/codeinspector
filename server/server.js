const express = require('express');
const path = require('path');
const cors = require('cors');
const { getDb, closeDb } = require('./database/db');

const app = express();
const DEFAULT_PORT = 3031;
const MAX_PORT_ATTEMPTS = 20;

// ─── Middleware
app.use(cors());
app.use(express.json());

// ─── Static files (frontend)
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// ─── API Routes
app.use('/api/projects', require('./routes/projects'));
app.use('/api/analysis', require('./routes/analysis'));
app.use('/api/reports', require('./routes/reports'));

// ─── Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0', port: app.get('port'), timestamp: new Date().toISOString() });
});

// ─── SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

// ─── Error handler
app.use((err, req, res, next) => {
  console.error('[Error]', err.message);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

// ─── Try to listen on a port, retry next one if busy
function tryListen(port, attemptsLeft) {
  if (attemptsLeft <= 0) {
    console.error(`\n  [ERROR] No free port found (tried ${DEFAULT_PORT}–${port - 1})\n`);
    process.exit(1);
  }

  const server = app.listen(port, () => {
    app.set('port', port);
    getDb();

    const note = port !== DEFAULT_PORT ? `  (port ${DEFAULT_PORT} was busy)` : '';

    console.log('');
    console.log('  ╔══════════════════════════════════════════╗');
    console.log('  ║        CodeInspector v1.0.0              ║');
    console.log(`  ║   http://localhost:${port}                  ║`);
    if (note) {
      console.log(`  ║${note.padEnd(42)}║`);
    }
    console.log('  ╚══════════════════════════════════════════╝');
    console.log('');
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`  Port ${port} is busy, trying ${port + 1}...`);
      tryListen(port + 1, attemptsLeft - 1);
    } else {
      console.error(`\n  [ERROR] ${err.message}\n`);
      process.exit(1);
    }
  });
}

// ─── Start
const requestedPort = parseInt(process.env.PORT, 10) || DEFAULT_PORT;
tryListen(requestedPort, MAX_PORT_ATTEMPTS);

// ─── Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  closeDb();
  process.exit(0);
});

process.on('SIGTERM', () => {
  closeDb();
  process.exit(0);
});
