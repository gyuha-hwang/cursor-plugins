---
name: pstack-setup-pstack
description: "pstack setup-pstack: Configure which models pstack uses per role and at what reasoning budget. Detects your available models and writes an always-applied rule that overrides the skill defaults. Use for $pstack-setup-pstack, \"configure pstack models\", \"pstack budget\", or changing pstack's model choices."
---

# pstack: setup-pstack

이 스킬은 사용자가 명시적으로 호출했을 때만 적용한다. 먼저 이 파일의 실제 경로를 확인하고 [Codex 어댑터](../../adapter.md)를 읽는다.

지원 상태: **supported**. 설치 상태와 모델 상속을 확인합니다. 원본 모델 규칙 파일은 쓰지 않습니다.

모델 설정 파일을 생성하지 않는다. 현재 설치본의 manifest.json과 관리 도구 status 결과를 바탕으로 버전, 명시 호출 방식, 모델 상속, 선택적 도구의 설치 여부를 안내한다.
