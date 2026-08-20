/**
 * Colunas (etapas) do quadro Kanban do Suporte.
 *
 * `key` é o valor gravado em `reminders.status` — imutável depois de criada.
 * Renomear muda só o `name`, então nenhuma tarefa existente fica órfã.
 */
export interface SupportColumn {
  id: string
  key: string
  name: string
  color: string
  position: number
  /** Coluna terminal: cair nela marca a tarefa como concluída. */
  isDone: boolean
  createdAt: string
}

/**
 * Etapas que o quadro usa enquanto o backend não responde (ou se o banco ainda
 * não rodou a migração). São as mesmas 4 que a migração semeia, com as keys que
 * as tarefas antigas já gravaram em `reminders.status`.
 */
export const FALLBACK_COLUMNS: SupportColumn[] = [
  { id: 'fallback-todo', key: 'todo', name: 'A Fazer', color: '#9CA3AF', position: 1, isDone: false, createdAt: '' },
  { id: 'fallback-doing', key: 'doing', name: 'Fazendo', color: '#4F8EF7', position: 2, isDone: false, createdAt: '' },
  { id: 'fallback-waiting', key: 'waiting', name: 'Aguardando técnico', color: '#F59E0B', position: 3, isDone: false, createdAt: '' },
  { id: 'fallback-done', key: 'done', name: 'Feito', color: '#10B981', position: 4, isDone: true, createdAt: '' },
]

/** Paleta oferecida ao criar/editar uma coluna (mesma linguagem do Comercial). */
export const COLUMN_COLORS = [
  '#9CA3AF', '#4F8EF7', '#8B5CF6', '#EC4899',
  '#F59E0B', '#F97316', '#DC2626', '#10B981',
]
