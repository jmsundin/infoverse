import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act, screen } from '@testing-library/react';
import React from 'react';

/**
 * Touch Gesture Logic Tests
 *
 * These tests verify the touch gesture detection logic used in Canvas.tsx.
 * We test the gesture logic in isolation using a minimal test component
 * that mimics the Canvas touch handling behavior.
 */

// Minimal component that replicates Canvas touch gesture logic
function TouchGestureTestComponent({
  onContextMenu,
}: {
  onContextMenu: (x: number, y: number) => void;
}) {
  const twoFingerTapStartTimeRef = React.useRef<number | null>(null);
  const twoFingerLongPressStartPointRef = React.useRef<{ x: number; y: number } | null>(null);
  const twoFingerLongPressTimerRef = React.useRef<number | null>(null);
  const longPressContextMenuTimerRef = React.useRef<number | null>(null);
  const longPressContextMenuStartPointRef = React.useRef<{ x: number; y: number } | null>(null);
  const longPressContextMenuOpenedRef = React.useRef(false);
  const lastTapRef = React.useRef(0);

  const cancelLongPressContextMenu = React.useCallback(() => {
    if (longPressContextMenuTimerRef.current) {
      clearTimeout(longPressContextMenuTimerRef.current);
      longPressContextMenuTimerRef.current = null;
    }
    longPressContextMenuStartPointRef.current = null;
    if (twoFingerLongPressTimerRef.current) {
      clearTimeout(twoFingerLongPressTimerRef.current);
      twoFingerLongPressTimerRef.current = null;
    }
    twoFingerLongPressStartPointRef.current = null;
  }, []);

  const handleTouchStart = React.useCallback(
    (e: React.TouchEvent) => {
      // Two-finger gestures
      if (e.touches.length === 2) {
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const clientX = (t1.clientX + t2.clientX) / 2;
        const clientY = (t1.clientY + t2.clientY) / 2;

        cancelLongPressContextMenu();
        twoFingerLongPressStartPointRef.current = { x: clientX, y: clientY };
        twoFingerTapStartTimeRef.current = Date.now();

        // Long-press timer (500ms)
        twoFingerLongPressTimerRef.current = window.setTimeout(() => {
          const start = twoFingerLongPressStartPointRef.current;
          if (!start) return;
          longPressContextMenuOpenedRef.current = true;
          onContextMenu(start.x, start.y);
        }, 500);
        return;
      }

      // One-finger long press
      if (e.touches.length !== 1) return;
      const touch = e.touches[0];
      longPressContextMenuOpenedRef.current = false;
      cancelLongPressContextMenu();
      longPressContextMenuStartPointRef.current = { x: touch.clientX, y: touch.clientY };
      longPressContextMenuTimerRef.current = window.setTimeout(() => {
        const start = longPressContextMenuStartPointRef.current;
        if (!start) return;
        longPressContextMenuOpenedRef.current = true;
        onContextMenu(start.x, start.y);
      }, 500);
    },
    [cancelLongPressContextMenu, onContextMenu]
  );

  const handleTouchMove = React.useCallback(
    (e: React.TouchEvent) => {
      // Two-finger movement cancellation
      if (e.touches.length === 2 && twoFingerLongPressStartPointRef.current) {
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const currentMidX = (t1.clientX + t2.clientX) / 2;
        const currentMidY = (t1.clientY + t2.clientY) / 2;
        const start = twoFingerLongPressStartPointRef.current;
        const dist = Math.hypot(currentMidX - start.x, currentMidY - start.y);
        if (dist > 10) {
          cancelLongPressContextMenu();
          twoFingerTapStartTimeRef.current = null;
        }
        return;
      }

      // One-finger movement cancellation
      const start = longPressContextMenuStartPointRef.current;
      if (!start) return;
      if (e.touches.length !== 1) {
        cancelLongPressContextMenu();
        return;
      }
      const touch = e.touches[0];
      const dist = Math.hypot(touch.clientX - start.x, touch.clientY - start.y);
      if (dist > 10) {
        cancelLongPressContextMenu();
      }
    },
    [cancelLongPressContextMenu]
  );

  const handleTouchEnd = React.useCallback(
    (e: React.TouchEvent) => {
      // Capture values before cancelling (cancel clears the refs)
      const twoFingerTapStartTime = twoFingerTapStartTimeRef.current;
      const twoFingerMidpoint = twoFingerLongPressStartPointRef.current;
      const longPressOpened = longPressContextMenuOpenedRef.current;

      cancelLongPressContextMenu();

      if (longPressOpened) {
        longPressContextMenuOpenedRef.current = false;
        twoFingerTapStartTimeRef.current = null;
        return;
      }

      // Two-finger tap detection
      if (
        twoFingerTapStartTime &&
        twoFingerMidpoint &&
        e.touches.length === 0
      ) {
        const elapsed = Date.now() - twoFingerTapStartTime;
        if (elapsed < 300) {
          onContextMenu(twoFingerMidpoint.x, twoFingerMidpoint.y);
          twoFingerTapStartTimeRef.current = null;
          return;
        }
      }
      twoFingerTapStartTimeRef.current = null;

      // Double-tap detection
      const now = Date.now();
      if (now - lastTapRef.current < 300) {
        if (e.changedTouches.length > 0) {
          const touch = e.changedTouches[0];
          onContextMenu(touch.clientX, touch.clientY);
        }
      }
      lastTapRef.current = now;
    },
    [cancelLongPressContextMenu, onContextMenu]
  );

  return (
    <div
      data-testid="touch-target"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={{ width: 500, height: 500 }}
    />
  );
}

// Helper to create touch objects
const createTouch = (x: number, y: number, identifier = 0) => ({
  clientX: x,
  clientY: y,
  identifier,
  target: document.body,
  screenX: x,
  screenY: y,
  pageX: x,
  pageY: y,
  radiusX: 1,
  radiusY: 1,
  rotationAngle: 0,
  force: 1,
});

// Helper to create TouchEvent-like objects for fireEvent
const createTouchEventInit = (
  touches: ReturnType<typeof createTouch>[],
  changedTouches: ReturnType<typeof createTouch>[] = touches
) => ({
  touches,
  targetTouches: touches,
  changedTouches,
});

describe('Canvas Touch Gestures', () => {
  let onContextMenu: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    onContextMenu = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Two-finger tap', () => {
    it('should open context menu on quick two-finger tap (<300ms)', () => {
      render(<TouchGestureTestComponent onContextMenu={onContextMenu} />);
      const target = screen.getByTestId('touch-target');

      // Touch down with two fingers
      const touch1 = createTouch(100, 100, 0);
      const touch2 = createTouch(200, 200, 1);
      fireEvent.touchStart(target, createTouchEventInit([touch1, touch2]));

      // Advance less than 300ms
      act(() => {
        vi.advanceTimersByTime(100);
      });

      // Lift both fingers (touches becomes empty, changedTouches has the lifted fingers)
      fireEvent.touchEnd(target, {
        touches: [],
        targetTouches: [],
        changedTouches: [touch1, touch2],
      });

      // Context menu should be called at the midpoint (150, 150)
      expect(onContextMenu).toHaveBeenCalledTimes(1);
      expect(onContextMenu).toHaveBeenCalledWith(150, 150);
    });

    it('should NOT open context menu if tap takes too long (>300ms but <500ms)', () => {
      render(<TouchGestureTestComponent onContextMenu={onContextMenu} />);
      const target = screen.getByTestId('touch-target');

      const touch1 = createTouch(100, 100, 0);
      const touch2 = createTouch(200, 200, 1);
      fireEvent.touchStart(target, createTouchEventInit([touch1, touch2]));

      // Advance more than 300ms but less than 500ms (so long-press doesn't trigger)
      act(() => {
        vi.advanceTimersByTime(350);
      });

      // Lift both fingers
      fireEvent.touchEnd(target, {
        touches: [],
        targetTouches: [],
        changedTouches: [touch1, touch2],
      });

      // Context menu should NOT be called (tap was too slow, long-press didn't trigger)
      expect(onContextMenu).not.toHaveBeenCalled();
    });

    it('should NOT open context menu if fingers move >10px during tap', () => {
      render(<TouchGestureTestComponent onContextMenu={onContextMenu} />);
      const target = screen.getByTestId('touch-target');

      const touch1 = createTouch(100, 100, 0);
      const touch2 = createTouch(200, 200, 1);
      fireEvent.touchStart(target, createTouchEventInit([touch1, touch2]));

      // Move fingers more than 10px
      const movedTouch1 = createTouch(115, 115, 0);
      const movedTouch2 = createTouch(215, 215, 1);
      fireEvent.touchMove(target, createTouchEventInit([movedTouch1, movedTouch2]));

      // Quick release
      act(() => {
        vi.advanceTimersByTime(50);
      });
      fireEvent.touchEnd(target, {
        touches: [],
        targetTouches: [],
        changedTouches: [movedTouch1, movedTouch2],
      });

      // Context menu should NOT be called (gesture was cancelled by movement)
      expect(onContextMenu).not.toHaveBeenCalled();
    });

    it('should calculate midpoint correctly between two fingers', () => {
      render(<TouchGestureTestComponent onContextMenu={onContextMenu} />);
      const target = screen.getByTestId('touch-target');

      // Fingers at (0, 0) and (100, 200) -> midpoint should be (50, 100)
      const touch1 = createTouch(0, 0, 0);
      const touch2 = createTouch(100, 200, 1);
      fireEvent.touchStart(target, createTouchEventInit([touch1, touch2]));

      act(() => {
        vi.advanceTimersByTime(50);
      });

      fireEvent.touchEnd(target, {
        touches: [],
        targetTouches: [],
        changedTouches: [touch1, touch2],
      });

      expect(onContextMenu).toHaveBeenCalledWith(50, 100);
    });
  });

  describe('Two-finger long-press (existing behavior)', () => {
    it('should open context menu after 500ms hold with two fingers', () => {
      render(<TouchGestureTestComponent onContextMenu={onContextMenu} />);
      const target = screen.getByTestId('touch-target');

      const touch1 = createTouch(100, 100, 0);
      const touch2 = createTouch(200, 200, 1);
      fireEvent.touchStart(target, createTouchEventInit([touch1, touch2]));

      // Advance 500ms to trigger long-press
      act(() => {
        vi.advanceTimersByTime(500);
      });

      // Context menu should be called at midpoint
      expect(onContextMenu).toHaveBeenCalledTimes(1);
      expect(onContextMenu).toHaveBeenCalledWith(150, 150);
    });

    it('should NOT trigger tap after long-press opens menu', () => {
      render(<TouchGestureTestComponent onContextMenu={onContextMenu} />);
      const target = screen.getByTestId('touch-target');

      const touch1 = createTouch(100, 100, 0);
      const touch2 = createTouch(200, 200, 1);
      fireEvent.touchStart(target, createTouchEventInit([touch1, touch2]));

      // Let long-press trigger
      act(() => {
        vi.advanceTimersByTime(500);
      });

      expect(onContextMenu).toHaveBeenCalledTimes(1);

      // Now release - should not trigger another context menu
      fireEvent.touchEnd(target, {
        touches: [],
        targetTouches: [],
        changedTouches: [touch1, touch2],
      });

      // Still only 1 call
      expect(onContextMenu).toHaveBeenCalledTimes(1);
    });
  });

  describe('One-finger gestures (regression tests)', () => {
    it('should open context menu on one-finger long-press (500ms)', () => {
      render(<TouchGestureTestComponent onContextMenu={onContextMenu} />);
      const target = screen.getByTestId('touch-target');

      const touch = createTouch(150, 150, 0);
      fireEvent.touchStart(target, createTouchEventInit([touch]));

      act(() => {
        vi.advanceTimersByTime(500);
      });

      expect(onContextMenu).toHaveBeenCalledTimes(1);
      expect(onContextMenu).toHaveBeenCalledWith(150, 150);
    });

    it('should open context menu on double-tap', () => {
      render(<TouchGestureTestComponent onContextMenu={onContextMenu} />);
      const target = screen.getByTestId('touch-target');

      const touch = createTouch(150, 150, 0);

      // First tap
      fireEvent.touchStart(target, createTouchEventInit([touch]));
      act(() => {
        vi.advanceTimersByTime(50);
      });
      fireEvent.touchEnd(target, {
        touches: [],
        targetTouches: [],
        changedTouches: [touch],
      });

      // Second tap within 300ms
      act(() => {
        vi.advanceTimersByTime(100);
      });
      fireEvent.touchStart(target, createTouchEventInit([touch]));
      act(() => {
        vi.advanceTimersByTime(50);
      });
      fireEvent.touchEnd(target, {
        touches: [],
        targetTouches: [],
        changedTouches: [touch],
      });

      expect(onContextMenu).toHaveBeenCalledTimes(1);
      expect(onContextMenu).toHaveBeenCalledWith(150, 150);
    });

    it('should NOT open context menu on single tap', () => {
      render(<TouchGestureTestComponent onContextMenu={onContextMenu} />);
      const target = screen.getByTestId('touch-target');

      const touch = createTouch(150, 150, 0);
      fireEvent.touchStart(target, createTouchEventInit([touch]));
      act(() => {
        vi.advanceTimersByTime(50);
      });
      fireEvent.touchEnd(target, {
        touches: [],
        targetTouches: [],
        changedTouches: [touch],
      });

      // Wait long enough that it's clearly a single tap
      act(() => {
        vi.advanceTimersByTime(500);
      });

      expect(onContextMenu).not.toHaveBeenCalled();
    });

    it('should cancel one-finger long-press if finger moves >10px', () => {
      render(<TouchGestureTestComponent onContextMenu={onContextMenu} />);
      const target = screen.getByTestId('touch-target');

      const touch = createTouch(100, 100, 0);
      fireEvent.touchStart(target, createTouchEventInit([touch]));

      // Move finger more than 10px
      act(() => {
        vi.advanceTimersByTime(100);
      });
      const movedTouch = createTouch(120, 120, 0);
      fireEvent.touchMove(target, createTouchEventInit([movedTouch]));

      // Wait for long-press timer
      act(() => {
        vi.advanceTimersByTime(500);
      });

      // Context menu should NOT be called (cancelled by movement)
      expect(onContextMenu).not.toHaveBeenCalled();
    });
  });
});
