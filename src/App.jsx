import { useState } from 'react'
import { SERVICES } from './data/services'
import { useSharedQuotaState } from './hooks/useSharedQuotaState'
import ServiceCard from './components/ServiceCard'
import TaskPicker from './components/TaskPicker'
import RecoBox from './components/RecoBox'
import SummaryBar from './components/SummaryBar'
import MigrationPanel from './components/MigrationPanel'
import BackupPanel from './components/BackupPanel'
import WeeklyHistoryPanel from './components/WeeklyHistoryPanel.jsx'
import IdeaCapture from './components/IdeaCapture'
import IdeaQueue from './components/IdeaQueue'
import SurplusNotice from './components/SurplusNotice'
import SurplusSettings from './components/SurplusSettings'
import RunReview from './components/RunReview'
import CycleSummary from './components/CycleSummary'
import { useSurplusStore } from './hooks/useSurplusStore'
import { globalSwitchState } from './surplus/policy'
import styles from './App.module.css'

export default function App() {
  const {
    state,
    updateQuota,
    confirmQuotas,
    resetAll,
    refreshSync,
    syncStatus,
    syncMessage,
    workspaceId,
    weeklyHistory,
    refreshWeeklyHistory,
    getServiceHistory,
  } = useSharedQuotaState()
  const [selectedTask, setSelectedTask] = useState(null)
  const surplus = useSurplusStore({ workspaceId, quotaState: state })

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <img src="/logo_squared.webp" className={styles.logo} alt="Kairos Logo" />
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
            onConfirm={confirmQuotas}
          />
        ))}
      </section>

      <section className={styles.historySection}>
        <WeeklyHistoryPanel
          services={SERVICES}
          weeklyHistory={weeklyHistory}
          onRefresh={refreshWeeklyHistory}
          getServiceHistory={getServiceHistory}
        />
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
        <div className={styles.sectionLabel}>Expiring surplus</div>
        <SurplusNotice
          evaluation={surplus.evaluation}
          ideas={surplus.ideas}
          services={SERVICES}
          onMarkLaunched={surplus.markLaunchedManually}
          onConfirmQuotas={confirmQuotas}
          lease={surplus.lease}
        />
      </section>

      <section>
        <div className={styles.sectionLabel}>Idea queue</div>
        {!surplus.sharedMode && (
          <p className={styles.subtitle}>
            The queue works on this device. Automatic runs need shared mode and are unavailable until a workspace is set.
          </p>
        )}
        <IdeaCapture onAdd={surplus.addIdea} sharedMode={surplus.sharedMode} />
        <IdeaQueue
          ideas={surplus.ideas}
          invalid={surplus.invalid}
          lease={surplus.lease}
          actions={{
            updateIdea: surplus.updateIdea,
            reorder: surplus.reorder,
            archiveIdea: surplus.archiveIdea,
            deleteIdea: surplus.deleteIdea,
            requestApproval: surplus.requestApproval,
          }}
        />
      </section>

      <section>
        <div className={styles.sectionLabel}>Run results</div>
        <RunReview runs={surplus.runs} ideas={surplus.ideas} onDecision={surplus.decideRun} />
        <CycleSummary cycles={surplus.cycles} runs={surplus.runs} services={SERVICES} />
      </section>

      <section>
        <div className={styles.sectionLabel}>Surplus settings</div>
        <SurplusSettings
          policy={surplus.policy}
          onUpdatePolicy={surplus.updatePolicy}
          services={SERVICES}
          sharedMode={surplus.sharedMode}
          autoRunEnabled={surplus.autoRunEnabled}
          stopIssued={globalSwitchState(surplus.control) === 'stopped'}
          onStopAutoRuns={surplus.stopAutoRuns}
          onSetAutoRunEnabled={surplus.setAutoRunEnabled}
        />
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
