const {
  normalizeNumber,
  getCountryConfigs,
  detectCountryFromNumber,
  formatPhoneDisplay,
  COUNTRY_CONFIGS,
} = require("../src/phoneValidator");

// Mock dependencies needed by utils.js
jest.mock("../src/config", () => ({
  uploadsDir: "/tmp/uploads",
  tempDir: "/tmp/temp",
}));
jest.mock("../src/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

describe("phoneValidator", () => {
  // ─── Paraguay ───
  describe("PY - Paraguay", () => {
    it("normalizes already-normalized 595972117231", () => {
      const r = normalizeNumber("595972117231", "PY");
      expect(r).toEqual({
        normalized: "595972117231",
        valid: true,
        country: "PY",
      });
    });

    it("normalizes local with leading 0: 0992756462", () => {
      const r = normalizeNumber("0992756462", "PY");
      expect(r).toEqual({
        normalized: "595972117231",
        valid: true,
        country: "PY",
      });
    });

    it("normalizes local without 0: 992756462", () => {
      const r = normalizeNumber("992756462", "PY");
      expect(r).toEqual({
        normalized: "595972117231",
        valid: true,
        country: "PY",
      });
    });

    it("normalizes with + prefix: +595972117231", () => {
      const r = normalizeNumber("+595972117231", "PY");
      expect(r).toEqual({
        normalized: "595972117231",
        valid: true,
        country: "PY",
      });
    });

    it("normalizes with spaces: 595 992 756 462", () => {
      const r = normalizeNumber("595 992 756 462", "PY");
      expect(r).toEqual({
        normalized: "595972117231",
        valid: true,
        country: "PY",
      });
    });

    it("normalizes with dashes: 595-992-756-462", () => {
      const r = normalizeNumber("595-992-756-462", "PY");
      expect(r).toEqual({
        normalized: "595972117231",
        valid: true,
        country: "PY",
      });
    });
  });

  // ─── Argentina ───
  // AR: code=54, localLength=10, mobilePrefix=[9], totalLength=12
  // Format: 54 + 9XXXXXXXXX (10 local digits starting with 9)
  describe("AR - Argentina", () => {
    it("normalizes full number 549115555123", () => {
      const r = normalizeNumber("549115555123", "AR");
      expect(r.normalized).toBe("549115555123");
      expect(r.valid).toBe(true);
    });

    it("normalizes local 9115555123", () => {
      const r = normalizeNumber("9115555123", "AR");
      expect(r.normalized).toBe("549115555123");
      expect(r.valid).toBe(true);
    });

    it("normalizes with +: +549115555123", () => {
      const r = normalizeNumber("+549115555123", "AR");
      expect(r.normalized).toBe("549115555123");
      expect(r.valid).toBe(true);
    });

    it("normalizes local with leading 0: 09115555123", () => {
      const r = normalizeNumber("09115555123", "AR");
      expect(r.normalized).toBe("549115555123");
      expect(r.valid).toBe(true);
    });

    it("rejects number not starting with 9", () => {
      const r = normalizeNumber("1115555123", "AR");
      expect(r.valid).toBe(false);
    });
  });

  // ─── Brasil ───
  // BR: code=55, localLength=11, totalLength=13
  // Format: 55 + XX9XXXXXXXX (area code 2 digits + 9 + 8 digits)
  describe("BR - Brasil", () => {
    it("normalizes 5511912345678 (13 digits)", () => {
      const r = normalizeNumber("5511912345678", "BR");
      expect(r.normalized).toBe("5511912345678");
      expect(r.valid).toBe(true);
    });

    it("normalizes local 11912345678", () => {
      const r = normalizeNumber("11912345678", "BR");
      expect(r.normalized).toBe("5511912345678");
      expect(r.valid).toBe(true);
    });

    it("normalizes +5511912345678", () => {
      const r = normalizeNumber("+5511912345678", "BR");
      expect(r.normalized).toBe("5511912345678");
      expect(r.valid).toBe(true);
    });

    it("normalizes with leading 0: 011912345678", () => {
      const r = normalizeNumber("011912345678", "BR");
      expect(r.normalized).toBe("5511912345678");
      expect(r.valid).toBe(true);
    });
  });

  // ─── Chile ───
  describe("CL - Chile", () => {
    it("normalizes 56912345678", () => {
      const r = normalizeNumber("56912345678", "CL");
      expect(r.normalized).toBe("56912345678");
      expect(r.valid).toBe(true);
    });

    it("normalizes local 912345678", () => {
      const r = normalizeNumber("912345678", "CL");
      expect(r.normalized).toBe("56912345678");
      expect(r.valid).toBe(true);
    });

    it("normalizes with leading 0: 0912345678", () => {
      const r = normalizeNumber("0912345678", "CL");
      expect(r.normalized).toBe("56912345678");
      expect(r.valid).toBe(true);
    });
  });

  // ─── Uruguay ───
  describe("UY - Uruguay", () => {
    it("normalizes 59891234567", () => {
      const r = normalizeNumber("59891234567", "UY");
      expect(r.normalized).toBe("59891234567");
      expect(r.valid).toBe(true);
    });

    it("normalizes local 91234567", () => {
      const r = normalizeNumber("91234567", "UY");
      expect(r.normalized).toBe("59891234567");
      expect(r.valid).toBe(true);
    });
  });

  // ─── Colombia ───
  describe("CO - Colombia", () => {
    it("normalizes 573101234567", () => {
      const r = normalizeNumber("573101234567", "CO");
      expect(r.normalized).toBe("573101234567");
      expect(r.valid).toBe(true);
    });

    it("normalizes local 3101234567", () => {
      const r = normalizeNumber("3101234567", "CO");
      expect(r.normalized).toBe("573101234567");
      expect(r.valid).toBe(true);
    });
  });

  // ─── Peru ───
  describe("PE - Peru", () => {
    it("normalizes 51912345678", () => {
      const r = normalizeNumber("51912345678", "PE");
      expect(r.normalized).toBe("51912345678");
      expect(r.valid).toBe(true);
    });

    it("normalizes local 912345678", () => {
      const r = normalizeNumber("912345678", "PE");
      expect(r.normalized).toBe("51912345678");
      expect(r.valid).toBe(true);
    });
  });

  // ─── Ecuador ───
  describe("EC - Ecuador", () => {
    it("normalizes 593912345678", () => {
      const r = normalizeNumber("593912345678", "EC");
      expect(r.normalized).toBe("593912345678");
      expect(r.valid).toBe(true);
    });

    it("normalizes local 912345678", () => {
      const r = normalizeNumber("912345678", "EC");
      expect(r.normalized).toBe("593912345678");
      expect(r.valid).toBe(true);
    });
  });

  // ─── Bolivia ───
  describe("BO - Bolivia", () => {
    it("normalizes 59161234567", () => {
      const r = normalizeNumber("59161234567", "BO");
      expect(r.normalized).toBe("59161234567");
      expect(r.valid).toBe(true);
    });

    it("normalizes local 71234567 (starts with 7)", () => {
      const r = normalizeNumber("71234567", "BO");
      expect(r.normalized).toBe("59171234567");
      expect(r.valid).toBe(true);
    });

    it("normalizes local 61234567 (starts with 6)", () => {
      const r = normalizeNumber("61234567", "BO");
      expect(r.normalized).toBe("59161234567");
      expect(r.valid).toBe(true);
    });
  });

  // ─── Venezuela ───
  describe("VE - Venezuela", () => {
    it("normalizes 584121234567", () => {
      const r = normalizeNumber("584121234567", "VE");
      expect(r.normalized).toBe("584121234567");
      expect(r.valid).toBe(true);
    });

    it("normalizes local 4121234567", () => {
      const r = normalizeNumber("4121234567", "VE");
      expect(r.normalized).toBe("584121234567");
      expect(r.valid).toBe(true);
    });
  });

  // ─── Mexico ───
  describe("MX - Mexico", () => {
    it("normalizes 525512345678", () => {
      const r = normalizeNumber("525512345678", "MX");
      expect(r.normalized).toBe("525512345678");
      expect(r.valid).toBe(true);
    });

    it("normalizes local 5512345678", () => {
      const r = normalizeNumber("5512345678", "MX");
      expect(r.normalized).toBe("525512345678");
      expect(r.valid).toBe(true);
    });
  });

  // ─── Estados Unidos ───
  describe("US - Estados Unidos", () => {
    it("normalizes 12125551234", () => {
      const r = normalizeNumber("12125551234", "US");
      expect(r.normalized).toBe("12125551234");
      expect(r.valid).toBe(true);
    });

    it("normalizes local 2125551234", () => {
      const r = normalizeNumber("2125551234", "US");
      expect(r.normalized).toBe("12125551234");
      expect(r.valid).toBe(true);
    });

    it("normalizes +1 (212) 555-1234", () => {
      const r = normalizeNumber("+1 (212) 555-1234", "US");
      expect(r.normalized).toBe("12125551234");
      expect(r.valid).toBe(true);
    });
  });

  // ─── Espana ───
  describe("ES - Espana", () => {
    it("normalizes 34612345678", () => {
      const r = normalizeNumber("34612345678", "ES");
      expect(r.normalized).toBe("34612345678");
      expect(r.valid).toBe(true);
    });

    it("normalizes local 612345678", () => {
      const r = normalizeNumber("612345678", "ES");
      expect(r.normalized).toBe("34612345678");
      expect(r.valid).toBe(true);
    });

    it("normalizes local 712345678 (starts with 7)", () => {
      const r = normalizeNumber("712345678", "ES");
      expect(r.normalized).toBe("34712345678");
      expect(r.valid).toBe(true);
    });
  });

  // ─── Invalid numbers ───
  describe("Invalid numbers", () => {
    it("returns valid: false for null input", () => {
      const r = normalizeNumber(null, "PY");
      expect(r.valid).toBe(false);
    });

    it("returns valid: false for empty string", () => {
      const r = normalizeNumber("", "PY");
      expect(r.valid).toBe(false);
    });

    it("returns valid: false for unsupported country", () => {
      const r = normalizeNumber("12345", "XX");
      expect(r.valid).toBe(false);
    });

    it("returns valid: false for no country code", () => {
      const r = normalizeNumber("992756462", null);
      expect(r.valid).toBe(false);
    });

    it("returns valid: false for too short number", () => {
      const r = normalizeNumber("12345", "PY");
      expect(r.valid).toBe(false);
    });

    it("returns valid: false for letters in number", () => {
      const r = normalizeNumber("abc123", "PY");
      expect(r.valid).toBe(false);
    });

    it("returns valid: false for wrong mobile prefix", () => {
      // PY only allows prefix 9
      const r = normalizeNumber("595112345678", "PY");
      expect(r.valid).toBe(false);
    });
  });

  // ─── detectCountryFromNumber ───
  describe("detectCountryFromNumber", () => {
    it("detects Paraguay from 595972117231", () => {
      expect(detectCountryFromNumber("595972117231")).toBe("PY");
    });

    it("detects Argentina from 549115555123", () => {
      expect(detectCountryFromNumber("549115555123")).toBe("AR");
    });

    it("detects US from 12125551234", () => {
      expect(detectCountryFromNumber("12125551234")).toBe("US");
    });

    it("detects Chile from 56912345678", () => {
      expect(detectCountryFromNumber("56912345678")).toBe("CL");
    });

    it("detects Uruguay from 59891234567", () => {
      expect(detectCountryFromNumber("59891234567")).toBe("UY");
    });

    it("detects Ecuador from 593912345678", () => {
      expect(detectCountryFromNumber("593912345678")).toBe("EC");
    });

    it("detects Bolivia from 59161234567", () => {
      expect(detectCountryFromNumber("59161234567")).toBe("BO");
    });

    it("detects Brasil from 5511912345678", () => {
      expect(detectCountryFromNumber("5511912345678")).toBe("BR");
    });

    it("returns null for invalid input", () => {
      expect(detectCountryFromNumber(null)).toBeNull();
      expect(detectCountryFromNumber("")).toBeNull();
      expect(detectCountryFromNumber("abc")).toBeNull();
    });

    it("returns null for unrecognized number", () => {
      expect(detectCountryFromNumber("9991234567890")).toBeNull();
    });
  });

  // ─── formatPhoneDisplay ───
  describe("formatPhoneDisplay", () => {
    it("formats PY number with spaces", () => {
      const result = formatPhoneDisplay("595972117231", "PY");
      expect(result).toBe("+595 972 117 231");
    });

    it("formats US number with spaces", () => {
      const result = formatPhoneDisplay("12125551234", "US");
      // local is 2125551234 (10 digits), split from right: 2 125 551 234
      expect(result).toMatch(/^\+1 /);
      expect(result.replace(/\s/g, "").replace("+", "")).toBe("12125551234");
    });

    it("auto-detects country if not provided", () => {
      const result = formatPhoneDisplay("595972117231");
      expect(result).toBe("+595 972 117 231");
    });

    it("returns empty string for null input", () => {
      expect(formatPhoneDisplay(null)).toBe("");
      expect(formatPhoneDisplay("")).toBe("");
    });

    it("returns +number for unrecognized number", () => {
      const result = formatPhoneDisplay("9991234567890");
      expect(result).toBe("+9991234567890");
    });
  });

  // ─── getCountryConfigs ───
  describe("getCountryConfigs", () => {
    it("returns all 13 countries", () => {
      const configs = getCountryConfigs();
      expect(Object.keys(configs)).toHaveLength(13);
    });

    it("includes code, name, and totalLength for each country", () => {
      const configs = getCountryConfigs();
      for (const [key, val] of Object.entries(configs)) {
        expect(val).toHaveProperty("code");
        expect(val).toHaveProperty("name");
        expect(val).toHaveProperty("totalLength");
        expect(typeof val.code).toBe("string");
        expect(typeof val.name).toBe("string");
        expect(typeof val.totalLength).toBe("number");
      }
    });

    it("does not expose mobilePrefix or localLength", () => {
      const configs = getCountryConfigs();
      for (const val of Object.values(configs)) {
        expect(val).not.toHaveProperty("mobilePrefix");
        expect(val).not.toHaveProperty("localLength");
      }
    });
  });

  // ─── Backwards compatibility: normalizeParaguayanNumber ───
  describe("normalizeParaguayanNumber (backwards compat)", () => {
    const { normalizeParaguayanNumber } = require("../src/utils");

    it("normalizes 595972117231", () => {
      expect(normalizeParaguayanNumber("595972117231")).toBe("595972117231");
    });

    it("normalizes 0992756462", () => {
      expect(normalizeParaguayanNumber("0992756462")).toBe("595972117231");
    });

    it("normalizes 992756462", () => {
      expect(normalizeParaguayanNumber("992756462")).toBe("595972117231");
    });

    it("returns null for invalid number", () => {
      expect(normalizeParaguayanNumber("123")).toBeNull();
    });

    it("returns null for null input", () => {
      expect(normalizeParaguayanNumber(null)).toBeNull();
    });
  });
});
