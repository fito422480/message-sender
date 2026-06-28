const waha = require('./wahaClient');
const logger = require('./logger');
const { db } = require('./firebaseAdmin');
const { invalidateProfileCache } = require('./middleware/ensureUserProfile');

const SESSION_NAME = waha.WAHA_DEFAULT_SESSION;

class WhatsAppManager {
  constructor(userId = 'default') {
    this.userId = userId;
    this.sessionName = SESSION_NAME;

    this.isReady = false;
    this.connectionState = 'disconnected';
    this.lastActivity = Date.now();

    this.qrCode = null;
    this.lastQRUpdate = null;

    this.userInfo = null;
    this.meData = null;

    this._pollTimer = null;
    this._qrPollTimer = null;
    this._isDestroyed = false;
  }

  _getScopedUserId() {
    return this.userId;
  }

  updateActivity() {
    this.lastActivity = Date.now();
  }

  async _handlePhoneRegistration(phoneNumber) {
    const userId = this._getScopedUserId();
    try {
      const existing = await db.collection('users')
        .where('whatsappPhone', '==', phoneNumber)
        .limit(10)
        .get();
      const otherUser = existing.docs.find(doc => doc.id !== userId);
      if (otherUser) {
        logger.warn({ userId, phoneNumber, otherUserId: otherUser.id }, 'Phone number already linked to another user');
        return false;
      }
      await db.collection('users').doc(userId).set({ whatsappPhone: phoneNumber }, { merge: true });
      invalidateProfileCache(userId);
      logger.info({ userId, phoneNumber }, 'WhatsApp phone saved to Firestore');
      return true;
    } catch (err) {
      logger.warn({ userId, phoneNumber, err: err?.message }, 'Failed to register phone in Firestore');
      return true;
    }
  }

  async _clearFirestorePhone() {
    const userId = this._getScopedUserId();
    try {
      await db.collection('users').doc(userId).set({ whatsappPhone: null }, { merge: true });
      invalidateProfileCache(userId);
      logger.info({ userId }, 'WhatsApp phone cleared from Firestore');
    } catch (err) {
      logger.warn({ userId, err: err?.message }, 'Failed to clear phone from Firestore');
    }
  }

  getState() {
    return {
      isReady: this.isReady,
      connectionState: this.connectionState,
      lastActivity: this.lastActivity,
      lastQRUpdate: this.lastQRUpdate || null,
      hasQR: !!this.qrCode,
      userInfo: this.userInfo || null,
    };
  }

  getConnectionHealth() {
    return {
      isReady: this.isReady,
      connectionState: this.connectionState,
      canSendMessages: this.isReady,
    };
  }

  // ─── Session lifecycle ─────────────────────────────────────────────────────

  async safeInitialize() {
    if (this._isDestroyed) return;
    logger.info({ userId: this._getScopedUserId() }, 'Initializing WAHA session');
    try {
      const existing = await waha.getSession(this.sessionName).catch(() => null);
      if (!existing) {
        logger.info({ userId: this._getScopedUserId() }, 'Creating new WAHA session');
        await waha.createSession(this.sessionName).catch(() => {});
      } else if (existing.status === 'STOPPED' || existing.status === 'FAILED') {
        logger.info({ userId: this._getScopedUserId(), status: existing.status }, 'Starting existing WAHA session');
        await waha.startSession(this.sessionName).catch(() => {});
      }
      this._startPolling();
    } catch (err) {
      logger.error({ err: err?.message, userId: this._getScopedUserId() }, 'Failed to initialize WAHA session');
    }
  }

  async cleanInitialize() {
    this._stopPolling();
    this._stopQrPolling();
    this.isReady = false;
    this.connectionState = 'disconnected';
    this.qrCode = null;
    this.userInfo = null;

    try {
      await waha.logoutSession(this.sessionName).catch(() => {});
      await waha.deleteSession(this.sessionName).catch(() => {});
    } catch {}
    await new Promise(r => setTimeout(r, 1000));
    await this.safeInitialize();
  }

  _startPolling() {
    this._stopPolling();
    this._pollTimer = setInterval(() => this._pollSession(), 3000);
    this._pollSession();
  }

  _stopPolling() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }

  _startQrPolling() {
    this._stopQrPolling();
    this._qrPollTimer = setInterval(() => this._fetchQR(), 2000);
    this._fetchQR();
  }

  _stopQrPolling() {
    if (this._qrPollTimer) {
      clearInterval(this._qrPollTimer);
      this._qrPollTimer = null;
    }
  }

  async _pollSession() {
    if (this._isDestroyed) return;
    try {
      const session = await waha.getSession(this.sessionName);
      const status = session?.status || 'STOPPED';

      switch (status) {
        case 'WORKING':
          if (!this.isReady) {
            this.connectionState = 'connected';
            this.isReady = true;
            this._stopQrPolling();
            this.qrCode = null;
            this.lastQRUpdate = null;

            if (session.me) {
              const phoneNumber = session.me.id ? session.me.id.split('@')[0] : null;
              this.meData = session.me;
              this.userInfo = {
                phoneNumber,
                pushname: session.me.pushName || `Usuario ${phoneNumber}`,
                jid: session.me.id,
              };
              if (phoneNumber) {
                await this._handlePhoneRegistration(phoneNumber).catch(() => {});
              }
            }
            logger.info({ userId: this._getScopedUserId(), status }, 'WAHA session ready');
          }
          break;

        case 'SCAN_QR_CODE':
          if (this.connectionState !== 'qr_ready') {
            this.connectionState = 'qr_ready';
            this.isReady = false;
            this._startQrPolling();
            logger.info({ userId: this._getScopedUserId() }, 'WAHA session needs QR scan');
          }
          break;

        case 'STARTING':
          this.connectionState = 'connecting';
          this.isReady = false;
          break;

        case 'FAILED':
          this.connectionState = 'disconnected';
          this.isReady = false;
          logger.warn({ userId: this._getScopedUserId() }, 'WAHA session failed');
          break;

        case 'STOPPED':
          this.connectionState = 'disconnected';
          this.isReady = false;
          break;
      }
    } catch (err) {
      logger.warn({ userId: this._getScopedUserId(), err: err?.message }, 'Poll session error');
    }
  }

  async _fetchQR() {
    if (this._isDestroyed || this.isReady) return;
    try {
      const qrBuffer = await waha.getQR(this.sessionName);
      if (qrBuffer && qrBuffer.length > 0) {
        this.qrCode = `data:image/png;base64,${qrBuffer.toString('base64')}`;
        this.lastQRUpdate = Date.now();
      }
    } catch (err) {
      if (!err.message?.includes('404') && !err.message?.includes('SCAN_QR_CODE')) {
        logger.warn({ userId: this._getScopedUserId(), err: err?.message }, 'Fetch QR error');
      }
    }
  }

  async getQrBase64() {
    if (!this.qrCode) {
      await this._fetchQR();
    }
    return this.qrCode;
  }

  // ─── Logout ────────────────────────────────────────────────────────────────

  async logout() {
    logger.info({ userId: this._getScopedUserId() }, 'Logging out WAHA session');
    this._stopPolling();
    this._stopQrPolling();
    this.isReady = false;
    this.connectionState = 'logging_out';
    this.qrCode = null;
    this.userInfo = null;

    try {
      await waha.logoutSession(this.sessionName);
    } catch (err) {
      logger.warn({ userId: this._getScopedUserId(), err: err?.message }, 'Logout error');
    }

    try {
      await waha.stopSession(this.sessionName);
    } catch {}

    await this._clearFirestorePhone();

    this.connectionState = 'disconnected';
    logger.info({ userId: this._getScopedUserId() }, 'WAHA session logged out');
    return true;
  }

  async forceCleanup() {
    this._stopPolling();
    this._stopQrPolling();
    this.isReady = false;
    this.connectionState = 'disconnected';
    this.qrCode = null;
    this.userInfo = null;
    try {
      await waha.logoutSession(this.sessionName).catch(() => {});
      await waha.deleteSession(this.sessionName).catch(() => {});
    } catch {}
  }

  async ensureConnection() {
    if (!this.isReady) {
      const session = await waha.getSession(this.sessionName).catch(() => null);
      if (!session || session.status !== 'WORKING') {
        await this.safeInitialize();
        await new Promise(r => setTimeout(r, 2000));
      }
      if (!this.isReady) {
        throw new Error('No se pudo restablecer la conexión');
      }
    }
  }

  async setActiveCampaign(active) {
    this.activeCampaign = active;
  }

  isActiveCampaign() {
    return this.activeCampaign || false;
  }

  // ─── Cleanup ───────────────────────────────────────────────────────────────

  destroy() {
    this._isDestroyed = true;
    this._stopPolling();
    this._stopQrPolling();
    this.isReady = false;
    this.connectionState = 'disconnected';
    this.qrCode = null;
    this.userInfo = null;
  }
}

module.exports = { WhatsAppManager };
