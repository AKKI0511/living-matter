export default function ControlGuide({ compact = false }: { compact?: boolean }) {
  return <section className={compact ? "control-guide compact" : "control-guide"} aria-label="Controls">
    <h2>Controls</h2>
    <dl className="keyboard-guide">
      <div><dt>Move</dt><dd><kbd>↑ ↓ ← →</kbd><span> / </span><kbd>W A S D</kbd></dd></div>
      <div><dt>Jump</dt><dd><kbd>Space</kbd></dd></div>
      <div><dt>Sprint</dt><dd><kbd>Shift</kbd></dd></div>
    </dl>
    <dl className="finger-guide">
      <div><dt>Move</dt><dd>Left stick</dd></div>
      <div><dt>Jump</dt><dd>↑ button</dd></div>
      <div><dt>Sprint</dt><dd>Push stick further</dd></div>
    </dl>
  </section>;
}
