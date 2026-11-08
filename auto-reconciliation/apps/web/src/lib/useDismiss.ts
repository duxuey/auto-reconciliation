import { useEffect, type RefObject } from "react";

/** 点击外部或按 Esc 时关闭浮层 */
export function useDismiss(
  ref: RefObject<HTMLElement>,
  open: boolean,
  onClose: () => void
): void {
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    function handlePointer(event: MouseEvent): void {
      if (ref.current !== null && !ref.current.contains(event.target as Node)) {
        onClose();
      }
    }
    function handleKey(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        onClose();
      }
    }
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [ref, open, onClose]);
}
