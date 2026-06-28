const { WhatsAppManager } = require('./manager');
const logger = require('./logger');

class SessionManager {
  constructor() {
    this.sessions = new Map();
    this.creatingSession = new Map();
  }

  async getSession(userId) {
    if (this.sessions.has(userId)) {
      return this.sessions.get(userId);
    }
    if (this.creatingSession.has(userId)) {
      await this.creatingSession.get(userId);
      return this.sessions.get(userId);
    }
    const creationPromise = this.createSession(userId);
    this.creatingSession.set(userId, creationPromise);
    try {
      await creationPromise;
      return this.sessions.get(userId);
    } finally {
      this.creatingSession.delete(userId);
    }
  }

  async createSession(userId) {
    const manager = new WhatsAppManager(userId);
    await manager.safeInitialize();
    this.sessions.set(userId, manager);
    logger.info({ userId }, 'Session created for user via WAHA');
  }

  async getSessionByToken(req) {
    const userId = req.auth?.uid;
    if (!userId) {
      throw new Error('Usuario no autenticado');
    }
    return this.getSession(userId);
  }

  getActiveSessions() {
    const active = [];
    for (const [userId, manager] of this.sessions) {
      const state = manager.getState();
      active.push({
        userId,
        isReady: state.isReady,
        connectionState: state.connectionState,
        userInfo: state.userInfo,
        lastActivity: state.lastActivity,
        hasQR: state.hasQR,
      });
    }
    return active;
  }

  async closeSession(userId) {
    const manager = this.sessions.get(userId);
    if (manager) {
      try {
        manager.destroy();
        this.sessions.delete(userId);
        const { cleanupUserData } = require('./queueRedis');
        await cleanupUserData(userId);
        logger.info({ userId }, 'Session closed');
      } catch (error) {
        logger.error({ userId, error: error.message }, 'Error closing session');
      }
    }
  }

  async initializeSession(userId) {
    const manager = this.sessions.get(userId);
    if (manager) {
      await manager.safeInitialize();
      return true;
    }
    return false;
  }

  getStats() {
    const sessions = this.getActiveSessions();
    return {
      totalSessions: sessions.length,
      readySessions: sessions.filter(s => s.isReady).length,
      connectingSessions: sessions.filter(s => s.connectionState === 'connecting').length,
      qrPendingSessions: sessions.filter(s => s.connectionState === 'qr_ready').length,
      sessions,
    };
  }

  cleanupInactiveSessions(maxInactiveHours = 24) {
    const now = Date.now();
    const maxInactiveMs = maxInactiveHours * 60 * 60 * 1000;
    for (const [userId, manager] of this.sessions) {
      const state = manager.getState();
      if (now - state.lastActivity > maxInactiveMs) {
        logger.info({ userId }, 'Closing inactive session');
        this.closeSession(userId);
      }
    }
  }

  async logoutUser(userId) {
    try {
      const manager = this.sessions.get(userId);
      if (!manager) {
        const { cleanupUserData } = require('./queueRedis');
        await cleanupUserData(userId);
        return { success: true, message: 'No había sesión activa' };
      }
      await manager.logout();
      this.sessions.delete(userId);
      const { cleanupUserData } = require('./queueRedis');
      await cleanupUserData(userId);
      return { success: true, message: 'Sesión de WhatsApp cerrada exitosamente' };
    } catch (error) {
      logger.error({ userId, error: error.message }, 'Error during logout');
      if (this.sessions.has(userId)) {
        const manager = this.sessions.get(userId);
        await manager.forceCleanup();
        this.sessions.delete(userId);
      }
      return { success: false, message: error.message };
    }
  }

  async logoutByToken(req) {
    const userId = req.auth?.uid;
    if (!userId) throw new Error('Usuario no autenticado');
    return await this.logoutUser(userId);
  }
}

module.exports = new SessionManager();
