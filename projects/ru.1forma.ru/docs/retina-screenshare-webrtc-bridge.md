# Retina Screenshare WebRTC Bridge

This document describes a local native WebRTC bridge for Retina screen sharing in the 1Forma Pake desktop app.

The goal is to bypass the resolution limits of `navigator.mediaDevices.getDisplayMedia` inside Tauri/WKWebView while still returning a normal browser `MediaStream` to Jitsi.

## Problem

Jitsi already tries to request maximum screen capture resolution.

In the Jitsi checkout, `node_modules/lib-jitsi-meet/dist/esm/modules/RTC/ScreenObtainer.js` sets large constraints for low-fps screen sharing:

```js
video.height = 99999;
video.width = 99999;
```

If `MediaStreamTrack.getSettings()` still reports non-Retina dimensions after this, then the limiting layer is likely WebKit/Tauri/macOS capture behavior, not ordinary page-level constraints.

The local bridge approach replaces the WebKit-provided capture stream with a native ScreenCaptureKit-backed stream.

## Target Architecture

```text
Jitsi page inside Pake WebView
  -> navigator.mediaDevices.getDisplayMedia()
  -> injected JS intercepts the call
  -> JS creates RTCPeerConnection recvonly offer
  -> JS sends offer to localhost signaling endpoint
  -> native bridge captures screen via ScreenCaptureKit
  -> native bridge publishes capture as WebRTC video track
  -> native bridge returns SDP answer
  -> JS receives remote MediaStream
  -> patched getDisplayMedia returns that MediaStream to Jitsi
```

The important contract is:

- Jitsi still calls `getDisplayMedia`.
- The page still receives a real `MediaStream`.
- Jitsi does not need to know that the stream came from native ScreenCaptureKit.

## Why Not Safari Extension

Safari WebExtension is only useful for pages opened in Safari.app.

The 1Forma desktop app runs the site inside Pake/Tauri `WKWebView`. For that environment, Pake injection is the correct equivalent of a browser extension content script.

Therefore the bridge should be local to the Pake app:

- injected JS lives in `same-window-routes.js`, while account-manager UI lives in `account-manager-routes.js`;
- native bridge is launched by the macOS app or a helper process;
- no Safari extension is required.

## Components

### 1. Pake Injected JS

Current injection files:

```text
same-window-routes.js
account-manager-routes.js
```

Responsibilities:

- patch `navigator.mediaDevices.getDisplayMedia`;
- try native Retina bridge first;
- fall back to original WebKit `getDisplayMedia` if bridge fails;
- log requested and actual track settings for diagnostics.

Minimal browser-side flow:

```js
async function getNativeRetinaStream() {
  const pc = new RTCPeerConnection({ iceServers: [] });

  const streamPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Native Retina bridge timeout"));
    }, 10000);

    pc.ontrack = event => {
      clearTimeout(timeout);
      resolve(event.streams[0] || new MediaStream([event.track]));
    };
  });

  pc.addTransceiver("video", { direction: "recvonly" });

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  const response = await fetch("http://127.0.0.1:47777/offer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(pc.localDescription),
  });

  if (!response.ok) {
    throw new Error(`Native Retina bridge failed: HTTP ${response.status}`);
  }

  const answer = await response.json();
  await pc.setRemoteDescription(answer);

  return streamPromise;
}
```

The patched method should preserve fallback:

```js
const originalGetDisplayMedia =
  navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);

navigator.mediaDevices.getDisplayMedia = async function patchedGetDisplayMedia(constraints) {
  try {
    return await getNativeRetinaStream(constraints);
  } catch (error) {
    console.warn("[Pake] Native Retina bridge failed, fallback to WebKit", error);
    return originalGetDisplayMedia(constraints);
  }
};
```

### 2. Local Signaling Server

The native side exposes a local HTTP endpoint:

```text
POST http://127.0.0.1:47777/offer
```

Request:

```json
{
  "type": "offer",
  "sdp": "..."
}
```

Response:

```json
{
  "type": "answer",
  "sdp": "..."
}
```

For localhost-only operation, no external ICE servers should be required.

The bridge must bind only to loopback:

```text
127.0.0.1
```

Do not bind to `0.0.0.0`.

### 3. Native ScreenCaptureKit Capture

The native capture layer should use ScreenCaptureKit on macOS.

Responsibilities:

- request/check Screen Recording permission;
- enumerate displays/windows;
- configure capture in physical pixels;
- publish frames into a WebRTC video source.

Conceptual Swift capture setup:

```swift
let content = try await SCShareableContent.excludingDesktopWindows(
    false,
    onScreenWindowsOnly: true
)

guard let display = content.displays.first else {
    throw CaptureError.noDisplay
}

let filter = SCContentFilter(display: display, excludingWindows: [])

let config = SCStreamConfiguration()
config.width = display.width
config.height = display.height
config.minimumFrameInterval = CMTime(value: 1, timescale: 30)
config.pixelFormat = kCVPixelFormatType_32BGRA
config.showsCursor = true

let stream = SCStream(filter: filter, configuration: config, delegate: nil)
```

Important note:

- `SCDisplay.width` and `SCDisplay.height` are already pixel dimensions in ScreenCaptureKit APIs on modern macOS.
- Do not blindly multiply by `2` without verifying the reported display dimensions.
- The bridge should log display dimensions and emitted frame dimensions.

### 4. Native WebRTC Publisher

The native bridge needs a WebRTC implementation.

Recommended prototype path:

```text
Swift helper process + Google WebRTC.framework
```

Reason:

- ScreenCaptureKit is native Swift/macOS;
- Google WebRTC has native `RTCVideoSource`, `RTCVideoTrack`, and `RTCPeerConnection`;
- integrating ScreenCaptureKit frames into Rust WebRTC first would add avoidable complexity.

Conceptual frame handoff:

```swift
final class ScreenCaptureVideoSource: NSObject, SCStreamOutput {
    private let videoSource: RTCVideoSource
    private let capturer: RTCVideoCapturer

    init(videoSource: RTCVideoSource) {
        self.videoSource = videoSource
        self.capturer = RTCVideoCapturer(delegate: videoSource)
        super.init()
    }

    func stream(
        _ stream: SCStream,
        didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
        of type: SCStreamOutputType
    ) {
        guard type == .screen,
              let pixelBuffer = sampleBuffer.imageBuffer else {
            return
        }

        let buffer = RTCCVPixelBuffer(pixelBuffer: pixelBuffer)
        let frame = RTCVideoFrame(
            buffer: buffer,
            rotation: ._0,
            timeStampNs: currentTimestampNs()
        )

        capturer.delegate?.capturer(capturer, didCapture: frame)
    }
}
```

The exact API shape depends on the WebRTC.framework version, but the principle is stable:

```text
CMSampleBuffer -> CVPixelBuffer -> RTCCVPixelBuffer -> RTCVideoFrame -> RTCVideoSource
```

## Integration Options

### Option A: Separate Swift Helper

The helper is a small macOS process launched by the Pake app.

Pros:

- easiest to prototype;
- isolates native WebRTC dependencies from Tauri/Rust;
- can be restarted independently;
- simpler permission debugging.

Cons:

- lifecycle management is needed;
- app packaging must include helper binary/frameworks;
- localhost port ownership must be handled.

Recommended for MVP.

### Option B: Integrated Tauri macOS Module

The bridge is linked into the Pake app itself.

Pros:

- one process;
- no helper lifecycle;
- cleaner final product if dependency integration is solved.

Cons:

- more complex build pipeline;
- harder Swift/Rust/WebRTC integration;
- higher risk to destabilize current Pake build.

Recommended only after the helper MVP proves that Retina capture works.

### Option C: Rust Native Bridge

Use Rust for signaling and WebRTC, and call macOS ScreenCaptureKit through bindings.

Pros:

- fits Tauri/Rust conceptually;
- one language for server/signaling.

Cons:

- ScreenCaptureKit integration is harder;
- native frame conversion into Rust WebRTC is more work;
- higher chance of spending time on plumbing before proving the product behavior.

Not recommended as the first implementation.

## MVP Plan

### Phase 1: JS Bridge Skeleton

Add a guarded bridge path to the injected layer that owns the shared webview behavior, now split between `same-window-routes.js` and `account-manager-routes.js`.

Acceptance:

- `getDisplayMedia` first tries `http://127.0.0.1:47777/offer`;
- if the bridge is down, Jitsi still works through original WebKit capture;
- logs clearly show bridge success/failure.

### Phase 2: Synthetic Native WebRTC Track

Build a Swift helper that serves `/offer` and publishes a generated video track.

The generated track can be:

- color bars;
- timestamp overlay;
- moving gradient.

Acceptance:

- Jitsi receives the synthetic track as screenshare;
- remote participant sees synthetic video;
- no ScreenCaptureKit yet.

This proves that the Jitsi/WebView/WebRTC replacement path works.

### Phase 3: ScreenCaptureKit Track

Replace synthetic frames with ScreenCaptureKit frames.

Acceptance:

- local logs show physical capture dimensions;
- browser `track.getSettings()` reports expected Retina dimensions if WebRTC exposes them;
- remote participant sees sharp text;
- CPU and latency are acceptable for 15-30 fps.

### Phase 4: Source Selection

Add source selection.

Options:

- initially capture primary display;
- later expose display/window list through `/sources`;
- let JS call `/sources`, show native or web picker, then pass selected source id to `/offer`.

Acceptance:

- user can choose which display/window to share;
- selected source matches the outgoing stream.

### Phase 5: Packaging

Bundle helper with generated Pake app.

Acceptance:

- helper starts with app;
- helper exits with app;
- Screen Recording permission prompt/onboarding is clear;
- no external network port is opened.

## Diagnostics

Browser-side logs should include:

```js
console.info("[Pake] Native Retina bridge offer created");
console.info("[Pake] Native Retina bridge answer received");
console.info("[Pake] Native Retina stream", {
  settings: track.getSettings?.(),
  constraints: track.getConstraints?.(),
});
```

Native-side logs should include:

```text
[retina-bridge] listening on 127.0.0.1:47777
[retina-bridge] received offer
[retina-bridge] selected display: id=..., width=..., height=...
[retina-bridge] emitted frame: width=..., height=..., fps=...
[retina-bridge] returned answer
```

Jitsi-side relevant code paths:

- `react/features/base/tracks/actions.web.ts`
- `react/features/base/tracks/functions.web.ts`
- `node_modules/lib-jitsi-meet/dist/esm/modules/RTC/ScreenObtainer.js`

## Security

Hard requirements:

- bind signaling server to `127.0.0.1` only;
- reject non-local requests;
- use a random per-app-session token in request headers;
- do not allow arbitrary websites to request capture.

Recommended token flow:

1. Native app generates random token on startup.
2. Token is injected into the WebView through Pake config or runtime injection.
3. JS sends:

```http
X-Pake-Retina-Token: <session-token>
```

4. Native server rejects missing/wrong token.

Without a token, any website loaded in the WebView could potentially hit localhost and request a stream.

## Known Risks

- Native WebRTC.framework packaging can complicate the Pake build.
- Screen Recording permission may require app restart after first grant.
- `track.getSettings()` on the browser receiver may not perfectly reflect native capture dimensions even when visual quality is correct.
- Localhost HTTP from an HTTPS page may be blocked in some WebKit configurations; if that happens, use a Tauri command to pass the offer to native instead of `fetch`.
- Returning a remote WebRTC track from `getDisplayMedia` may differ from a native display-capture track in some Jitsi edge paths. This must be tested.

## Fallback Strategy

The bridge must never make screen sharing unusable.

Fallback order:

1. Try native WebRTC bridge.
2. If bridge fails, use original WebKit `getDisplayMedia`.
3. Preserve Jitsi's existing `99999` width/height constraints.
4. Log actual returned track settings.

## Recommended First Commit Scope

Keep the first implementation small:

- add JS bridge skeleton behind a feature flag;
- no native helper yet;
- fallback always works;
- document expected `/offer` contract.

Suggested feature flag:

```js
const ENABLE_NATIVE_RETINA_BRIDGE =
  window.pakeConfig?.nativeRetinaScreenshare === true ||
  localStorage.getItem("pake_native_retina_screenshare") === "1";
```

This allows testing without risking the normal Jitsi screenshare path.
