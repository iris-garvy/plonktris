// On-screen buttons for touch devices. They feed the same InputController as the keyboard, so
// DAS / ARR / soft drop handling applies to held buttons too.
import type { PointerEvent, ReactNode } from 'react';
import { ArrowDown, ArrowDownToLine, ArrowLeft, ArrowRight, RotateCcw, RotateCw, Undo2 } from 'lucide-react';
import type { InputController } from '../game/input';
import type { BindingAction } from '../keybindings';

interface TouchControlsProps {
  controller: InputController;
  noHold?: boolean;
}

export default function TouchControls({ controller, noHold }: TouchControlsProps) {
  const btn = (cmd: BindingAction, label: string, icon: ReactNode, extra = '') => (
    <button
      key={cmd}
      type="button"
      className={`pp-touch-btn ${extra}`}
      aria-label={label}
      disabled={cmd === 'hold' && noHold}
      onPointerDown={(e: PointerEvent<HTMLButtonElement>) => {
        e.preventDefault();
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* inactive pointer */ }
        controller.press(cmd);
      }}
      onPointerUp={() => controller.release(cmd)}
      onPointerCancel={() => controller.release(cmd)}
      onContextMenu={e => e.preventDefault()}
    >
      {icon}
    </button>
  );
  return (
    <div className="pp-touch" role="group" aria-label="game controls">
      {btn('hold', 'hold', <span className="pp-touch-text">hold</span>)}
      {btn('rotateCcw', 'rotate counter-clockwise', <RotateCcw />)}
      {btn('rotateCw', 'rotate clockwise', <RotateCw />)}
      {btn('undo', 'undo', <Undo2 />)}
      {btn('left', 'move left', <ArrowLeft />)}
      {btn('softDrop', 'soft drop', <ArrowDown />)}
      {btn('right', 'move right', <ArrowRight />)}
      {btn('place', 'hard drop', <ArrowDownToLine />, 'primary')}
    </div>
  );
}
