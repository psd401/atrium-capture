import AtriumCaptureContracts
import Foundation

public enum NativeAnnotationPlacement {
    public static func arrowDirection(
        from start: NativePoint,
        to end: NativePoint
    ) -> ArrowDirection? {
        guard start.x.isFinite, start.y.isFinite, end.x.isFinite, end.y.isFinite else {
            return nil
        }
        if end.x >= start.x {
            return end.y >= start.y ? .downRight : .upRight
        }
        return end.y >= start.y ? .downLeft : .upLeft
    }

    public static func geometry(
        from start: NativePoint,
        to end: NativePoint,
        previewWidth: Double,
        previewHeight: Double,
        imageBounds: NativeRect,
        minimumPreviewDimension: Double = 8
    ) -> Geometry? {
        guard start.x.isFinite, start.y.isFinite,
              end.x.isFinite, end.y.isFinite,
              previewWidth.isFinite, previewWidth > 0,
              previewHeight.isFinite, previewHeight > 0,
              minimumPreviewDimension.isFinite, minimumPreviewDimension > 0,
              imageBounds.isValid
        else {
            return nil
        }

        let startX = clamp(start.x, lower: 0, upper: previewWidth)
        let startY = clamp(start.y, lower: 0, upper: previewHeight)
        let endX = clamp(end.x, lower: 0, upper: previewWidth)
        let endY = clamp(end.y, lower: 0, upper: previewHeight)
        let minimumWidth = min(minimumPreviewDimension, previewWidth)
        let minimumHeight = min(minimumPreviewDimension, previewHeight)
        let viewWidth = max(abs(endX - startX), minimumWidth)
        let viewHeight = max(abs(endY - startY), minimumHeight)
        let centerX = (startX + endX) / 2
        let centerY = (startY + endY) / 2
        let viewX = clamp(
            centerX - viewWidth / 2,
            lower: 0,
            upper: previewWidth - viewWidth
        )
        let viewY = clamp(
            centerY - viewHeight / 2,
            lower: 0,
            upper: previewHeight - viewHeight
        )
        let scaleX = imageBounds.width / previewWidth
        let scaleY = imageBounds.height / previewHeight

        return Geometry(
            height: viewHeight * scaleY,
            width: viewWidth * scaleX,
            x: imageBounds.x + viewX * scaleX,
            y: imageBounds.y + viewY * scaleY
        )
    }

    private static func clamp(_ value: Double, lower: Double, upper: Double) -> Double {
        min(max(value, lower), upper)
    }
}
