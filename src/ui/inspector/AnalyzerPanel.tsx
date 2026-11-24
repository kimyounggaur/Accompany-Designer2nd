import { useEffect, useState } from "react";
import { SpectrumAnalyzer } from "../../components/SpectrumAnalyzer";
import { audioEngine } from "../../audio/currentEngine";
import { PanelSection } from "./PanelSection";

/** 소리 엔진이 아직 준비되지 않았을 때 다시 물어보는 간격(밀리초) */
const ANALYSER_RETRY_MS = 500;

/** 분석기 칸: 소리 엔진이 준비되면 분석 노드를 받아 스펙트럼을 그린다 */
export function AnalyzerPanel() {
  const [analyser, setAnalyser] = useState<AnalyserNode | undefined>(undefined);

  // 오디오 컨텍스트는 처음 소리를 낼 때 만들어지므로, 준비될 때까지 잠시 간격을 두고 다시 묻는다
  useEffect(() => {
    let timer: number | undefined;
    const tryGetAnalyser = () => {
      const node = audioEngine.getAnalyser();
      if (node) {
        setAnalyser(node);
      } else {
        timer = window.setTimeout(tryGetAnalyser, ANALYSER_RETRY_MS);
      }
    };
    tryGetAnalyser();
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <PanelSection id="spectrum" title="분석기" className="spec-panel">
      <SpectrumAnalyzer analyser={analyser} />
    </PanelSection>
  );
}
