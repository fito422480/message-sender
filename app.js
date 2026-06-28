require('dotenv').config();
const logger = require('./src/logger');

// Configurar NODE_ENV para desarrollo si no está establecido
if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = 'development';
  logger.info('NODE_ENV configurado como development');
}

const VALID_ENVS = ['development', 'production'];
if (!VALID_ENVS.includes(process.env.NODE_ENV)) {
  logger.error({ NODE_ENV: process.env.NODE_ENV }, 'NODE_ENV inválido. Debe ser "development" o "production"');
  process.exit(1);
}

const express = require('express');
const path = require('path');

const { retentionHours } = require('./src/config');
const { cleanupOldFiles } = require('./src/utils');
const { buildRoutes } = require('./src/routes');
const { buildApiV1Routes } = require('./src/apiV1Routes');
const sessionManager = require('./src/sessionManager');

const app = express();
const port = process.env.PORT || 3000;
const host = process.env.HOST || '0.0.0.0';

// Si hay proxy/ingress con TLS, ayuda a detectar https correcto en req
app.set('trust proxy', 1);

// Archivos estáticos SIN auth (deja que el front haga login con Keycloak)
//app.use('/public', express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname, 'public')));

// JSON parser
app.use(express.json());

// Rutas de API (buildRoutes ahora maneja las sesiones automáticamente)
app.use('/', buildRoutes());

// API v1 — Public API for Professional/Enterprise plans
app.use('/api/v1', buildApiV1Routes());

// Raíz -> index.html (sin auth)
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Health endpoints for Kubernetes
app.get('/health', async (_req, res) => {
  try {
    // simple liveness
    res.json({ status: 'ok', time: new Date().toISOString() });
  } catch {
    res.status(500).json({ status: 'error' });
  }
});

app.get('/ready', async (_req, res) => {
  try {
    res.json({ ready: true });
  } catch (e) {
    res.status(503).json({ ready: false, error: e?.message });
  }
});

// 404 opcional para otras rutas
app.use((req, res) => res.status(404).json({ error: 'Not Found' }));

// Start
const server = app.listen(port, host, async () => {
  logger.info({ url: `http://${host}:${port}` }, 'Servidor multi-sesión escuchando');
  logger.info({ retentionHours }, 'Configuración de retención');

  cleanupOldFiles(retentionHours);
  setInterval(() => {
    logger.info('Limpieza automática programada...');
    cleanupOldFiles(retentionHours);
  }, 6 * 3600 * 1000);

  // Programar limpieza de sesiones inactivas cada 4 horas
  setInterval(() => {
    logger.info('Limpieza de sesiones inactivas...');
    sessionManager.cleanupInactiveSessions(24); // 24 horas
  }, 4 * 3600 * 1000);

  logger.info('Sistema multi-sesión WhatsApp inicializado correctamente');
});

// Global error handlers to prevent process crash on unhandled errors
process.on('unhandledRejection', (reason) => {
  try {
    logger.warn({ err: reason?.message, stack: reason?.stack }, 'UnhandledRejection capturado');
  } catch (e) {
    console.error('UnhandledRejection', reason);
  }
});

process.on('uncaughtException', (err) => {
  try {
    logger.error({ err: err?.message, stack: err?.stack }, 'UncaughtException capturado');
  } catch (e) {
    console.error('UncaughtException', err);
  }
  // No salir; dejar que los manejadores de reconexión actúen
});

// Graceful shutdown
let isShuttingDown = false;

async function shutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.info({ signal }, 'Iniciando graceful shutdown...');

  // 1. Stop accepting new HTTP requests
  if (server) {
    server.close(() => logger.info('Servidor HTTP cerrado'));
  }

  // 2. Close queue worker (waits for active job to finish)
  try {
    const { closeWorker } = require('./src/queueRedis');
    if (closeWorker) await closeWorker();
    logger.info('Queue worker cerrado');
  } catch (e) {
    logger.error({ err: e?.message }, 'Error cerrando worker');
  }

  // 3. Close PostgreSQL pool
  try {
    const { closePool } = require('./src/postgresClient');
    if (closePool) await closePool();
    logger.info('Pool PostgreSQL cerrado');
  } catch (e) {
    logger.error({ err: e?.message }, 'Error cerrando pool PostgreSQL');
  }

  logger.info('Shutdown completo');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));


