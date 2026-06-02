type AnalysisDetailsButtonProps = {
  onClick: () => void
}

export function AnalysisDetailsButton({ onClick }: AnalysisDetailsButtonProps) {
  return (
    <button className="analysis-button" type="button" onClick={onClick}>
      View Detailed Analysis
    </button>
  )
}
