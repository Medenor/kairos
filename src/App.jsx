import { useState } from 'react'
import { useSharedQuotaState } from './hooks/useSharedQuotaState'
import { useCatalogue } from './hooks/useCatalogue'
import { useNow } from './hooks/useNow'
import ServiceCard from './components/ServiceCard'
import TaskPicker from './components/TaskPicker'
import RecoBox from './components/RecoBox'
import SummaryBar from './components/SummaryBar'
import EmptyState from './components/EmptyState'
import ProviderManager from './components/ProviderManager'
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
  const now = useNow()
  const catalogue = useCatalogue()
  const providers = catalogue.runtimeProviders
  const [openRequest, setOpenRequest] = useState(0)
  const {
    state,
    updateQuota,
    confirmQuotas,
    applyStateEffects,
    resetAll,
    refreshSync,
    syncStatus,
    syncMessage,
    workspaceId,
    weeklyHistory,
    refreshWeeklyHistory,
    getServiceHistory,
  } = useSharedQuotaState(providers)
  const [selectedTask, setSelectedTask] = useState(null)
  const surplus = useSurplusStore({ workspaceId, quotaState: state, services: providers, now })

  // Readings entered with the form are applied right after the catalogue persisted state then definition.
  function handleAddProvider(input) {
    const result = catalogue.addProvider(input, { state, now })
    if (result.ok) applyStateEffects(result.effects)
    return result
  }

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
        <div className={styles.sectionLabel}>Providers</div>
        {providers.length === 0 && <EmptyState onAdd={() => setOpenRequest((n) => n + 1)} />}
        {providers.map((svc) => (
          <ServiceCard
            key={svc.id}
            svc={svc}
            quotaState={state[svc.id]}
            onUpdate={updateQuota}
            onConfirm={confirmQuotas}
            now={now}
          />
        ))}
        <ProviderManager onAdd={handleAddProvider} openRequest={openRequest} />
      </section>

      <section className={styles.historySection}>
        <WeeklyHistoryPanel
          services={providers}
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
        <RecoBox task={selectedTask} providers={providers} state={state} now={now} />
      </section>

      <section>
        <div className={styles.sectionLabel}>Expiring surplus</div>
        <SurplusNotice
          evaluation={surplus.evaluation}
          ideas={surplus.ideas}
          services={providers}
          now={now}
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
        <RunReview runs={surplus.runs} ideas={surplus.ideas} onDecision={surplus.decideRun} services={providers} />
        <CycleSummary cycles={surplus.cycles} runs={surplus.runs} services={providers} now={now} />
      </section>

      <section>
        <div className={styles.sectionLabel}>Surplus settings</div>
        <SurplusSettings
          policy={surplus.policy}
          onUpdatePolicy={surplus.updatePolicy}
          services={providers}
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
        providers={providers}
        state={state}
        onReset={resetAll}
        onSync={refreshSync}
        syncStatus={syncStatus}
        syncMessage={syncMessage}
      />
    </div>
  )
}
