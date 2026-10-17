import Foundation

/// simd非依存の3次元ベクトル(Linux/macOSどちらでもテストできるようにするため)。
public struct Vec3: Equatable {
    public var x: Float
    public var y: Float
    public var z: Float
    public init(_ x: Float, _ y: Float, _ z: Float) {
        self.x = x
        self.y = y
        self.z = z
    }
}

public enum Placement {
    /// キャラが +Z 方向を向いた状態を yaw=0 とし、カメラの方を向かせるY軸回転(ラジアン)。
    /// 上から撮っても、水平面上の向きだけで決めるので「正面を向き続ける」ことはなく、
    /// 常にカメラ方向を向く。
    public static func yawFacing(from character: Vec3, toward camera: Vec3) -> Float {
        let dx = camera.x - character.x
        let dz = camera.z - character.z
        if abs(dx) < 1e-6 && abs(dz) < 1e-6 { return 0 }
        return atan2(dx, dz)
    }

    /// Y軸まわりに yaw だけ回す(yaw=π/2 で +Z が +X へ向く)。
    public static func rotateY(_ v: Vec3, yaw: Float) -> Vec3 {
        let c = cos(yaw)
        let s = sin(yaw)
        return Vec3(v.x * c + v.z * s, v.y, -v.x * s + v.z * c)
    }

    /// 集合写真用の並び。カメラ側へ開いた弧(両端がカメラに近い)を、
    /// 中心 center のまわりに count 人分つくる。戻り値は世界座標。
    public static func groupPositions(
        center: Vec3,
        camera: Vec3,
        count: Int,
        radius: Float,
        spanDegrees: Float = 120
    ) -> [Vec3] {
        guard count > 0 else { return [] }
        if count == 1 { return [center] }
        let facing = yawFacing(from: center, toward: camera)
        let span = spanDegrees * Float.pi / 180
        var result: [Vec3] = []
        for i in 0..<count {
            let t = (Float(i) / Float(count - 1) - 0.5) * span
            // ローカル座標: カメラは +Z 側にいるものとして、弧を作る
            let local = Vec3(radius * sin(t), 0, radius * (1 - cos(t)))
            let rotated = rotateY(local, yaw: facing)
            result.append(Vec3(center.x + rotated.x, center.y, center.z + rotated.z))
        }
        return result
    }
}
