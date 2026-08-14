/**
 * The connection dialog.
 *
 * On GitHub Pages there is no server at the page's own origin, so this is the
 * one piece of setup a player might have to do. It explains that in a sentence
 * and remembers the answer.
 */
import { el, modal, toast } from '../ui.js';
import { store } from '../store.js';
import { normalizeServerUrl, saveServer, savedServer, sameOriginServer, probeSameOrigin } from '../config.js';
import { connect, disconnect } from '../net.js';

export function openServerDialog() {
  const input = el('input.input', {
    type: 'text',
    placeholder: 'wss://my-playhub.onrender.com',
    value: store.serverUrl || savedServer(),
    autocomplete: 'off',
    spellcheck: 'false',
  });

  const status = el('p.field-hint');
  const sameOriginRow = el('div');

  const close = modal({
    title: '서버 연결',
    body: [
      el(
        'p.field-hint',
        { style: { marginBottom: '12px' } },
        '다른 사람과 온라인으로 놀려면 PlayHub 서버가 필요합니다. ' +
          '직접 띄운 서버 주소나, 친구에게 받은 주소를 넣어 주세요. 서버 없이도 모든 게임을 혼자·둘이 즐길 수 있습니다.',
      ),
      el('div.field', {}, [
        el('label', {}, '서버 주소'),
        input,
        el('span.field-hint', {}, 'https:// 또는 wss:// 로 시작하는 주소. 경로를 생략하면 /ws 가 붙습니다.'),
      ]),
      sameOriginRow,
      status,
    ],
    actions: () => [
      store.serverUrl
        ? el(
            'button.btn.danger',
            {
              type: 'button',
              onClick: () => {
                disconnect();
                saveServer('');
                toast('연결을 끊었습니다.');
                close();
              },
            },
            '연결 끊기',
          )
        : null,
      el('button.btn', { type: 'button', onClick: () => close() }, '취소'),
      el(
        'button.btn.primary',
        {
          type: 'button',
          onClick: () => {
            const url = normalizeServerUrl(input.value);
            if (!url) {
              status.textContent = '주소를 이해할 수 없습니다. 예: wss://example.com/ws';
              status.style.color = 'var(--bad)';
              return;
            }
            saveServer(url);
            connect(url);
            toast('연결하는 중…');
            close();
          },
        },
        '연결',
      ),
    ],
  });

  // Offer the page's own origin when a server actually answers there.
  probeSameOrigin().then((ok) => {
    if (!ok) return;
    const url = sameOriginServer();
    sameOriginRow.append(
      el('div.field', {}, [
        el(
          'button.btn.block',
          {
            type: 'button',
            onClick: () => {
              input.value = url;
              status.textContent = '이 페이지를 제공하는 서버를 사용합니다.';
              status.style.color = 'var(--good)';
            },
          },
          `이 페이지의 서버 사용 (${new URL(url).host})`,
        ),
      ]),
    );
  });
}
