const $ = id => document.getElementById(id);
const video = $('camera'), canvas = $('roi'), ctx = canvas.getContext('2d', {willReadFrequently: true});
let token = 0, stream = null, timer = null, callback = null, busy = false, upload = null;
const failures = {
  torch_unavailable: '这台设备或浏览器无法启用闪光灯，请换用支持的手机。',
  insufficient_duration: '有效采集不足 20 秒，请重新测量。', frame_interruption: '视频帧中断，请保持页面前台并重测。',
  unstable_frame_rate: '帧率不稳定，请关闭其他占用摄像头的程序后重测。',
  finger_not_covered: '未检测到稳定的手指覆盖，请轻盖镜头与闪光灯。',
  exposure_clipped: '画面过亮或过暗，请调整手指位置后重测，不要用力按压。',
  signal_too_weak: '脉动信号太弱，请调整位置后重测。', motion_or_pressure_change: '信号变化过大，请保持手指和手机不动后重测。',
  bpm_out_of_range: '本工具无法可靠估算这次读数，请重新测量。',
  inconsistent_pulse: '前后两段信号不一致，请重新测量。', low_signal_quality: '信号质量不足，请重新测量。'
};
function errorText(error) {
  const known = {NotAllowedError:'未获得摄像头权限，请允许后再重试。', NotFoundError:'未找到可用的后置摄像头。',
    OverconstrainedError:'摄像头不支持本次后置采集要求，请换用支持的手机。', NotReadableError:'摄像头被占用或无法读取。',
    AbortError:'操作已取消或请求超时。'};
  return known[error?.name] || error?.message?.trim() || '摄像头授权未完成或设备无法提供采集，请重试。';
}
function controls(active) {
  busy = active;
  for (const id of ['pre', 'post', 'reset']) $(id).disabled = active;
  $('stop').disabled = !active;
}
function releaseCamera() {
  clearTimeout(timer); timer = null;
  if (callback !== null) {
    if (video.cancelVideoFrameCallback) video.cancelVideoFrameCallback(callback);
    else cancelAnimationFrame(callback);
  }
  callback = null;
  if (stream) stream.getTracks().forEach(track => track.stop()); // also releases torch
  stream = null; video.srcObject = null;
}
function stop(message = '已停止，本次未完成的采集不提交。') {
  token++; releaseCamera(); upload?.abort(); upload = null; controls(false); $('status').textContent = message;
}
async function request(path, options = {}) {
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : `请求被拒绝 (${response.status})`);
  return data;
}
async function summary() {
  $('details').textContent = JSON.stringify(await request('/api/session/summary'), null, 2);
}
async function measure(phase) {
  if (busy) return;
  const run = ++token; controls(true); $('result').textContent = ''; $('progress').value = 0;
  try {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('需要可信 HTTPS 和摄像头支持；手机访问普通局域网 HTTP 不可采集。');
    const sentAt = Date.now()/1000;
    const sensor = await request('/api/sensor/status');
    if (run !== token) return;
    const offset = sensor.server_timestamp - (sentAt + Date.now()/1000)/2;
    if (sensor.mode !== 'mixed') throw new Error('请先设置 SENSOR_MODE=mixed 并重启后端。');
    if (phase === 'post') {
      const records = await request('/api/session/summary');
      if (run !== token) return;
      if (records.pre_ritual_hr === null) throw new Error('请先完成前测。');
    }
    $('status').textContent = '请允许后置摄像头。授权后将自动开启闪光灯；你可以随时停止。';
    const acquired = await navigator.mediaDevices.getUserMedia({audio: false,
      video: {facingMode: {exact: 'environment'}, width: {ideal: 320}, height: {ideal: 240}, frameRate: {ideal: 30, max: 30}}});
    if (run !== token) { acquired.getTracks().forEach(t => t.stop()); return; }
    stream = acquired; video.srcObject = acquired; await video.play();
    if (run !== token) return;
    const track = stream.getVideoTracks()[0];
    if (!track.getCapabilities?.().torch) throw new Error(failures.torch_unavailable);
    await track.applyConstraints({advanced: [{torch: true}]});
    if (run !== token) return;
    if (track.getSettings().torch === false) throw new Error(failures.torch_unavailable);
    track.addEventListener('ended', () => { if (run === token && busy) stop('摄像头已断开，请重新测量。'); }, {once: true});
    $('status').textContent = '轻盖镜头，保持不动。正在等待曝光稳定…';
    const warmupUntil = performance.now() + 1500;
    let startMedia = null, lastMedia = -1;
    const samples = [];
    timer = setTimeout(() => { if (run === token) stop('采集超时或视频中断，请重新测量。'); }, 32000);
    const schedule = () => {
      callback = video.requestVideoFrameCallback ? video.requestVideoFrameCallback(capture) : requestAnimationFrame(now => capture(now, {mediaTime: video.currentTime}));
    };
    async function capture(now, metadata) {
      if (run !== token) return;
      try {
        if (now < warmupUntil || metadata.mediaTime <= lastMedia) { schedule(); return; }
        lastMedia = metadata.mediaTime;
        if (startMedia === null) startMedia = lastMedia;
        const elapsed = lastMedia-startMedia;
        const w = video.videoWidth, h = video.videoHeight;
        if (!w || !h) { schedule(); return; }
        ctx.drawImage(video, w/4, h/4, w/2, h/2, 0, 0, 32, 32);
        const pixels = ctx.getImageData(0, 0, 32, 32).data;
        let r=0, g=0, b=0;
        for (let i=0; i<pixels.length; i+=4) { r+=pixels[i]; g+=pixels[i+1]; b+=pixels[i+2]; }
        samples.push({t: elapsed, r: r/1024, g: g/1024, b: b/1024});
        $('progress').value = Math.min(25, elapsed);
        $('status').textContent = `采集中 ${Math.min(25, elapsed).toFixed(1)} / 25 秒，请保持不动。`;
        if (samples.length > 1200) throw new Error('帧数量异常，请重测。');
        if (elapsed < 25) { schedule(); return; }
        const timestamp = Date.now()/1000 + offset;
        releaseCamera(); $('status').textContent = '摄像头与闪光灯已关闭，正在校验信号…';
        upload = new AbortController();
        timer = setTimeout(() => upload?.abort(), 10000);
        const result = await request('/api/sensor/ppg', {method: 'POST', headers: {'Content-Type':'application/json'},
          signal: upload.signal, body: JSON.stringify({timestamp, session_id: sensor.session_id, phase, torch_enabled: true, samples})});
        clearTimeout(timer); upload = null;
        if (run !== token) return;
        $('result').textContent = result.valid ? `估算心率 ${result.heart_rate} BPM · 工程质量 ${result.signal_quality.toFixed(2)}` : '本次无有效心率，未写入缓存。';
        $('status').textContent = result.valid ? '已记录短测结果。TTL到期后会回退模拟信号；这不是连续心率。' : (failures[result.failure_reason] || '信号无效，请重新测量。');
        controls(false); await summary();
      } catch (error) { if (run === token) stop(`测量未完成：${errorText(error)} 可重新测量；若提交已到达服务器，请刷新记录核对。`); }
    }
    schedule();
  } catch (error) { if (run === token) stop(`无法开始：${errorText(error)}`); }
}
$('pre').onclick = () => measure('pre'); $('post').onclick = () => measure('post');
$('stop').onclick = () => stop();
$('summary').onclick = () => summary().catch(error => { $('status').textContent = error.message; });
$('reset').onclick = async () => {
  if (busy) return;
  controls(true);
  try { await request('/api/demo', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({scenario:'calming'})});
    $('status').textContent = '新会话已建立，请先前测，再连接正式视觉页面。'; await summary();
  } catch(error) { $('status').textContent = error.message; } finally { controls(false); }
};
document.addEventListener('visibilitychange', () => { if (document.hidden && busy) stop('页面已离开前台，本次采集停止。'); });
window.addEventListener('pagehide', () => stop());
summary().catch(() => {});
