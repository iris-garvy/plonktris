// Dev-only gameplay sandbox: PuzzlePlayer + BoardEditor with sample puzzles, no backend.
// `npm run dev`, then open http://localhost:5173/playground.html
import { StrictMode, useCallback, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import PuzzlePlayer, { type FinishResult, type PuzzlePlayerHandle, type PuzzleSpec } from '../components/PuzzlePlayer';
import BoardEditor from '../components/BoardEditor';
import KeybindingsModal from '../components/KeybindingsModal';
import { PIECE_NAMES, REQUIREMENT_NAMES, emptyBoard, replay, validPuzzleBoard, type Board } from '../game/engine';
import { loadBindings, loadHandling, saveBindings, saveHandling, type Bindings, type Handling } from '../keybindings';
import { SAMPLES, queueFromText } from './samples';
import './playground.css';

function ResultCard({ result, puzzle, onRestart }: { result: FinishResult; puzzle: PuzzleSpec; onRestart: () => void }) {
  const check = replay(puzzle.board, puzzle.queue, puzzle.requirements, result.solution);
  return (
    <div className={`pg-result ${result.success ? 'ok' : 'fail'}`}>
      <div className="pg-result-title">{result.success ? 'solved!' : 'not quite'}</div>
      <div>{(result.timeMs / 1000).toFixed(2)}s · {result.keys} keys · {result.pieces} pieces</div>
      <div>{result.solution.length} actions · replay {check.ok ? 'ok' : `✗ ${check.error}`}</div>
      <button type="button" onClick={onRestart}>again</button>
    </div>
  );
}

function Playground() {
  const [bindings, setBindings] = useState<Bindings>(loadBindings);
  const [handling, setHandling] = useState<Handling>(loadHandling);
  const [showSettings, setShowSettings] = useState(false);
  const [tab, setTab] = useState<'play' | 'edit'>('play');

  const [sampleIdx, setSampleIdx] = useState(0);
  const [custom, setCustom] = useState<PuzzleSpec | null>(null);
  const puzzle: PuzzleSpec = useMemo(() => custom ?? SAMPLES[sampleIdx], [custom, sampleIdx]);
  const [result, setResult] = useState<FinishResult | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const player = useRef<PuzzlePlayerHandle>(null);

  // editor state
  const [editBoard, setEditBoard] = useState<Board>(() => SAMPLES[0].board);
  const [queueText, setQueueText] = useState('TIOLJSZ');
  const editQueue = useMemo(() => queueFromText(queueText), [queueText]);

  const onFinish = useCallback((r: FinishResult) => {
    setResult(r);
    setLog(l => [`finish: success=${r.success} actions=${r.solution.length} keys=${r.keys} ${r.timeMs}ms`, ...l].slice(0, 8));
  }, []);
  const onReset = useCallback(() => {
    setResult(null);
    setLog(l => ['reset', ...l].slice(0, 8));
  }, []);

  const changeBindings = (b: Bindings) => { setBindings(b); saveBindings(b); };
  const changeHandling = (h: Handling) => { setHandling(h); saveHandling(h); };

  const reqText = puzzle.requirements.slice(0, 7)
    .map((v, i) => (v ? `${REQUIREMENT_NAMES[i]} ${v}` : null)).filter(Boolean).join(' · ');

  return (
    <div className="pg">
      <header className="pg-header">
        <span className="pg-logo">plonktris <i>playground</i></span>
        <button type="button" className={tab === 'play' ? 'active' : ''} onClick={() => setTab('play')}>play</button>
        <button type="button" className={tab === 'edit' ? 'active' : ''} onClick={() => setTab('edit')}>edit</button>
        <span className="pg-handling">DAS {handling.das} · ARR {handling.arr} · SD {handling.softDrop || 'instant'}</span>
        <button type="button" className="pg-settings" onClick={() => setShowSettings(true)}>settings</button>
      </header>

      {tab === 'play' && (
        <>
          <div className="pg-samples">
            {SAMPLES.map((s, i) => (
              <button
                key={s.name}
                type="button"
                className={!custom && i === sampleIdx ? 'active' : ''}
                onClick={() => { setCustom(null); setSampleIdx(i); setResult(null); }}
              >
                {s.name}
              </button>
            ))}
            {custom && <button type="button" className="active">custom</button>}
          </div>
          <PuzzlePlayer
            ref={player}
            puzzle={puzzle}
            bindings={bindings}
            handling={handling}
            onFinish={onFinish}
            onReset={onReset}
            disabled={showSettings}
            overlay={result && <ResultCard result={result} puzzle={puzzle} onRestart={() => player.current?.restart()} />}
            sidePanel={
              <div className="pg-side">
                <div className="pg-req">{reqText}</div>
                <div className="pg-queue">{puzzle.queue.map(id => PIECE_NAMES[id]).join('')}</div>
                <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => player.current?.undo()}>undo</button>
                <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => player.current?.restart()}>restart</button>
              </div>
            }
          />
          <pre className="pg-log">{log.join('\n')}</pre>
        </>
      )}

      {tab === 'edit' && (
        <BoardEditor
          board={editBoard}
          onChange={setEditBoard}
          queue={editQueue}
          bindings={bindings}
          handling={handling}
          disabled={showSettings}
          sidePanel={
            <div className="pg-side">
              <input
                className="pg-queue-input"
                value={queueText}
                onChange={e => setQueueText(e.target.value.toUpperCase().replace(/[^IOTSZLJ]/g, '').slice(0, 30))}
                onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                placeholder="queue"
                aria-label="queue"
              />
              <div className="pg-req">{validPuzzleBoard(editBoard) ? 'valid board' : 'INVALID board'}</div>
              <button type="button" onClick={() => setEditBoard(emptyBoard())}>reset (external)</button>
              <button
                type="button"
                disabled={!editQueue.length}
                onClick={() => {
                  setCustom({ board: editBoard, queue: editQueue, requirements: [0, 0, 0, 0, 0, 1, 0, 0] });
                  setResult(null);
                  setTab('play');
                }}
              >
                play it (attack ≥ 1)
              </button>
            </div>
          }
        />
      )}

      {showSettings && (
        <KeybindingsModal
          bindings={bindings}
          onChange={changeBindings}
          handling={handling}
          onHandlingChange={changeHandling}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Playground />
  </StrictMode>,
);
