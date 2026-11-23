# 0009 프로젝트 파일 형식

- 상태: 확정 (2026-11-23, 설계서 추천안 채택)
- 결정: 새 프로젝트 파일 `.adproj`는 압축하지 않은 zip이다. 안에 `project.json`과 `audio/` 폴더(음원 SHA-256 해시 이름)를 둔다. 옛 JSON 두 형식(`format: "accompany-designer-project", version: 1`과 형식 표시가 없는 v0)은 계속 읽는다.
- 이유: 음원은 이미 압축된 형식이라 zip 압축 이득이 작고, 압축하지 않으면 만들고 여는 속도가 빠르다. 해시 이름으로 같은 음원의 중복 저장과 재연결 판단이 쉬워진다.
- 영향: P4-1(문서 형식 v2와 `parseProject`), P4-2(`.adproj`와 재연결 대화상자). `projectStorage`의 옛 형식 읽기 코드는 삭제하지 않고 `parseProject`가 호출한다.
- 다르게 정하면: JSON을 유지하면 P4-2가 줄지만 큰 곡의 메모리 문제가 남는다.
