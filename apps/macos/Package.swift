// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "AtriumCaptureMac",
    platforms: [.macOS(.v14)],
    products: [
        .library(name: "AtriumCaptureContracts", targets: ["AtriumCaptureContracts"]),
        .library(name: "AtriumCaptureCore", targets: ["AtriumCaptureCore"]),
        .library(name: "AtriumCaptureMacPlatform", targets: ["AtriumCaptureMacPlatform"]),
        .executable(name: "AtriumCaptureMacApp", targets: ["AtriumCaptureMacApp"]),
        .executable(name: "AtriumCaptureNativeHost", targets: ["AtriumCaptureNativeHost"]),
        .executable(name: "AtriumCaptureMacVerifier", targets: ["AtriumCaptureMacVerifier"]),
    ],
    targets: [
        .target(name: "AtriumCaptureContracts"),
        .target(
            name: "AtriumCaptureCore",
            dependencies: ["AtriumCaptureContracts"]
        ),
        .target(
            name: "AtriumCaptureMacPlatform",
            dependencies: ["AtriumCaptureContracts", "AtriumCaptureCore"]
        ),
        .executableTarget(
            name: "AtriumCaptureMacApp",
            dependencies: ["AtriumCaptureContracts", "AtriumCaptureCore", "AtriumCaptureMacPlatform"]
        ),
        .executableTarget(
            name: "AtriumCaptureNativeHost",
            dependencies: ["AtriumCaptureContracts", "AtriumCaptureCore"]
        ),
        .executableTarget(
            name: "AtriumCaptureMacVerifier",
            dependencies: ["AtriumCaptureContracts", "AtriumCaptureCore", "AtriumCaptureMacPlatform"]
        ),
        .testTarget(
            name: "AtriumCaptureContractsTests",
            dependencies: ["AtriumCaptureContracts"]
        ),
        .testTarget(
            name: "AtriumCaptureCoreTests",
            dependencies: ["AtriumCaptureContracts", "AtriumCaptureCore"]
        ),
        .testTarget(
            name: "AtriumCaptureMacPlatformTests",
            dependencies: ["AtriumCaptureContracts", "AtriumCaptureCore", "AtriumCaptureMacPlatform"]
        ),
    ]
)
