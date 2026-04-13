import { TASKS } from '../data/services'
import styles from './TaskPicker.module.css'

export default function TaskPicker({ selected, onSelect }) {
  return (
    <div className={styles.grid}>
      {TASKS.map((t) => (
        <button
          key={t.id}
          className={`${styles.btn} ${selected === t.id ? styles.selected : ''}`}
          onClick={() => onSelect(t.id)}
        >
          <span className={styles.name}>{t.name}</span>
          <span className={styles.desc}>{t.desc}</span>
        </button>
      ))}
    </div>
  )
}
