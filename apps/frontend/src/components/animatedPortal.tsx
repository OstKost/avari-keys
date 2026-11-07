import { useLayoutEffect, useRef, ReactNode } from 'react';
import { createPortal } from 'react-dom';
function AnimatedSurface({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    return () => {
      if (!element || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const clone = element.cloneNode(true) as HTMLDivElement;
      clone.inert = true;
      clone.setAttribute('aria-hidden', 'true');
      clone.classList.add('modal-leaving');
      document.body.appendChild(clone);
      window.setTimeout(() => clone.remove(), 160);
    };
  }, []);
  return <div ref={ref} className="modal-presence">{children}</div>;
}
export function animatedPortal(children: ReactNode, container: Element | DocumentFragment) {
  return createPortal(<AnimatedSurface>{children}</AnimatedSurface>, container);
}
