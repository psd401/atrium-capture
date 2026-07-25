import { ArrowDirection } from '@atrium-capture/contracts';
import { describe, expect, it } from 'vitest';

import { arrowEndpoints, directionForArrow } from '../src/arrow-geometry.js';

describe('arrow rendering geometry', () => {
  const geometry = { height: 40, width: 80, x: 10, y: 20 };

  it('preserves all four drag directions', () => {
    expect(arrowEndpoints(geometry, ArrowDirection.UpRight)).toEqual({
      startX: 10,
      startY: 60,
      endX: 90,
      endY: 20,
    });
    expect(arrowEndpoints(geometry, ArrowDirection.DownRight)).toEqual({
      startX: 10,
      startY: 20,
      endX: 90,
      endY: 60,
    });
    expect(arrowEndpoints(geometry, ArrowDirection.UpLeft)).toEqual({
      startX: 90,
      startY: 60,
      endX: 10,
      endY: 20,
    });
    expect(arrowEndpoints(geometry, ArrowDirection.DownLeft)).toEqual({
      startX: 90,
      startY: 20,
      endX: 10,
      endY: 60,
    });
  });

  it('defaults legacy annotations to up-right', () => {
    expect(arrowEndpoints(geometry)).toEqual(arrowEndpoints(geometry, ArrowDirection.UpRight));
  });

  it('derives direction from the original drag endpoints', () => {
    const start = { x: 50, y: 50 };
    expect(directionForArrow(start, { x: 100, y: 10 })).toBe(ArrowDirection.UpRight);
    expect(directionForArrow(start, { x: 100, y: 90 })).toBe(ArrowDirection.DownRight);
    expect(directionForArrow(start, { x: 10, y: 10 })).toBe(ArrowDirection.UpLeft);
    expect(directionForArrow(start, { x: 10, y: 90 })).toBe(ArrowDirection.DownLeft);
  });
});
