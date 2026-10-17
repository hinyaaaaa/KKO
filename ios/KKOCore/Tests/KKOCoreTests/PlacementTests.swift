import XCTest
@testable import KKOCore

final class PlacementTests: XCTestCase {
    func testYawFacingCameraOnPositiveZ() {
        let yaw = Placement.yawFacing(from: Vec3(0, 0, 0), toward: Vec3(0, 0, 2))
        XCTAssertEqual(yaw, 0, accuracy: 1e-5)
    }

    func testYawQuarterTurnTowardPositiveX() {
        let yaw = Placement.yawFacing(from: Vec3(0, 0, 0), toward: Vec3(1, 0, 0))
        XCTAssertEqual(yaw, Float.pi / 2, accuracy: 1e-5)
    }

    func testYawIgnoresHeightDifference() {
        // 上から撮っても(カメラの高さが違っても)水平の向きは変わらない
        let low = Placement.yawFacing(from: Vec3(0, 0, 0), toward: Vec3(1, 0.2, 1))
        let high = Placement.yawFacing(from: Vec3(0, 0, 0), toward: Vec3(1, 3.0, 1))
        XCTAssertEqual(low, high, accuracy: 1e-6)
    }

    func testYawWhenCameraIsDirectlyAbove() {
        // 真上からでも NaN にならない
        let yaw = Placement.yawFacing(from: Vec3(0, 0, 0), toward: Vec3(0, 5, 0))
        XCTAssertEqual(yaw, 0, accuracy: 1e-6)
    }

    func testRotateYQuarterTurn() {
        let r = Placement.rotateY(Vec3(0, 0, 1), yaw: Float.pi / 2)
        XCTAssertEqual(r.x, 1, accuracy: 1e-5)
        XCTAssertEqual(r.z, 0, accuracy: 1e-5)
    }

    func testGroupSingleStaysAtCenter() {
        let p = Placement.groupPositions(center: Vec3(1, 0, 2), camera: Vec3(0, 1, 0), count: 1, radius: 0.5)
        XCTAssertEqual(p, [Vec3(1, 0, 2)])
    }

    func testGroupZeroIsEmpty() {
        XCTAssertTrue(Placement.groupPositions(center: Vec3(0, 0, 0), camera: Vec3(0, 0, 3), count: 0, radius: 0.5).isEmpty)
    }

    func testGroupArcIsSymmetricAndEndsAreCloserToCamera() {
        let camera = Vec3(0, 1.5, 3)
        let p = Placement.groupPositions(center: Vec3(0, 0, 0), camera: camera, count: 3, radius: 0.5)
        XCTAssertEqual(p.count, 3)
        // 中央は center のまま
        XCTAssertEqual(p[1].x, 0, accuracy: 1e-5)
        XCTAssertEqual(p[1].z, 0, accuracy: 1e-5)
        // 左右対称
        XCTAssertEqual(p[0].x, -p[2].x, accuracy: 1e-5)
        XCTAssertEqual(p[0].z, p[2].z, accuracy: 1e-5)
        // 両端のほうがカメラに近い(z が大きい)
        XCTAssertGreaterThan(p[0].z, p[1].z)
    }

    func testGroupArcFollowsCameraDirection() {
        // カメラが +X 側にあるときは、弧の両端が +X 側へ出る
        let p = Placement.groupPositions(center: Vec3(0, 0, 0), camera: Vec3(3, 1, 0), count: 3, radius: 0.5)
        XCTAssertGreaterThan(p[0].x, p[1].x)
        XCTAssertGreaterThan(p[2].x, p[1].x)
    }
}
