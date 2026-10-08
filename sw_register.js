// 서비스 워커 등록과 상태 전달. 오프라인 준비는 **사용자가 설정에서 켠 경우에만** 시작한다
// (저장 용량이 커서 기본은 꺼짐). 이미 등록된 워커는 켠 상태로 보고 업데이트를 이어 간다.
// 상태는 window.hanjaOffline에 두고 변할 때마다 'hanja-offline' 이벤트를 보낸다.
//   state: 'checking' | 'off' | 'unsupported' | 'preparing' | 'ready' | 'unavailable'
//   waiting: 새 버전 캐시가 다 채워져 대기 중(다시 열면 적용)
//   announce: 이번 실행에서 ready/unavailable로 바뀐 직후(한 번만 알리기 위한 표시)
//   updateFailed: 업데이트 설치 실패 사유('quota'|'timeout'|'http'|'network'|'' ) — 알림은 24시간에 한 번
// 서비스 워커가 어떤 이유로든 안 되면 앱은 서비스 워커 없이 그대로 온라인으로 동작한다.
// 문제 시 ?nosw=1로 열면 이 앱(scope)의 등록 해제·캐시 삭제를 하고 등록하지 않는다.
(function () {
  var OPTIN = 'hanja_offline_optin';
  var FAIL_AT = 'hanja_offline_fail_at';
  var NOTICE_AT = 'hanja_update_fail_notice_at';
  var DAY = 24 * 60 * 60 * 1000;
  // stamp가 산출물 총 바이트로 바꾼다. 개발 서버에서는 0이라 100MB로 어림한다.
  var NEEDED_BYTES = 68672251;

  var st = (window.hanjaOffline = {
    state: 'checking',
    waiting: false,
    announce: false,
    updateFailed: null,
    update: function () {},
    enable: function () { return Promise.resolve('unsupported'); },
    disable: function () { return Promise.resolve(); },
  });
  function emit() {
    try { window.dispatchEvent(new Event('hanja-offline')); } catch (_) {}
  }
  function set(state, announce) {
    var changed = st.state !== state;
    st.state = state;
    if (announce && changed) st.announce = true;
    emit();
  }
  function ls(key, value) {
    try {
      if (value === undefined) return localStorage.getItem(key);
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, String(value));
    } catch (_) {}
    return null;
  }
  function recent(key) {
    var t = Number(ls(key));
    return t > 0 && Date.now() - t < DAY;
  }
  var firstFrame = false;
  window.addEventListener('flutter-first-frame', function () { firstFrame = true; });
  var scopeUrl = new URL('./', document.baseURI).href;
  var supported = 'serviceWorker' in navigator && 'caches' in window;

  // 저장 공간이 부족해도 브라우저가 학습 기록 DB(IndexedDB/OPFS)를 지우지 않도록 1회 요청한다.
  // 이미 허용됐으면 다시 묻지 않고, API가 없거나 실패해도 조용히 넘어간다(부팅을 막지 않음).
  try {
    var sm = navigator.storage;
    if (sm && sm.persist && sm.persisted) {
      sm.persisted().then(function (ok) { return ok || sm.persist(); }).catch(function () {});
    }
  } catch (_) {}

  // 이 앱(scope)의 등록만 해제한다. 같은 origin의 다른 앱 워커는 건드리지 않는다.
  function cleanup() {
    var jobs = [];
    try {
      jobs.push(navigator.serviceWorker.getRegistrations().then(function (regs) {
        return Promise.all(regs.filter(function (r) { return r.scope === scopeUrl; })
          .map(function (r) { return r.unregister(); }));
      }));
      jobs.push(caches.keys().then(function (names) {
        return Promise.all(names.filter(function (n) { return n.indexOf('hanja-') === 0; })
          .map(function (n) { return caches.delete(n); }));
      }));
    } catch (_) {}
    return Promise.all(jobs).catch(function () {});
  }

  if (/[?&]nosw=1(&|$)/.test(location.search)) {
    ls(OPTIN, null);
    st.state = 'off';
    if (supported) cleanup();
    return;
  }
  if (!supported) { st.state = 'unsupported'; return; }

  function failReason(e) { return e && typeof e === 'string' ? e : ''; }

  function track(reg) {
    st.update = function () {
      if (recent(FAIL_AT)) return; // 실패 뒤 24시간은 확인하지 않는다
      reg.update().catch(function () {});
    };
    function watch(worker, first) {
      worker.addEventListener('statechange', function () {
        if (worker.state === 'installed') {
          if (first) set('ready', true);
          else { st.waiting = true; emit(); }
        } else if (worker.state === 'redundant' && first && !reg.active) {
          ls(FAIL_AT, Date.now());
          set('unavailable', true);
        }
      });
    }
    if (reg.active) {
      // 활성 워커는 install(전체 저장)을 끝낸 것이다. 개발 서버용 빈 워커만 구분한다.
      var ch = new MessageChannel();
      ch.port1.onmessage = function (e) { set(e.data && e.data.dev ? 'unsupported' : 'ready', false); };
      reg.active.postMessage({ type: 'status' }, [ch.port2]);
    } else if (reg.installing) {
      set('preparing', false);
      watch(reg.installing, true);
    } else if (reg.waiting) {
      set('preparing', false);
    }
    if (reg.waiting && navigator.serviceWorker.controller) { st.waiting = true; emit(); }
    reg.addEventListener('updatefound', function () {
      var w = reg.installing;
      if (w) watch(w, !reg.active);
    });
  }

  // 워커가 설치 실패를 알린다. 업데이트 실패는 하루에 한 번만 앱에 전달한다.
  navigator.serviceWorker.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || d.type !== 'install-failed') return;
    ls(FAIL_AT, Date.now());
    if (d.update) {
      if (!recent(NOTICE_AT)) {
        ls(NOTICE_AT, Date.now());
        st.updateFailed = failReason(d.reason) || 'network';
        emit();
      }
    } else {
      st.updateFailedReason = failReason(d.reason);
    }
  });

  function register() {
    // 'sw.js'는 <base href> 기준 상대 경로, scope './'는 sw.js가 있는 하위 경로(/hanja-web/)다.
    return navigator.serviceWorker.register('sw.js', { scope: './' }).then(track).catch(function () {
      ls(FAIL_AT, Date.now());
      set('unavailable', true);
    });
  }

  function hasRoom() {
    var need = (NEEDED_BYTES || 100 * 1024 * 1024) * 1.5;
    if (!(navigator.storage && navigator.storage.estimate)) return Promise.resolve(true);
    return navigator.storage.estimate().then(function (e) {
      return !e || !e.quota || e.quota - (e.usage || 0) >= need;
    }).catch(function () { return true; });
  }

  // 사용자가 설정에서 켠다. 'started' | 'no-space' | 'unsupported'
  st.enable = function () {
    var conn = navigator.connection;
    if (conn && conn.saveData) return Promise.resolve('unsupported');
    return hasRoom().then(function (ok) {
      if (!ok) return 'no-space';
      ls(OPTIN, '1');
      ls(FAIL_AT, null);
      set('preparing', false);
      register();
      return 'started';
    });
  };
  st.disable = function () {
    ls(OPTIN, null);
    ls(FAIL_AT, null);
    st.waiting = false;
    return cleanup().then(function () { set('off', false); });
  };

  // 시작: 이미 등록된 워커가 있으면 이어 가고, 없으면 켜 둔 사용자만 등록한다.
  navigator.serviceWorker.getRegistration('./').then(function (reg) {
    var live = reg && (reg.active || reg.installing || reg.waiting);
    if (live && /sw\.js$/.test((live.scriptURL || ''))) { track(reg); return; }
    if (ls(OPTIN) !== '1') { set('off', false); return; }
    if (recent(FAIL_AT)) { set('unavailable', false); return; }
    // 첫 화면과 저장 다운로드가 경쟁하지 않게 첫 프레임 뒤에 시작한다.
    set('preparing', false);
    var go = function () { setTimeout(register, 3000); };
    if (firstFrame) go();
    else window.addEventListener('flutter-first-frame', go, { once: true });
  }).catch(function () { set('off', false); });
})();
