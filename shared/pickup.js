// Balloon touch test shared by the client (own pickups), the room (claim validation) and bots.
// A balloon is touched when it's within PICKUP_RADIUS horizontally AND the body (feet .. feet + PLAYER_HEIGHT)
// overlaps the balloon vertically, so air balloons (y = ORB_Y_AIR) can only be taken mid-jump.
import { ORB_DIAMETER, ORB_Y, PICKUP_RADIUS, PLAYER_HEIGHT } from './config.js';

const R = ORB_DIAMETER / 2;

export const orbHeight = (o) => o.y ?? ORB_Y;

export const orbInAir = (o) => orbHeight(o) - R > PLAYER_HEIGHT;

/** slackR / slackY widen the test for latency (room-side validation). */
export function canTouchOrb(o, x, z, feetY, slackR = 0, slackY = 0) {
  const r = PICKUP_RADIUS + slackR;
  const dx = x - o.x;
  const dz = z - o.z;
  if (dx * dx + dz * dz > r * r) return false;
  const cy = orbHeight(o);
  return feetY + PLAYER_HEIGHT + slackY >= cy - R && feetY - slackY <= cy + R;
}
