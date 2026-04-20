import { useState } from 'react'
import { createBackup, listBackups, restoreBackup } from '../services/sharedStateApi'
import styles from './BackupPanel.module.css'

export default function BackupPanel({ workspaceId }) {
  const [backups, setBackups] = useState([])
  const [message, setMessage] = useState('')

  const refresh = async () => {
    if (!workspaceId) return
    try {
      const response = await listBackups(workspaceId)
      setBackups(response.items || [])
    } catch (error) {
      setMessage(error.message)
    }
  }

  const handleCreate = async () => {
    if (!workspaceId) return
    try {
      await createBackup(workspaceId)
      setMessage('Backup created')
      await refresh()
    } catch (error) {
      setMessage(error.message)
    }
  }

  const handleRestore = async (backupId) => {
    try {
      await restoreBackup(workspaceId, backupId)
      setMessage('Backup restored')
      await refresh()
    } catch (error) {
      setMessage(error.message)
    }
  }

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <h3 className={styles.title}>Backups</h3>
        <div className={styles.actions}>
          <button className={styles.button} onClick={refresh} disabled={!workspaceId}>
            Refresh
          </button>
          <button className={styles.button} onClick={handleCreate} disabled={!workspaceId}>
            Create Backup
          </button>
        </div>
      </div>
      {message && <p className={styles.meta}>{message}</p>}
      {backups.length > 0 && (
        <ul className={styles.list}>
          {backups.slice(0, 5).map((backup) => (
            <li key={backup.id} className={styles.item}>
              <span>
                {backup.status} · {new Date(backup.created_at).toLocaleString()}
              </span>
              <button className={styles.restoreBtn} onClick={() => handleRestore(backup.id)}>
                Restore
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
