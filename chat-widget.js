/**
 * CHEB VPN — Chat Support Widget
 * Подключение: <script src="/chat-widget.js" defer></script>
 */
(function () {
  'use strict';

  const API = '/api/chat';
  const AVATAR_BOT  = '/avatar_danil.jpg'; // временно — аватарка Данила как лицо поддержки
  const AVATAR_OP   = '/avatar_danil.jpg';
  const POLL_MS     = 4000;

  // ── localStorage helpers ──────────────────────────────────────────────────
  function getGuestId() {
    let id = localStorage.getItem('chvpn_guest_id');
    if (!id) {
      id = 'g_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem('chvpn_guest_id', id);
    }
    return id;
  }
  function getSession()       { return localStorage.getItem('chvpn_session_id'); }
  function saveSession(sid)   { localStorage.setItem('chvpn_session_id', sid); }
  function clearSession()     { localStorage.removeItem('chvpn_session_id'); }

  // ── Device hint ──────────────────────────────────────────────────────────
  function deviceHint() {
    const ua = navigator.userAgent;
    if (/iPhone|iPad/i.test(ua)) return 'ios';
    if (/Android/i.test(ua)) return 'android';
    if (/Windows/i.test(ua)) return 'windows';
    if (/Mac/i.test(ua)) return 'mac';
    return '';
  }

  // ── API calls ─────────────────────────────────────────────────────────────
  async function apiPost(path, body) {
    const r = await fetch(API + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return r.json();
  }
  async function apiGet(path) {
    const r = await fetch(API + path);
    return r.json();
  }

  // ── State ────────────────────────────────────────────────────────────────
  let sessionId = null;
  let guestId   = getGuestId();
  let pollTimer = null;
  let lastMsgCount = 0;
  let isOpen    = false;
  let isEscalated = false;
  let showEscalateBtn = false;

  // ── Render helpers ───────────────────────────────────────────────────────
  function escHtml(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
            .replace(/"/g,'&quot;');
  }
  // Простой markdown → html (жирный, ссылки, переносы)
  function mdToHtml(s) {
    return escHtml(s)
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(/\*(.+?)\*/g, '<i>$1</i>')
      .replace(/`(.+?)`/g, '<code>$1</code>')
      .replace(/\n/g, '<br>');
  }

  function avatarFor(role) {
    if (role === 'operator') return `<img class="chvpn-avatar" src="${AVATAR_OP}" alt="Данил">`;
    if (role === 'bot')      return `<img class="chvpn-avatar" src="${AVATAR_BOT}" alt="Алекс">`;
    return '';
  }

  function renderMessage(msg) {
    const isUser = msg.role === 'user';
    const side   = isUser ? 'chvpn-msg-user' : 'chvpn-msg-bot';
    const name   = msg.role === 'operator' ? 'Данил' : (msg.role === 'bot' ? 'Алекс' : '');
    return `
      <div class="chvpn-msg ${side}">
        ${!isUser ? avatarFor(msg.role) : ''}
        <div class="chvpn-bubble">
          ${name ? `<div class="chvpn-name">${name}</div>` : ''}
          <div class="chvpn-text">${mdToHtml(msg.text)}</div>
        </div>
      </div>`;
  }

  // ── DOM refs ─────────────────────────────────────────────────────────────
  let $msgs, $input, $send, $buttons, $escalateRow, $typing;

  function scrollBottom() {
    if ($msgs) $msgs.scrollTop = $msgs.scrollHeight;
  }

  function appendMessage(msg) {
    if (!$msgs) return;
    $msgs.insertAdjacentHTML('beforeend', renderMessage(msg));
    scrollBottom();
  }

  function showTyping(on) {
    if ($typing) $typing.style.display = on ? 'flex' : 'none';
  }

  function setInputDisabled(dis) {
    if ($input) $input.disabled = dis;
    if ($send)  $send.disabled  = dis;
  }

  function renderButtons(btns) {
    if (!$buttons) return;
    $buttons.innerHTML = '';
    (btns || []).forEach(label => {
      const b = document.createElement('button');
      b.className = 'chvpn-quick-btn';
      b.textContent = label;
      b.onclick = () => { $buttons.innerHTML = ''; sendMessage(label); };
      $buttons.appendChild(b);
    });
  }

  function showEscalate(show) {
    if (!$escalateRow) return;
    $escalateRow.style.display = show ? 'block' : 'none';
  }

  // ── Chat logic ────────────────────────────────────────────────────────────
  async function initSession() {
    const existing = getSession();
    const data = await apiPost('/init', {
      guest_id: guestId,
      page_url: location.href,
      device_hint: deviceHint(),
      ...(existing ? { session_id: existing } : {}),
    });
    sessionId = data.session_id;
    saveSession(sessionId);
    lastMsgCount = 0;
    if ($msgs) $msgs.innerHTML = '';
    (data.messages || []).forEach(m => appendMessage(m));
    lastMsgCount = (data.messages || []).length;
    renderButtons(data.buttons);
    startPolling();
  }

  async function sendMessage(text) {
    if (!text || !sessionId) return;
    text = text.trim();
    if (!text) return;
    if ($input) $input.value = '';
    appendMessage({ role: 'user', text });
    setInputDisabled(true);
    showTyping(true);
    renderButtons([]);
    showEscalate(false);
    try {
      const data = await apiPost('/send', {
        session_id: sessionId,
        guest_id: guestId,
        text,
      });
      showTyping(false);
      setInputDisabled(false);
      if (data.reply) {
        appendMessage({ role: 'bot', text: data.reply });
        lastMsgCount += 2;
      }
      if (data.escalated) {
        isEscalated = true;
        showEscalate(false);
      } else if (data.show_escalate) {
        showEscalate(true);
      }
    } catch (e) {
      showTyping(false);
      setInputDisabled(false);
      appendMessage({ role: 'bot', text: 'Что-то пошло не так, попробуй ещё раз 🙏' });
    }
    if ($input) $input.focus();
  }

  async function escalate() {
    if (!sessionId) return;
    showEscalate(false);
    try {
      const data = await apiPost('/escalate', { session_id: sessionId, guest_id: guestId });
      if (data.message) appendMessage({ role: 'bot', text: data.message });
      isEscalated = true;
    } catch {}
  }

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(async () => {
      if (!sessionId || !isOpen) return;
      try {
        const data = await apiGet(`/history?session_id=${sessionId}&guest_id=${guestId}`);
        const msgs = data.messages || [];
        if (msgs.length > lastMsgCount) {
          const newMsgs = msgs.slice(lastMsgCount);
          newMsgs.forEach(m => {
            if (m.role !== 'user') appendMessage(m);
          });
          lastMsgCount = msgs.length;
        }
      } catch {}
    }, POLL_MS);
  }

  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  // ── Build widget DOM ──────────────────────────────────────────────────────
  function buildWidget() {
    const style = document.createElement('style');
    style.textContent = `
      #chvpn-widget { position: fixed; z-index: 9999; font-family: 'Onest', 'Inter', sans-serif; }

      /* Кнопка открытия */
      #chvpn-fab {
        position: fixed; bottom: 24px; right: 24px;
        width: 56px; height: 56px; border-radius: 50%;
        background: #5e6ad2; border: none; cursor: pointer;
        box-shadow: 0 4px 20px rgba(94,106,210,.45);
        display: flex; align-items: center; justify-content: center;
        transition: transform .2s, box-shadow .2s;
        z-index: 9999;
      }
      #chvpn-fab:hover { transform: scale(1.08); box-shadow: 0 6px 28px rgba(94,106,210,.6); }
      #chvpn-fab svg { width: 26px; height: 26px; fill: #fff; }
      #chvpn-fab .chvpn-badge {
        position: absolute; top: 0; right: 0;
        width: 16px; height: 16px; border-radius: 50%;
        background: #e5484d; border: 2px solid #fff;
        display: none;
      }
      #chvpn-fab.has-new .chvpn-badge { display: block; }

      /* Popup */
      #chvpn-popup {
        position: fixed; bottom: 90px; right: 24px;
        width: 360px; max-height: 520px;
        background: #18181b; border: 1px solid #2e2e33;
        border-radius: 16px; box-shadow: 0 12px 48px rgba(0,0,0,.5);
        display: flex; flex-direction: column;
        overflow: hidden; opacity: 0; pointer-events: none;
        transform: translateY(12px) scale(.97);
        transition: opacity .2s, transform .2s;
        z-index: 9998;
      }
      #chvpn-popup.open { opacity: 1; pointer-events: all; transform: none; }

      /* Header */
      .chvpn-header {
        display: flex; align-items: center; gap: 10px;
        padding: 14px 16px; background: #1c1c20;
        border-bottom: 1px solid #2e2e33; flex-shrink: 0;
      }
      .chvpn-header img { width: 36px; height: 36px; border-radius: 50%; object-fit: cover; }
      .chvpn-header-info { flex: 1; }
      .chvpn-header-name { color: #fff; font-size: 14px; font-weight: 600; }
      .chvpn-header-status { color: #5e6ad2; font-size: 12px; }
      .chvpn-close {
        background: none; border: none; cursor: pointer;
        color: #666; font-size: 20px; line-height: 1; padding: 4px;
      }
      .chvpn-close:hover { color: #999; }

      /* Messages */
      #chvpn-msgs {
        flex: 1; overflow-y: auto; padding: 12px 12px 4px;
        scroll-behavior: smooth;
      }
      #chvpn-msgs::-webkit-scrollbar { width: 4px; }
      #chvpn-msgs::-webkit-scrollbar-track { background: transparent; }
      #chvpn-msgs::-webkit-scrollbar-thumb { background: #333; border-radius: 2px; }

      .chvpn-msg { display: flex; gap: 8px; margin-bottom: 10px; }
      .chvpn-msg-user { flex-direction: row-reverse; }
      .chvpn-avatar { width: 28px; height: 28px; border-radius: 50%; object-fit: cover; flex-shrink: 0; align-self: flex-end; }
      .chvpn-bubble { max-width: 82%; }
      .chvpn-name { font-size: 11px; color: #888; margin-bottom: 3px; }
      .chvpn-text {
        display: inline-block; padding: 8px 12px;
        border-radius: 12px; font-size: 13.5px; line-height: 1.45; color: #e4e4e7;
      }
      .chvpn-msg-bot .chvpn-text { background: #27272a; border-radius: 4px 12px 12px 12px; }
      .chvpn-msg-user .chvpn-text { background: #5e6ad2; color: #fff; border-radius: 12px 4px 12px 12px; }

      /* Typing indicator */
      #chvpn-typing { display: none; align-items: center; gap: 8px; padding: 0 12px 8px; }
      #chvpn-typing img { width: 28px; height: 28px; border-radius: 50%; object-fit: cover; }
      .chvpn-dots { display: flex; gap: 4px; background: #27272a; padding: 8px 12px; border-radius: 12px; }
      .chvpn-dots span {
        width: 6px; height: 6px; border-radius: 50%; background: #888;
        animation: chvpn-bounce .9s infinite;
      }
      .chvpn-dots span:nth-child(2) { animation-delay: .15s; }
      .chvpn-dots span:nth-child(3) { animation-delay: .3s; }
      @keyframes chvpn-bounce {
        0%,60%,100% { transform: translateY(0); }
        30% { transform: translateY(-5px); }
      }

      /* Quick buttons */
      #chvpn-buttons { padding: 4px 12px 8px; display: flex; flex-wrap: wrap; gap: 6px; flex-shrink: 0; }
      .chvpn-quick-btn {
        background: #27272a; border: 1px solid #3f3f46;
        color: #a1a1aa; font-size: 12px; border-radius: 20px;
        padding: 5px 12px; cursor: pointer; transition: all .15s;
      }
      .chvpn-quick-btn:hover { background: #3f3f46; color: #fff; border-color: #5e6ad2; }

      /* Escalate */
      #chvpn-escalate-row { padding: 4px 12px 8px; flex-shrink: 0; }
      #chvpn-escalate-btn {
        width: 100%; background: #27272a; border: 1px solid #3f3f46;
        color: #a1a1aa; font-size: 12.5px; border-radius: 8px;
        padding: 8px; cursor: pointer; transition: all .15s;
      }
      #chvpn-escalate-btn:hover { background: #3f3f46; color: #fff; }

      /* Input row */
      .chvpn-input-row {
        display: flex; gap: 8px; padding: 10px 12px 12px;
        border-top: 1px solid #2e2e33; flex-shrink: 0; background: #18181b;
      }
      #chvpn-input {
        flex: 1; background: #27272a; border: 1px solid #3f3f46;
        border-radius: 8px; padding: 8px 12px;
        color: #e4e4e7; font-size: 13.5px; outline: none; resize: none;
        font-family: inherit; max-height: 80px; min-height: 36px;
        line-height: 1.4;
      }
      #chvpn-input:focus { border-color: #5e6ad2; }
      #chvpn-input::placeholder { color: #52525b; }
      #chvpn-send {
        background: #5e6ad2; border: none; border-radius: 8px;
        width: 36px; height: 36px; cursor: pointer; flex-shrink: 0;
        display: flex; align-items: center; justify-content: center;
        transition: background .15s; align-self: flex-end;
      }
      #chvpn-send:hover { background: #6e7ae2; }
      #chvpn-send:disabled { background: #3f3f46; cursor: default; }
      #chvpn-send svg { width: 16px; height: 16px; fill: #fff; }

      /* Mobile slide-up */
      @media (max-width: 480px) {
        #chvpn-popup {
          bottom: 0; right: 0; left: 0; width: 100%;
          max-height: 85vh; border-radius: 16px 16px 0 0;
          transform: translateY(100%);
        }
        #chvpn-popup.open { transform: translateY(0); }
        #chvpn-fab { bottom: 16px; right: 16px; }
      }
    `;
    document.head.appendChild(style);

    document.body.insertAdjacentHTML('beforeend', `
      <button id="chvpn-fab" aria-label="Открыть чат поддержки">
        <svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z"/></svg>
        <span class="chvpn-badge"></span>
      </button>

      <div id="chvpn-popup" role="dialog" aria-label="Чат поддержки">
        <div class="chvpn-header">
          <img src="/avatar_danil.jpg" alt="Данил">
          <div class="chvpn-header-info">
            <div class="chvpn-header-name">Поддержка CHEB VPN</div>
            <div class="chvpn-header-status">● Онлайн</div>
          </div>
          <button class="chvpn-close" id="chvpn-close-btn" aria-label="Закрыть">✕</button>
        </div>
        <div id="chvpn-msgs"></div>
        <div id="chvpn-typing">
          <img src="/avatar_danil.jpg" alt="">
          <div class="chvpn-dots"><span></span><span></span><span></span></div>
        </div>
        <div id="chvpn-buttons"></div>
        <div id="chvpn-escalate-row" style="display:none">
          <button id="chvpn-escalate-btn">👋 Позвать менеджера Данила</button>
        </div>
        <div class="chvpn-input-row">
          <textarea id="chvpn-input" placeholder="Напиши сообщение..." rows="1"></textarea>
          <button id="chvpn-send" aria-label="Отправить">
            <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
          </button>
        </div>
      </div>
    `);

    $msgs        = document.getElementById('chvpn-msgs');
    $input       = document.getElementById('chvpn-input');
    $send        = document.getElementById('chvpn-send');
    $buttons     = document.getElementById('chvpn-buttons');
    $escalateRow = document.getElementById('chvpn-escalate-row');
    $typing      = document.getElementById('chvpn-typing');

    const fab    = document.getElementById('chvpn-fab');
    const popup  = document.getElementById('chvpn-popup');
    const closeBtn = document.getElementById('chvpn-close-btn');
    const escalateBtn = document.getElementById('chvpn-escalate-btn');

    // Auto-resize textarea
    $input.addEventListener('input', () => {
      $input.style.height = 'auto';
      $input.style.height = Math.min($input.scrollHeight, 80) + 'px';
    });

    fab.addEventListener('click', () => toggleChat(popup, fab));
    closeBtn.addEventListener('click', () => closeChat(popup));

    $send.addEventListener('click', () => {
      sendMessage($input.value);
    });
    $input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage($input.value);
      }
    });
    escalateBtn.addEventListener('click', () => escalate());
  }

  function toggleChat(popup, fab) {
    if (isOpen) { closeChat(popup, fab); return; }
    isOpen = true;
    popup.classList.add('open');
    fab.classList.remove('has-new');
    fab.style.display = 'none';
    if (!sessionId) {
      sessionId = getSession();
      initSession();
    } else {
      startPolling();
    }
    setTimeout(() => { if ($input) $input.focus(); }, 300);
  }

  function closeChat(popup, fab) {
    isOpen = false;
    popup.classList.remove('open');
    stopPolling();
    const fabEl = fab || document.getElementById('chvpn-fab');
    if (fabEl) fabEl.style.display = 'flex';
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', buildWidget);
  } else {
    buildWidget();
  }

})();
