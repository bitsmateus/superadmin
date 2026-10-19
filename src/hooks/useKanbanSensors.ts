import { MouseSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core'

/**
 * Sensores dos kanbans com @dnd-kit.
 *  - Mouse: arrasta depois de 6px (um clique em "editar"/"abrir" não vira arrasto).
 *  - Toque: só arrasta depois de SEGURAR o cartão ~0,25s. Antes, qualquer deslizada de 6px no
 *    cartão já virava arrasto, e no celular era quase impossível rolar as colunas pro lado.
 *    Agora deslizar rola a tela; segurar e arrastar move o cartão.
 */
export function useKanbanSensors() {
  return useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  )
}
