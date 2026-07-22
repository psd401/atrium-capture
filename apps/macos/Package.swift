// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "AtriumCaptureMac",
    platforms: [.macOS(.v14)],
    products: [
        .library(name: "AtriumCaptureContracts", targets: ["AtriumCaptureContracts"]),
    ],
    targets: [
        .target(name: "AtriumCaptureContracts"),
        .testTarget(
            name: "AtriumCaptureContractsTests",
            dependencies: ["AtriumCaptureContracts"]
        ),
    ]
)
