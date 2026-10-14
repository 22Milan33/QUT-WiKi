export interface FlinkItem {
  name: string
  link: string
  avatar?: string
  siteshot?: string
  desc?: string
}

const OPEN_RE = /^<flink(\s[^>]*)?>\s*$/
const CLOSE_RE = /^<\/flink\s*>\s*$/
const ITEM_RE = /^-\s+([\w-]+)\s*:\s*(.*)$/
const KV_RE = /^([\w-]+)\s*:\s*(.*)$/

function isSafeLink(value: string): boolean {
  if (/^(\/|\.\/|\.\.\/|#)/.test(value)) return !value.startsWith('//')
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

// 解析 <flink> 容器内的列表，格式：
//   - name: 站点名称
//     link: https://example.com/
//     avatar: 头像
//     descr: 描述（兼容 desc）
//     siteshot: 背景图
function parseFlinkItems(block: string): FlinkItem[] {
  const inner = block
    .replace(/^<flink(\s[^>]*)?>\s*\r?\n/, '')
    .replace(/\r?\n\s*<\/flink\s*>\s*$/, '')
  const items: Record<string, string>[] = []
  let current: Record<string, string> | null = null
  for (const raw of inner.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const item = line.match(ITEM_RE)
    if (item) {
      current = { [item[1]]: item[2] }
      items.push(current)
      continue
    }
    const kv = line.match(KV_RE)
    if (kv && current) current[kv[1]] = kv[2]
  }
  return items
    .filter((it) => it.name && it.link && isSafeLink(it.link))
    .map((it) => ({
      name: it.name!,
      link: it.link!,
      desc: it.desc ?? it.descr,
      avatar: it.avatar,
      siteshot: it.siteshot,
    }))
}

function toComponentTag(items: FlinkItem[]): string {
  const json = JSON.stringify(items)
    .replace(/&/g, '\\u0026')
    .replace(/</g, '\\u003c')
    .replace(/'/g, '\\u0027')
  return `<Flinks :links='${json}' />`
}

export function flinkBlockPlugin(md: any) {
  md.block.ruler.before('html_block', 'flink_block', (state: any, startLine: number, endLine: number, silent: boolean) => {
    const pos = state.bMarks[startLine] + state.tShift[startLine]
    const max = state.eMarks[startLine]
    if (!OPEN_RE.test(state.src.slice(pos, max))) return false

    let line = startLine + 1
    let found = -1
    while (line < endLine) {
      const p = state.bMarks[line] + state.tShift[line]
      const m = state.eMarks[line]
      if (CLOSE_RE.test(state.src.slice(p, m))) {
        found = line
        break
      }
      line++
    }
    if (found === -1) return false
    if (silent) return true

    let block = ''
    for (let i = startLine; i <= found; i++) {
      block += state.src.slice(state.bMarks[i], state.eMarks[i]) + '\n'
    }
    const items = parseFlinkItems(block)
    if (!items.length) return false

    const token = state.push('html_block', '', 0)
    token.map = [startLine, found + 1]
    token.content = toComponentTag(items)
    state.line = found + 1
    return true
  })
}
