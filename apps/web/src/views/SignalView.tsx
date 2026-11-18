import { LEGAL_NOTICE, type OntologyGraph } from '@steamverse/shared';
import { formatNumber } from '../lib/format';
import { EraSwarm } from './signal/EraSwarm';
import { GenreSunburst } from './signal/GenreSunburst';
import { SleepFlow } from './signal/SleepFlow';
import { TasteChord } from './signal/TasteChord';

interface Props {
  graph: OntologyGraph;
  onOpenInExplorer: (id: string) => void;
}

const SECTIONS = [
  ['01', '코드', 's-chord'],
  ['02', '궤도', 's-sunburst'],
  ['03', '시대', 's-swarm'],
  ['04', '흐름', 's-sankey'],
] as const;

/** 시그널: 관계를 따라 흐르는 네 장의 차트 (코드·선버스트·비스웜·생키) */
export function SignalView({ graph, onOpenInExplorer }: Props) {
  const { stats } = graph;
  return (
    <div className="sv-scroll h-full overflow-y-auto bg-[#04050a]">
      <div className="mx-auto flex max-w-[1240px] flex-col gap-6 px-8 pt-10 pb-16">
        <header className="mb-4 flex items-end justify-between gap-8">
          <div>
            <div className="eyebrow">Signals</div>
            <h1 className="mt-2 text-[30px] font-semibold tracking-tight text-white">취향을 관통하는 네 개의 신호</h1>
            <p className="mt-2 max-w-[560px] text-[13px] leading-relaxed text-white/45">
              {formatNumber(stats.totalGames)}개 게임의 태그·장르·출시 연도·회사가 서로 어떻게 엮여 있는지 따라가 봅니다. 차트마다 "표로 보기"로 숫자를 그대로 볼 수
              있어요.
            </p>
          </div>
          <nav className="flex shrink-0 gap-1.5">
            {SECTIONS.map(([i, label, id]) => (
              <button
                key={id}
                onClick={() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                className="rounded-full border border-white/[0.08] px-3 py-1.5 text-[12px] text-white/55 transition hover:border-white/20 hover:text-white"
              >
                <span className="mr-1.5 font-mono text-[9.5px] text-white/30">{i}</span>
                {label}
              </button>
            ))}
          </nav>
        </header>

        <div id="s-chord" className="scroll-mt-6">
          <TasteChord graph={graph} />
        </div>
        <div id="s-sunburst" className="scroll-mt-6">
          <GenreSunburst graph={graph} onOpen={onOpenInExplorer} />
        </div>
        <div id="s-swarm" className="scroll-mt-6">
          <EraSwarm graph={graph} onOpen={onOpenInExplorer} />
        </div>
        <div id="s-sankey" className="scroll-mt-6">
          <SleepFlow graph={graph} />
        </div>

        <footer className="mt-6 border-t border-white/[0.06] pt-5 text-[11px] leading-relaxed text-white/35">
          <p>{LEGAL_NOTICE.ko}</p>
          <p className="mt-1.5 text-white/25">{LEGAL_NOTICE.en}</p>
        </footer>
      </div>
    </div>
  );
}
