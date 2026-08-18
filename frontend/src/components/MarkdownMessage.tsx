import { Fragment, useState, type ReactNode } from 'react'

/**
 * Claude / ChatGPT / Gemini style Markdown renderer for LLM responses.
 *
 * Fully supports:
 * - GFM Tables with alignments (left, center, right), rounded borders, alternate row backgrounds, and scroll container
 * - Fenced code blocks with language header bar and Copy-to-Clipboard button
 * - ATX Headings (h1 - h6) with subtle borders and typography hierarchy
 * - GitHub-style Alerts ([!NOTE], [!TIP], [!IMPORTANT], [!WARNING], [!CAUTION])
 * - Blockquotes with accent line
 * - Ordered and Unordered lists with Task lists (- [x], - [ ])
 * - Inline formatting: bold (**bold**, __bold__), italic (*italic*, _italic_), strikethrough (~~del~~), inline code (`code`), and safe external links
 */

type MarkdownMessageProps = {
  text: string
  className?: string
}

const INLINE_PATTERN = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(__[^_\n]+__)|(\*[^*\n]+\*)|(_[^_\n]+_)|(~~[^~\n]+~~)|(\[[^\]\n]+\]\([^)\s]+\))/g

/** Splits a line into styled inline spans. */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  let index = 0

  INLINE_PATTERN.lastIndex = 0
  while ((match = INLINE_PATTERN.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index))
    }

    const token = match[0]
    const key = `${keyPrefix}-i${index++}`

    if (token.startsWith('`')) {
      nodes.push(<code className="md-inline-code" key={key}>{token.slice(1, -1)}</code>)
    } else if (token.startsWith('**') || token.startsWith('__')) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>)
    } else if (token.startsWith('~~')) {
      nodes.push(<s key={key}>{token.slice(2, -2)}</s>)
    } else if (token.startsWith('[')) {
      const split = token.indexOf('](')
      const label = token.slice(1, split)
      const href = token.slice(split + 2, -1)
      nodes.push(
        <a key={key} href={href} target="_blank" rel="noreferrer noopener" className="md-link">
          {label}
        </a>,
      )
    } else {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>)
    }

    lastIndex = match.index + token.length
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex))
  }

  return nodes.length > 0 ? nodes : [text]
}

/** Strips the leading marker from a list item, or returns null if not one. */
function listItemContent(line: string, ordered: boolean): string | null {
  const match = ordered ? /^\s*\d+[.)]\s+(.*)$/.exec(line) : /^\s*[-*+]\s+(.*)$/.exec(line)
  return match ? match[1] : null
}

/** Determines if a line is a markdown table delimiter row (e.g. |---|:---:|---:|) */
function isTableDelimiter(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed.includes('-')) return false
  const parts = trimmed.split('|').map((s) => s.trim()).filter((s) => s.length > 0)
  if (parts.length === 0) return false
  return parts.every((p) => /^:?-+:?$/.test(p))
}

/** Extracts column alignments ('left' | 'center' | 'right') from delimiter row */
function parseTableAlignments(delimiterLine: string): Array<'left' | 'center' | 'right'> {
  const parts = delimiterLine.trim().split('|').map((s) => s.trim()).filter((s) => s.length > 0)
  return parts.map((p) => {
    const leftColon = p.startsWith(':')
    const rightColon = p.endsWith(':')
    if (leftColon && rightColon) return 'center'
    if (rightColon) return 'right'
    return 'left'
  })
}

/** Splits a table row into cells, handling optional leading/trailing pipes */
function splitTableRow(rowLine: string): string[] {
  let trimmed = rowLine.trim()
  if (trimmed.startsWith('|')) trimmed = trimmed.slice(1)
  if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1)
  return trimmed.split('|').map((cell) => cell.trim())
}

/** Interactive Code Block component with header bar & copy button */
function CodeBlock({ lang, code }: { lang?: string; code: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback if clipboard API is restricted
    }
  }

  return (
    <div className="md-code-block">
      <div className="md-code-header">
        <span className="md-code-lang">{lang || 'text'}</span>
        <button
          type="button"
          className={`md-code-copy-btn ${copied ? 'copied' : ''}`}
          onClick={handleCopy}
          title="Copy code"
        >
          {copied ? (
            <>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span>Copied!</span>
            </>
          ) : (
            <>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <pre className="md-code-content">
        <code>{code}</code>
      </pre>
    </div>
  )
}

/** Renders task item or regular list item */
function renderListItem(content: string, keyPrefix: string): ReactNode {
  const taskMatch = /^\[([ xX])\]\s+(.*)/.exec(content)
  if (taskMatch) {
    const isChecked = taskMatch[1].toLowerCase() === 'x'
    const itemText = taskMatch[2]
    return (
      <span className="md-task-item">
        <input type="checkbox" checked={isChecked} readOnly className="md-task-checkbox" />
        <span className={isChecked ? 'md-task-done' : ''}>{renderInline(itemText, keyPrefix)}</span>
      </span>
    )
  }
  return renderInline(content, keyPrefix)
}

export function MarkdownMessage({ text, className }: MarkdownMessageProps) {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let cursor = 0
  let key = 0

  while (cursor < lines.length) {
    const line = lines[cursor]

    if (!line.trim()) {
      cursor += 1
      continue
    }

    // 1. Fenced code block
    const fence = /^\s*```(\w+)?\s*$/.exec(line)
    if (fence) {
      const body: string[] = []
      const lang = fence[1] || ''
      cursor += 1
      while (cursor < lines.length && !/^\s*```\s*$/.test(lines[cursor])) {
        body.push(lines[cursor])
        cursor += 1
      }
      cursor += 1 // closing fence
      blocks.push(<CodeBlock key={`cb-${key++}`} lang={lang} code={body.join('\n')} />)
      continue
    }

    // 2. Markdown Table (GFM Table)
    if (line.includes('|') && cursor + 1 < lines.length && isTableDelimiter(lines[cursor + 1])) {
      const headerLine = line
      const delimiterLine = lines[cursor + 1]
      const alignments = parseTableAlignments(delimiterLine)
      const headers = splitTableRow(headerLine)
      cursor += 2

      const rows: string[][] = []
      while (cursor < lines.length && lines[cursor].trim().includes('|')) {
        rows.push(splitTableRow(lines[cursor]))
        cursor += 1
      }

      blocks.push(
        <div className="md-table-container" key={`tbl-${key++}`}>
          <table className="md-table">
            <thead>
              <tr>
                {headers.map((h, hIdx) => (
                  <th key={hIdx} style={{ textAlign: alignments[hIdx] || 'left' }}>
                    {renderInline(h, `th-${key}-${hIdx}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rIdx) => (
                <tr key={rIdx}>
                  {row.map((cell, cIdx) => (
                    <td key={cIdx} style={{ textAlign: alignments[cIdx] || 'left' }}>
                      {renderInline(cell, `td-${key}-${rIdx}-${cIdx}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      )
      continue
    }

    // 3. ATX Headings
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      const level = Math.min(heading[1].length, 4)
      const Tag = `h${level + 2 > 6 ? 6 : level + 2}` as 'h3' | 'h4' | 'h5' | 'h6'
      blocks.push(
        <Tag className={`md-h md-h${level}`} key={`h-${key++}`}>
          {renderInline(heading[2], `h${key}`)}
        </Tag>,
      )
      cursor += 1
      continue
    }

    // 4. Horizontal Rule
    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) {
      blocks.push(<hr className="md-rule" key={`hr-${key++}`} />)
      cursor += 1
      continue
    }

    // 5. Blockquotes & GitHub-style Alerts
    if (/^\s*>\s?/.test(line)) {
      const quotedLines: string[] = []
      while (cursor < lines.length && /^\s*>\s?/.test(lines[cursor])) {
        quotedLines.push(lines[cursor].replace(/^\s*>\s?/, ''))
        cursor += 1
      }

      const fullQuote = quotedLines.join('\n').trim()
      const alertMatch = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*([\s\S]*)/i.exec(fullQuote)

      if (alertMatch) {
        const alertType = alertMatch[1].toUpperCase()
        const alertBody = alertMatch[2].trim()
        blocks.push(
          <div className={`md-alert md-alert-${alertType.toLowerCase()}`} key={`alert-${key++}`}>
            <div className="md-alert-header">
              <span className="md-alert-icon">
                {alertType === 'NOTE' && 'ℹ️'}
                {alertType === 'TIP' && '💡'}
                {alertType === 'IMPORTANT' && '📌'}
                {alertType === 'WARNING' && '⚠️'}
                {alertType === 'CAUTION' && '🛑'}
              </span>
              <span className="md-alert-title">{alertType}</span>
            </div>
            <div className="md-alert-body">{renderInline(alertBody, `ab-${key}`)}</div>
          </div>,
        )
      } else {
        blocks.push(
          <blockquote className="md-quote" key={`q-${key++}`}>
            {renderInline(quotedLines.join(' '), `q${key}`)}
          </blockquote>,
        )
      }
      continue
    }

    // 6. Ordered & Unordered Lists
    const ordered = listItemContent(line, true) !== null
    if (ordered || listItemContent(line, false) !== null) {
      const items: string[] = []
      while (cursor < lines.length) {
        const content = listItemContent(lines[cursor], ordered)
        if (content === null) break
        items.push(content)
        cursor += 1
      }
      const ListTag = ordered ? 'ol' : 'ul'
      blocks.push(
        <ListTag className="md-list" key={`list-${key++}`}>
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>{renderListItem(item, `l${key}-${itemIndex}`)}</li>
          ))}
        </ListTag>,
      )
      continue
    }

    // 7. Paragraph
    const paragraph: string[] = []
    while (cursor < lines.length) {
      const next = lines[cursor]
      if (
        !next.trim()
        || /^\s*```/.test(next)
        || /^#{1,6}\s/.test(next)
        || /^\s*>\s?/.test(next)
        || (next.includes('|') && cursor + 1 < lines.length && isTableDelimiter(lines[cursor + 1]))
        || listItemContent(next, true) !== null
        || listItemContent(next, false) !== null
      ) {
        break
      }
      paragraph.push(next.trim())
      cursor += 1
    }
    blocks.push(
      <p className="md-p" key={`p-${key++}`}>
        {renderInline(paragraph.join(' '), `p${key}`)}
      </p>,
    )
  }

  return (
    <div className={className ? `markdown-body ${className}` : 'markdown-body'}>
      {blocks.map((block, i) => (
        <Fragment key={i}>{block}</Fragment>
      ))}
    </div>
  )
}
