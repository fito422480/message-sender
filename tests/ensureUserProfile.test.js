// tests/ensureUserProfile.test.js
// Tests for ensureUserProfile middleware (src/middleware/ensureUserProfile.js)

const mockGet = jest.fn();
const mockSet = jest.fn();
const mockUpdate = jest.fn();
const mockDoc = jest.fn(() => ({
  get: mockGet,
  set: mockSet,
  update: mockUpdate,
}));
const mockCollection = jest.fn(() => ({ doc: mockDoc }));

jest.mock("firebase-admin", () => {
  const mockFirestore = Object.assign(
    jest.fn(() => ({ collection: mockCollection })),
    {
      FieldValue: { serverTimestamp: jest.fn(() => "SERVER_TIMESTAMP") },
    },
  );
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

jest.mock("../src/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

// Must require AFTER mocks
const {
  ensureUserProfile,
  invalidateProfileCache,
} = require("../src/middleware/ensureUserProfile");

function makeReq(auth) {
  return { auth: auth || null };
}

function makeRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
  // Clear the profile cache between tests
  invalidateProfileCache("user-123");
  invalidateProfileCache("admin-user");
  invalidateProfileCache("any-uid");
});

describe("ensureUserProfile middleware", () => {
  test("returns 401 when no auth uid present", async () => {
    const req = makeReq(null);
    const res = makeRes();
    const next = jest.fn();

    await ensureUserProfile(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Unauthenticated" });
    expect(next).not.toHaveBeenCalled();
  });

  test("creates new user profile with correct fields when doc does not exist", async () => {
    // First call: doc does not exist
    mockGet.mockResolvedValueOnce({ exists: false });
    // After set, read-back returns resolved data
    const resolvedData = {
      email: "test@example.com",
      displayName: "Test User",
      createdAt: new Date("2026-03-14T00:00:00Z"),
      trialEndsAt: expect.any(Date),
      plan: "trial",
      role: "user",
      whatsappPhone: null,
      lastLoginAt: new Date("2026-03-14T00:00:00Z"),
    };
    mockSet.mockResolvedValueOnce(undefined);
    mockGet.mockResolvedValueOnce({ data: () => resolvedData });

    const req = makeReq({
      uid: "user-123",
      email: "test@example.com",
      name: "Test User",
    });
    const res = makeRes();
    const next = jest.fn();

    await ensureUserProfile(req, res, next);

    expect(mockSet).toHaveBeenCalledTimes(1);
    const setArg = mockSet.mock.calls[0][0];
    expect(setArg.plan).toBe("trial");
    expect(setArg.role).toBe("user");
    expect(setArg.email).toBe("test@example.com");
    expect(setArg.displayName).toBe("Test User");
    expect(setArg.whatsappPhone).toBeNull();
    expect(setArg.createdAt).toBe("SERVER_TIMESTAMP");
    expect(setArg.lastLoginAt).toBe("SERVER_TIMESTAMP");
    expect(next).toHaveBeenCalled();
    expect(req.userProfile).toBeDefined();
    expect(req.userProfile.uid).toBe("user-123");
    expect(req.userProfile.plan).toBe("trial");
  });

  test("sets trialEndsAt to 15 days from now for new users", async () => {
    mockGet.mockResolvedValueOnce({ exists: false });
    mockSet.mockResolvedValueOnce(undefined);
    const futureDate = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000);
    mockGet.mockResolvedValueOnce({
      data: () => ({
        email: "a@b.com",
        displayName: "",
        createdAt: new Date(),
        trialEndsAt: futureDate,
        plan: "trial",
        role: "user",
        whatsappPhone: null,
        lastLoginAt: new Date(),
      }),
    });

    const req = makeReq({ uid: "user-123", email: "a@b.com", name: "" });
    const res = makeRes();
    const next = jest.fn();

    await ensureUserProfile(req, res, next);

    const setArg = mockSet.mock.calls[0][0];
    const trialEnd = setArg.trialEndsAt;
    expect(trialEnd).toBeInstanceOf(Date);
    // Should be ~15 days from now (allow 5 second tolerance)
    const expectedMs = Date.now() + 15 * 24 * 60 * 60 * 1000;
    expect(Math.abs(trialEnd.getTime() - expectedMs)).toBeLessThan(5000);
  });

  test("detects admin by email adolfo.andres.ayala@gmail.com and sets role admin", async () => {
    mockGet.mockResolvedValueOnce({ exists: false });
    mockSet.mockResolvedValueOnce(undefined);
    mockGet.mockResolvedValueOnce({
      data: () => ({
        email: "adolfo.andres.ayala@gmail.com",
        displayName: "Admin",
        createdAt: new Date(),
        trialEndsAt: new Date(),
        plan: "trial",
        role: "admin",
        whatsappPhone: null,
        lastLoginAt: new Date(),
      }),
    });

    const req = makeReq({
      uid: "admin-user",
      email: "adolfo.andres.ayala@gmail.com",
      name: "Admin",
    });
    const res = makeRes();
    const next = jest.fn();

    await ensureUserProfile(req, res, next);

    const setArg = mockSet.mock.calls[0][0];
    expect(setArg.role).toBe("admin");
  });

  test("returns existing profile from Firestore when doc exists", async () => {
    const existingData = {
      email: "existing@test.com",
      displayName: "Existing",
      createdAt: new Date(),
      trialEndsAt: new Date(),
      plan: "active",
      role: "user",
      whatsappPhone: "595991234567",
      lastLoginAt: new Date(),
    };
    mockGet.mockResolvedValueOnce({ exists: true, data: () => existingData });
    mockUpdate.mockResolvedValueOnce(undefined);

    const req = makeReq({
      uid: "user-123",
      email: "existing@test.com",
      name: "Existing",
    });
    const res = makeRes();
    const next = jest.fn();

    await ensureUserProfile(req, res, next);

    expect(mockSet).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
    expect(req.userProfile.uid).toBe("user-123");
    expect(req.userProfile.email).toBe("existing@test.com");
    expect(req.userProfile.plan).toBe("active");
  });

  test("updates lastLoginAt on existing user (fire-and-forget)", async () => {
    const existingData = {
      email: "e@t.com",
      displayName: "E",
      createdAt: new Date(),
      trialEndsAt: new Date(),
      plan: "active",
      role: "user",
      whatsappPhone: null,
      lastLoginAt: new Date(),
    };
    mockGet.mockResolvedValueOnce({ exists: true, data: () => existingData });
    mockUpdate.mockResolvedValueOnce(undefined);

    const req = makeReq({ uid: "user-123", email: "e@t.com", name: "E" });
    const res = makeRes();
    const next = jest.fn();

    await ensureUserProfile(req, res, next);

    expect(mockUpdate).toHaveBeenCalledWith({
      lastLoginAt: "SERVER_TIMESTAMP",
    });
  });

  test("uses cache — second call does not hit Firestore", async () => {
    const existingData = {
      email: "cached@test.com",
      displayName: "Cached",
      createdAt: new Date(),
      trialEndsAt: new Date(),
      plan: "active",
      role: "user",
      whatsappPhone: null,
      lastLoginAt: new Date(),
    };
    mockGet.mockResolvedValueOnce({ exists: true, data: () => existingData });
    mockUpdate.mockResolvedValueOnce(undefined);

    const req1 = makeReq({
      uid: "user-123",
      email: "cached@test.com",
      name: "Cached",
    });
    const res1 = makeRes();
    const next1 = jest.fn();
    await ensureUserProfile(req1, res1, next1);

    // Reset mock call counts
    mockGet.mockClear();
    mockCollection.mockClear();

    // Second call — should use cache
    const req2 = makeReq({
      uid: "user-123",
      email: "cached@test.com",
      name: "Cached",
    });
    const res2 = makeRes();
    const next2 = jest.fn();
    await ensureUserProfile(req2, res2, next2);

    expect(mockGet).not.toHaveBeenCalled();
    expect(next2).toHaveBeenCalled();
    expect(req2.userProfile.email).toBe("cached@test.com");
  });

  test("cache expires after 5 minutes", async () => {
    jest.useFakeTimers();

    const existingData = {
      email: "timed@test.com",
      displayName: "Timed",
      createdAt: new Date(),
      trialEndsAt: new Date(),
      plan: "active",
      role: "user",
      whatsappPhone: null,
      lastLoginAt: new Date(),
    };

    // First call - populates cache
    mockGet.mockResolvedValueOnce({ exists: true, data: () => existingData });
    mockUpdate.mockResolvedValueOnce(undefined);

    const req1 = makeReq({
      uid: "any-uid",
      email: "timed@test.com",
      name: "Timed",
    });
    await ensureUserProfile(req1, makeRes(), jest.fn());

    mockGet.mockClear();

    // Advance time by 5 minutes + 1 ms
    jest.advanceTimersByTime(5 * 60 * 1000 + 1);

    // Second call — cache should be expired, hits Firestore again
    mockGet.mockResolvedValueOnce({ exists: true, data: () => existingData });
    mockUpdate.mockResolvedValueOnce(undefined);

    const req2 = makeReq({
      uid: "any-uid",
      email: "timed@test.com",
      name: "Timed",
    });
    await ensureUserProfile(req2, makeRes(), jest.fn());

    expect(mockGet).toHaveBeenCalled();

    jest.useRealTimers();
  });

  test("sets req.userProfile correctly with all expected fields", async () => {
    const data = {
      email: "full@test.com",
      displayName: "Full User",
      createdAt: new Date("2026-01-01"),
      trialEndsAt: new Date("2026-04-01"),
      plan: "trial",
      role: "user",
      whatsappPhone: "595991000000",
      lastLoginAt: new Date("2026-03-14"),
    };
    mockGet.mockResolvedValueOnce({ exists: true, data: () => data });
    mockUpdate.mockResolvedValueOnce(undefined);

    const req = makeReq({
      uid: "user-123",
      email: "full@test.com",
      name: "Full User",
    });
    const res = makeRes();
    const next = jest.fn();

    await ensureUserProfile(req, res, next);

    expect(req.userProfile).toEqual(
      expect.objectContaining({
        uid: "user-123",
        email: "full@test.com",
        displayName: "Full User",
        createdAt: data.createdAt,
        trialEndsAt: data.trialEndsAt,
        plan: "trial",
        role: "user",
        country: "PY",
        whatsappPhone: "595991000000",
        lastLoginAt: data.lastLoginAt,
      }),
    );
  });

  test("handles Firestore errors gracefully — calls next without crashing", async () => {
    mockGet.mockRejectedValueOnce(new Error("Firestore unavailable"));

    const req = makeReq({ uid: "user-123", email: "e@t.com", name: "E" });
    const res = makeRes();
    const next = jest.fn();

    await ensureUserProfile(req, res, next);

    // Should call next even on error (graceful degradation)
    expect(next).toHaveBeenCalled();
    // Should NOT have set userProfile
    expect(req.userProfile).toBeUndefined();
  });
});
