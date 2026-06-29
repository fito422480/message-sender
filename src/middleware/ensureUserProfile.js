// src/middleware/ensureUserProfile.js
const { admin, db } = require("../firebaseAdmin");
const logger = require("../logger");

// In-memory cache: uid -> { profile, expiresAt }
const profileCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Invalidate a cached profile (called when profile is updated).
 */
function invalidateProfileCache(uid) {
  profileCache.delete(uid);
}

/**
 * Middleware: ensure a Firestore user profile exists for the authenticated user.
 * Runs after checkJwt. Sets req.userProfile.
 */
async function ensureUserProfile(req, res, next) {
  try {
    const uid = req.auth && req.auth.uid;
    if (!uid) {
      return res.status(401).json({ error: "Unauthenticated" });
    }

    // If Firestore is not available (e.g. dev mode without credentials), skip
    if (!db) {
      logger.warn(
        { uid },
        "ensureUserProfile: Firestore not available, skipping",
      );
      return next();
    }

    // Check cache first
    const cached = profileCache.get(uid);
    if (cached && cached.expiresAt > Date.now()) {
      req.userProfile = cached.profile;
      return next();
    }

    const userRef = db.collection("users").doc(uid);
    const snap = await userRef.get();

    if (!snap.exists) {
      // Auto-create profile for new user
      const now = new Date();
      const profile = {
        email: req.auth.email || "",
        displayName: req.auth.name || "",
        photoURL: req.auth.picture || null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        trialEndsAt: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
        plan: "trial",
        role:
          req.auth.email === "adolfo.andres.ayala@gmail.com" ? "admin" : "user",
        status: "active",
        country: "PY",
        whatsappPhone: null,
        apiKey: null,
        lastLoginAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      await userRef.set(profile);
      logger.info(
        { uid, email: req.auth.email, role: profile.role },
        "Created new user profile",
      );

      // Read back to get server timestamps resolved
      const created = await userRef.get();
      const data = created.data();
      const resolved = {
        uid,
        email: data.email,
        displayName: data.displayName,
        photoURL: data.photoURL || req.auth.picture || null,
        createdAt: data.createdAt,
        trialEndsAt: data.trialEndsAt,
        plan: data.plan,
        role: data.role,
        status: data.status || "active",
        country: data.country || "PY",
        whatsappPhone: data.whatsappPhone,
        lastLoginAt: data.lastLoginAt,
      };

      profileCache.set(uid, {
        profile: resolved,
        expiresAt: Date.now() + CACHE_TTL_MS,
      });
      req.userProfile = resolved;
      return next();
    }

    // Profile exists — update lastLoginAt (fire-and-forget)
    userRef
      .update({ lastLoginAt: admin.firestore.FieldValue.serverTimestamp() })
      .catch((err) => {
        logger.warn({ uid, err: err.message }, "Failed to update lastLoginAt");
      });

    const data = snap.data();
    const profile = {
      uid,
      email: data.email,
      displayName: data.displayName,
      photoURL: data.photoURL || req.auth.picture || null,
      createdAt: data.createdAt,
      trialEndsAt: data.trialEndsAt,
      plan: data.plan,
      role: data.role,
      status: data.status || "active",
      country: data.country || "PY",
      whatsappPhone: data.whatsappPhone,
      lastLoginAt: data.lastLoginAt,
    };

    profileCache.set(uid, { profile, expiresAt: Date.now() + CACHE_TTL_MS });
    req.userProfile = profile;
    return next();
  } catch (err) {
    logger.error(
      { err: err.message, uid: req.auth && req.auth.uid },
      "ensureUserProfile error",
    );
    // Don't crash the app — let the request through without profile
    // downstream middleware can handle missing profile gracefully
    return next();
  }
}

module.exports = { ensureUserProfile, invalidateProfileCache };
