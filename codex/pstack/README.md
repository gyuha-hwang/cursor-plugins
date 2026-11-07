# pstack를 Codex에서 사용하기

이 포크는 [cursor/plugins](https://github.com/cursor/plugins)의 pstack에 개인용 Codex 어댑터를 추가한다. 원본 pstack와 Claude Code 설치 방식은 유지한다. Codex에는 58개 스킬의 명시 호출 진입점을 제공하며, Cursor 전용 기능까지 구현한 것은 아니다. 지원 상태와 실행 조건은 [호환 목록](compatibility.json), 실제 대응은 [어댑터](adapter.md)에 있다.

## 설치와 호출

Node 24와 Git을 사용한다. 최초 설치는 다음과 같다. `TESTED_COMMIT`에는 이 포크에서 검사한 **전체 커밋 SHA** 또는 검증된 태그를 넣는다. 움직이는 main 브랜치는 설치 대상으로 받지 않는다.

```sh
git clone https://github.com/gyuha-hwang/cursor-plugins.git ~/.codex/pstack/source
cd ~/.codex/pstack/source
git remote add upstream https://github.com/cursor/plugins.git
node codex/pstack/scripts/manage.mjs install --ref TESTED_COMMIT
node codex/pstack/scripts/manage.mjs status
```

이미 체크아웃이 있다면 다시 clone하지 않는다. 설치 도구는 추적된 커밋에서 원본 자료와 생성된 진입점을 추출해 `~/.codex/pstack/releases/`에 보존하고 `~/.agents/skills/pstack-*`를 연결한다. 소스 체크아웃의 미커밋 변경은 설치되지 않는다. `CODEX_HOME`이 있으면 설치 저장소 기본값은 그 아래 `pstack/`다. 테스트·다른 사용자 경로에는 `--home`과 `--skills-dir`을 함께 지정할 수 있다. 같은 이름의 기존 파일은 덮어쓰지 않는다.

새 Codex 세션에서 다음과 같이 요청한다. 목록이 갱신되지 않으면 세션을 다시 시작한다.

```text
$pstack-poteto-help 사용할 수 있는 기능과 제한을 알려줘
$pstack-poteto-mode 이 문제를 재현하고 원인을 고친 뒤 실제 동작으로 검증해줘
$pstack-how 이 모듈의 호출 흐름을 코드 근거로 설명해줘
$pstack-setup-pstack 현재 설치 상태를 확인해줘
```

일반 대화에서는 자동 적용하지 않는다. 내부에서 필요한 스킬만 읽으며 모델·추론 강도는 세션 설정을 따른다. 기존 `[agents]` 기본 모델을 별도로 설정했다면 해당 설정이 상속 동작에 영향을 줄 수 있다. 다중 모델 검토는 기본 제공하지 않는다. `make-bot-ui`는 Cursor 자동화·비밀 요청에 의존하므로 미지원이다. statechart의 Java/TLC/mise, 동영상 렌더러, watch-pr의 Bun 등은 필요한 기능을 실제 실행할 때 확인한다. 설치 도구가 전역 프로그램을 자동 설치하지는 않는다.

## 갱신·롤백·제거

```sh
git fetch origin
node codex/pstack/scripts/manage.mjs update --ref TESTED_COMMIT
node codex/pstack/scripts/manage.mjs rollback
node codex/pstack/scripts/manage.mjs uninstall
```

갱신은 무결성을 확인한 버전으로 current 링크를 교체한다. 실패하면 현재 설치본을 유지한다. rollback은 직전 설치본과 현재 설치본을 교환한다. 같은 버전의 재설치는 직전 버전 기록을 지우지 않는다. 제거는 이 도구가 관리하는 링크만 해제하며 소스와 버전별 자료는 보존한다. 남아 있는 `.install-lock`은 다른 설치 프로세스가 종료됐는지 확인한 후 빈 디렉터리만 `rmdir`로 제거한다.

## 원본 업데이트를 검토하기

포크의 `pstack upstream sync` Actions가 매주 월요일 09:17 KST에 확인하며 수동 실행도 가능하다. 변경이 없으면 쓰지 않고, 관련 변경이 있으면 원본 전체 이력을 병합한 갱신 PR을 만든다. pstack 외 다른 플러그인 변경도 PR diff에 포함될 수 있다. 열린 갱신 PR이 있으면 먼저 해당 PR을 검토하며 새 PR을 중복 생성하지 않는다. 원본 병합 충돌은 이슈로 남긴다. 자동 병합과 Mac의 설치본 자동 갱신은 하지 않는다.

원본 스킬·공유 자료가 검토된 지문과 달라지면 Draft PR이 된다. 이는 코드 충돌이 없어도 새 지침과 의존성을 검토해야 한다는 뜻이다. 각 스킬을 `supported`, `conditional`, `unsupported`로 분류하고 필요한 도구와 대체 방법을 어댑터/호환 목록에 반영한다. 새 스킬은 목록에 먼저 추가한다. 삭제된 스킬도 검토 명령으로 명시적으로 제거한다. 그런 다음 실제 검토한 항목만 기록한다.

```sh
npm ci --prefix codex/pstack --ignore-scripts
node codex/pstack/scripts/review.mjs --source UPSTREAM_SHA --skill changed-skill
node codex/pstack/scripts/review.mjs --source UPSTREAM_SHA --shared
npm run check --prefix codex/pstack
npm test --prefix codex/pstack
```

여러 스킬은 `--skill`을 반복한다. 남은 미검토 항목이 있으면 생성 검사는 실패한다. 리뷰가 완료된 변경만 커밋하고 CI와 실제 Codex 확인 결과를 검토한 뒤 PR을 병합한다. 로컬 갱신에는 **호환판 병합 커밋 SHA**를 사용한다. 원본 SHA는 Codex 파일을 포함하지 않으므로 설치 대상이 아니다. 기록된 원본 버전·SHA·트리 지문은 [upstream-lock.json](upstream-lock.json)에 있다.

수동 변경 확인은 `npm run upstream:check --prefix codex/pstack`, PR 생성까지는 `node codex/pstack/scripts/sync-upstream.mjs --apply`다. 확인 모드는 GitHub 읽기만 하며, 적용 모드는 깨끗한 체크아웃과 이 포크의 origin을 요구한다. 동일한 원본 SHA의 브랜치가 남은 경우 임의로 덮어쓰지 않고 실패하므로 기존 브랜치/PR을 먼저 확인한다.

포크에서 Actions와 PR 생성 권한을 활성화해야 한다. 정기 워크플로는 기본 GITHUB_TOKEN만 사용한다. 동기화 작업 안에서 검증을 직접 실행하므로, 자동 생성 PR의 별도 CI가 실행 승인을 기다려도 검증 결과를 확인할 수 있다. 공개 저장소가 60일간 비활성이면 GitHub가 예약 실행을 중지할 수 있다. Actions에서 다시 활성화하고 수동 실행한다. [GitHub 예약 실행 정책](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)

## 검증과 유지보수

생성 파일을 직접 고치지 않는다. `adapter.md`, 호환 목록, 생성기를 고친 뒤 `npm run generate --prefix codex/pstack`로 갱신한다. 원본 전체를 복사·번역하는 대신 짧은 Codex 진입점에서 고정된 원본을 읽으므로 상대 링크와 스크립트 권한을 유지한다. 생성된 파일과 원본 자료는 같은 설치 스냅샷에 들어간다.

전체 검사는 다음과 같다. root 의존성은 기존 upstream 검사에 필요하다.

```sh
npm ci --prefix codex/pstack --ignore-scripts
npm install --no-save --no-package-lock --ignore-scripts ajv@8.17.1 ajv-formats@3.0.1 fast-check@4.5.3
node codex/pstack/scripts/check.mjs
git diff --check
```

CI는 생성 무결성·호환 지문·링크·설치/롤백/충돌 처리와 기존 upstream 검사를 확인한다. 실제 모델을 부르는 Codex 행동 검증은 별도로 수행한다. UI·운영·외부 통합 확인을 이 CI 결과로 대신하지 않는다. upstream의 MIT 저작권과 라이선스는 `pstack/LICENSE`에 유지한다. 공개 저장소에는 사용자 설정·인증·대화 기록을 넣지 않는다.

### 최초 호환판의 실제 확인 범위

pstack 0.15.36 / 어댑터 1.0.0을 Node 24와 Codex CLI 0.167.0에서 확인했다. 분류는 지원 36개, 조건부 21개, 미지원 1개다. 이는 모든 스킬의 실사용 시나리오를 끝까지 실행했다는 뜻이 아니다.

- 호환판 자동 검사 21개: 설치 스냅샷, 명시 호출 메타데이터, 지문 변경 감지, 기존 파일 보존, 갱신 실패·롤백·제거, 실제 로컬 Git 병합과 Draft/충돌 처리.
- 원본 statechart 검사: 267개 통과, 선택 도구가 필요한 67개 건너뜀. 실제 TLC 검사는 도구가 준비된 환경에서 별도 실행해야 한다. macOS 임시 경로 별칭으로 인한 상대 symlink 실패를 피하도록 검사 환경 TMPDIR만 실제 경로로 정규화했다. 원본 파일은 변경하지 않았다.
- 실제 Codex 읽기 전용 실행: 도움말·설정 확인·미지원 기능 안내·코드 설명·제공된 요약에서 맥락 회수. swarm은 정확히 두 작업자가 각자 Node를 실행해 결과를 반환하고 상위가 취합하는 것을 확인했다. 모델·추론 강도 인자는 생략했다.
- `--ephemeral` CLI 검증에서는 작업자 생성이 `no rollout found`로 실패했고 순차 확인과 독립 검증 미실행을 보고했다. 일반 CLI 세션과 별도 독립 검증 세션에서는 두 작업자 실행이 성공했다. 따라서 위임이 필요한 작업에는 정상 세션을 사용한다.
- 다중 모델 교차 검증, 전체 58개 스킬의 종단 실행, 실제 브라우저·운영·외부 서비스 통합, 실제 TLC 모델 검증은 이 초기 확인에 포함하지 않았다.
