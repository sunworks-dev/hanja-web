// Flutter가 준비되기 전의 안내·인사. 첫 프레임 뒤에는 이벤트와 타이머를 남기지 않는다.
(function () {
  'use strict';

  var boot = document.getElementById('boot');
  if (!boot) return;
  var msg = document.getElementById('boot-msg');
  var retry = document.getElementById('boot-retry');
  var greet = document.getElementById('boot-greet');
  var reaction = document.getElementById('boot-reaction');
  var done = false;
  var slowTimer;
  var roarTimer;
  var reactionTimer;

  function stage(text) {
    if (done || boot.dataset.state !== 'loading') return;
    msg.textContent = text;
  }

  function fail(text) {
    if (done) return;
    clearTimeout(slowTimer);
    boot.dataset.state = 'error';
    msg.textContent = text;
    retry.hidden = false;
  }

  function retryLoad() {
    location.reload();
  }

  function greetTiger() {
    if (done) return;
    clearTimeout(roarTimer);
    clearTimeout(reactionTimer);
    boot.classList.remove('is-roaring');
    reaction.textContent = '';
    // 같은 인사도 live region의 별도 변경으로 읽히게 한다.
    reactionTimer = setTimeout(function () {
      if (!done) reaction.textContent = '어흥! 반가워요.';
    }, 0);
    var reducedMotion = window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // 연속 클릭도 이전 애니메이션의 끝을 기다리지 않고 다시 시작한다.
    // 모션 감소에서는 CSS가 말풍선만 정적으로 표시한다.
    if (!reducedMotion) void boot.offsetWidth;
    boot.classList.add('is-roaring');
    roarTimer = setTimeout(function () {
      if (!done) boot.classList.remove('is-roaring');
    }, 650);
  }

  function scriptFailed(event) {
    if (event.target && event.target.tagName === 'SCRIPT') {
      fail('앱 파일을 받지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.');
    }
  }

  function visibilityChanged() {
    if (!done) boot.dataset.paused = String(document.hidden);
  }

  function finish() {
    if (done) return;
    done = true;
    clearTimeout(slowTimer);
    clearTimeout(roarTimer);
    clearTimeout(reactionTimer);
    window.removeEventListener('flutter-first-frame', finish);
    window.removeEventListener('error', scriptFailed, true);
    document.removeEventListener('visibilitychange', visibilityChanged);
    retry.removeEventListener('click', retryLoad);
    greet.removeEventListener('click', greetTiger);
    boot.classList.remove('is-roaring');
    boot.remove();
    // bootstrap의 늦은 Promise가 API를 불러도 제거한 DOM을 다시 만지지 않는다.
    boot = msg = retry = greet = reaction = null;
  }

  window.hanjaBoot = { stage: stage, fail: fail };
  window.addEventListener('flutter-first-frame', finish);
  window.addEventListener('error', scriptFailed, true);
  document.addEventListener('visibilitychange', visibilityChanged);
  visibilityChanged();
  retry.addEventListener('click', retryLoad);
  greet.addEventListener('click', greetTiger);
  greet.disabled = false;
  slowTimer = setTimeout(function () {
    if (done || boot.dataset.state !== 'loading') return;
    boot.dataset.state = 'slow';
    msg.textContent = '시간이 오래 걸리고 있어요. 계속 기다리거나 다시 시도할 수 있어요.';
    retry.hidden = false;
  }, 20000);
})();
