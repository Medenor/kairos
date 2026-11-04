// Identifiers (research D1). Provider ids `p_` + 12 base32 characters, quota ids `q_` + 8; never
// derived from a name and never equal to a former fixed service id. Pure: the random source is injected.

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567'
const PROVIDER_ID_RE = /^p_[a-z2-7]{12}$/
const QUOTA_ID_RE = /^q_[a-z2-7]{8}$/

// Service ids of features 001 to 006. Only found in old records; read-only and display only.
export const LEGACY_SERVICE_IDS = Object.freeze(['claude', 'chatgpt', 'copilot', 'openrouter', 'kilocode'])

function defaultRandom() {
  return crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296
}

function token(length, random) {
  let out = ''
  for (let i = 0; i < length; i += 1) out += ALPHABET[Math.floor(random() * ALPHABET.length) % ALPHABET.length]
  return out
}

export const newProviderId = (random = defaultRandom) => `p_${token(12, random)}`
export const newQuotaId = (random = defaultRandom) => `q_${token(8, random)}`

export const isProviderId = (id) => typeof id === 'string' && PROVIDER_ID_RE.test(id)
export const isQuotaId = (id) => typeof id === 'string' && QUOTA_ID_RE.test(id)
export const isLegacyServiceId = (id) => typeof id === 'string' && LEGACY_SERVICE_IDS.includes(id)
export const isKnownServiceRef = (id) => isProviderId(id) || isLegacyServiceId(id)
