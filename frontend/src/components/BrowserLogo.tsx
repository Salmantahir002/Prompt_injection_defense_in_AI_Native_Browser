import type { SVGProps } from 'react'

export interface BrowserLogoProps extends SVGProps<SVGSVGElement> {
  size?: number | string
}

/**
 * Orbit Browser Logo:
 * Features a central terracotta planetary core with two sleek concentric
 * orbital arcs (warm silver and ivory) wrapping around in celestial orbit.
 */
export function BrowserLogo({ size = 20, className = '', ...props }: BrowserLogoProps) {
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      xmlns="http://www.w3.org/2000/svg"
      className={`browser-logo ${className}`.trim()}
      aria-hidden="true"
      {...props}
    >
      {/* Central terracotta planet core */}
      <circle cx="31" cy="32" r="6.2" fill="var(--logo-core, #b94f1c)" className="browser-logo__core" />
      {/* Inner silver/grey orbital arc */}
      <path
        d="M 34.83 17.70 A 14.80 14.80 0 1 1 18.18 39.40"
        fill="none"
        stroke="var(--logo-mid, #b7b2ad)"
        strokeWidth="6.6"
        strokeLinecap="round"
        className="browser-logo__band browser-logo__band--inner"
      />
      {/* Outer ivory/cream orbital arc */}
      <path
        d="M 31.85 7.71 A 24.30 24.30 0 1 1 8.98 42.27"
        fill="none"
        stroke="var(--logo-outer, #f5efe8)"
        strokeWidth="7.4"
        strokeLinecap="round"
        className="browser-logo__band browser-logo__band--outer"
      />
    </svg>
  )
}

export default BrowserLogo
