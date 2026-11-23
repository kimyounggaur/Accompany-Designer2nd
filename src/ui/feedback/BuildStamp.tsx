/** 지금 화면이 어느 빌드인지 보여 준다(배포가 반영됐는지 확인용). 값은 vite.config.ts에서 주입한다. */
export function BuildStamp() {
  return (
    <span className="build-stamp" data-testid="build-stamp" title={`빌드 시각 ${__BUILD_TIME__}`}>
      빌드 {__BUILD_COMMIT__}
    </span>
  );
}
