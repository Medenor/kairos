import { ApiError } from './errors.js'

export function requireFields(payload, fields) {
  if (!payload || typeof payload !== 'object') {
    throw new ApiError(400, 'INVALID_BODY', 'Request body must be a JSON object')
  }

  for (const field of fields) {
    if (payload[field] === undefined || payload[field] === null || payload[field] === '') {
      throw new ApiError(400, 'VALIDATION_ERROR', `Missing required field: ${field}`)
    }
  }
}

export function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => {
      data += chunk
    })
    req.on('end', () => {
      if (!data) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(data))
      } catch {
        reject(new ApiError(400, 'INVALID_JSON', 'Body must be valid JSON'))
      }
    })
    req.on('error', reject)
  })
}
