export function mapLocalStorageImport(payload) {
  const errors = []
  const records = []

  for (const [index, record] of (payload.records || []).entries()) {
    if (!record || typeof record !== 'object') {
      errors.push({ index, message: 'Record must be an object' })
      continue
    }
    const { logical_key, record_type, payload: body, source_fingerprint } = record
    if (!logical_key || !record_type || body === undefined) {
      errors.push({ index, message: 'Missing required fields' })
      continue
    }
    records.push({
      logicalKey: logical_key,
      recordType: record_type,
      payload: body,
      sourceFingerprint: source_fingerprint || `${record_type}:${logical_key}`,
    })
  }

  return { records, errors }
}
