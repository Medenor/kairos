import { useState } from 'react'
import { useSharedQuotaState } from './hooks/useSharedQuotaState'
import { useCatalogue } from './hooks/useCatalogue'
import { useNow } from './hooks/useNow'
import TaskPicker from './components/TaskPicker'
import RecoBox from './components/RecoBox'
import SummaryBar from './components/SummaryBar'
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
  const removed = catalogue.removedTombstones
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
    getProviderHistory,
  } = useSharedQuotaState(providers, { catalogue: catalogue.catalogue, removed })
  const [selectedTask, setSelectedTask] = useState(null)
  const surplus = useSurplusStore({ workspaceId, quotaState: state, services: providers, now })

  // The catalogue persists state then definition; readings entered in a form are applied to the live
  // state right after, in the same event.
  function afterChange(result) {
    if (result.ok && result.effects?.stateWrites?.length) applyStateEffects(result.effects)
    return result
  }
  const handleAddProvider = (input) => afterChange(catalogue.addProvider(input, { state, now }))
  const handleUpdateProvider = (id, input) => afterChange(catalogue.updateProvider(id, input, { state, now }))
  const handleDeleteProvider = (id) => afterChange(catalogue.removeProvider(id, { state, now }))

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
        <ProviderManager
          providers={providers}
          stored={catalogue.catalogue.providers}
          state={state}
          runs={surplus.runs}
          now={now}
          onUpdateQuota={updateQuota}
          onConfirmQuotas={confirmQuotas}
          onAdd={handleAddProvider}
          onUpdate={handleUpdateProvider}
          onDelete={handleDeleteProvider}
          notices={{
            conflicts: catalogue.conflicts,
            invalid: catalogue.invalid,
            nameConflicts: catalogue.nameConflicts,
            removedElsewhere: catalogue.removedElsewhere,
          }}
          onResolveConflict={catalogue.resolveConflict}
          onDismissRemoved={catalogue.dismissRemovedNotice}
        />
      </section>

      <section className={styles.historySection}>
        <WeeklyHistoryPanel
          providers={providers}
          removedProviders={removed}
          catalogue={catalogue.catalogue}
          weeklyHistory={weeklyHistory}
          onRefresh={refreshWeeklyHistory}
          getProviderHistory={getProviderHistory}
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
