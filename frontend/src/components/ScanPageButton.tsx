type ScanPageButtonProps = {
  onClick: () => void
  isScanning?: boolean
}

export function ScanPageButton({ onClick, isScanning }: ScanPageButtonProps) {
  return (
    <button
      className="scan-button"
      type="button"
      onClick={onClick}
      disabled={isScanning}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
      {isScanning ? 'Scanning...' : 'Scan'}
    </button>
  )
}
