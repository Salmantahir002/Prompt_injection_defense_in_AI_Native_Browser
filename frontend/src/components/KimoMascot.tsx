import { useEffect, useId, useRef, useState } from 'react'
import '../styles/kimo-mascot.css'

/**
 * Kimo — the assistant's mascot.
 *
 * A vector rebuild of the KIMO character render: glass-domed head over a
 * screen face, glossy white shell with orange trim, and two detached floating
 * arms. It is drawn as layered SVG rather than shipped as an image so the
 * arms, head and face are separate nodes that can be animated independently —
 * an image can bob, but it can never wave.
 *
 * Motion is driven by a small routine: the component cycles through "acts"
 * (idle → wave → think → look → cheer) on a timer, and CSS reacts to the
 * `data-act` attribute. Every act's keyframes resolve back to the rest pose so
 * an act can end at any moment without the character snapping. Hovering the
 * full-size mascot interrupts the routine with a wave, then resumes it.
 */

type Act = 'idle' | 'wave' | 'think' | 'look' | 'cheer' | 'nod' | 'shake' | 'spin' | 'point'

/**
 * The performance loop: [act, how long it holds]. Idle beats are kept short
 * so the character reads as lively rather than static — the routine cycles
 * through a gesture every couple of seconds.
 * Durations are whole multiples of each act's keyframe cycle (see
 * kimo-mascot.css) so the gesture completes instead of being cut mid-swing.
 */
const ROUTINE: ReadonlyArray<readonly [Act, number]> = [
  ['idle', 2200],
  ['wave', 2400],
  ['idle', 1800],
  ['nod', 1400],
  ['idle', 2000],
  ['think', 3600],
  ['idle', 1800],
  ['point', 1800],
  ['idle', 2000],
  ['look', 2800],
  ['idle', 1800],
  ['shake', 1400],
  ['idle', 2000],
  ['spin', 1600],
  ['idle', 2200],
  ['cheer', 2200],
]

const WAVE_MS = 2400
const ENTRY_MS = 900

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(REDUCED_MOTION_QUERY).matches,
  )

  useEffect(() => {
    const query = window.matchMedia(REDUCED_MOTION_QUERY)
    const handleChange = () => setReduced(query.matches)
    query.addEventListener('change', handleChange)
    return () => query.removeEventListener('change', handleChange)
  }, [])

  return reduced
}

/**
 * One arm, drawn for the right-hand side of the body. The left arm reuses the
 * same geometry through a mirroring transform, so both stay identical.
 *
 * Note the mirror lives on an inner <g>: the outer arm group is the one CSS
 * rotates, and a CSS transform would otherwise replace the mirror attribute.
 */
function KimoArm({ uid }: { uid: string }) {
  return (
    <g>
      {/* Shoulder ball — the arm floats free of the body, held by the joint glow. */}
      <circle cx="158" cy="120" r="11.5" fill={`url(#${uid}-shell)`} stroke="#ffb057" strokeWidth="1.8" />
      <circle cx="158" cy="120" r="5" fill="#2b1608" stroke="#ffc178" strokeWidth="1.3" />

      {/* Upper arm into the elbow joint. */}
      <path d="M159 130l5 10" stroke={`url(#${uid}-shell)`} strokeWidth="14" strokeLinecap="round" />
      <path d="M159 130l5 10" stroke="#ff9f2d" strokeWidth="14" strokeLinecap="round" opacity="0.14" />
      <circle cx="164" cy="144" r="8.4" fill={`url(#${uid}-shell)`} stroke="#ff9f2d" strokeWidth="1.9" />

      {/* Forearm. */}
      <path d="M165 151l1.5 7" stroke={`url(#${uid}-shell)`} strokeWidth="12.5" strokeLinecap="round" />

      {/* Open hand: palm, three fingers and a thumb, as in the render. */}
      <ellipse cx="167" cy="166" rx="9.8" ry="10.4" fill={`url(#${uid}-shell)`} stroke="#ffbe74" strokeWidth="1.3" />
      <g stroke={`url(#${uid}-shell)`} strokeWidth="4.4" strokeLinecap="round">
        <path d="M161.4 173.6l-1.6 5.6" />
        <path d="M167 175.4l0.4 6" />
        <path d="M172.4 173l2 5" />
      </g>
      <g stroke="#ff9f2d" strokeWidth="1.2" strokeLinecap="round" opacity="0.8">
        <path d="M161.4 175l-1.2 4" />
        <path d="M167 177l0.3 4.4" />
        <path d="M172.2 174.6l1.4 3.4" />
        <path d="M159.4 161.6a5.4 5.4 0 0 1 1.8-4.2" />
      </g>
      <path d="M158.6 164.6l-6 2.4" stroke={`url(#${uid}-shell)`} strokeWidth="5" strokeLinecap="round" />
    </g>
  )
}

export function KimoMascot({ compact = false }: { compact?: boolean }) {
  const uid = useId().replace(/:/g, '')
  const reduced = usePrefersReducedMotion()
  const [act, setAct] = useState<Act>('idle')
  const timerRef = useRef<number | null>(null)
  const indexRef = useRef(0)
  // Lets the hover gesture hand control back to the routine when it finishes.
  const resumeRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (reduced) return

    // Each mascot on screen enters the routine at a different point, so the
    // header and the welcome character never gesture in lockstep.
    indexRef.current = Math.floor(Math.random() * ROUTINE.length)

    function advance() {
      const [nextAct, holdMs] = ROUTINE[indexRef.current % ROUTINE.length]
      indexRef.current += 1
      setAct(nextAct)
      timerRef.current = window.setTimeout(advance, holdMs)
    }

    resumeRef.current = advance
    // A beat of stillness first, so the character settles in before it acts.
    timerRef.current = window.setTimeout(advance, ENTRY_MS)

    return () => {
      resumeRef.current = null
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    }
  }, [reduced])

  const handlePointerEnter = () => {
    const resume = resumeRef.current
    if (reduced || compact || !resume) return
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    setAct('wave')
    timerRef.current = window.setTimeout(resume, WAVE_MS)
  }

  return (
    <svg
      className={`kimo ${compact ? 'kimo--compact' : ''}`}
      data-act={reduced ? 'idle' : act}
      viewBox="0 0 200 200"
      fill="none"
      role="img"
      aria-label="Kimo"
      onPointerEnter={handlePointerEnter}
    >
      <defs>
        {/* Glossy white shell: lit from the upper left, shading to warm grey. */}
        <linearGradient id={`${uid}-shell`} x1="58" y1="86" x2="150" y2="190" gradientUnits="userSpaceOnUse">
          <stop stopColor="#ffffff" />
          <stop offset="0.52" stopColor="#f2f4f7" />
          <stop offset="1" stopColor="#c9ced6" />
        </linearGradient>
        <linearGradient id={`${uid}-shell-soft`} x1="70" y1="96" x2="132" y2="188" gradientUnits="userSpaceOnUse">
          <stop stopColor="#ffffff" />
          <stop offset="1" stopColor="#dde1e8" />
        </linearGradient>
        {/* Signature orange, matching the product's amber accents. */}
        <linearGradient id={`${uid}-orange`} x1="60" y1="100" x2="140" y2="186" gradientUnits="userSpaceOnUse">
          <stop stopColor="#ffb443" />
          <stop offset="0.5" stopColor="#ff8b1f" />
          <stop offset="1" stopColor="#e8630c" />
        </linearGradient>
        <linearGradient id={`${uid}-screen`} x1="74" y1="52" x2="126" y2="94" gradientUnits="userSpaceOnUse">
          <stop stopColor="#2a1608" />
          <stop offset="1" stopColor="#0b0503" />
        </linearGradient>
        {/* The dome reads as glass: a bright rim, almost nothing in the middle. */}
        <linearGradient id={`${uid}-glass`} x1="76" y1="36" x2="128" y2="98" gradientUnits="userSpaceOnUse">
          <stop stopColor="#ffffff" stopOpacity="0.2" />
          <stop offset="0.42" stopColor="#ffffff" stopOpacity="0.03" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0.12" />
        </linearGradient>
        <radialGradient id={`${uid}-thruster`} cx="0.5" cy="0.5" r="0.5">
          <stop stopColor="#bfe6ff" stopOpacity="0.95" />
          <stop offset="0.55" stopColor="#63b8ff" stopOpacity="0.5" />
          <stop offset="1" stopColor="#3b9dff" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${uid}-aura`} cx="0.5" cy="0.5" r="0.5">
          <stop stopColor="#ff9f2d" stopOpacity="0.26" />
          <stop offset="1" stopColor="#ff9f2d" stopOpacity="0" />
        </radialGradient>

        {/* Trim and screen graphics are painted wide, then clipped to the shell
            so they hug the silhouette exactly instead of spilling past it. */}
        <clipPath id={`${uid}-body-clip`}>
          <path d="M100 92c24 0 40 7 40 20v10c7 10 10 24 10 34 0 18-18 32-50 32s-50-14-50-32c0-10 3-24 10-34V112c0-13 16-20 40-20z" />
        </clipPath>
        <clipPath id={`${uid}-screen-clip`}>
          <rect x="72" y="50" width="56" height="44" rx="10" />
        </clipPath>
      </defs>

      {!compact ? <ellipse className="kimo__aura" cx="100" cy="110" rx="96" ry="88" fill={`url(#${uid}-aura)`} /> : null}
      {!compact ? <ellipse className="kimo__floor" cx="100" cy="193" rx="48" ry="9" fill={`url(#${uid}-thruster)`} /> : null}

      <g className="kimo__float">
        {/* Arms sit behind the shell so a raised arm sweeps cleanly past it. */}
        <g className="kimo__arm kimo__arm--left">
          <g transform="translate(200, 0) scale(-1, 1)">
            <KimoArm uid={uid} />
          </g>
        </g>
        <g className="kimo__arm kimo__arm--right">
          <KimoArm uid={uid} />
        </g>

        <g className="kimo__body">
          <path
            d="M100 92c24 0 40 7 40 20v10c7 10 10 24 10 34 0 18-18 32-50 32s-50-14-50-32c0-10 3-24 10-34V112c0-13 16-20 40-20z"
            fill={`url(#${uid}-shell)`}
          />

          <g clipPath={`url(#${uid}-body-clip)`}>
            {/* Curved orange side panels. */}
            <path d="M63 108c-9 15-12 33-8 50 2 9 6 16 11 22" stroke={`url(#${uid}-orange)`} strokeWidth="13" strokeLinecap="round" />
            <path d="M137 108c9 15 12 33 8 50-2 9-6 16-11 22" stroke={`url(#${uid}-orange)`} strokeWidth="13" strokeLinecap="round" />
            <path d="M69 110c-8 15-11 32-7 48" stroke="#ffd9a8" strokeWidth="2.2" strokeLinecap="round" opacity="0.85" />
            <path d="M131 110c8 15 11 32 7 48" stroke="#ffd9a8" strokeWidth="2.2" strokeLinecap="round" opacity="0.85" />

            {/* Shell seams — thin glowing panel gaps. */}
            <path d="M70 106h60" stroke="#ff9f2d" strokeWidth="1.6" strokeLinecap="round" opacity="0.55" />
            <path d="M64 174q36 14 72 0" stroke={`url(#${uid}-orange)`} strokeWidth="5" strokeLinecap="round" />
            <path d="M62 182q38 12 76 0" stroke="#ff9f2d" strokeWidth="1.4" strokeLinecap="round" opacity="0.5" />

            {/* Chest plate. */}
            <rect x="90" y="102" width="20" height="7" rx="3.5" fill={`url(#${uid}-orange)`} />
            <rect x="75" y="112" width="50" height="54" rx="14" fill={`url(#${uid}-shell-soft)`} stroke="#ff9f2d" strokeWidth="1.3" strokeOpacity="0.5" />
            <path d="M82 118h36" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" opacity="0.7" />

            {/* K badge. */}
            <rect className="kimo__badge" x="92" y="120" width="16" height="16" rx="5.5" fill={`url(#${uid}-orange)`} />
            <g stroke="#fff7ec" strokeWidth="1.5" strokeLinecap="round">
              <path d="M97 124.5v7" />
              <path d="M97 128l4.6-3.5" />
              <path d="M97 128l4.6 3.6" />
            </g>

            {/* KIMO wordmark, drawn as strokes so it never depends on a font. */}
            <g className="kimo__detail" stroke={`url(#${uid}-orange)`} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M80 144v10M80 149l5.6-5M80 149l5.6 5" />
              <path d="M90.5 144v10" />
              <path d="M95 154v-10l4.6 6 4.6-6v10" />
              <rect x="109" y="144" width="8.4" height="10" rx="4.2" />
            </g>

            {/* Status lamps. */}
            <g className="kimo__detail">
              <circle cx="82" cy="171" r="5.4" fill="#33200e" stroke={`url(#${uid}-orange)`} strokeWidth="1.8" />
              <circle cx="118" cy="171" r="5.4" fill="#33200e" stroke={`url(#${uid}-orange)`} strokeWidth="1.8" />
              <path d="M69 128v10" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" opacity="0.55" />
            </g>

            {/* Specular highlight down the left of the shell. */}
            <path d="M74 104c-8 18-11 40-7 60" stroke="#ffffff" strokeWidth="7" strokeLinecap="round" opacity="0.5" />
          </g>

          {/* Underside thruster glow. */}
          <ellipse className="kimo__thruster" cx="100" cy="186" rx="24" ry="7" fill={`url(#${uid}-thruster)`} />
        </g>

        <g className="kimo__head">
          {/* Collar ring where the dome meets the shell. */}
          <rect x="62" y="88" width="76" height="14" rx="7" fill={`url(#${uid}-shell)`} stroke="#ffb057" strokeWidth="1.4" />
          <path d="M66 92q34-7 68 0" stroke={`url(#${uid}-orange)`} strokeWidth="3.4" strokeLinecap="round" />

          {/* Screen face inside the glass. */}
          <rect x="70" y="48" width="60" height="48" rx="12" fill="#1b0e05" opacity="0.9" />
          <rect x="72" y="50" width="56" height="44" rx="10" fill={`url(#${uid}-screen)`} stroke="#ffb057" strokeWidth="1.2" strokeOpacity="0.45" />

          <g clipPath={`url(#${uid}-screen-clip)`}>
            {/* Faint circuitry, as on the render's display. Kept to two clean
                traces — anything finer turns to noise at sidebar sizes. */}
            <g className="kimo__detail" stroke="#ff9f2d" strokeWidth="1" opacity="0.32" strokeLinecap="round" fill="none">
              <path d="M103 89h9l4-4h9" />
              <path d="M112 89v-4" />
            </g>
            <rect className="kimo__shine" x="-30" y="44" width="16" height="60" fill="#ffffff" opacity="0.06" transform="skewX(-16)" />
          </g>

          <g className="kimo__face">
            {/* Resting expression: the render's arched, smiling eyes. */}
            <g className="kimo__eyes kimo__eyes--rest" stroke="#ff9f2d" strokeWidth="6" strokeLinecap="round">
              <path d="M79 73q7-12 14 0" />
              <path d="M107 73q7-12 14 0" />
            </g>
            {/* Alert expression, used while thinking and looking around. */}
            <g className="kimo__eyes kimo__eyes--wide" fill="#ff9f2d">
              <rect x="80" y="62" width="12" height="13" rx="6" />
              <rect x="108" y="62" width="12" height="13" rx="6" />
            </g>
            <path className="kimo__mouth kimo__mouth--rest" d="M92 83q8 6 16 0" stroke="#ff9f2d" strokeWidth="3.6" strokeLinecap="round" />
            <ellipse className="kimo__mouth kimo__mouth--think" cx="100" cy="84" rx="4" ry="4.6" stroke="#ff9f2d" strokeWidth="2.6" />
          </g>

          {/* Glass dome over the face: nearly clear, carried by its rim and two
              specular streaks rather than by fill. */}
          <path
            d="M64.2 96a42 42 0 1 1 71.6 0z"
            fill={`url(#${uid}-glass)`}
            stroke="#ffffff"
            strokeOpacity="0.5"
            strokeWidth="1.8"
          />
          <path d="M76 82a32 32 0 0 1 13-30" stroke="#ffffff" strokeOpacity="0.72" strokeWidth="3.6" strokeLinecap="round" fill="none" />
          <path d="M118 42a31 31 0 0 1 10 16" stroke="#ffffff" strokeOpacity="0.4" strokeWidth="2.6" strokeLinecap="round" fill="none" />
          {/* Light bouncing up off the white shell into the base of the glass. */}
          <path d="M67 92a40 40 0 0 0 66 0" stroke="#ffffff" strokeOpacity="0.22" strokeWidth="3" strokeLinecap="round" fill="none" />
        </g>

        {/* Thought bubbles, shown only while thinking. */}
        {!compact ? (
          <g className="kimo__thought" fill="#ffc178">
            <circle className="kimo__thought-dot" cx="146" cy="52" r="3" />
            <circle className="kimo__thought-dot" cx="156" cy="40" r="4.2" />
            <circle className="kimo__thought-dot" cx="169" cy="26" r="5.6" />
          </g>
        ) : null}
      </g>

      {!compact ? (
        <g className="kimo__sparks">
          <path className="kimo__spark" d="M26 62l2.4 5.6L34 70l-5.6 2.4L26 78l-2.4-5.6L18 70l5.6-2.4L26 62z" fill="#ffd08a" />
          <circle className="kimo__spark" cx="174" cy="96" r="2.8" fill="#ff9f2d" />
          <circle className="kimo__spark" cx="34" cy="140" r="2.2" fill="#ffe1b5" />
        </g>
      ) : null}
    </svg>
  )
}
