# 운영 설정 체크리스트 (대시보드에서 직접 해야 하는 것)

코드로 처리할 수 없는 설정입니다. 설계서 §6의 P1-1, P1-2, P1-5에 해당합니다. 아래를 마치면 `[ ]`를 `[x]`로 바꿉니다. 메뉴 이름은 화면을 직접 보지 못해 조금 다를 수 있습니다.

## Vercel (결정 0001)

- [ ] **이 저장소와 연결된 Vercel 계정·프로젝트를 찾는다.** 이 작업에 연결된 팀(kimyounggaur's projects)에는 프로젝트가 0개라, 배포한 계정이 다른 계정일 가능성이 큽니다.
- [ ] 프로젝트 설정 → Git → **Production Branch를 `master`로** 바꾼다. (지금까지 어느 브랜치가 운영으로 나갔는지는 확인하지 못했습니다.)
- [ ] 프로젝트 설정 → Environments(또는 Environment Variables)에서 **시스템 환경 변수 노출**(`VERCEL_GIT_COMMIT_SHA`)이 켜져 있는지 본다. 꺼져 있으면 화면의 빌드 표시가 `빌드 local`로 나옵니다.
- [ ] 빌드 설정의 **Node.js 버전을 22.x 이상**으로 맞춘다(`package.json`의 `engines: >=22.12.0`, `.nvmrc`는 `22`).
- [ ] **수용 확인:** master에 병합한 뒤 운영 주소 화면의 상태 줄 오른쪽 끝에 보이는 `빌드 xxxxxxx`가 `git rev-parse --short=7 HEAD`와 같다. PR마다 미리보기 주소가 생긴다.
- 되돌리기: Vercel의 이전 배포로 되돌리기(Instant Rollback).

## GitHub (결정 0001, 설계서 P1-1·P1-2)

- [ ] 저장소 설정 → Default branch를 `master`로 바꾼다.
- [ ] 옛 `main`(4월 코드)은 태그로 남긴 뒤 지운다.
  ```bash
  git tag archive/main-2026-04 origin/main
  git push origin archive/main-2026-04
  git push origin --delete main
  ```
- [ ] 저장소 설정 → Pages를 끈다. (코드의 `pages.yml`과 `build:pages`는 P1-2에서 삭제합니다.) 이미 Pages 주소를 알린 사람이 있다면 끄기 전에 "주소가 바뀌었습니다" 안내 한 장을 2~4주 올려 둘 수 있습니다.
- [ ] README 첫 줄의 "공식 주소"에 Vercel 주소 하나를 적는다. 이때 `index.html`의 `og:image`(`/og.png`)도 절대 주소(`https://<공식 주소>/og.png`)로 바꾼다. 카카오톡·슬랙 같은 곳의 공유 미리보기는 절대 주소가 있어야 이미지를 가져옵니다.

## CI와 브랜치 보호 (설계서 P1-5)

- [ ] 저장소 설정 → Branches → `master` 보호 규칙: PR로만 변경, 필수 검사 `check`, `e2e`.
- [ ] **수용 확인:** 일부러 테스트 하나를 깨뜨린 PR이 병합 버튼을 막는다.

## 선택: 과거 이력 정리 (설계서 P1-3, 실행하지 않음)

저장소 이력에 `node_modules` 약 103MB가 남아 있습니다. 지우려면 이력을 다시 써야 하며 **모든 커밋 번호가 바뀝니다.** 용량이 실제로 문제일 때만, 열린 PR이 없을 때, 백업 후 설계서 §6 P1-3의 `git filter-repo` 절차로 한 번에 합니다. 이 작업은 자동으로 실행하지 않았습니다.
