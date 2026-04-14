import { useState } from 'react'
import { SERVICES } from './data/services'
import { useSharedQuotaState } from './hooks/useSharedQuotaState'
import ServiceCard from './components/ServiceCard'
import TaskPicker from './components/TaskPicker'
import RecoBox from './components/RecoBox'
import SummaryBar from './components/SummaryBar'
import MigrationPanel from './components/MigrationPanel'
import BackupPanel from './components/BackupPanel'
import styles from './App.module.css'

export default function App() {
  const { state, updateQuota, resetAll, refreshSync, syncStatus, syncMessage, workspaceId } =
    useSharedQuotaState()
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

      <section>
        <MigrationPanel workspaceId={workspaceId} />
        <BackupPanel workspaceId={workspaceId} />
      </section>

      <SummaryBar
        state={state}
        onReset={resetAll}
        onSync={refreshSync}
        syncStatus={syncStatus}
        syncMessage={syncMessage}
      />
    </div>
  )
}
