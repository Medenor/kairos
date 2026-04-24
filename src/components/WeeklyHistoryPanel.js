import { useEffect, useMemo, useState } from 'react'
import { jsxs, jsx } from 'react/jsx-runtime'
import { deriveServiceHistorySeries } from '../utils.js'

const c = {
  panel: 'weekly-history-panel',
  header: 'weekly-history-panel__header',
  headingBlock: 'weekly-history-panel__heading-block',
  kicker: 'weekly-history-panel__kicker',
  title: 'weekly-history-panel__title',
  summary: 'weekly-history-panel__summary',
  controls: 'weekly-history-panel__controls',
  control: 'weekly-history-panel__control',
  controlLabel: 'weekly-history-panel__control-label',
  select: 'weekly-history-panel__select',
  button: 'weekly-history-panel__button',
  archivedNotice: 'weekly-history-panel__archived-notice',
  emptyState: 'weekly-history-panel__empty-state',
  tableWrap: 'weekly-history-panel__table-wrap',
  table: 'weekly-history-panel__table',
  gapRow: 'weekly-history-panel__gap-row',
  weekCell: 'weekly-history-panel__week-cell',
  weekKey: 'weekly-history-panel__week-key',
  recordedBadge: 'weekly-history-panel__recorded-badge',
  gapBadge: 'weekly-history-panel__gap-badge',
  message: 'weekly-history-panel__message',
  gapMessage: 'weekly-history-panel__gap-message',
  quotaList: 'weekly-history-panel__quota-list',
  quotaRow: 'weekly-history-panel__quota-row',
  quotaLabel: 'weekly-history-panel__quota-label',
  quotaValue: 'weekly-history-panel__quota-value',
}

function formatQuotaValue(quota) {
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

function quotaRows(entry) {
  return entry.quotas.map((quota) =>
    jsx(
      'li',
      {
        className: c.quotaRow,
        children: [
          jsx('span', { className: c.quotaLabel, children: quota.label }, 'label'),
          jsx('span', { className: c.quotaValue, children: formatQuotaValue(quota) }, 'value'),
        ],
      },
      quota.quotaId
    )
  )
}

function tableRows(series) {
  return series.entries.map((entry) =>
    jsxs(
      'tr',
      {
        className: entry.status !== 'recorded' ? c.gapRow : undefined,
        children: [
          jsxs('td', {
            children: [
              jsx('div', { className: c.weekCell, children: entry.weekStartDate }),
              jsx('div', { className: c.weekKey, children: entry.weekKey }),
            ],
          }),
          jsxs('td', {
            children: [
              jsx(
                'span',
                {
                  className: entry.status === 'recorded' ? c.recordedBadge : c.gapBadge,
                  children:
                    entry.status === 'recorded'
                      ? 'Recorded'
                      : entry.status === 'missing_service'
                        ? 'Missing service'
                        : 'Missing week',
                }
              ),
              entry.message ? jsx('div', { className: c.message, children: entry.message }) : null,
            ],
          }),
          jsx('td', {
            children:
              entry.status === 'recorded'
                ? jsx('ul', { className: c.quotaList, children: quotaRows(entry) })
                : jsx('span', {
                    className: c.gapMessage,
                    children: 'No quota values were recorded for this week.',
                  }),
          }),
        ],
      },
      `${entry.weekKey}-${entry.status}`
    )
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
  const selectedOption = serviceOptions.find((option) => option.id === selectedServiceId) || serviceOptions[0] || null

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

  const historySummary = !series.entries.length
    ? 'No weekly snapshots are available yet.'
    : series.hasEnoughHistoryForTrends
      ? `${series.recordedWeekCount} recorded weeks`
      : 'At least two recorded weeks are needed to compare trends.'

  const archivedService = selectedOption?.archived

  const handleChange = (event) => {
    const nextServiceId = event.target.value
    if (typeof onSelectService === 'function') {
      onSelectService(nextServiceId)
      return
    }
    setInternalSelectedServiceId(nextServiceId)
  }

  return jsxs('section', {
    className: c.panel,
    'aria-label': 'Weekly history',
    children: [
      jsxs('div', {
        className: c.header,
        children: [
          jsxs('div', {
            className: c.headingBlock,
            children: [
              jsx('div', { className: c.kicker, children: 'Weekly history' }),
              jsx('h2', { className: c.title, children: selectedOption?.label || series.displayName }),
              jsx('p', { className: c.summary, children: historySummary }),
            ],
          }),
          jsxs('div', {
            className: c.controls,
            children: [
              jsxs('label', {
                className: c.control,
                children: [
                  jsx('span', { className: c.controlLabel, children: 'Service' }),
                  jsx('select', {
                    className: c.select,
                    value: selectedServiceId,
                    onChange: handleChange,
                    children: serviceOptions.map((option) =>
                      jsx('option', { value: option.id, children: option.label }, option.id)
                    ),
                  }),
                ],
              }),
              typeof onRefresh === 'function'
                ? jsx('button', {
                    type: 'button',
                    className: c.button,
                    onClick: onRefresh,
                    children: 'Refresh',
                  })
                : null,
            ],
          }),
        ],
      }),
      archivedService
        ? jsx('p', {
            className: c.archivedNotice,
            children: 'Archived service data is preserved from captured snapshot metadata.',
          })
        : null,
      !series.entries.length
        ? jsx('p', {
            className: c.emptyState,
            children: 'No weekly snapshots recorded yet.',
          })
        : jsx('div', {
            className: c.tableWrap,
            children: jsxs('table', {
              className: c.table,
              children: [
                jsx('thead', {
                  children: jsx('tr', {
                    children: [
                      jsx('th', { scope: 'col', children: 'Week' }, 'week'),
                      jsx('th', { scope: 'col', children: 'Status' }, 'status'),
                      jsx('th', { scope: 'col', children: 'Service values' }, 'values'),
                    ],
                  }),
                }),
                jsx('tbody', { children: tableRows(series) }),
              ],
            }),
          }),
    ],
  })
}
