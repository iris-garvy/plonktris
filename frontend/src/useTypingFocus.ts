import { useEffect, useState } from 'react';

function isTextField(el: EventTarget | Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
}

/**
 * True while a form field has focus — the game/editor should ignore keys then, so typing a
 * puzzle name or a queue doesn't move pieces (or restart the run on Backspace).
 */
export function useTypingFocus(): boolean {
  const [typing, setTyping] = useState(() => isTextField(document.activeElement));
  useEffect(() => {
    const onIn = (e: FocusEvent) => setTyping(isTextField(e.target));
    const onOut = (e: FocusEvent) => setTyping(isTextField(e.relatedTarget));
    document.addEventListener('focusin', onIn);
    document.addEventListener('focusout', onOut);
    return () => {
      document.removeEventListener('focusin', onIn);
      document.removeEventListener('focusout', onOut);
    };
  }, []);
  return typing;
}
