import { useEffect } from "react";
import { ViewportTransform } from "../types";

export const useKeyboardShortcuts = (
  selectedNodeIds: Set<string>,
  confirmDeleteNode: (ids: string[]) => void,
  setIsSearchOpen: (open: boolean) => void,
  handleCut: (id: string) => void,
  handlePaste: (pos: { x: number; y: number }) => void,
  viewTransform: ViewportTransform,
  toastVisible: boolean,
  toastAction?: () => void
) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement as HTMLElement;
      const isInputActive =
        activeEl &&
        (["INPUT", "TEXTAREA"].includes(activeEl.tagName) ||
          activeEl.isContentEditable);

      // Undo (Ctrl+Z / Cmd+Z)
      if ((e.ctrlKey || e.metaKey) && e.key === "z") {
        if (toastVisible && toastAction) {
          e.preventDefault();
          toastAction();
        }
      }

      // Delete (Delete / Backspace)
      if ((e.key === "Delete" || e.key === "Backspace") && !isInputActive) {
        if (selectedNodeIds.size > 0) {
          e.preventDefault();
          confirmDeleteNode(Array.from(selectedNodeIds));
        }
      }

      // Search (Ctrl+F / Cmd+F)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setIsSearchOpen(true);
      }

      // Cut (Ctrl+X / Cmd+X)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "x") {
        if (selectedNodeIds.size === 1) {
          e.preventDefault();
          handleCut(Array.from(selectedNodeIds)[0]);
        }
      }

      // Paste (Ctrl+V / Cmd+V)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") {
        e.preventDefault();
        handlePaste({
          x: -viewTransform.x / viewTransform.k + window.innerWidth / 2 / viewTransform.k,
          y: -viewTransform.y / viewTransform.k + window.innerHeight / 2 / viewTransform.k,
        });
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    selectedNodeIds,
    confirmDeleteNode,
    setIsSearchOpen,
    handleCut,
    handlePaste,
    viewTransform,
    toastVisible,
    toastAction,
  ]);
};

