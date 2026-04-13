import { useState } from 'react'
import { SERVICES } from './data/services'
import { useQuotaState } from './hooks/useQuotaState'
import ServiceCard from './components/ServiceCard'
import TaskPicker from './components/TaskPicker'
import RecoBox from './components/RecoBox'
import SummaryBar from './components/SummaryBar'
import styles from './App.module.css'

export default function App() {
  const { state, updateQuota, resetAll } = useQuotaState()
  const [selectedTask, setSelectedTask] = useState(null)

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <img src="/logo.webp" className={styles.logo} alt="Kairos Logo" />
          <h1 className={styles.title}>Kairos - AI Quota Router</h1>
        </div>
        <p className={styles.subtitle}>Update your quotas on the fly — get a routing recommendation instantly.</p>
      </header>

      <section>
        <div className={styles.sectionLabel}>Service status</div>
        {SERVICES.map((svc) => (
          <ServiceCard
            key={svc.id}
            svc={svc}
            quotaState={state[svc.id]}
            onUpdate={updateQuota}
          />
        ))}
      </section>

      <section style={{ marginTop: '20px' }}>
        <div className={styles.sectionLabel}>What are you about to do?</div>
        <TaskPicker selected={selectedTask} onSelect={setSelectedTask} />
      </section>

      <section>
        <div className={styles.sectionLabel}>Recommendation</div>
        <RecoBox task={selectedTask} state={state} />
      </section>

      <SummaryBar state={state} onReset={resetAll} />
    </div>
  )
}
