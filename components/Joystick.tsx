import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  runOnJS,
} from 'react-native-reanimated';

interface JoystickProps {
  onMove: (x: number, y: number) => void;
  onRelease: () => void;
  size: number;
  position: 'left' | 'right';
}

export const Joystick: React.FC<JoystickProps> = ({
  onMove,
  onRelease,
  size,
  position,
}) => {
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const isActive = useSharedValue(false);
  const maxDistance = size / 3;

  const panGesture = Gesture.Pan()
    .simultaneousWithExternalGesture()
    .onBegin(() => {
      isActive.value = true;
    })
    .onUpdate((event) => {
      // Calculate position relative to the center of the joystick
      const translationX = event.x - size / 2;
      const translationY = event.y - size / 2;

      const distance = Math.sqrt(
        translationX * translationX + translationY * translationY
      );

      if (distance > maxDistance) {
        const angle = Math.atan2(translationY, translationX);
        translateX.value = Math.cos(angle) * maxDistance;
        translateY.value = Math.sin(angle) * maxDistance;
      } else {
        translateX.value = translationX;
        translateY.value = translationY;
      }

      // Get normalized values (-1 to 1)
      const xValue = translateX.value / maxDistance;
      const yValue = translateY.value / maxDistance;
      runOnJS(onMove)(xValue, yValue);
    })
    .onEnd(() => {
      isActive.value = false;
      translateX.value = withSpring(0, { damping: 15 });
      translateY.value = withSpring(0, { damping: 15 });
      runOnJS(onRelease)();
    })
    .onFinalize(() => {
      if (isActive.value) {
        isActive.value = false;
        translateX.value = withSpring(0, { damping: 15 });
        translateY.value = withSpring(0, { damping: 15 });
        runOnJS(onRelease)();
      }
    });

  const knobStyle = useAnimatedStyle(() => {
    return {
      transform: [
        { translateX: translateX.value },
        { translateY: translateY.value },
      ],
    };
  });

  return (
    <View
      style={[
        styles.joystickContainer,
        {
          width: size,
          height: size,
          [position]: 20,
        },
      ]}
    >
      <GestureDetector gesture={panGesture}>
        <View
          style={[styles.joystickBackground, { width: size, height: size }]}
        >
          <Animated.View
            style={[
              styles.joystickKnob,
              {
                width: size / 3,
                height: size / 3,
              },
              knobStyle,
            ]}
          />
        </View>
      </GestureDetector>
    </View>
  );
};

const styles = StyleSheet.create({
  joystickContainer: {
    position: 'absolute',
    bottom: 20,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  joystickBackground: {
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  joystickKnob: {
    backgroundColor: 'rgba(255, 255, 255, 0.5)',
    borderRadius: 999,
    position: 'absolute',
  },
});
