import * as SplashScreen from "expo-splash-screen";
import { useState } from "react";
import { StyleSheet, View, Text } from "react-native";
import Animated, { Easing, Keyframe } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

const DURATION = 4000;

export function AnimatedSplashOverlay() {
  const [animate, setAnimate] = useState(false);
  const [visible, setVisible] = useState(true);

  if (!visible) return null;

  const splashKeyframe = new Keyframe({
    0: {
      opacity: 1,
      transform: [{ scale: 0.9 }],
    },
    100: {
      opacity: 0,
      transform: [{ scale: 1.08 }],
      easing: Easing.out(Easing.ease),
    },
  });

  return animate ? (
    <Animated.View
      entering={splashKeyframe.duration(DURATION).withCallback((finished) => {
        "worklet";
        if (finished) {
          scheduleOnRN(setVisible, false);
        }
      })}
      style={styles.splashOverlay}
    >
      <View style={styles.logoCircle}>
        <Text style={styles.logoText}>V</Text>
      </View>

      <Text style={styles.appName}>Vanish Class</Text>
      <Text style={styles.appSubtitle}>NETWORK</Text>

      <View style={styles.bottomContainer}>
        <Text style={styles.tagline}>Messages that disappear.</Text>
      </View>
    </Animated.View>
  ) : (
    <View
      onLayout={() => {
        SplashScreen.hideAsync().finally(() => {
          setAnimate(true);
        });
      }}
      style={styles.splashOverlay}
    >
      <View style={styles.logoCircle}>
        <Text style={styles.logoText}>V</Text>
      </View>

      <Text style={styles.appName}>Vanish Class</Text>
      <Text style={styles.appSubtitle}>NETWORK</Text>

      <View style={styles.bottomContainer}>
        <Text style={styles.tagline}>Messages that disappear.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  splashOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "#F5FAF9",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
  },
  logoCircle: {
    width: 110,
    height: 110,
    borderRadius: 35,
    backgroundColor: "#168F83",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 22,
    elevation: 8,
    shadowColor: "#168F83",
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
  },
  logoText: {
    fontSize: 62,
    fontWeight: "bold",
    color: "#FFFFFF",
  },
  appName: {
    fontSize: 30,
    fontWeight: "bold",
    color: "#168F83",
    letterSpacing: 0.5,
  },
  appSubtitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#6B9D96",
    letterSpacing: 5,
    marginTop: 5,
  },
  bottomContainer: {
    position: "absolute",
    bottom: 65,
  },
  tagline: {
    fontSize: 13,
    color: "#7A9B96",
    letterSpacing: 0.5,
  },
});
