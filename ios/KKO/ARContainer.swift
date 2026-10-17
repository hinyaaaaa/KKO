import SwiftUI
import ARKit
import RealityKit
import KKOCore

struct ARContainer: UIViewRepresentable {
    @ObservedObject var hud: HUDModel

    func makeCoordinator() -> Coordinator {
        Coordinator(hud: hud)
    }

    func makeUIView(context: Context) -> ARView {
        let view = ARView(frame: .zero)
        context.coordinator.attach(to: view)
        return view
    }

    func updateUIView(_ uiView: ARView, context: Context) {}

    final class Coordinator: NSObject, ARSessionDelegate {
        private let hud: HUDModel
        private weak var arView: ARView?
        private var frameCounter = 0
        private var lastTimestamp: TimeInterval = 0

        init(hud: HUDModel) {
            self.hud = hud
        }

        func attach(to view: ARView) {
            arView = view
            view.session.delegate = self

            let config = ARWorldTrackingConfiguration()
            config.planeDetection = [.horizontal]
            config.environmentTexturing = .automatic
            if ARWorldTrackingConfiguration.supportsFrameSemantics(.personSegmentationWithDepth) {
                config.frameSemantics.insert(.personSegmentationWithDepth)
                hud.occlusion = "人の前後関係: ON"
            } else {
                hud.occlusion = "人の前後関係: 非対応"
            }
            view.session.run(config)

            let tap = UITapGestureRecognizer(target: self, action: #selector(handleTap(_:)))
            view.addGestureRecognizer(tap)

            hud.resetAction = { [weak self] in
                self?.arView?.scene.anchors.removeAll()
                self?.hud.placedCount = 0
            }
        }

        // MARK: - タップで置く

        @objc private func handleTap(_ gesture: UITapGestureRecognizer) {
            guard let view = arView else { return }
            let point = gesture.location(in: view)

            let hit = view.raycast(from: point, allowing: .existingPlaneGeometry, alignment: .horizontal).first
                ?? view.raycast(from: point, allowing: .estimatedPlane, alignment: .horizontal).first
            guard let result = hit else { return }

            let t = result.worldTransform.columns.3
            let center = Vec3(t.x, t.y, t.z)
            let cam = view.cameraTransform.translation
            let camera = Vec3(cam.x, cam.y, cam.z)

            let positions = Placement.groupPositions(
                center: center,
                camera: camera,
                count: hud.groupCount,
                radius: 0.45
            )
            for p in positions {
                let yaw = Placement.yawFacing(from: p, toward: camera)
                let anchor = AnchorEntity(world: SIMD3<Float>(p.x, p.y, p.z))
                anchor.orientation = simd_quatf(angle: yaw, axis: SIMD3<Float>(0, 1, 0))
                anchor.addChild(makeStandIn())
                view.scene.addAnchor(anchor)
            }
            hud.placedCount += positions.count
        }

        /// 人の代わりの箱(身長1.5m)。鼻に見立てた小さな箱が「正面」を示す。
        private func makeStandIn() -> Entity {
            let body = ModelEntity(
                mesh: MeshResource.generateBox(size: SIMD3<Float>(0.4, 1.5, 0.2), cornerRadius: 0.03),
                materials: [SimpleMaterial(color: UIColor.systemPink, isMetallic: false)]
            )
            body.position = SIMD3<Float>(0, 0.75, 0)

            let nose = ModelEntity(
                mesh: MeshResource.generateBox(size: SIMD3<Float>(0.08, 0.08, 0.08)),
                materials: [SimpleMaterial(color: UIColor.white, isMetallic: false)]
            )
            nose.position = SIMD3<Float>(0, 1.3, 0.14)
            body.addChild(nose)
            return body
        }

        // MARK: - ARSessionDelegate

        func session(_ session: ARSession, didAdd anchors: [ARAnchor]) {
            let n = anchors.filter { $0 is ARPlaneAnchor }.count
            if n > 0 { hud.planeCount += n }
        }

        func session(_ session: ARSession, didRemove anchors: [ARAnchor]) {
            let n = anchors.filter { $0 is ARPlaneAnchor }.count
            if n > 0 { hud.planeCount = max(0, hud.planeCount - n) }
        }

        func session(_ session: ARSession, cameraDidChangeTrackingState camera: ARCamera) {
            switch camera.trackingState {
            case .normal:
                hud.tracking = "追跡: 良好"
            case .notAvailable:
                hud.tracking = "追跡: 利用不可"
            case .limited(let reason):
                switch reason {
                case .initializing: hud.tracking = "追跡: 初期化中"
                case .excessiveMotion: hud.tracking = "追跡: 動きが速すぎ"
                case .insufficientFeatures: hud.tracking = "追跡: 特徴点が少ない"
                case .relocalizing: hud.tracking = "追跡: 再位置合わせ中"
                @unknown default: hud.tracking = "追跡: 制限あり"
                }
            }
        }

        func session(_ session: ARSession, didUpdate frame: ARFrame) {
            frameCounter += 1
            guard frameCounter % 30 == 0 else { return }
            if lastTimestamp > 0 {
                let dt = frame.timestamp - lastTimestamp
                if dt > 0 { hud.fps = String(format: "%.0f fps", 30.0 / dt) }
            }
            lastTimestamp = frame.timestamp
            if let intensity = frame.lightEstimate?.ambientIntensity {
                hud.ambientIntensity = String(format: "環境光: %.0f lm", intensity)
            }
        }
    }
}
