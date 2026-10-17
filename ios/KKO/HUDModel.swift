import Foundation
import Combine

/// 画面左上に出す計測値と、操作の状態。検証結果を画面から読み取れるようにするためのもの。
final class HUDModel: ObservableObject {
    @Published var tracking: String = "-"
    @Published var planeCount: Int = 0
    @Published var ambientIntensity: String = "-"
    @Published var fps: String = "-"
    @Published var occlusion: String = "-"
    @Published var placedCount: Int = 0
    @Published var groupCount: Int = 1

    /// 配置したものを全部消す。ARContainer側が設定する。
    var resetAction: (() -> Void)?
}
