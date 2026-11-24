import { dot, abs, pow, float, normalView, positionViewDirection } from 'three/tsl';

/** Schlick-style Fresnel factor for the current surface: 0 looking straight at it, 1 at a grazing angle. */
export const fresnel = power => pow(float(1).sub(abs(dot(normalView, positionViewDirection)).clamp(0, 1)), power);
