import { ArrowDirection, type Geometry } from '@atrium-capture/contracts';

export interface ArrowPoint {
  x: number;
  y: number;
}

export interface ArrowEndpoints {
  endX: number;
  endY: number;
  startX: number;
  startY: number;
}

export function directionForArrow(start: ArrowPoint, end: ArrowPoint): ArrowDirection {
  if (end.x >= start.x) {
    return end.y >= start.y ? ArrowDirection.DownRight : ArrowDirection.UpRight;
  }
  return end.y >= start.y ? ArrowDirection.DownLeft : ArrowDirection.UpLeft;
}

export function arrowEndpoints(
  geometry: Geometry,
  direction = ArrowDirection.UpRight,
): ArrowEndpoints {
  switch (direction) {
    case ArrowDirection.DownRight:
      return {
        endX: geometry.x + geometry.width,
        endY: geometry.y + geometry.height,
        startX: geometry.x,
        startY: geometry.y,
      };
    case ArrowDirection.UpLeft:
      return {
        endX: geometry.x,
        endY: geometry.y,
        startX: geometry.x + geometry.width,
        startY: geometry.y + geometry.height,
      };
    case ArrowDirection.DownLeft:
      return {
        endX: geometry.x,
        endY: geometry.y + geometry.height,
        startX: geometry.x + geometry.width,
        startY: geometry.y,
      };
    case ArrowDirection.UpRight:
      return {
        endX: geometry.x + geometry.width,
        endY: geometry.y,
        startX: geometry.x,
        startY: geometry.y + geometry.height,
      };
  }
}
