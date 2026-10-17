import SwiftUI

struct ContentView: View {
    @StateObject private var hud = HUDModel()

    var body: some View {
        ZStack {
            ARContainer(hud: hud)

            VStack(alignment: .leading, spacing: 4) {
                Text("KKO v3 spike").font(.caption.bold())
                Text(hud.tracking)
                Text("検出した床: \(hud.planeCount)")
                Text(hud.ambientIntensity)
                Text(hud.fps)
                Text(hud.occlusion)
                Text("置いた数: \(hud.placedCount)")
            }
            .font(.caption)
            .foregroundColor(.white)
            .padding(8)
            .background(Color.black.opacity(0.55))
            .cornerRadius(8)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .padding(.top, 54)
            .padding(.leading, 8)
            .allowsHitTesting(false)

            VStack(spacing: 10) {
                Spacer()
                Text("床をタップして置く")
                    .font(.footnote)
                    .foregroundColor(.white)
                    .padding(6)
                    .background(Color.black.opacity(0.55))
                    .cornerRadius(6)
                Picker("人数", selection: $hud.groupCount) {
                    Text("1人").tag(1)
                    Text("2人").tag(2)
                    Text("3人").tag(3)
                    Text("5人").tag(5)
                }
                .pickerStyle(.segmented)
                .padding(.horizontal, 24)
                Button("全部消す") { hud.resetAction?() }
                    .padding(.horizontal, 20)
                    .padding(.vertical, 8)
                    .background(Color.white.opacity(0.85))
                    .cornerRadius(10)
                    .padding(.bottom, 34)
            }
        }
    }
}
