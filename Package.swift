// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "semantic-prompt-contract",
    platforms: [
        .iOS(.v17),
        .macOS(.v13)
    ],
    products: [
        .library(name: "SemanticPromptContract", targets: ["SemanticPromptContract"])
    ],
    targets: [
        .target(
            name: "SemanticPromptContract",
            path: "adapters/swift/Sources/SemanticPromptContract"
        ),
        .testTarget(
            name: "SemanticPromptContractTests",
            dependencies: ["SemanticPromptContract"],
            path: "adapters/swift/Tests/SemanticPromptContractTests"
        )
    ]
)
