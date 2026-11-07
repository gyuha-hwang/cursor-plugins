---
name: pstack-principle-guard-the-context-window
description: "pstack principle-guard-the-context-window: Apply when context is filling up: large outputs, long files, repeated reads, fan-out planning. Route bulk to subagents; keep summaries in the main thread, not raw payloads."
---

# pstack: principle-guard-the-context-window

이 스킬은 사용자가 명시적으로 호출했을 때만 적용한다. 먼저 이 파일의 실제 경로를 확인하고 [Codex 어댑터](../../adapter.md)를 읽는다.

지원 상태: **conditional**. 필요한 도구가 실제 제공되는지 확인합니다. 생략·순차 대체·교차 검증 미실행을 구분해 보고합니다.

[원본 작업 절차](../../../../../pstack/skills/principle-guard-the-context-window/SKILL.md)를 읽고 수행한다. 원본의 도구·모델·설정·자율권 지침에는 Codex 어댑터를 적용한다. 원본의 다른 스킬 호출은 이 묶음의 이름에 pstack-을 붙여 해석한다.
