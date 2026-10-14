import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, unlinkSync, utimesSync, writeFileSync } from 'fs'
import { resolve, join, dirname, isAbsolute, relative } from 'path'
import { tmpdir } from 'os'
import { execFileSync } from 'child_process'
import XLSX from 'xlsx'

const DANGER = 'style="color:#d32f2f;font-weight:bold"'
const TEN_API = process.env.QUTWIKI_XLSX_API || 'https://syncwiki.quters.top'
const CACHE_TTL = 3600000
const FORCE_XLSX_SYNC = process.env.QUTWIKI_XLSX_FORCE === '1'
const MAX_XLSX_BYTES = 20 * 1024 * 1024
const MAX_SHEETS = 20
const MAX_ROWS = 5000
const MAX_COLUMNS = 100

function esc(s: string): string {
  const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }
  return s.replace(/[&<>"]/g, c => map[c] || c)
}

function syncTencentDoc(docUrl: string, cacheDir: string): Buffer | null {
  const match = docUrl.match(/docs\.qq\.com\/sheet\/([A-Za-z0-9]+)/)
  if (!match) return null
  const docId = match[1]

  const cacheFile = join(cacheDir, `${docId}.xlsx`)
  const staleCache = existsSync(cacheFile) ? readFileSync(cacheFile) : null
  if (!FORCE_XLSX_SYNC && staleCache) {
    const age = Date.now() - statSync(cacheFile).mtimeMs
    if (age < CACHE_TTL) return staleCache
  }

  const apiUrl = `${TEN_API}/api/xlsx?url=${encodeURIComponent(docUrl)}`
  const tmpFile = join(tmpdir(), `xlsx_tc_${Date.now()}.xlsx`)
  const scriptFile = join(tmpdir(), `xlsx_tc_fetch_${Date.now()}.js`)
  writeFileSync(scriptFile, [
    'var fs=require("fs");var https=require("https");',
    'https.get(' + JSON.stringify(apiUrl) + ', function(res) {',
    '  if(res.statusCode!==200) process.exit(1);',
    '  var chunks=[];',
    '  var size=0;',
    '  res.on("data",function(c){size+=c.length;if(size>' + MAX_XLSX_BYTES + '){res.destroy();process.exit(1)}chunks.push(c)});',
    '  res.on("end",function(){fs.writeFileSync(' + JSON.stringify(tmpFile) + ',Buffer.concat(chunks))});',
    '}).on("error",function(){process.exit(1)});',
  ].join('\n'))
  try {
    execFileSync(process.execPath, [scriptFile], { timeout: 150000, stdio: 'pipe', windowsHide: true })
    if (existsSync(tmpFile)) {
      const buf = readFileSync(tmpFile)
      mkdirSync(dirname(cacheFile), { recursive: true })
      writeFileSync(cacheFile, buf)
      return buf
    }
  } catch { } finally {
    try { unlinkSync(tmpFile) } catch { }
    try { unlinkSync(scriptFile) } catch { }
  }
  if (staleCache) {
    // 同步失败：沿用旧缓存，并刷新过期时间推迟下次重试，避免每次构建都卡在同步超时上
    try {
      const now = new Date()
      utimesSync(cacheFile, now, now)
    } catch { }
    return staleCache
  }
  return null
}

function isTencentDocUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' &&
      url.hostname === 'docs.qq.com' &&
      url.port === '' &&
      url.username === '' &&
      url.password === '' &&
      /^\/sheet\/[A-Za-z0-9]+$/.test(url.pathname)
  } catch {
    return false
  }
}

function validateWorkbook(workbook: XLSX.WorkBook): void {
  if (workbook.SheetNames.length > MAX_SHEETS) throw new Error(`工作表数量超过限制（${MAX_SHEETS}）`)
  for (const name of workbook.SheetNames) {
    const ref = workbook.Sheets[name]?.['!ref']
    if (!ref) continue
    const range = XLSX.utils.decode_range(ref)
    const rows = range.e.r - range.s.r + 1
    const columns = range.e.c - range.s.c + 1
    if (rows > MAX_ROWS) throw new Error(`工作表「${name}」行数超过限制（${MAX_ROWS}）`)
    if (columns > MAX_COLUMNS) throw new Error(`工作表「${name}」列数超过限制（${MAX_COLUMNS}）`)
  }
}

function sheetToHtml(sheet: XLSX.WorkSheet, keyCols: string[], hideCols: string[], contactCols: string[], avatarCol: string | null, descCol: string | null, tagCols: string[], nameCol: string | null): string {
  const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })
  const rows = rawRows.filter(r => r.some((c: any) => c != null && String(c).trim() !== ''))
  if (rows.length === 0) return '<p>（空表格）</p>'

  const header = rows[0].map((c: any) => String(c).trim())
  const body = rows.slice(1)
  const hideSet = new Set(hideCols)
  const contactSet = new Set(contactCols)
  const tagSet = new Set(tagCols)

  const keyIndices: number[] = []
  for (const k of keyCols) {
    const idx = header.findIndex(h => h === k)
    if (idx === -1) return `<p ${DANGER}>[xlsx] 主键列 "${esc(k)}" 不存在（可用：${header.map(esc).join('、')}）</p>`
    keyIndices.push(idx)
  }

  const avatarIdx = avatarCol ? header.findIndex(h => h === avatarCol) : -1
  if (avatarCol && avatarIdx === -1) return `<p ${DANGER}>[xlsx] 头像列 "${esc(avatarCol)}" 不存在（可用：${header.map(esc).join('、')}）</p>`
  const descIdx = descCol ? header.findIndex(h => h === descCol) : -1
  if (descCol && descIdx === -1) return `<p ${DANGER}>[xlsx] 描述列 "${esc(descCol)}" 不存在（可用：${header.map(esc).join('、')}）</p>`
  const nameIdx = nameCol ? header.findIndex(h => h === nameCol) : -1
  if (nameCol && nameIdx === -1) return `<p ${DANGER}>[xlsx] 名称列 "${esc(nameCol)}" 不存在（可用：${header.map(esc).join('、')}）</p>`

  for (const ki of keyIndices) {
    let lastVal = ''
    for (const row of body) {
      const v = String(row[ki] ?? '').trim()
      if (v) { lastVal = v } else { row[ki] = lastVal }
    }
  }

  const groups = keyIndices.length > 0 ? buildGroups(body, keyIndices[0]) : new Map<string, any[][]>([['', body]])
  const titleIdx = nameIdx >= 0 ? nameIdx : (keyIndices.length >= 2 ? keyIndices[1] : (keyIndices.length === 1 ? keyIndices[0] : -1))
  let html = '<div class="xlsx-cards">\n'

  for (const [gName, gRows] of groups) {
    if (gName) {
      html += `<div class="xlsx-card-group">\n`
      html += `<h3 class="xlsx-card-group-title">${esc(gName)}</h3>\n`
    }
    html += '<div class="xlsx-card-grid">\n'
    for (const row of gRows) {
      html += renderCard(header, row, titleIdx, descIdx, avatarIdx, hideSet, contactSet, tagSet)
    }
    html += '</div>\n'
    if (gName) html += '</div>\n'
  }

  html += '</div>\n'
  return html
}

function buildGroups(body: any[][], keyIdx: number): Map<string, any[][]> {
  const groups = new Map<string, any[][]>()
  for (const row of body) {
    const k = String(row[keyIdx] ?? '').trim()
    if (!k) continue
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k)!.push(row)
  }
  return groups
}

function genAvatarUrl(val: string): string {
  if (!val) return ''
  if (val.startsWith('http://') || val.startsWith('https://')) return val
  return `https://p.qlogo.cn/gh/${val}/${val}/0/`
}

const CONTACT_ICONS: Record<string, string> = {
  qq: '<svg class="xlsx-card-contact-icon" viewBox="0 0 24 24" width="14" height="14" fill="#1EBAFC" aria-hidden="true"><path d="M21.395 15.035a40 40 0 0 0-.803-2.264l-1.079-2.695c.001-.032.014-.562.014-.836C19.526 4.632 17.351 0 12 0S4.474 4.632 4.474 9.241c0 .274.013.804.014.836l-1.08 2.695a39 39 0 0 0-.802 2.264c-1.021 3.283-.69 4.643-.438 4.673.54.065 2.103-2.472 2.103-2.472 0 1.469.756 3.387 2.394 4.771-.612.188-1.363.479-1.845.835-.434.32-.379.646-.301.778.343.578 5.883.369 7.482.189 1.6.18 7.14.389 7.483-.189.078-.132.132-.458-.301-.778-.483-.356-1.233-.646-1.846-.836 1.637-1.384 2.393-3.302 2.393-4.771 0 0 1.563 2.537 2.103 2.472.251-.03.581-1.39-.438-4.673"/></svg>',
  微信: '<svg class="xlsx-card-contact-icon" viewBox="0 0 24 24" width="14" height="14" fill="#07C160" aria-hidden="true"><path d="M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 0 1 .213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.326.326 0 0 0 .167-.054l1.903-1.114a.864.864 0 0 1 .717-.098 10.16 10.16 0 0 0 2.837.403c.276 0 .543-.027.811-.05-.857-2.578.157-4.972 1.932-6.446 1.703-1.415 3.882-1.98 5.853-1.838-.576-3.583-4.196-6.348-8.596-6.348zM5.785 5.991c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178A1.17 1.17 0 0 1 4.623 7.17c0-.651.52-1.18 1.162-1.18zm5.813 0c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178 1.17 1.17 0 0 1-1.162-1.178c0-.651.52-1.18 1.162-1.18zm5.34 2.867c-1.797-.052-3.746.512-5.28 1.786-1.72 1.428-2.687 3.72-1.78 6.22.942 2.453 3.666 4.229 6.884 4.229.826 0 1.622-.12 2.361-.336a.722.722 0 0 1 .598.082l1.584.926a.272.272 0 0 0 .14.047c.134 0 .24-.111.24-.247 0-.06-.023-.12-.038-.177l-.327-1.233a.582.582 0 0 1-.023-.156.49.49 0 0 1 .201-.398C23.024 18.48 24 16.82 24 14.98c0-3.21-2.931-5.837-6.656-6.088V8.89c-.135-.01-.27-.027-.407-.03zm-2.53 3.274c.535 0 .969.44.969.982a.976.976 0 0 1-.969.983.976.976 0 0 1-.969-.983c0-.542.434-.982.97-.982zm4.844 0c.535 0 .969.44.969.982a.976.976 0 0 1-.969.983.976.976 0 0 1-.969-.983c0-.542.434-.982.969-.982z"/></svg>',
}

function renderContact(header: string, value: string, icon: string): string {
  const labeled = value.match(/^((QQ|微信)\s*(?:群|个人))\s*[:：]?\s*(.+)$/i)
  if (labeled) {
    const label = labeled[1].replace(/\s+/g, '')
    const account = labeled[3].trim()
    const leading = CONTACT_ICONS[labeled[2].toLowerCase()] || CONTACT_ICONS[labeled[2]] || icon
    const copyLabel = `${header}：${label} ${account}`
    return `<span class="xlsx-card-contact"><button class="xlsx-card-link" type="button" data-copy="${esc(account)}" data-tip="" title="点击复制${esc(copyLabel)}" onclick="navigator.clipboard.writeText(this.dataset.copy || '').then(() => { this.dataset.tip = '复制成功'; window.setTimeout(() => { this.dataset.tip = '' }, 1200) })">${leading}<span>${esc(account)}</span></button></span>`
  }

  const parts = value.split(/(\d+)/).filter(Boolean)
  const html = parts.map((part) => {
    if (!/^\d+$/.test(part)) return `<span>${esc(part)}</span>`
    const label = `${header}：${part}`
    return `<button class="xlsx-card-link" type="button" data-copy="${esc(part)}" data-tip="" title="点击复制${esc(label)}" onclick="navigator.clipboard.writeText(this.dataset.copy || '').then(() => { this.dataset.tip = '复制成功'; window.setTimeout(() => { this.dataset.tip = '' }, 1200) })">${icon}<span>${esc(part)}</span></button>`
  }).join('')
  return `<span class="xlsx-card-contact">${html}</span>`
}

function renderCard(header: string[], row: any[], titleIdx: number, descIdx: number, avatarIdx: number, hideSet: Set<string>, contactSet: Set<string>, tagSet: Set<string>): string {
  const title = titleIdx >= 0 ? String(row[titleIdx] ?? '').trim() : ''
  const desc = descIdx >= 0 ? String(row[descIdx] ?? '').trim() : ''
  const avatarVal = avatarIdx >= 0 ? String(row[avatarIdx] ?? '').trim() : ''
  const avatarUrl = genAvatarUrl(avatarVal)
  const avatarChar = title ? (title.replace(/[a-zA-Z0-9]/g, '').charAt(0) || title.charAt(0)) : ''

  const LINK_SVG = `<svg class="xlsx-card-link-icon" viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M10.86 8.52a3.3 3.3 0 0 0 0-4.66L9.45 2.45a3.3 3.3 0 0 0-4.66 0a3.3 3.3 0 0 0 0 4.66l.47.47a.75.75 0 0 0 1.06-1.06l-.47-.47a1.8 1.8 0 0 1 2.54-2.54l1.41 1.41a1.8 1.8 0 0 1 0 2.54l-.47.47a.75.75 0 1 0 1.06 1.06z"/><path d="M4.67 7.49a3.3 3.3 0 0 0 0 4.66l1.41 1.41a3.3 3.3 0 0 0 4.66 0a3.3 3.3 0 0 0 0-4.66l-.47-.47a.75.75 0 0 0-1.06 1.06l.47.47a1.8 1.8 0 0 1-2.54 2.54l-1.41-1.41a1.8 1.8 0 0 1 0-2.54l.47-.47a.75.75 0 0 0-1.06-1.06z"/></svg>`

  let tagHtml = ''
  let infoHtml = ''

  for (let i = 0; i < header.length; i++) {
    const val = String(row[i] ?? '').trim()
    if (!val) continue
    if (i === titleIdx) continue
    if (i === descIdx) continue
    if (i === avatarIdx) continue
    if (hideSet.has(header[i])) continue

    if (contactSet.has(header[i])) {
      const parts = val.split(/[\n|｜]/).map(s => s.trim()).filter(Boolean)
      infoHtml += parts.map(v => renderContact(header[i], v, LINK_SVG)).join('')
    } else if (tagSet.size > 0 ? tagSet.has(header[i]) : true) {
      const parts = val.split(/[\n,，]/).map(s => s.trim()).filter(Boolean)
      tagHtml += parts.map(v => `<span class="xlsx-badge">${esc(v)}</span>`).join('')
    }
  }

  let infoSection = ''
  if (infoHtml) {
    infoSection = `<div class="xlsx-card-info">${infoHtml}</div>`
  }

  return `<div class="xlsx-card">
  <div class="xlsx-card-face">
    ${avatarUrl ? `<img class="xlsx-card-blur-bg" src="${esc(avatarUrl)}" alt="">` : ''}
    ${avatarUrl ? `<div class="xlsx-card-banner"><img class="xlsx-card-avatar-el" src="${esc(avatarUrl)}" alt=""></div>` : ''}
    ${!avatarUrl && title ? `<div class="xlsx-card-avatar">${esc(avatarChar)}</div>` : ''}
    <div class="xlsx-card-name">${esc(title)}</div>
    ${desc ? `<div class="xlsx-card-desc">${esc(desc)}</div>\n` : ''}
    ${tagHtml ? `<div class="xlsx-card-tags">${tagHtml}</div>\n` : ''}
    ${infoSection}
  </div>
</div>\n`
}

export function xlsxTablePlugin(md: any, baseDir: string) {
  const origFence = md.renderer.rules.fence || function (tokens: any, idx: number, opts: any, _env: any, self: any) {
    return self.renderToken(tokens, idx, opts)
  }

  md.renderer.rules.fence = (tokens: any, idx: number, opts: any, env: any, self: any) => {
    const token = tokens[idx]
    const info = (token.info || '').trim()

    if (!info.startsWith('xlsx')) {
      return origFence(tokens, idx, opts, env, self)
    }

    let spec = info.slice(4).trim()
    let targetSheet: string | null = null
    let keyCols: string[] = []
    let hideCols: string[] = []
    let contactCols: string[] = []
    let avatarCol: string | null = null
    let descCol: string | null = null
    let tagCols: string[] = []
    let nameCol: string | null = null

    let qs = ''
    const spIdx = spec.indexOf(' ')
    if (spIdx !== -1) {
      qs = spec.slice(spIdx + 1).trim()
      spec = spec.slice(0, spIdx).trim()
    } else {
      const qIdx = spec.indexOf('?')
      if (qIdx !== -1) {
        qs = spec.slice(qIdx + 1)
        spec = spec.slice(0, qIdx).trim()
      }
    }
    if (qs) {
      for (const p of qs.split('&')) {
        const eqIdx = p.indexOf('=')
        if (eqIdx === -1) continue
        const name = p.slice(0, eqIdx).trim()
        const vals = p.slice(eqIdx + 1).split(',').map(s => s.trim()).filter(Boolean)
        if (name === 'key') keyCols = vals
        else if (name === 'hide') hideCols = vals
        else if (name === 'contact') contactCols = vals
        else if (name === 'avatar') avatarCol = vals[0] || null
        else if (name === 'desc') descCol = vals[0] || null
        else if (name === 'tag') tagCols = vals
        else if (name === 'name') nameCol = vals[0] || null
        else if (name === 'sheet' || name === 'table') targetSheet = vals[0] || null
      }
    }

    if (!targetSheet) {
      const hashIdx = spec.indexOf('#')
      if (hashIdx !== -1) { targetSheet = spec.slice(hashIdx + 1).trim(); spec = spec.slice(0, hashIdx).trim() }
    }

    if (!spec) return `<p ${DANGER}>[xlsx] 未指定文件路径</p>`

    const isUrl = spec.startsWith('http://') || spec.startsWith('https://')
    const httpCacheDir = resolve(baseDir, '.http_cache')

    try {
      let wb: XLSX.WorkBook
      if (isUrl) {
        if (isTencentDocUrl(spec)) {
          const buf = syncTencentDoc(spec, httpCacheDir)
          if (!buf || buf.length === 0) return `<p ${DANGER}>[xlsx] 腾讯文档同步失败，请确保后端服务已启动：<br><code>cd code && npm start</code></p>`
          wb = XLSX.read(buf, { type: 'buffer', sheetRows: MAX_ROWS + 1 })
        } else {
          return `<p ${DANGER}>[xlsx] 仅允许 https://docs.qq.com/sheet/ 链接</p>`
        }
      } else {
        const resourcesRoot = realpathSync(resolve(baseDir, 'resources'))
        const requestedPath = resolve(baseDir, spec.replace(/^\//, ''))
        if (!existsSync(requestedPath)) return `<p ${DANGER}>[xlsx] 文件不存在：${esc(spec)}</p>`
        const filePath = realpathSync(requestedPath)
        const resourcePath = relative(resourcesRoot, filePath)
        if (resourcePath.startsWith('..') || isAbsolute(resourcePath)) {
          return `<p ${DANGER}>[xlsx] 本地文件必须位于 docs/resources 目录</p>`
        }
        if (!existsSync(filePath)) return `<p ${DANGER}>[xlsx] 文件不存在：${esc(spec)}</p>`
        if (statSync(filePath).size > MAX_XLSX_BYTES) return `<p ${DANGER}>[xlsx] 文件超过 ${MAX_XLSX_BYTES} 字节限制</p>`
        wb = XLSX.readFile(filePath, { sheetRows: MAX_ROWS + 1 })
      }
      validateWorkbook(wb)
      const names = wb.SheetNames

      if (targetSheet) {
        const sheet = wb.Sheets[targetSheet]
        if (!sheet) return `<p ${DANGER}>[xlsx] 工作表 "${esc(targetSheet)}" 不存在（可用：${names.map(esc).join('、')}）</p>`
        return sheetToHtml(sheet, keyCols, hideCols, contactCols, avatarCol, descCol, tagCols, nameCol)
      }

      if (names.length === 1) return sheetToHtml(wb.Sheets[names[0]], keyCols, hideCols, contactCols, avatarCol, descCol, tagCols, nameCol)

      let out = ''
      for (const name of names) {
        out += `<h3 class="xlsx-sheet-title">${esc(name)}</h3>\n`
        out += sheetToHtml(wb.Sheets[name], keyCols, hideCols, contactCols, avatarCol, descCol, tagCols, nameCol)
      }
      return out
    } catch (e: any) {
      return `<p ${DANGER}>[xlsx] 读取失败：${esc(e.message || String(e))}</p>`
    }
  }
}
