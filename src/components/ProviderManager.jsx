import { useState } from 'react'
import DeleteProviderDialog from './DeleteProviderDialog.jsx'
import EmptyState from './EmptyState.jsx'
import ProviderForm from './ProviderForm.jsx'
import ServiceCard from './ServiceCard.jsx'
import { activeRunFor, describeDeletion } from '../providers/activeRun.js'
import { draftFromProvider } from './providerDraft.js'
import styles from './ProviderManager.module.css'

// The provider list and everything that changes it: the empty state, the add form, edit, delete
// confirmation. It holds no rules: forms and dialogs hand input to the handlers, which delegate to the
// pure reducers (src/providers/catalogue.js) and return their `{ ok, errors }` result.
// Props:
//   providers  runtime services in display order       stored   stored providers by id (for edit drafts)
//   state      quota state                              runs     run records (active-run warning)
//   now        shared Date                              onUpdateQuota(id, quotaId, value), onConfirmQuotas(id)
//   onAdd(input), onUpdate(id, input), onDelete(id), onDuplicate(id)  -> reducer result;  onReorder(ids)
//   notices    shared-mode state: { conflicts, invalid, nameConflicts, removedElsewhere }
//   onResolveConflict(key, 'theirs' | 'mine'), onDismissRemoved(id)
export default function ProviderManager({
  providers,
  stored = {},
  state,
  runs = [],
  now,
  onUpdateQuota,
  onConfirmQuotas,
  onAdd,
  onUpdate,
  onDelete,
  onDuplicate,
  onReorder,
  notices = {},
  onResolveConflict,
  onDismissRemoved,
  children,
}) {
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [deletingId, setDeletingId] = useState(null)
  const [focusName, setFocusName] = useState(false)

  function submitAdd(input) {
    const result = onAdd(input)
    if (result?.ok) setAdding(false)
    return result
  }

  function submitEdit(id, input) {
    const result = onUpdate(id, input)
    if (result?.ok) {
      setEditingId(null)
      setFocusName(false)
    }
    return result
  }

  function confirmDelete(id) {
    onDelete(id)
    setDeletingId(null)
  }

  // The copy opens in edit mode with the name focused, so it can be renamed right away.
  function duplicate(id) {
    const result = onDuplicate?.(id)
    if (result?.ok && result.effects?.providerId) {
      setDeletingId(null)
      setFocusName(true)
      setEditingId(result.effects.providerId)
    }
  }

  // Keyboard-operable move buttons (no drag dependency); the order never feeds a rule.
  function move(index, delta) {
    const ids = providers.map((p) => p.id)
    const target = index + delta
    if (target < 0 || target >= ids.length) return
    ;[ids[index], ids[target]] = [ids[target], ids[index]]
    onReorder?.(ids)
  }

  const cardActions = (svc, index) => [
    { label: 'Edit', onClick: () => { setDeletingId(null); setEditingId(svc.id) } },
    { label: 'Duplicate', onClick: () => duplicate(svc.id), title: 'Create a copy with the same settings' },
    { label: 'Move up', onClick: () => move(index, -1), disabled: index === 0, title: 'Show this provider earlier in the list' },
    { label: 'Move down', onClick: () => move(index, 1), disabled: index === providers.length - 1, title: 'Show this provider later in the list' },
    { label: 'Delete', onClick: () => { setEditingId(null); setDeletingId(svc.id) } },
  ]

  const { conflicts = [], invalid = [], nameConflicts = [], removedElsewhere = [] } = notices
  const nameOf = (id) => stored[id]?.name ?? id

  return (
    <div className={styles.region}>
      {conflicts.map((conflict) => (
        <div key={conflict.key} className={styles.notice} role="alert">
          <p>
            <strong>{conflict.name}</strong> was changed on another device
            {conflict.server?.name && conflict.server.name !== conflict.local?.name ? ` (now called "${conflict.server.name}")` : ''}.
            Your version was not saved over theirs.
          </p>
          <div className={styles.noticeActions}>
            <button type="button" className={styles.noticeButton} onClick={() => onResolveConflict?.(conflict.key, 'theirs')}>Keep theirs</button>
            <button type="button" className={styles.noticeButton} onClick={() => onResolveConflict?.(conflict.key, 'mine')}>Reapply mine</button>
          </div>
        </div>
      ))}
      {removedElsewhere.map((entry) => (
        <div key={entry.id} className={styles.notice} role="status">
          <p><strong>{entry.name}</strong> was removed on another device: your change was not applied.</p>
          <div className={styles.noticeActions}>
            <button type="button" className={styles.noticeButton} onClick={() => onDismissRemoved?.(entry.id)}>Dismiss</button>
          </div>
        </div>
      ))}
      {nameConflicts.map((id) => (
        <div key={id} className={styles.notice} role="alert">
          <p>The name <strong>{nameOf(id)}</strong> is used by two providers (created on different devices). Rename one.</p>
          <div className={styles.noticeActions}>
            <button type="button" className={styles.noticeButton}
              onClick={() => { setDeletingId(null); setFocusName(true); setEditingId(id) }}>
              Rename
            </button>
          </div>
        </div>
      ))}
      {invalid.length > 0 && (
        <div className={styles.notice} role="status">
          <p>Some shared provider records are invalid and were not used:</p>
          <ul className={styles.invalidList}>
            {invalid.map((entry) => (
              <li key={entry.key}>
                <code>{entry.key}</code>: {entry.errors.map((e) => `${e.path || 'record'} ${e.message}`).join('; ')}
              </li>
            ))}
          </ul>
        </div>
      )}

      {providers.length === 0 && !adding && <EmptyState onAdd={() => setAdding(true)} />}

      {providers.map((svc, index) => {
        if (editingId === svc.id && stored[svc.id]) {
          return (
            <ProviderForm
              key={`edit-${svc.id}`}
              mode="edit"
              initial={draftFromProvider(stored[svc.id], state)}
              onSubmit={(input) => submitEdit(svc.id, input)}
              onCancel={() => { setEditingId(null); setFocusName(false) }}
              focusName={focusName}
              runWarning={activeRunFor(svc.id, runs) ? describeDeletion(stored[svc.id], runs).runWarning : null}
            />
          )
        }
        return (
          <div key={svc.id}>
            {deletingId === svc.id && stored[svc.id] && (
              <DeleteProviderDialog
                provider={stored[svc.id]}
                runs={runs}
                onConfirm={() => confirmDelete(svc.id)}
                onCancel={() => setDeletingId(null)}
              />
            )}
            <ServiceCard
              svc={svc}
              quotaState={state[svc.id]}
              onUpdate={onUpdateQuota}
              onConfirm={onConfirmQuotas}
              now={now}
              actions={cardActions(svc, index)}
            />
          </div>
        )
      })}

      {adding ? (
        <ProviderForm mode="create" onSubmit={submitAdd} onCancel={() => setAdding(false)} />
      ) : (
        providers.length > 0 && (
          <button type="button" className={styles.addButton} onClick={() => setAdding(true)}>
            Add provider
          </button>
        )
      )}
      {children}
    </div>
  )
}
