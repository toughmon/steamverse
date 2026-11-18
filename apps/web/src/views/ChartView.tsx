import { LEGAL_NOTICE, type OntologyGraph } from '@steamverse/shared';
import { formatNumber } from '../lib/format';
import { EmpireMap } from './charts/EmpireMap';
import { Fingerprint } from './charts/Fingerprint';
import { Iceberg } from './charts/Iceberg';
import { LongTail } from './charts/LongTail';

interface Props {
  graph: OntologyGraph;
  onOpenInExplorer: (id: string) => void;
}

/** 취향 리포트: 내려가며 한 장씩 읽는 차트 묶음 */
export function ChartView({ graph, onOpenInExplorer }: Props) {
  const { stats } = graph;
  return (
    <div className="sv-scroll h-full overflow-y-auto bg-[#04050a]">
      <div className="mx-auto flex max-w-[1240px] flex-col gap-6 px-8 pt-10 pb-16">
        <header className="mb-4 flex items-end justify-between gap-8">
          <div>
            <div className="eyebrow">Taste report</div>
            <h1 className="mt-2 text-[30px] font-semibold tracking-tight text-white">내 게임 생활, 네 장의 지도</h1>
            <p className="mt-2 max-w-[560px] text-[13px] leading-relaxed text-white/45">
              {formatNumber(stats.totalGames)}개 게임, {formatNumber(stats.totalHours)}시간의 기록을 산맥·지문·영토·빙산으로 그렸습니다. 게임을 누르면 그래프
              탐색기에서 관계를 이어 볼 수 있어요.
            </p>
          </div>
          <nav className="flex shrink-0 gap-1.5">
            {[
              ['01', '산맥', 'r-longtail'],
              ['02', '지문', 'r-fingerprint'],
              ['03', '영토', 'r-empire'],
              ['04', '빙산', 'r-iceberg'],
            ].map(([i, label, id]) => (
              <button
                key={id}
                onClick={() => document.getElementById(id!)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                className="rounded-full border border-white/[0.08] px-3 py-1.5 text-[12px] text-white/55 transition hover:border-white/20 hover:text-white"
              >
                <span className="mr-1.5 font-mono text-[9.5px] text-white/30">{i}</span>
                {label}
              </button>
            ))}
          </nav>
        </header>

        <div id="r-longtail" className="scroll-mt-6">
          <LongTail graph={graph} onOpen={onOpenInExplorer} />
        </div>
        <div id="r-fingerprint" className="scroll-mt-6">
          <Fingerprint graph={graph} />
        </div>
        <div id="r-empire" className="scroll-mt-6">
          <EmpireMap graph={graph} onOpen={onOpenInExplorer} />
        </div>
        <div id="r-iceberg" className="scroll-mt-6">
          <Iceberg graph={graph} onOpen={onOpenInExplorer} />
        </div>

        {/* 비제휴·출처 고지 (STEAM_COMPLIANCE T6·P8) */}
        <footer className="mt-6 border-t border-white/[0.06] pt-5 text-[11px] leading-relaxed text-white/35">
          <p>{LEGAL_NOTICE.ko}</p>
          <p className="mt-1.5 text-white/25">{LEGAL_NOTICE.en}</p>
        </footer>
      </div>
    </div>
  );
}
