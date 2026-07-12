import { Vector3 } from 'three';

export const SOURCE_UNIT_METERS = 0.0254;

// Taken from the root matrices emitted by ValveResourceFormat's CS2 map exporter.
// Source is right-handed Z-up in inches; VRF glTF is right-handed Y-up in meters.
export function sourceToThree(x: number, y: number, z: number, target = new Vector3()): Vector3 {
  return target.set(y * SOURCE_UNIT_METERS, z * SOURCE_UNIT_METERS, x * SOURCE_UNIT_METERS);
}

export function sourceViewDirection(yawDegrees: number, pitchDegrees: number, target = new Vector3()): Vector3 {
  const yaw = (yawDegrees * Math.PI) / 180;
  let pitch = pitchDegrees;
  if (pitch > 180) pitch -= 360;
  const pitchRadians = (pitch * Math.PI) / 180;
  const horizontal = Math.cos(pitchRadians);
  const sourceX = horizontal * Math.cos(yaw);
  const sourceY = horizontal * Math.sin(yaw);
  const sourceZ = -Math.sin(pitchRadians);
  return target.set(sourceY, sourceZ, sourceX).normalize();
}
