// Module worker: generates the floor / walkway texture bytes off the main thread (see textures.js).
import { genFloor, genWalkway } from './floorGen.js';

self.onmessage = (e) => {
  const { id, kind, N, size } = e.data;
  const r = kind === 'floor' ? genFloor(N, size) : genWalkway(N, size);
  self.postMessage({ id, color: r.color.buffer, normal: r.normal.buffer, N: r.N }, [r.color.buffer, r.normal.buffer]);
};
