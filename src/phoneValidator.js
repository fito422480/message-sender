"use strict";

const COUNTRY_CONFIGS = {
  PY: {
    code: "595",
    name: "Paraguay",
    localLength: 9,
    mobilePrefix: ["9"],
    totalLength: 12,
  },
  AR: {
    code: "54",
    name: "Argentina",
    localLength: 10,
    mobilePrefix: ["9"],
    totalLength: 12,
  },
  BR: {
    code: "55",
    name: "Brasil",
    localLength: 11,
    mobilePrefix: ["1", "2", "3", "4", "5", "6", "7", "8", "9"],
    totalLength: 13,
  },
  CL: {
    code: "56",
    name: "Chile",
    localLength: 9,
    mobilePrefix: ["9"],
    totalLength: 11,
  },
  UY: {
    code: "598",
    name: "Uruguay",
    localLength: 8,
    mobilePrefix: ["9"],
    totalLength: 11,
  },
  CO: {
    code: "57",
    name: "Colombia",
    localLength: 10,
    mobilePrefix: ["3"],
    totalLength: 12,
  },
  PE: {
    code: "51",
    name: "Perú",
    localLength: 9,
    mobilePrefix: ["9"],
    totalLength: 11,
  },
  EC: {
    code: "593",
    name: "Ecuador",
    localLength: 9,
    mobilePrefix: ["9"],
    totalLength: 12,
  },
  BO: {
    code: "591",
    name: "Bolivia",
    localLength: 8,
    mobilePrefix: ["6", "7"],
    totalLength: 11,
  },
  VE: {
    code: "58",
    name: "Venezuela",
    localLength: 10,
    mobilePrefix: ["4"],
    totalLength: 12,
  },
  MX: {
    code: "52",
    name: "México",
    localLength: 10,
    mobilePrefix: ["1", "2", "3", "4", "5", "6", "7", "8", "9"],
    totalLength: 12,
  },
  US: {
    code: "1",
    name: "Estados Unidos",
    localLength: 10,
    mobilePrefix: ["2", "3", "4", "5", "6", "7", "8", "9"],
    totalLength: 11,
  },
  ES: {
    code: "34",
    name: "España",
    localLength: 9,
    mobilePrefix: ["6", "7"],
    totalLength: 11,
  },
};

/**
 * Normalize a phone number based on country code.
 * @param {string|number} rawNumber - The raw phone number input
 * @param {string} countryCode - ISO 2-letter country code (e.g. 'PY', 'AR')
 * @returns {{ normalized: string, valid: boolean, country: string }}
 */
function normalizeNumber(rawNumber, countryCode) {
  const result = { normalized: "", valid: false, country: countryCode || "" };

  if (!rawNumber || !countryCode) return result;

  const config = COUNTRY_CONFIGS[countryCode.toUpperCase()];
  if (!config) return result;

  result.country = countryCode.toUpperCase();

  // Clean: remove spaces, dashes, parentheses, dots
  let cleaned = String(rawNumber)
    .trim()
    .replace(/[\s\-\(\)\.]/g, "");

  // Remove leading +
  if (cleaned.startsWith("+")) {
    cleaned = cleaned.substring(1);
  }

  // If starts with country code, strip it to get local number
  if (cleaned.startsWith(config.code)) {
    const local = cleaned.substring(config.code.length);
    if (local.length === config.localLength) {
      cleaned = local;
    }
  }

  // Remove leading 0 (common local format)
  if (cleaned.startsWith("0")) {
    const withoutZero = cleaned.substring(1);
    if (withoutZero.length === config.localLength) {
      cleaned = withoutZero;
    }
  }

  // At this point cleaned should be the local number
  if (cleaned.length === config.localLength && /^\d+$/.test(cleaned)) {
    // Validate mobile prefix
    const firstDigit = cleaned[0];
    if (config.mobilePrefix.includes(firstDigit)) {
      result.normalized = config.code + cleaned;
      result.valid = true;
      return result;
    }
  }

  // Check if it's already a fully qualified number with country code
  if (
    /^\d+$/.test(cleaned) &&
    cleaned.length === config.totalLength &&
    cleaned.startsWith(config.code)
  ) {
    const local = cleaned.substring(config.code.length);
    if (config.mobilePrefix.includes(local[0])) {
      result.normalized = cleaned;
      result.valid = true;
      return result;
    }
  }

  return result;
}

/**
 * Returns all supported country configurations (for frontend dropdown).
 * @returns {Object} Map of country code to config
 */
function getCountryConfigs() {
  const configs = {};
  for (const [key, val] of Object.entries(COUNTRY_CONFIGS)) {
    configs[key] = {
      code: val.code,
      name: val.name,
      totalLength: val.totalLength,
    };
  }
  return configs;
}

/**
 * Try to detect country from a fully normalized number (with country code prefix).
 * @param {string} normalizedNumber - A fully normalized phone number (digits only)
 * @returns {string|null} ISO 2-letter country code or null
 */
function detectCountryFromNumber(normalizedNumber) {
  if (!normalizedNumber || !/^\d+$/.test(normalizedNumber)) return null;

  // Sort by code length descending so longer codes match first (e.g. 598 before 59, 591 before 5)
  const sorted = Object.entries(COUNTRY_CONFIGS).sort(
    (a, b) => b[1].code.length - a[1].code.length,
  );

  for (const [countryCode, config] of sorted) {
    if (
      normalizedNumber.startsWith(config.code) &&
      normalizedNumber.length === config.totalLength
    ) {
      const local = normalizedNumber.substring(config.code.length);
      if (config.mobilePrefix.includes(local[0])) {
        return countryCode;
      }
    }
  }

  return null;
}

/**
 * Format a phone number for display with spaces.
 * E.g. 595972117231 → +595 992 756 462
 * @param {string} number - Normalized phone number (digits only)
 * @param {string} [countryCode] - Optional ISO 2-letter code; if omitted, tries detection
 * @returns {string} Formatted number or original if formatting fails
 */
function formatPhoneDisplay(number, countryCode) {
  if (!number) return "";

  const cc = countryCode || detectCountryFromNumber(number);
  if (!cc) return "+" + number;

  const config = COUNTRY_CONFIGS[cc];
  if (!config) return "+" + number;

  if (!number.startsWith(config.code)) return "+" + number;

  const local = number.substring(config.code.length);

  // Split local number into groups of 3 from the right
  const groups = [];
  let remaining = local;
  while (remaining.length > 3) {
    groups.unshift(remaining.slice(-3));
    remaining = remaining.slice(0, -3);
  }
  if (remaining.length > 0) {
    groups.unshift(remaining);
  }

  return "+" + config.code + " " + groups.join(" ");
}

module.exports = {
  COUNTRY_CONFIGS,
  normalizeNumber,
  getCountryConfigs,
  detectCountryFromNumber,
  formatPhoneDisplay,
};
