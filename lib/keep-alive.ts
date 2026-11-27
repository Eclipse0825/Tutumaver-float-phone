// Standalone runtime keep-alive, extracted from the original AI Virtual Phone.
import { kvGet, kvSet, registerKvMigration, hydrateKvDb } from "./kv-db";

// Retain the original storage key for migration and backup compatibility.
const KEY = "weixin_keepalive_v1";
registerKvMigration(KEY);
export const KEEP_ALIVE_CHANGED = "rabbit-keep-alive-changed";
export function loadKeepAlive(): boolean { try { return kvGet(KEY) === "1"; } catch { return false; } }
export function saveKeepAlive(on: boolean): void {
    kvSet(KEY, on ? "1" : "0");
    if (typeof window !== "undefined") window.dispatchEvent(new Event(KEEP_ALIVE_CHANGED));
}
let _wakeLock: WakeLockSentinel | null = null;
let _keepAliveAudio: HTMLAudioElement | null = null;
let wanted = false, installed = false, callActive = false, phoneActive = false;
let wakePending = false, playPending = false, revision = 0;
const shouldRun = () => installed && wanted && !callActive && !phoneActive;

function ensureAudioCreated() {
    if (_keepAliveAudio) return;
    _keepAliveAudio = new Audio();
    // 生成 1 秒静音 WAV。采样率必须是 48kHz：iOS 的系统音频会话采样率跟着正在
    // 播放的媒体走，之前用 8kHz 会把整个会话拖到 8kHz，随后播放的 TTS 语音被压到
    // 4kHz 以下，听感发闷。48kHz 是手机硬件的原生采样率。单声道即可，双声道下
    // 交错写入的 ±1 会退化成左右声道各自的直流，反而失去"有能量"的意义。
    const sampleRate = 48000;
    const samples = sampleRate;
    const buf = new ArrayBuffer(44 + samples * 2);
    const view = new DataView(buf);
    const writeStr = (off: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
    writeStr(0, "RIFF");
    view.setUint32(4, 36 + samples * 2, true);
    writeStr(8, "WAVE");
    writeStr(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeStr(36, "data");
    view.setUint32(40, samples * 2, true);
    // ±1 LSB 微噪声（约 -90dB，不可闻）：纯零波形会被 Chrome 判为"无声页面"，
    // 安卓后台 5 分钟后定时器被强节流（轮询延迟拉到分钟级）；有能量的音频
    // 可获得 "playing audio" 豁免。
    for (let i = 0; i < samples; i++) {
        view.setInt16(44 + i * 2, i % 2 === 0 ? 1 : -1, true);
    }
    const blob = new Blob([buf], { type: "audio/wav" });
    _keepAliveAudio.src = URL.createObjectURL(blob);
    _keepAliveAudio.loop = true;
    _keepAliveAudio.volume = 0.01;
}


function removeGestures() {
    document.removeEventListener("touchstart", onUserGesture, true);
    document.removeEventListener("click", onUserGesture, true);
}
function onUserGesture() { if (shouldRun()) playKeepAlive(); }
function playKeepAlive() {
    if (!shouldRun() || playPending) return;
    ensureAudioCreated();
    if (!_keepAliveAudio!.paused) { removeGestures(); return; }
    playPending = true;
    const ticket = revision;
    const audio = _keepAliveAudio!;
    void audio.play().then(() => {
        if (!shouldRun()) audio.pause();
        else removeGestures();
    }).catch(() => {
        if (shouldRun()) {
            document.addEventListener("touchstart", onUserGesture, true);
            document.addEventListener("click", onUserGesture, true);
        }
    }).finally(() => {
        playPending = false;
        if (ticket !== revision && shouldRun()) playKeepAlive();
    });
}
async function acquireWakeLock() {
    if (!shouldRun() || document.visibilityState !== "visible" || _wakeLock || wakePending || !("wakeLock" in navigator)) return;
    wakePending = true;
    const ticket = revision;
    try {
        const lock = await navigator.wakeLock.request("screen");
        if (ticket !== revision || !shouldRun() || document.visibilityState !== "visible") {
            await lock.release().catch(() => {});
        } else {
            _wakeLock = lock;
            lock.addEventListener("release", () => { if (_wakeLock === lock) _wakeLock = null; });
        }
    } catch {} finally {
        wakePending = false;
        if (ticket !== revision && shouldRun()) void acquireWakeLock();
    }
}
function pauseKeepAlive(reset = false) {
    revision++;
    const lock = _wakeLock;
    _wakeLock = null;
    if (lock) void lock.release().catch(() => {});
    if (_keepAliveAudio) {
        _keepAliveAudio.pause();
        if (reset) _keepAliveAudio.currentTime = 0;
    }
    removeGestures();
}
function reconcile() {
    if (!shouldRun()) { pauseKeepAlive(!wanted); return; }
    // Start audio before awaiting Wake Lock so the toggle's user gesture is retained.
    playKeepAlive();
    void acquireWakeLock();
}
export function setKeepAliveCallActive(active: boolean) {
    callActive = active;
    if (installed) reconcile();
}
export function installKeepAlive(): () => void {
    if (typeof window === "undefined") return () => {};
    installed = true;
    let disposed = false;
    const sync = () => { wanted = loadKeepAlive(); reconcile(); };
    const visible = () => { if (document.visibilityState === "visible") sync(); };
    const phone = (event: Event) => {
        phoneActive = !!(event as CustomEvent<{active?: boolean}>).detail?.active;
        reconcile();
    };
    window.addEventListener(KEEP_ALIVE_CHANGED, sync);
    window.addEventListener("phone-call-state", phone);
    document.addEventListener("visibilitychange", visible);
    void hydrateKvDb().then(() => { if (!disposed) sync(); }).catch(() => {});
    return () => {
        disposed = true;
        installed = false;
        wanted = false;
        phoneActive = false;
        window.removeEventListener(KEEP_ALIVE_CHANGED, sync);
        window.removeEventListener("phone-call-state", phone);
        document.removeEventListener("visibilitychange", visible);
        pauseKeepAlive(true);
        if (_keepAliveAudio) {
            URL.revokeObjectURL(_keepAliveAudio.src);
            _keepAliveAudio = null;
        }
    };
}
