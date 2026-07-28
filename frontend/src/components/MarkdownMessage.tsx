import { Fragment, type ReactNode } from 'react'

/**
 * Minimal markdown renderer for LLM replies.
 *
 * The model answers in markdown, so rendering the raw string leaves `**bold**`
 * and `###` fragments in the transcript. Everything is built as React nodes —
 * never `dangerouslySetInnerHTML` — because model output is untrusted content
 * in this app and must never be able to inject markup into the sidebar.
 *
 * Supported: ATX headings, fenced and indented-free code blocks, unordered and
 * ordered lists, blockquotes, horizontal rules, and inline bold / italic /
 * strikethrough / code / links.
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
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>)
    } else if (token.startsWith('**') || token.startsWith('__')) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>)
    } else if (token.startsWith('~~')) {
      nodes.push(<s key={key}>{token.slice(2, -2)}</s>)
    } else if (token.startsWith('[')) {
      const split = token.indexOf('](')
      const label = token.slice(1, split)
      const href = token.slice(split + 2, -1)
      // Links open in the user's browser, never in the agent-controlled tab.
      nodes.push(
        <a key={key} href={href} target="_blank" rel="noreferrer noopener">
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

    // Fenced code block — held verbatim, including any markdown inside it.
    const fence = /^\s*```(\w+)?\s*$/.exec(line)
    if (fence) {
      const body: string[] = []
      cursor += 1
      while (cursor < lines.length && !/^\s*```\s*$/.test(lines[cursor])) {
        body.push(lines[cursor])
        cursor += 1
      }
      cursor += 1 // closing fence (or end of input)
      blocks.push(
        <pre className="md-code" key={`b${key++}`}>
          {fence[1] ? <span className="md-code-lang">{fence[1]}</span> : null}
          <code>{body.join('\n')}</code>
        </pre>,
      )
      continue
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      const level = Math.min(heading[1].length, 4)
      const Tag = `h${level + 2 > 6 ? 6 : level + 2}` as 'h3' | 'h4' | 'h5' | 'h6'
      blocks.push(
        <Tag className={`md-h md-h${level}`} key={`b${key++}`}>
          {renderInline(heading[2], `h${key}`)}
        </Tag>,
      )
      cursor += 1
      continue
    }

    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) {
      blocks.push(<hr className="md-rule" key={`b${key++}`} />)
      cursor += 1
      continue
    }

    if (/^\s*>\s?/.test(line)) {
      const quoted: string[] = []
      while (cursor < lines.length && /^\s*>\s?/.test(lines[cursor])) {
        quoted.push(lines[cursor].replace(/^\s*>\s?/, ''))
        cursor += 1
      }
      blocks.push(
        <blockquote className="md-quote" key={`b${key++}`}>
          {renderInline(quoted.join(' '), `q${key}`)}
        </blockquote>,
      )
      continue
    }

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
        <ListTag className="md-list" key={`b${key++}`}>
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>{renderInline(item, `l${key}-${itemIndex}`)}</li>
          ))}
        </ListTag>,
      )
      continue
    }

    // Paragraph — consecutive plain lines join into one, as markdown does.
    const paragraph: string[] = []
    while (cursor < lines.length) {
      const next = lines[cursor]
      if (
        !next.trim()
        || /^\s*```/.test(next)
        || /^#{1,6}\s/.test(next)
        || /^\s*>\s?/.test(next)
        || listItemContent(next, true) !== null
        || listItemContent(next, false) !== null
      ) {
        break
      }
      paragraph.push(next.trim())
      cursor += 1
    }
    blocks.push(
      <p className="md-p" key={`b${key++}`}>
        {renderInline(paragraph.join(' '), `p${key}`)}
      </p>,
    )
  }

  return <div className={className ? `markdown-body ${className}` : 'markdown-body'}>{blocks.map((block, i) => <Fragment key={i}>{block}</Fragment>)}</div>
}
