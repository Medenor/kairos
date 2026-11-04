import { useState } from 'react'
import ProviderForm from './ProviderForm.jsx'
import styles from './ProviderManager.module.css'

// Entry point of provider management: the "Add provider" button and the form region. Later stories
// extend it (edit, duplicate, reorder, delete, shared-mode notices).
// Props: onAdd(input) -> {ok, errors?}; openRequest (number, bumped by the empty state to open the form).
export default function ProviderManager({ onAdd, openRequest = 0, children }) {
  const [openedFor, setOpenedFor] = useState(0)
  const [manualOpen, setManualOpen] = useState(false)
  // The empty state asks to open the form by bumping `openRequest`; closing remembers that bump.
  const open = manualOpen || openRequest > openedFor

  function close() {
    setManualOpen(false)
    setOpenedFor(openRequest)
  }

  function submit(input) {
    const result = onAdd(input)
    if (result?.ok) close()
    return result
  }

  return (
    <div className={styles.region}>
      {open ? (
        <ProviderForm mode="create" onSubmit={submit} onCancel={close} />
      ) : (
        <button type="button" className={styles.addButton} onClick={() => setManualOpen(true)}>
          Add provider
        </button>
      )}
      {children}
    </div>
  )
}
