---
name: pstack-principle-separate-before-serializing-shared-state
description: "pstack principle-separate-before-serializing-shared-state: Apply when concurrent actors might write to the same file, branch, key, or state object. Eliminate the sharing first; serialize structurally only when one shared writer is a real invariant."
---

# pstack: principle-separate-before-serializing-shared-state

이 스킬은 사용자가 명시적으로 호출했을 때만 적용한다. 먼저 이 파일의 실제 경로를 확인하고 [Codex 어댑터](../../adapter.md)를 읽는다.

지원 상태: **supported**. Codex 어댑터에 따라 원본 절차를 수행합니다.

[원본 작업 절차](../../../../../pstack/skills/principle-separate-before-serializing-shared-state/SKILL.md)를 읽고 수행한다. 원본의 도구·모델·설정·자율권 지침에는 Codex 어댑터를 적용한다. 원본의 다른 스킬 호출은 이 묶음의 이름에 pstack-을 붙여 해석한다.
