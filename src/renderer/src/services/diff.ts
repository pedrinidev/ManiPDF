/** Una operación de diff por líneas. */
export interface DiffOp {
  type: 'same' | 'add' | 'del'
  text: string
}

/**
 * Diff por líneas basado en la subsecuencia común más larga (LCS).
 * `del` = está en A pero no en B; `add` = está en B pero no en A.
 */
export function lineDiff(a: string[], b: string[]): DiffOp[] {
  const m = a.length
  const n = b.length
  // dp[i][j] = longitud de la LCS de a[i:] y b[j:].
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const out: DiffOp[] = []
  let i = 0
  let j = 0
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      out.push({ type: 'same', text: a[i] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: 'del', text: a[i] })
      i++
    } else {
      out.push({ type: 'add', text: b[j] })
      j++
    }
  }
  while (i < m) out.push({ type: 'del', text: a[i++] })
  while (j < n) out.push({ type: 'add', text: b[j++] })
  return out
}
