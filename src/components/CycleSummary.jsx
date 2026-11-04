import { useMemo } from 'react'
import { SERVICES } from '../data/services'
import { SUPPORTED_SERVICE_IDS } from '../surplus/constants'
import { summariseCycles } from '../surplus/cycles'
import styles from './CycleSummary.module.css'

// Per reset cycle: quota left at reset and the part consumed by automatic runs (FR-022, SC-003).
// `now` defaults to the render time; pass it for reproducible output.

const pct = (value) => `${Math.round(value * 10) / 10}%`

function hoursLabel(hours) {
  return hours >= 48 ? `${Math.round(hours / 24)} days` : `${Math.round(hours)} h`
}

function ServiceCycles({ service, summary }) {
  return (
    <section className={styles.service} aria-label={`${service.name} reset cycles`}>
      <h3 className={styles.serviceTitle}>{service.name}</h3>
      {summary.status !== 'ok' ? (
        <p className={styles.short}>
          History too short: no reset cycle has been recorded yet for {service.name}. The first summary appears
          after a reset, once Kairos has a quota reading from before it.
        </p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Reset</th>
                <th scope="col">Quota left at reset</th>
                <th scope="col">Consumed by runs</th>
              </tr>
            </thead>
            <tbody>
              {summary.cycles.map((cycle) => (
                <tr key={cycle.cycleKey}>
                  <th scope="row" className={styles.date}>
                    {cycle.resetDate}
                  </th>
                  <td>
                    <span className={styles.value}>
                      {cycle.approximate ? '≈ ' : ''}
                      {pct(cycle.quotaLeftAtResetPct)}
                    </span>
                    {cycle.approximate ? (
                      <span
                        className={styles.approx}
                        title="The last reading was older than the freshness limit when the reset happened"
                      >
                        Approximate: last reading {hoursLabel(cycle.readingAgeHoursAtReset)} before reset
                      </span>
                    ) : null}
                  </td>
                  <td>
                    <span className={styles.value}>{pct(cycle.consumedByRunsPct)}</span>
                    <span className={styles.note}>estimated</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

export default function CycleSummary({ cycles = [], runs = [], services = SERVICES, now }) {
  const supported = useMemo(() => services.filter((s) => SUPPORTED_SERVICE_IDS.includes(s.id)), [services])
  const summaries = useMemo(() => {
    const at = now ?? new Date()
    return supported.map((service) => ({
      service,
      summary: summariseCycles({ cycles, runs, serviceId: service.id, now: at }),
    }))
  }, [supported, cycles, runs, now])

  if (summaries.length === 0) return null

  return (
    <section className={styles.panel} aria-label="Reset cycle summary">
      <h2 className={styles.title}>Reset cycles</h2>
      <p className={styles.intro}>
        What was left of the weekly quota when each cycle reset, and the part used by automatic runs.
      </p>
      {summaries.map(({ service, summary }) => (
        <ServiceCycles key={service.id} service={service} summary={summary} />
      ))}
    </section>
  )
}
