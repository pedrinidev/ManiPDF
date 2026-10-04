/**
 * Permutación de páginas al arrastrar la miniatura `from` sobre la miniatura
 * `to` (índices 0-based): la página arrastrada pasa a OCUPAR la posición de la
 * de destino, y el resto se desplaza. Así se puede mover a cualquier posición,
 * incluida la última.
 */
export function moveIndex(total: number, from: number, to: number): number[] {
  const order = Array.from({ length: total }, (_, i) => i)
  order.splice(from, 1)
  order.splice(to, 0, from)
  return order
}

/** Dónde se insertará la página al soltarla sobre `target`: antes o después de ella. */
export function dropSide(from: number, target: number): 'before' | 'after' | null {
  if (from === target) return null
  return from > target ? 'before' : 'after'
}

/*
 * Selección de miniaturas tras cada operación. Antes se conservaban los mismos
 * índices: tras borrar o reordenar apuntaban a OTRAS páginas (y un segundo
 * «Borrar» se llevaba la siguiente sin querer).
 */

/** Tras reordenar con `order` (índices antiguos en su nuevo orden): cada página sigue seleccionada. */
export function selectionAfterReorder(selected: number[], order: number[]): number[] {
  const newIndex = new Map(order.map((old, index) => [old, index]))
  return selected
    .map((i) => newIndex.get(i))
    .filter((i): i is number => i !== undefined)
    .sort((a, b) => a - b)
}

/** Tras duplicar (cada copia justo detrás de su original): quedan seleccionadas las copias. */
export function selectionAfterDuplicate(selected: number[]): number[] {
  return [...new Set(selected)].sort((a, b) => a - b).map((index, k) => index + k + 1)
}

/** Tras insertar `count` páginas en la posición `at`: quedan seleccionadas las insertadas. */
export function selectionAfterInsert(at: number, count: number): number[] {
  return Array.from({ length: Math.max(0, count) }, (_, i) => at + i)
}
