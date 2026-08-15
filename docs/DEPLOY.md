# 배포 가이드

PlayHub는 두 조각으로 나뉩니다.

| 조각 | 하는 일 | 필요한 것 |
|---|---|---|
| **웹 클라이언트** | 15가지 게임 전부, 컴퓨터 대전, 한 기기 2인 대전 | 정적 호스팅이면 충분 (무료) |
| **서버** | 로비·채팅·온라인 1대1·대회 | Node.js를 돌릴 수 있는 곳 |

**웹만 올려도 게임은 전부 됩니다.** 서버는 "다른 사람"을 더해 줄 뿐입니다.

---

## 1단계 — 웹 클라이언트를 GitHub Pages에 (무료)

저장소에 `.github/workflows/pages.yml`이 이미 들어 있습니다. 할 일은 한 번의 설정뿐입니다.

1. 저장소 **Settings → Pages**로 갑니다.
2. **Source**를 **GitHub Actions**로 바꿉니다.
3. 기본 브랜치에 푸시합니다.
   아직 병합 전이라면 **Actions 탭 → "Deploy to GitHub Pages" → Run workflow**에서
   원하는 브랜치를 골라 바로 배포할 수 있습니다.

> 워크플로는 브랜치 이름을 `main`으로 못박지 않고 **저장소의 기본 브랜치**를 기준으로
> 동작합니다. 기본 브랜치 이름이 무엇이든 그대로 작동합니다.

몇 분 뒤 아래 주소에서 열립니다.

```
https://<사용자이름>.github.io/<저장소이름>/
```

이 저장소라면 `https://elel99gg34-code.github.io/mmmm/` 입니다.

> **빌드 단계가 없습니다.** 클라이언트는 순수 ES 모듈이고 `shared/`의 규칙 엔진을
> 그대로 import합니다. 워크플로는 `index.html`, `app/`, `shared/`를 그대로 복사할 뿐입니다.

이제 접속한 사람은 15가지 게임을 **컴퓨터와** 또는 **한 기기에서 둘이** 즐길 수 있습니다.

### 주소를 더 예쁘게 (도메인 없이, 무료)

기본 주소는 `https://<사용자이름>.github.io/<저장소이름>/` 입니다. 저장소 이름이 곧
주소이므로, **저장소 이름을 바꾸는 것이 가장 싸고 빠른 개선**입니다.

```
Settings → Repository name → playhub
→ https://<사용자이름>.github.io/playhub/
```

코드는 전부 상대 경로라 경로가 바뀌어도 그대로 동작합니다. 서비스도, DNS도, 비용도
필요 없습니다.

### 사용자 지정 도메인 쓰기 (선택)

저장소 루트에 `CNAME` 파일을 만들고 도메인 한 줄만 적으면 됩니다.

```
www.example.com
```

**주의 — 이 파일이 배포 산출물에 포함되어야 합니다.** Pages는 저장소가 아니라
발행된 산출물 안의 `CNAME`을 읽습니다. 워크플로가 이미 복사하도록 되어 있습니다.
(복사하지 않으면 배포할 때마다 사용자 지정 도메인 설정이 저절로 풀립니다.)

도메인을 산 곳(등록기관)의 DNS에 아래 레코드를 넣습니다.

| 종류 | 이름(호스트) | 값 |
|---|---|---|
| `CNAME` | `www` | `<사용자이름>.github.io.` |

apex 도메인(`example.com`, www 없이)으로도 들어오게 하려면 A/AAAA 레코드를 함께 넣습니다.
GitHub이 안내하는 주소는 바뀔 수 있으니 최종 확인은
[GitHub 문서](https://docs.github.com/pages/configuring-a-custom-domain-for-your-github-pages-site)에서 하세요.

| 종류 | 이름 | 값 |
|---|---|---|
| `A` | `@` | `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153` |
| `AAAA` | `@` | `2606:50c0:8000::153`, `2606:50c0:8001::153`, `2606:50c0:8002::153`, `2606:50c0:8003::153` |

DNS가 퍼진 뒤(보통 몇 분~몇 시간) **Settings → Pages → Enforce HTTPS**를 켜세요.
인증서는 GitHub이 무료로 발급합니다.

> ⚠️ **DNS를 먼저 걸고 CNAME을 나중에 올리세요.** 순서가 반대면, 도메인이 아직
> 응답하지 않는 동안 Pages가 기본 주소(`github.io`)로 온 요청을 그 도메인으로
> **301(영구) 리다이렉트**합니다. 브라우저는 301을 오래 캐시하기 때문에, 나중에
> 설정을 지워도 그 브라우저에서는 계속 죽은 도메인으로 튕깁니다. 시크릿 창에서
> 열어 보면 바로 확인됩니다.

**서버도 같은 도메인 아래에 두면 깔끔합니다.** 게임 서버를 배포한 뒤
`play.example.com` 같은 서브도메인을 CNAME으로 붙이면 `DEFAULT_SERVER`가
호스팅 업체 주소에 묶이지 않습니다.

| 종류 | 이름 | 값 |
|---|---|---|
| `CNAME` | `play` | 배포한 서버 주소 (예: `playhub-xxxx.onrender.com.`) |

```js
// app/js/config.js
export const DEFAULT_SERVER = 'wss://play.example.com/ws';
```

---

## 2단계 — 서버 올리기 (온라인 대전용)

아래 중 하나만 고르면 됩니다. 어느 쪽이든 `https://` 주소를 받고, WebSocket 주소는
같은 호스트에 `wss://` + `/ws`입니다.

### 방법 A — Render (제일 쉬움, 무료 플랜 있음)

1. [render.com](https://render.com)에 가입하고 GitHub 계정을 연결합니다.
2. **New → Blueprint**를 누르고 이 저장소를 고릅니다.
3. Render가 저장소의 [`render.yaml`](../render.yaml)을 읽어 알아서 설정합니다.
4. **Apply**를 누르고 기다립니다.

받는 주소: `https://playhub-xxxx.onrender.com`
서버 주소로 넣을 값: `wss://playhub-xxxx.onrender.com/ws`

> 무료 인스턴스는 15분간 요청이 없으면 잠듭니다. 다음 방문자는 깨어나는 동안 몇 초
> 기다립니다. 대회를 열 계획이라면 유료 플랜이나 Fly.io를 권합니다.

### 방법 B — Fly.io (한국에서 가장 빠름)

[`fly.toml`](../fly.toml)이 도쿄 리전(`nrt`)으로 설정되어 있습니다.

```bash
# flyctl 설치: https://fly.io/docs/hands-on/install-flyctl/
fly auth login
fly launch --no-deploy    # 앱 이름만 정하고, 기존 fly.toml을 그대로 씁니다
fly deploy
```

받는 주소: `https://<앱이름>.fly.dev` → `wss://<앱이름>.fly.dev/ws`

`min_machines_running = 1`로 잡아 두어 한 대는 항상 깨어 있습니다.

### 방법 C — Railway

1. [railway.app](https://railway.app)에서 **New Project → Deploy from GitHub repo**.
2. [`railway.json`](../railway.json)을 자동으로 읽습니다.
3. **Settings → Networking**에서 도메인을 하나 생성합니다.

### 방법 D — Docker (직접 서버가 있다면)

```bash
docker build -t playhub .
docker run -d --name playhub -p 8080:8080 --restart unless-stopped playhub
```

이 방식은 웹과 서버를 **같은 주소에서** 제공하므로 접속자가 서버 주소를 입력할
필요조차 없습니다. 클라이언트가 자기 출처를 자동으로 확인해서 연결합니다.

공개하려면 앞단에 HTTPS 리버스 프록시를 둡니다. Caddy 예시:

```caddyfile
play.example.com {
    reverse_proxy localhost:8080
}
```

Caddy는 WebSocket 업그레이드를 자동으로 넘겨 주고 인증서도 알아서 발급합니다.

nginx를 쓴다면 업그레이드 헤더를 직접 넘겨야 합니다:

```nginx
location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_read_timeout 300s;   # WebSocket이 조용할 때 끊기지 않도록
}
```

---

## 3단계 — 둘을 연결하기

### 방법 1: 기본 서버로 박아 두기 (권장)

[`app/js/config.js`](../app/js/config.js)를 열고 한 줄만 고칩니다.

```js
export const DEFAULT_SERVER = 'wss://playhub-xxxx.onrender.com/ws';
```

푸시하면 Pages가 다시 배포됩니다. 이제 **방문자는 아무것도 하지 않아도**
온라인 로비에 자동으로 들어갑니다.

### 방법 2: 각자 입력하기

오른쪽 위 연결 칩(●)을 눌러 주소를 넣습니다. 브라우저에 저장되어 다음부터는
자동으로 연결됩니다.

### 방법 3: 링크로 공유하기

```
https://<사용자이름>.github.io/<저장소>/?server=wss://내서버.example.com/ws
```

링크를 받은 사람은 열기만 하면 그 서버에 연결됩니다.

---

## 접속 허용 범위 제한하기 (선택)

기본값은 **모든 origin 허용**입니다. 아무나 여러분의 서버에 붙어도 된다는 뜻이라
공개 허브라면 그대로 두어도 괜찮습니다.

내 Pages 사이트에서만 쓰게 하려면 서버에 환경 변수를 넣습니다.

```
ALLOWED_ORIGINS=https://<사용자이름>.github.io
```

여러 개는 쉼표로 구분합니다. 직접 만든 클라이언트(브라우저가 아닌 도구)는
`Origin` 헤더가 없으므로 이 제한에 걸리지 않습니다.

---

## 계정 데이터 보관하기 (중요)

서버는 계정을 `DATA_DIR/accounts.json` (기본 `./data/accounts.json`) 한 파일에 보관합니다.
데이터베이스가 없어서 설치가 간단한 대신, **호스팅의 디스크가 초기화되면 계정도 사라집니다.**

| 호스팅 | 기본 상태 | 계정을 지키려면 |
|---|---|---|
| Render 무료 | 재배포·재시작마다 초기화 | Persistent Disk(유료)를 붙이고 `DATA_DIR=/var/data` 지정 |
| Render 유료 + Disk | 유지됨 | `DATA_DIR`을 디스크 마운트 경로로 |
| Fly.io | 볼륨 없으면 초기화 | `fly volumes create playhub_data --size 1` 후 `fly.toml`의 `[mounts]` 주석 해제 |
| Railway | Volume 없으면 초기화 | Volume을 붙이고 `DATA_DIR` 지정 |
| Docker | 컨테이너와 함께 사라짐 | `-v playhub-data:/app/data` |

세션 토큰 서명 키(`AUTH_SECRET`)도 함께 신경 써야 합니다. 지정하지 않으면 첫 실행 때
만들어 데이터 파일에 저장하는데, 파일이 초기화되면 키도 바뀌어 **모두가 로그아웃**됩니다.
디스크가 사라질 수 있는 곳이라면 환경 변수로 직접 넣어 두세요.

```bash
# 아무 긴 무작위 문자열이면 됩니다
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

계정 기능이 필요 없다면 `ACCOUNTS=0` 으로 손님 전용 서버가 됩니다. 저장할 것이 없으니
디스크 고민도 사라집니다.

## 서버 사양

작습니다. 인스턴스 하나에서:

- 접속 수백 명 (`ws` 소켓 하나당 수 KB)
- 게임 진행은 10Hz 타이머 하나로 전부 처리
- 데이터베이스 없음, 디스크 쓰기 없음, 상태는 전부 메모리

즉 **서버를 재시작하면 진행 중인 방과 대회는 사라집니다.** 이건 의도한 선택입니다.
저장할 것이 없으니 백업도, 마이그레이션도, 개인정보 보관도 없습니다.
무료 플랜의 256MB 인스턴스로도 넉넉합니다.

---

## 잘 되는지 확인하기

```bash
curl https://<서버주소>/healthz
# {"ok":true,"uptimeMs":...,"online":0,"rooms":0,"tournaments":0,"games":15,...}
```

`games`가 15면 엔진까지 정상 로드된 것입니다.

| 엔드포인트 | 용도 |
|---|---|
| `GET /healthz` | 상태 확인 (호스팅 헬스체크용) |
| `GET /api/games` | 게임 목록 |
| `GET /api/lobby` | 현재 로비 상태 |
| `WS /ws` | 게임 프로토콜 |

---

## 문제 해결

**연결 칩이 계속 "연결 중"에서 멈춥니다**
`https://` 페이지에서는 `wss://`만 쓸 수 있습니다. `ws://`를 넣으면 브라우저가
막습니다. 주소를 `wss://`로 바꾸세요.

**"이 서버는 현재 페이지의 접속을 허용하지 않습니다"**
서버의 `ALLOWED_ORIGINS`에 여러분의 Pages 주소가 빠져 있습니다. 추가하거나 값을 비우세요.

**첫 접속이 20~30초 걸립니다**
무료 플랜 인스턴스가 잠들어 있었습니다. Fly.io의 `min_machines_running = 1`이나
유료 플랜을 쓰면 없어집니다.

**Pages 배포가 404가 납니다**
Settings → Pages의 Source가 **GitHub Actions**인지 확인하세요. `Deploy from a branch`로
되어 있으면 워크플로 결과가 반영되지 않습니다.

**리버스 프록시 뒤에서 소켓이 자꾸 끊깁니다**
프록시의 read timeout을 늘리세요(위 nginx 예시의 `proxy_read_timeout`). 서버는
30초마다 ping을 보내지만, 프록시가 그보다 짧게 잡혀 있으면 소용이 없습니다.
