import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useState } from 'react';
import type { LayoutChangeEvent } from 'react-native';
import { Gesture } from 'react-native-gesture-handler';
import type Animated from 'react-native-reanimated';
import {
  cancelAnimation,
  scrollTo,
  useAnimatedReaction,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

// Settles the way a system sheet does: follows the flick it was let go with, with barely any overshoot.
const SPRING = { damping: 32, stiffness: 340, mass: 1 };
const ACTIVE_OFFSET_PX = 8;
const SIDEWAYS_FAIL_PX = 24;
const OVERPULL_SHARE = 0.18;
const OVERPULL_MAX_PX = 24;
// A flick decides by itself; otherwise the finger has to carry it this far, as halfway is out of reach on a long panel.
const FLICK_SPEED = 400;
const COMMIT_PX = 120;
const UNMOUNT_AFTER_MS = 500;
// A flick can lift before the press under it hears the drag took over, so that press still fires.
const PRESS_AFTER_DRAG_MS = 300;

const clock = () => {
  'worklet';
  return Date.now();
};

// `edge` is the side of the screen the card sits on; the list inside hands over to the panel when pulled past its end.
export function useDragPanel({
  edge,
  open,
  canOpen,
  onOpenChange,
}: {
  edge: 'top' | 'bottom';
  open: boolean;
  canOpen: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const reduceMotion = useReducedMotion();
  const height = useSharedValue(0);
  const natural = useSharedValue(0);
  const startHeight = useSharedValue(0);
  const dragging = useSharedValue(false);
  const scrollY = useSharedValue(0);
  const contentHeight = useSharedValue(0);
  const viewHeight = useSharedValue(0);
  const takenByPanel = useSharedValue(false);
  const takenAt = useSharedValue(0);
  const draggedAt = useSharedValue(0);
  const listRef = useAnimatedRef<Animated.ScrollView>();
  const [mounted, setMounted] = useState(open);
  const [lastLetGo, setLastLetGo] = useState(0);
  if (open && !mounted) setMounted(true);
  const headedOpen = useSharedValue(open);
  // Where the spring is already headed, so `open` catching up after a drag does not restart it and lose the flick.
  const aimedAt = useSharedValue(0);
  const opensToward = edge === 'top' ? 1 : -1;

  const aim = (target: number, velocity = 0) => {
    'worklet';
    aimedAt.set(target);
    height.set(reduceMotion ? target : withSpring(target, { ...SPRING, velocity }));
  };

  // On the UI thread, as a height just measured can still read as the old one from JS and open the panel to nothing.
  useAnimatedReaction(
    () => (headedOpen.get() ? natural.get() : 0),
    (target) => {
      if (target !== aimedAt.get() && !dragging.get()) aim(target);
    },
  );

  useEffect(() => {
    headedOpen.set(open);
    if (open) return;
    const timer = setTimeout(() => {
      if (!dragging.get()) setMounted(false);
    }, UNMOUNT_AFTER_MS);
    return () => clearTimeout(timer);
  }, [open, lastLetGo, dragging, headedOpen]);

  const onContentLayout = useCallback(
    ({ nativeEvent }: LayoutChangeEvent) => {
      natural.set(nativeEvent.layout.height);
    },
    [natural],
  );

  const arm = useCallback(() => setMounted(true), []);

  const settled = useCallback(
    (wantsOpen: boolean) => {
      // A pull that changed nothing has nothing else coming to tidy up after it.
      if (wantsOpen === open) {
        setLastLetGo(Date.now());
        return;
      }
      void Haptics.selectionAsync();
      onOpenChange(wantsOpen);
    },
    [open, onOpenChange],
  );

  const pulledTo = (wanted: number) => {
    'worklet';
    const max = natural.get();
    return wanted <= max ? Math.max(0, wanted) : max + Math.min(OVERPULL_MAX_PX, (wanted - max) * OVERPULL_SHARE);
  };

  const letGo = (velocityY: number) => {
    'worklet';
    const max = natural.get();
    const velocity = velocityY * opensToward;
    draggedAt.set(clock());
    const commit = Math.min(max / 2, COMMIT_PX);
    const closing = startHeight.get() > max / 2;
    const wantsOpen =
      Math.abs(velocity) >= FLICK_SPEED ? velocity > 0 : closing ? height.get() > max - commit : height.get() > commit;
    headedOpen.set(wantsOpen);
    aim(wantsOpen ? max : 0, velocity);
    scheduleOnRN(settled, wantsOpen);
  };

  // One per place it is used, as a gesture belongs to a single detector.
  const dragZone = () =>
    Gesture.Pan()
      .enabled(canOpen)
      .activeOffsetY([-ACTIVE_OFFSET_PX, ACTIVE_OFFSET_PX])
      .failOffsetX([-SIDEWAYS_FAIL_PX, SIDEWAYS_FAIL_PX])
      .onBegin(() => {
        scheduleOnRN(arm);
      })
      .onStart(() => {
        cancelAnimation(height);
        startHeight.set(height.get());
        dragging.set(true);
        draggedAt.set(clock());
        scheduleOnRN(arm);
      })
      .onUpdate((event) => {
        height.set(pulledTo(startHeight.get() + event.translationY * opensToward));
      })
      .onEnd((event) => {
        letGo(event.velocityY);
      })
      .onFinalize(() => {
        dragging.set(false);
      });

  const nativeList = Gesture.Native();
  const listPull = Gesture.Pan()
    .activeOffsetY([-ACTIVE_OFFSET_PX, ACTIVE_OFFSET_PX])
    .failOffsetX([-SIDEWAYS_FAIL_PX, SIDEWAYS_FAIL_PX])
    .simultaneousWithExternalGesture(nativeList)
    .onStart(() => {
      takenByPanel.set(false);
    })
    .onUpdate((event) => {
      if (!takenByPanel.get()) {
        const closing = event.translationY * opensToward < 0;
        const atEnd =
          edge === 'bottom' ? scrollY.get() <= 0 : scrollY.get() >= Math.max(0, contentHeight.get() - viewHeight.get()) - 1;
        if (!closing || !atEnd) return;
        cancelAnimation(height);
        takenByPanel.set(true);
        takenAt.set(event.translationY);
        startHeight.set(height.get());
        dragging.set(true);
      }
      height.set(pulledTo(startHeight.get() + (event.translationY - takenAt.get()) * opensToward));
      // The list holds still while the panel has the drag, even if the finger turns back.
      scrollTo(listRef, 0, scrollY.get(), false);
    })
    .onEnd((event) => {
      if (takenByPanel.get()) letGo(event.velocityY);
    })
    .onFinalize(() => {
      takenByPanel.set(false);
      dragging.set(false);
    });

  const onScroll = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollY.set(event.contentOffset.y);
    },
  });

  const clipStyle = useAnimatedStyle(() => ({ height: Math.max(0, height.get()), overflow: 'hidden' as const }));
  const contentStyle = useAnimatedStyle(() => {
    const max = natural.get();
    return { opacity: max ? Math.min(1, height.get() / (max * 0.6)) : 1 };
  });
  const handleStyle = useAnimatedStyle(() => ({
    width: withTiming(dragging.get() ? 48 : 36, { duration: 180 }),
    opacity: withTiming(dragging.get() ? 0.6 : 0.3, { duration: 180 }),
  }));

  const pressIsDrag = () => clock() - draggedAt.get() < PRESS_AFTER_DRAG_MS;

  const listProps = {
    ref: listRef,
    onScroll,
    scrollEventThrottle: 16,
    bounces: false,
    overScrollMode: 'never' as const,
    onContentSizeChange: (_width: number, contentH: number) => contentHeight.set(contentH),
    onLayout: ({ nativeEvent }: LayoutChangeEvent) => viewHeight.set(nativeEvent.layout.height),
  };

  return {
    mounted,
    dragZone,
    pressIsDrag,
    listGesture: Gesture.Simultaneous(listPull, nativeList),
    listProps,
    onContentLayout,
    clipStyle,
    contentStyle,
    handleStyle,
  };
}
