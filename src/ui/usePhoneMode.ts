import { PHONE_QUERY } from "../domain/layout/breakpoints";
import { useMediaQuery } from "./useMediaQuery";

/** 휴대폰 "재생·녹음" 모드인가(화면 폭 768px 미만, 설계서 §P6-5). 화면 폭이 바뀌면 따라 바뀐다. */
export function usePhoneMode(): boolean {
  return useMediaQuery(PHONE_QUERY);
}
