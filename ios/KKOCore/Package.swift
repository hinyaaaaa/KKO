// swift-tools-version:5.9
import PackageDescription

// ARKitやRealityKitに依存しない「純粋な計算」だけを置くパッケージ。
// ここに置いたものは、実機なしでCI(swift test)で検証できる。
let package = Package(
    name: "KKOCore",
    products: [
        .library(name: "KKOCore", targets: ["KKOCore"]),
    ],
    targets: [
        .target(name: "KKOCore"),
        .testTarget(name: "KKOCoreTests", dependencies: ["KKOCore"]),
    ]
)
