import { useEffect, useMemo, useState } from 'react'
import { deriveServiceHistorySeries } from '../utils.js'
import styles from './WeeklyHistoryPanel.module.css'

const STATUS_LABELS = {
  recorded: 'Recorded',
  missing_service: 'Missing service',
  missing_week: 'Missing week',
}

export function formatQuotaValue(quota) {
  if (!quota) return '—'
  const value = quota.value
  if (value === null || value === undefined) return '—'
  if (typeof value !== 'number') return String(value)

  const normalized = Number.isInteger(value)
    ? String(value)
    : value.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')

  if (quota.currency) return `${quota.currency}${normalized}`
  if (quota.type === 'consumed_pct' || quota.type === 'remaining_pct') return `${normalized}%`
  return normalized
}

function buildServiceOptions(services, weeklyHistory) {
  const current = services.map((service) => ({
    id: service.id,
    label: service.name,
    archived: false,
  }))

  const archived = new Map()
  for (const snapshot of weeklyHistory || []) {
    for (const [serviceId, serviceSnapshot] of Object.entries(snapshot.services || {})) {
      if (services.some((service) => service.id === serviceId) || archived.has(serviceId)) continue
      archived.set(serviceId, {
        id: serviceId,
        label:
          serviceSnapshot?.capturedServiceMeta?.serviceName ||
          serviceSnapshot?.serviceName ||
          serviceId,
        archived: true,
      })
    }
  }

  return [...current, ...Array.from(archived.values())]
}

function getHistorySummary(series) {
  if (!series.entries.length) {
    return 'No weekly snapshots yet. History starts from the first week Kairos records.'
  }
  if (!series.hasEnoughHistoryForTrends) {
    return 'Only one recorded week so far. Trends need at least two recorded weeks of data.'
  }
  return `${series.recordedWeekCount} recorded weeks`
}

function QuotaList({ quotas }) {
  return (
    <ul className={styles.quotaList}>
      {quotas.map((quota) => (
        <li key={quota.quotaId} className={styles.quotaRow}>
          <span className={styles.quotaLabel}>{quota.label}</span>
          <span className={styles.quotaValue}>{formatQuotaValue(quota)}</span>
        </li>
      ))}
    </ul>
  )
}

function HistoryRow({ entry }) {
  const recorded = entry.status === 'recorded'
  return (
    <tr className={recorded ? undefined : styles.gapRow}>
      <td>
        <div className={styles.weekCell}>{entry.weekStartDate}</div>
        <div className={styles.weekKey}>{entry.weekKey}</div>
      </td>
      <td>
        <span className={recorded ? styles.recordedBadge : styles.gapBadge}>
          {STATUS_LABELS[entry.status] || 'Missing week'}
        </span>
        {entry.message ? <div className={styles.message}>{entry.message}</div> : null}
      </td>
      <td>
        {recorded ? (
          <QuotaList quotas={entry.quotas} />
        ) : (
          <span className={styles.gapMessage}>No quota values were recorded for this week.</span>
        )}
      </td>
    </tr>
  )
}

export default function WeeklyHistoryPanel({
  services = [],
  weeklyHistory = [],
  selectedServiceId: controlledSelectedServiceId,
  onSelectService,
  onRefresh,
  getServiceHistory,
}) {
  const serviceOptions = useMemo(
    () => buildServiceOptions(services, weeklyHistory),
    [services, weeklyHistory]
  )
  const [internalSelectedServiceId, setInternalSelectedServiceId] = useState(
    serviceOptions[0]?.id || ''
  )

  useEffect(() => {
    if (
      !controlledSelectedServiceId &&
      !serviceOptions.some((option) => option.id === internalSelectedServiceId)
    ) {
      setInternalSelectedServiceId(serviceOptions[0]?.id || '')
    }
  }, [controlledSelectedServiceId, internalSelectedServiceId, serviceOptions])

  const selectedServiceId = controlledSelectedServiceId ?? internalSelectedServiceId
  const selectedOption =
    serviceOptions.find((option) => option.id === selectedServiceId) || serviceOptions[0] || null

  const series = useMemo(() => {
    if (!selectedServiceId) {
      return {
        displayName: 'Weekly history',
        entries: [],
        hasEnoughHistoryForTrends: false,
        recordedWeekCount: 0,
      }
    }

    if (typeof getServiceHistory === 'function') {
      return getServiceHistory(selectedServiceId)
    }

    return deriveServiceHistorySeries({
      history: weeklyHistory,
      serviceId: selectedServiceId,
      services,
    })
  }, [getServiceHistory, selectedServiceId, services, weeklyHistory])

  const handleChange = (event) => {
    const nextServiceId = event.target.value
    if (typeof onSelectService === 'function') {
      onSelectService(nextServiceId)
      return
    }
    setInternalSelectedServiceId(nextServiceId)
  }

  return (
    <section className={styles.panel} aria-label="Weekly history">
      <div className={styles.header}>
        <div className={styles.headingBlock}>
          <div className={styles.kicker}>Weekly history</div>
          <h2 className={styles.title}>{selectedOption?.label || series.displayName}</h2>
          <p className={styles.summary}>{getHistorySummary(series)}</p>
        </div>
        <div className={styles.controls}>
          <label className={styles.control}>
            <span className={styles.controlLabel}>Service</span>
            <select className={styles.select} value={selectedServiceId} onChange={handleChange}>
              {serviceOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {typeof onRefresh === 'function' ? (
            <button type="button" className={styles.button} onClick={onRefresh}>
              Refresh
            </button>
          ) : null}
        </div>
      </div>
      {selectedOption?.archived ? (
        <p className={styles.archivedNotice}>
          Archived service data is preserved from captured snapshot metadata.
        </p>
      ) : null}
      {!series.entries.length ? (
        <p className={styles.emptyState}>No weekly snapshots recorded yet.</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Week</th>
                <th scope="col">Status</th>
                <th scope="col">Service values</th>
              </tr>
            </thead>
            <tbody>
              {series.entries.map((entry) => (
                <HistoryRow key={`${entry.weekKey}-${entry.status}`} entry={entry} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
