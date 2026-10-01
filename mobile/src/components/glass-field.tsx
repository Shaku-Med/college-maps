import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { Input, TextArea, cn, useTextField, useThemeColor } from 'heroui-native';
import { forwardRef, useEffect, useRef, type ComponentProps, type ComponentRef } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

// HeroUI's field corner: --field-radius, which is 0.5rem * 1.75. Native glass needs it as a number to shape itself.
const RADIUS = 14;
const LIQUID_GLASS = isLiquidGlassAvailable();
const FOCUS_MS = 180;
const SHAKE_PX = 6;

/** Liquid Glass behind the text on iOS 26, a solid themed field elsewhere, and a ring that lights up on focus. */
function FieldBackground({ focus, invalid }: { focus: SharedValue<number>; invalid: boolean }) {
  const [accent, danger] = useThemeColor(['accent', 'danger']);
  const ring = useAnimatedStyle(() => ({ opacity: invalid ? 1 : focus.get() }));
  const shape = [StyleSheet.absoluteFill, { borderRadius: RADIUS }];

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {LIQUID_GLASS ? (
        <GlassView glassEffectStyle="regular" style={shape} />
      ) : (
        <View className="border border-border bg-field" style={shape} />
      )}
      <Animated.View style={[shape, { borderWidth: 1.5, borderColor: invalid ? danger : accent }, ring]} />
    </View>
  );
}

/** The focus and error motion shared by every glass input. */
function useGlassField(isInvalid: boolean | undefined) {
  const field = useTextField();
  const invalid = isInvalid ?? field?.isInvalid ?? false;
  const reduceMotion = useReducedMotion();
  const focus = useSharedValue(0);
  const shake = useSharedValue(0);
  const wasInvalid = useRef(invalid);

  // A field that just turned invalid gives a short shake, the way iOS rejects a wrong passcode.
  useEffect(() => {
    if (invalid && !wasInvalid.current && !reduceMotion) {
      shake.set(
        withSequence(
          withTiming(-SHAKE_PX, { duration: 50 }),
          withTiming(SHAKE_PX, { duration: 70 }),
          withTiming(-SHAKE_PX / 2, { duration: 60 }),
          withSpring(0, { damping: 12, stiffness: 300 }),
        ),
      );
    }
    wasInvalid.current = invalid;
  }, [invalid, reduceMotion, shake]);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: shake.get() }, { scale: reduceMotion ? 1 : 1 + focus.get() * 0.012 }],
  }));

  return {
    invalid,
    style,
    background: <FieldBackground focus={focus} invalid={invalid} />,
    onFocus: () => focus.set(withTiming(1, { duration: FOCUS_MS })),
    onBlur: () => focus.set(withTiming(0, { duration: FOCUS_MS })),
  };
}

type InputProps = ComponentProps<typeof Input>;

export const GlassInput = forwardRef<ComponentRef<typeof Input>, InputProps>(function GlassInput(
  { isInvalid, className, onFocus, onBlur, ...props },
  ref,
) {
  const glass = useGlassField(isInvalid);
  return (
    <Animated.View style={glass.style}>
      <Input
        ref={ref}
        {...props}
        isInvalid={glass.invalid}
        className={cn('bg-transparent', className)}
        background={glass.background}
        onFocus={(event) => {
          glass.onFocus();
          onFocus?.(event);
        }}
        onBlur={(event) => {
          glass.onBlur();
          onBlur?.(event);
        }}
      />
    </Animated.View>
  );
});

type TextAreaProps = ComponentProps<typeof TextArea>;

export const GlassTextArea = forwardRef<ComponentRef<typeof TextArea>, TextAreaProps>(function GlassTextArea(
  { isInvalid, className, onFocus, onBlur, ...props },
  ref,
) {
  const glass = useGlassField(isInvalid);
  return (
    <Animated.View style={glass.style}>
      <TextArea
        ref={ref}
        {...props}
        isInvalid={glass.invalid}
        className={cn('bg-transparent', className)}
        background={glass.background}
        onFocus={(event) => {
          glass.onFocus();
          onFocus?.(event);
        }}
        onBlur={(event) => {
          glass.onBlur();
          onBlur?.(event);
        }}
      />
    </Animated.View>
  );
});
