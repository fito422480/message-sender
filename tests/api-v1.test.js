// tests/api-v1.test.js
// Tests for API v1 routes: apiAuth middleware and POST /user/api-key

const http = require('http');
const express = require('express');

// ─── Firestore mock setup (before any require) ───
const mockGet = jest.fn();
const mockSet = jest.fn();
const mockUpdate = jest.fn();
const mockWhere = jest.fn();
const mockLimit = jest.fn();
const mockQueryGet = jest.fn();
const mockDelete = jest.fn();
const mockDoc = jest.fn(() => ({
  get: mockGet,
  set: mockSet,
  update: mockUpdate,
  delete: mockDelete,
}));
const mockCollection = jest.fn(() => ({
  doc: mockDoc,
  where: mockWhere,
}));

mockWhere.mockReturnValue({ limit: mockLimit });
mockLimit.mockReturnValue({ get: mockQueryGet });

jest.mock('firebase-admin', () => {
  const mockFirestore = Object.assign(jest.fn(() => ({ collection: mockCollection })), {
    FieldValue: { serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP') },
  });
  const mockAuth = { verifyIdToken: jest.fn() };
  const app = { auth: () => mockAuth, firestore: mockFirestore };
  return {
    apps: [app],
    initializeApp: jest.fn(),
    credential: { cert: jest.fn(), applicationDefault: jest.fn() },
    auth: () => mockAuth,
    firestore: mockFirestore,
  };
});

jest.mock('../src/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../src/metricsStore', () => ({
  createCampaign: jest.fn().mockResolvedValue({ id: 'camp-1' }),
  initCampaignRecipients: jest.fn().mockResolvedValue(),
  getCampaignDetail: jest.fn().mockResolvedValue(null),
}));

jest.mock('../src/queueRedis', () => ({
  enqueueCampaign: jest.fn().mockResolvedValue(),
}));

jest.mock('../src/sessionManager', () => ({
  getSession: jest.fn().mockResolvedValue(null),
}));

// Simple promisified request helper (no supertest dependency)
function request(app, method, path, body) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const port = server.address().port;
      const options = {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: { 'Content-Type': 'application/json' },
      };

      if (body && body._headers) {
        Object.assign(options.headers, body._headers);
        delete body._headers;
      }

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          server.close();
          let parsed = {};
          try { parsed = JSON.parse(data); } catch {}
          resolve({ status: res.statusCode, body: parsed });
        });
      });

      req.on('error', (err) => {
        server.close();
        reject(err);
      });

      if (body && !body._headers) {
        req.write(JSON.stringify(body));
      }
      req.end();
    });
  });
}

function requestWithHeaders(app, method, path, headers, body) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const port = server.address().port;
      const options = {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: { 'Content-Type': 'application/json', ...headers },
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          server.close();
          let parsed = {};
          try { parsed = JSON.parse(data); } catch {}
          resolve({ status: res.statusCode, body: parsed });
        });
      });

      req.on('error', (err) => {
        server.close();
        reject(err);
      });

      if (body) {
        req.write(JSON.stringify(body));
      }
      req.end();
    });
  });
}

// ═══════════════════════════════════════════════════════════
// 1. apiAuth middleware tests
// ═══════════════════════════════════════════════════════════
describe('apiAuth middleware', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    const { buildApiV1Routes } = require('../src/apiV1Routes');
    app = express();
    app.use(express.json());
    app.use('/api/v1', buildApiV1Routes());
  });

  test('rejects request with no Authorization header', async () => {
    const res = await requestWithHeaders(app, 'POST', '/api/v1/messages/send', {}, {
      phone: '595991234567',
      message: 'Hello',
    });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/missing/i);
  });

  test('rejects request with invalid Bearer token', async () => {
    const res = await requestWithHeaders(
      app,
      'POST',
      '/api/v1/messages/send',
      { Authorization: 'Bearer invalid-token-xyz' },
      { phone: '595991234567', message: 'Hello' }
    );

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid|expired/i);
  });

  test('rejects request with non-Bearer auth scheme', async () => {
    const res = await requestWithHeaders(
      app,
      'POST',
      '/api/v1/messages/send',
      { Authorization: 'Basic dXNlcjpwYXNz' },
      { phone: '595991234567', message: 'Hello' }
    );

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/missing/i);
  });
});

// ═══════════════════════════════════════════════════════════
// 2. POST /user/api-key — via main routes
// ═══════════════════════════════════════════════════════════
describe('POST /user/api-key', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NODE_ENV = 'development';
  });

  afterAll(() => {
    process.env.NODE_ENV = 'development';
  });

  test('generates API key for admin user (dev mode)', async () => {
    // In dev mode, conditionalAuth injects admin user with plan=active, role=admin
    jest.resetModules();

    jest.mock('../src/auth', () => ({
      checkJwt: jest.fn((req, res, next) => next()),
    }));
    jest.mock('../src/auth/index', () => ({
      getAuthState: jest.fn().mockResolvedValue({ state: {}, saveCreds: jest.fn(), clear: jest.fn() }),
    }), { virtual: true });
    jest.mock('../src/media', () => ({
      upload: {
        single: () => (req, res, next) => next(),
        fields: () => (req, res, next) => next(),
        array: () => (req, res, next) => next(),
      },
    }));
    jest.mock('qrcode', () => ({ toDataURL: jest.fn(), toFile: jest.fn() }), { virtual: true });
    jest.mock('../src/queueRedis', () => ({
      addMessage: jest.fn(),
      addBulkMessages: jest.fn(),
      getQueueStats: jest.fn().mockResolvedValue({}),
      enqueueCampaign: jest.fn(),
    }));
    jest.mock('../src/metricsStore', () => ({
      getMainDashboard: jest.fn(),
      getCampaigns: jest.fn(),
      createCampaign: jest.fn(),
      initCampaignRecipients: jest.fn(),
      getCampaignDetail: jest.fn(),
    }));
    jest.mock('../src/sessionManager', () => ({
      getSession: jest.fn().mockResolvedValue(null),
      closeSession: jest.fn(),
      getAllSessionsForUser: jest.fn().mockResolvedValue([]),
    }));
    jest.mock('../src/middleware/ensureUserProfile', () => ({
      ensureUserProfile: jest.fn((req, res, next) => next()),
      invalidateProfileCache: jest.fn(),
    }));
    jest.mock('../src/middleware/checkTrial', () => ({
      checkTrial: jest.fn((req, res, next) => next()),
    }));
    jest.mock('../src/middleware/ensureEmailVerified', () => ({
      ensureEmailVerified: jest.fn((req, res, next) => next()),
    }));
    jest.mock('../src/middleware/sessionGuard', () => ({
      sessionGuard: jest.fn((req, res, next) => next()),
      createSession: jest.fn((req, res, next) => next()),
      clearSession: jest.fn((req, res, next) => next()),
    }));
    jest.mock('@whiskeysockets/baileys', () => ({
      default: jest.fn(),
      DisconnectReason: { loggedOut: 401 },
    }), { virtual: true });
    jest.mock('../src/queue', () => ({
      MessageQueue: jest.fn().mockImplementation(() => ({})),
    }));
    jest.mock('fs', () => {
      const actual = jest.requireActual('fs');
      return { ...actual, existsSync: jest.fn().mockReturnValue(true) };
    });

    const { buildRoutes } = require('../src/routes');
    const routerApp = express();
    routerApp.use(express.json());
    routerApp.use(buildRoutes());

    const res = await requestWithHeaders(routerApp, 'POST', '/user/api-key', {});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.apiKey).toBeDefined();
    expect(typeof res.body.apiKey).toBe('string');
  });

  test('allows trial users to generate API keys', async () => {
    process.env.NODE_ENV = 'production';
    jest.resetModules();

    jest.mock('../src/auth', () => ({
      checkJwt: jest.fn((req, res, next) => {
        req.auth = { uid: 'trial-user', email: 'trial@test.com', sign_in_provider: 'password', email_verified: true };
        next();
      }),
    }));
    jest.mock('../src/auth/index', () => ({
      getAuthState: jest.fn().mockResolvedValue({ state: {}, saveCreds: jest.fn(), clear: jest.fn() }),
    }), { virtual: true });
    jest.mock('../src/media', () => ({
      upload: {
        single: () => (req, res, next) => next(),
        fields: () => (req, res, next) => next(),
        array: () => (req, res, next) => next(),
      },
    }));
    jest.mock('qrcode', () => ({ toDataURL: jest.fn(), toFile: jest.fn() }), { virtual: true });
    jest.mock('../src/queueRedis', () => ({
      addMessage: jest.fn(),
      addBulkMessages: jest.fn(),
      getQueueStats: jest.fn().mockResolvedValue({}),
      enqueueCampaign: jest.fn(),
    }));
    jest.mock('../src/metricsStore', () => ({
      getMainDashboard: jest.fn(),
      getCampaigns: jest.fn(),
      createCampaign: jest.fn(),
      initCampaignRecipients: jest.fn(),
      getCampaignDetail: jest.fn(),
    }));
    jest.mock('../src/sessionManager', () => ({
      getSession: jest.fn().mockResolvedValue(null),
      closeSession: jest.fn(),
      getAllSessionsForUser: jest.fn().mockResolvedValue([]),
    }));
    jest.mock('../src/middleware/ensureUserProfile', () => ({
      ensureUserProfile: jest.fn((req, res, next) => {
        req.userProfile = {
          uid: 'trial-user',
          role: 'user',
          plan: 'trial',
        };
        next();
      }),
      invalidateProfileCache: jest.fn(),
    }));
    jest.mock('../src/middleware/checkTrial', () => ({
      checkTrial: jest.fn((req, res, next) => next()),
    }));
    jest.mock('../src/middleware/ensureEmailVerified', () => ({
      ensureEmailVerified: jest.fn((req, res, next) => next()),
    }));
    jest.mock('../src/middleware/sessionGuard', () => ({
      sessionGuard: jest.fn((req, res, next) => next()),
      createSession: jest.fn((req, res, next) => next()),
      clearSession: jest.fn((req, res, next) => next()),
    }));
    jest.mock('@whiskeysockets/baileys', () => ({
      default: jest.fn(),
      DisconnectReason: { loggedOut: 401 },
    }), { virtual: true });
    jest.mock('../src/queue', () => ({
      MessageQueue: jest.fn().mockImplementation(() => ({})),
    }));
    jest.mock('fs', () => {
      const actual = jest.requireActual('fs');
      return { ...actual, existsSync: jest.fn().mockReturnValue(true) };
    });

    const { buildRoutes } = require('../src/routes');
    const routerApp = express();
    routerApp.use(express.json());
    routerApp.use(buildRoutes());

    const res = await requestWithHeaders(routerApp, 'POST', '/user/api-key', {});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.apiKey).toBe('string');
  });
});
